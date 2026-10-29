import { google } from "googleapis";
import {
  DEFAULT_TIMEZONE,
  DEFAULT_USER_ID,
  DEFAULT_WORKSPACE_ID,
  getSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

export function isGoogleCalendarConfigured(): boolean {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  return Boolean(
    clientId &&
      clientSecret &&
      refreshToken &&
      !clientId.includes("tu-google-client-id")
  );
}

/**
 * Crea el cliente OAuth2 autenticado de Google Calendar.
 * Soporta tanto variables de entorno globales como tokens por usuario almacenados en `user_integrations`.
 */
export async function getGoogleCalendarClient(userId?: string) {
  let clientId = process.env.GOOGLE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    "http://localhost:3000/api/auth/google/callback";
  let refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  let accessToken: string | undefined;
  let calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";

  // Buscar primero si el usuario tiene integración personalizada en Supabase
  if (userId && isSupabaseServerConfigured()) {
    const supabase = getSupabaseServerClient();
    const { data: integration } = await supabase
      .from("user_integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "google_calendar")
      .eq("is_active", true)
      .maybeSingle();

    if (integration) {
      if (integration.refresh_token) refreshToken = integration.refresh_token;
      if (integration.access_token) accessToken = integration.access_token;
      if (integration.config?.calendar_id) {
        calendarId = integration.config.calendar_id;
      }
    }
  }

  if (!clientId || !clientSecret || (!refreshToken && !accessToken)) {
    throw new Error(
      "Credenciales de Google Calendar no configuradas. Revisa GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REFRESH_TOKEN."
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
    access_token: accessToken,
  });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  return { calendar, calendarId };
}

/**
 * Extrae eventos de Google Calendar en tiempo real dentro de un rango de fechas.
 */
export async function fetchGoogleCalendarEvents(options: {
  timeMin: string;
  timeMax: string;
  userId?: string;
}) {
  if (!isGoogleCalendarConfigured()) {
    return [];
  }

  const { calendar, calendarId } = await getGoogleCalendarClient(options.userId);
  const response = await calendar.events.list({
    calendarId,
    timeMin: new Date(options.timeMin).toISOString(),
    timeMax: new Date(options.timeMax).toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
  });

  return response.data.items || [];
}

/**
 * Crea un evento directamente en Google Calendar (Sincronización Bidireccional).
 */
export async function pushEventToGoogleCalendar(
  eventData: {
    title: string;
    description?: string | null;
    start_time: string;
    end_time: string;
    location?: string | null;
    timezone?: string;
  },
  userId?: string
) {
  if (!isGoogleCalendarConfigured()) {
    return null;
  }

  const { calendar, calendarId } = await getGoogleCalendarClient(userId);
  const tz = eventData.timezone || DEFAULT_TIMEZONE;

  const response = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: eventData.title,
      description: eventData.description || undefined,
      location: eventData.location || undefined,
      start: {
        dateTime: new Date(eventData.start_time).toISOString(),
        timeZone: tz,
      },
      end: {
        dateTime: new Date(eventData.end_time).toISOString(),
        timeZone: tz,
      },
    },
  });

  return response.data;
}

/**
 * Actualiza o reprograma un evento existente en Google Calendar.
 */
export async function updateGoogleCalendarEvent(
  googleEventId: string,
  eventData: {
    title?: string;
    description?: string | null;
    start_time?: string;
    end_time?: string;
    location?: string | null;
    timezone?: string;
  },
  userId?: string
) {
  if (!isGoogleCalendarConfigured()) {
    return null;
  }

  const { calendar, calendarId } = await getGoogleCalendarClient(userId);
  const tz = eventData.timezone || DEFAULT_TIMEZONE;

  const requestBody: Record<string, unknown> = {};
  if (eventData.title !== undefined) requestBody.summary = eventData.title;
  if (eventData.description !== undefined)
    requestBody.description = eventData.description;
  if (eventData.location !== undefined) requestBody.location = eventData.location;
  if (eventData.start_time) {
    requestBody.start = {
      dateTime: new Date(eventData.start_time).toISOString(),
      timeZone: tz,
    };
  }
  if (eventData.end_time) {
    requestBody.end = {
      dateTime: new Date(eventData.end_time).toISOString(),
      timeZone: tz,
    };
  }

  const response = await calendar.events.patch({
    calendarId,
    eventId: googleEventId,
    requestBody,
  });

  return response.data;
}

/**
 * Elimina un evento de Google Calendar.
 */
export async function deleteGoogleCalendarEvent(
  googleEventId: string,
  userId?: string
) {
  if (!isGoogleCalendarConfigured()) {
    return false;
  }

  const { calendar, calendarId } = await getGoogleCalendarClient(userId);
  await calendar.events.delete({
    calendarId,
    eventId: googleEventId,
  });

  return true;
}

/**
 * Sincroniza los eventos de Google Calendar hacia la tabla `events` de Supabase.
 */
export async function syncGoogleCalendarToSupabase(options: {
  timeMin: string;
  timeMax: string;
  userId?: string;
  workspaceId?: string;
}) {
  const userId = options.userId || DEFAULT_USER_ID;
  const workspaceId = options.workspaceId || DEFAULT_WORKSPACE_ID;

  const googleItems = await fetchGoogleCalendarEvents({
    timeMin: options.timeMin,
    timeMax: options.timeMax,
    userId,
  });

  if (!isSupabaseServerConfigured() || googleItems.length === 0) {
    return { syncedCount: 0, items: googleItems };
  }

  const supabase = getSupabaseServerClient();
  const upsertedEvents = [];

  for (const item of googleItems) {
    if (!item.id || item.status === "cancelled") continue;

    const startIso =
      item.start?.dateTime ||
      (item.start?.date ? `${item.start.date}T09:00:00.000Z` : null);
    const endIso =
      item.end?.dateTime ||
      (item.end?.date ? `${item.end.date}T10:00:00.000Z` : null);

    if (!startIso || !endIso) continue;

    const { data: existing } = await supabase
      .from("events")
      .select("id")
      .eq("user_id", userId)
      .eq("google_event_id", item.id)
      .maybeSingle();

    const eventPayload = {
      user_id: userId,
      workspace_id: workspaceId,
      title: item.summary || "Evento de Google Calendar",
      description: item.description || null,
      event_type: "appointment",
      status: "scheduled",
      priority: "medium",
      start_time: new Date(startIso).toISOString(),
      end_time: new Date(endIso).toISOString(),
      all_day: Boolean(item.start?.date && !item.start?.dateTime),
      timezone: item.start?.timeZone || DEFAULT_TIMEZONE,
      location: item.location || null,
      meeting_url: item.hangoutLink || null,
      color: "#D96299",
      source: "google_calendar",
      google_event_id: item.id,
      google_etag: item.etag || null,
      sync_status: "synced",
      last_synced_at: new Date().toISOString(),
    };

    const { data, error } = existing?.id
      ? await supabase
          .from("events")
          .update(eventPayload)
          .eq("id", existing.id)
          .select("*")
          .single()
      : await supabase
          .from("events")
          .insert(eventPayload)
          .select("*")
          .single();

    if (!error && data) {
      upsertedEvents.push(data);
    }
  }

  await supabase.from("sync_logs").insert({
    user_id: userId,
    provider: "google_calendar",
    direction: "pull",
    status: "success",
    items_processed: upsertedEvents.length,
    details: { fetched: googleItems.length },
  });

  return {
    syncedCount: upsertedEvents.length,
    items: upsertedEvents,
  };
}
