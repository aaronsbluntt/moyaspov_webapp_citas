import { google } from "googleapis";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  DEFAULT_TIMEZONE,
  DEFAULT_USER_ID,
  DEFAULT_WORKSPACE_ID,
  getSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

const execFileAsync = promisify(execFile);

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
 */
export async function getGoogleCalendarClient(userId?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    "http://localhost:3000/api/auth/google/callback";
  let refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  let accessToken: string | undefined;
  let calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";

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
      "Credenciales OAuth de Google Calendar no configuradas en variables de entorno."
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

interface NormalizedGoogleEvent {
  id: string;
  summary: string;
  description: string | null;
  location: string | null;
  startIso: string;
  endIso: string;
  allDay: boolean;
  timeZone: string;
  htmlLink: string | null;
  etag: string | null;
  eventType: "appointment" | "block";
  status: string;
}

/**
 * Parsea un feed iCal (.ics) de Google Calendar para permitir sincronización en Vercel
 * sin requerir verificación de proyecto en Google Cloud Console.
 */
function parseIcsFeed(icsText: string): NormalizedGoogleEvent[] {
  const events: NormalizedGoogleEvent[] = [];
  const blocks = icsText.split("BEGIN:VEVENT");

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split("END:VEVENT")[0] || "";
    const unfolded = block.replace(/\r?\n[ \t]/g, "");
    const lines = unfolded.split(/\r?\n/);

    let uid = "";
    let summary = "Evento de Google Calendar";
    let description: string | null = null;
    let location: string | null = null;
    let dtStartRaw = "";
    let dtEndRaw = "";
    let isAllDay = false;
    let status = "confirmed";

    for (const line of lines) {
      if (line.startsWith("UID:")) uid = line.slice(4).trim();
      else if (line.startsWith("SUMMARY:"))
        summary = line
          .slice(8)
          .replace(/\\,/g, ",")
          .replace(/\\n/g, " ")
          .trim();
      else if (line.startsWith("DESCRIPTION:"))
        description = line
          .slice(12)
          .replace(/\\,/g, ",")
          .replace(/\\n/g, "\n")
          .trim();
      else if (line.startsWith("LOCATION:"))
        location = line.slice(9).replace(/\\,/g, ",").trim();
      else if (line.startsWith("STATUS:"))
        status = line.slice(7).trim().toLowerCase();
      else if (line.startsWith("DTSTART")) {
        if (line.includes("VALUE=DATE")) isAllDay = true;
        dtStartRaw = line.split(":").slice(1).join(":").trim();
      } else if (line.startsWith("DTEND")) {
        dtEndRaw = line.split(":").slice(1).join(":").trim();
      }
    }

    if (!uid || !dtStartRaw || status === "cancelled") continue;

    const parseIcsDate = (raw: string, allDayFlag: boolean): string | null => {
      if (allDayFlag || /^\d{8}$/.test(raw)) {
        const y = raw.slice(0, 4);
        const m = raw.slice(4, 6);
        const d = raw.slice(6, 8);
        return new Date(`${y}-${m}-${d}T09:00:00-04:00`).toISOString();
      }
      const match = raw.match(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/
      );
      if (match) {
        const [, y, mo, da, h, mi, s, z] = match;
        return new Date(
          `${y}-${mo}-${da}T${h}:${mi}:${s}${z ? "Z" : "-04:00"}`
        ).toISOString();
      }
      return null;
    };

    const startIso = parseIcsDate(dtStartRaw, isAllDay);
    const endIso = dtEndRaw
      ? parseIcsDate(dtEndRaw, isAllDay)
      : startIso
      ? new Date(new Date(startIso).getTime() + 3600000).toISOString()
      : null;

    if (!startIso || !endIso) continue;

    events.push({
      id: uid.replace(/@google\.com$/, ""),
      summary,
      description,
      location,
      startIso,
      endIso,
      allDay: isAllDay,
      timeZone: DEFAULT_TIMEZONE,
      htmlLink: null,
      etag: null,
      eventType: "appointment",
      status: "confirmed",
    });
  }

  return events;
}

/**
 * Extrae eventos de Google Calendar usando:
 * 1) OAuth2 (si GOOGLE_CLIENT_ID está configurado)
 * 2) Feed iCal (.ics) si el usuario configuró ical_url en user_integrations o GOOGLE_ICAL_URL
 * 3) CLI local `gcalendar` si está disponible en el entorno local
 */
export async function fetchNormalizedGoogleEvents(options: {
  timeMin: string;
  timeMax: string;
  userId?: string;
}): Promise<NormalizedGoogleEvent[]> {
  const isDefaultOwner =
    !options.userId || options.userId === DEFAULT_USER_ID;

  // Si es una cuenta nueva distinta al propietario principal, verificar si tiene integración propia
  let userHasCustomIntegration = false;
  let customIcalUrl = "";
  if (!isDefaultOwner && isSupabaseServerConfigured() && options.userId) {
    const supabase = getSupabaseServerClient();
    const { data: integration } = await supabase
      .from("user_integrations")
      .select("*")
      .eq("user_id", options.userId)
      .eq("provider", "google_calendar")
      .eq("is_active", true)
      .maybeSingle();

    if (integration) {
      userHasCustomIntegration = Boolean(
        integration.refresh_token || integration.access_token
      );
      const cfg = integration.config as Record<string, unknown> | undefined;
      if (
        cfg &&
        typeof cfg.ical_url === "string" &&
        cfg.ical_url.startsWith("http")
      ) {
        customIcalUrl = cfg.ical_url;
      }
    }

    // Cuenta nueva sin integración de Google Calendar conectada -> retorna vacío
    if (!userHasCustomIntegration && !customIcalUrl) {
      return [];
    }
  }

  // 1. Intentar con OAuth2 oficial
  if (
    (isDefaultOwner && isGoogleCalendarConfigured()) ||
    userHasCustomIntegration
  ) {
    try {
      const { calendar, calendarId } = await getGoogleCalendarClient(
        options.userId
      );
      const response = await calendar.events.list({
        calendarId,
        timeMin: new Date(options.timeMin).toISOString(),
        timeMax: new Date(options.timeMax).toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
      });

      const items = response.data.items || [];
      const normalized: NormalizedGoogleEvent[] = [];

      for (const item of items) {
        if (!item.id || item.status === "cancelled") continue;
        const allDay = Boolean(item.start?.date && !item.start?.dateTime);
        const startIso =
          item.start?.dateTime ||
          (item.start?.date ? `${item.start.date}T09:00:00-04:00` : null);
        const endIso =
          item.end?.dateTime ||
          (item.end?.date ? `${item.end.date}T10:00:00-04:00` : null);

        if (!startIso || !endIso) continue;

        normalized.push({
          id: item.id,
          summary: item.summary || "Cita en Google Calendar",
          description: item.description || null,
          location: item.location || null,
          startIso: new Date(startIso).toISOString(),
          endIso: new Date(endIso).toISOString(),
          allDay,
          timeZone: item.start?.timeZone || DEFAULT_TIMEZONE,
          htmlLink: item.hangoutLink || item.htmlLink || null,
          etag: item.etag || null,
          eventType: item.eventType === "focusTime" ? "block" : "appointment",
          status: item.status || "confirmed",
        });
      }
      return normalized;
    } catch {
      // Continuar a otros métodos si falla OAuth
    }
  }

  // 2. Intentar con URL iCal (.ics) configurada en variables de entorno o en Supabase user_integrations
  let icalUrl = process.env.GOOGLE_ICAL_URL || "";
  if (!icalUrl && isSupabaseServerConfigured()) {
    const supabase = getSupabaseServerClient();
    const { data: integration } = await supabase
      .from("user_integrations")
      .select("config")
      .eq("user_id", options.userId || DEFAULT_USER_ID)
      .eq("provider", "google_calendar")
      .maybeSingle();

    const cfg = integration?.config as Record<string, unknown> | undefined;
    if (cfg && typeof cfg.ical_url === "string" && cfg.ical_url.startsWith("http")) {
      icalUrl = cfg.ical_url;
    }
  }

  if (icalUrl) {
    try {
      const res = await fetch(icalUrl, { cache: "no-store" });
      if (res.ok) {
        const text = await res.text();
        if (text.includes("BEGIN:VCALENDAR")) {
          return parseIcsFeed(text);
        }
      }
    } catch {
      // Continuar al fallback local
    }
  }

  // 3. Fallback local con CLI `gcalendar` si está instalado en el sistema
  try {
    const binPath = "/Users/aaron/.gemini/antigravity/bin/gcalendar";
    const { stdout } = await execFileAsync(binPath, [
      "readonly",
      "events",
      "--start",
      new Date(options.timeMin).toISOString(),
      "--end",
      new Date(options.timeMax).toISOString(),
      "--max",
      "250",
      "--json",
    ]);

    const items = JSON.parse(stdout);
    if (Array.isArray(items)) {
      const normalized: NormalizedGoogleEvent[] = [];
      for (const item of items) {
        if (!item.id || item.status === "cancelled") continue;
        const allDay = Boolean(item.start?.date && !item.start?.dateTime);
        const startIso =
          item.start?.dateTime ||
          (item.start?.date ? `${item.start.date}T09:00:00-04:00` : null);
        const endIso =
          item.end?.dateTime ||
          (item.end?.date ? `${item.end.date}T10:00:00-04:00` : null);
        if (!startIso || !endIso) continue;

        normalized.push({
          id: item.id,
          summary: item.summary || "Evento en Google Calendar",
          description: item.description || null,
          location: item.location || null,
          startIso: new Date(startIso).toISOString(),
          endIso: new Date(endIso).toISOString(),
          allDay,
          timeZone: item.start?.timeZone || DEFAULT_TIMEZONE,
          htmlLink: item.hangoutLink || item.htmlLink || null,
          etag: item.etag || null,
          eventType: item.eventType === "focusTime" ? "block" : "appointment",
          status: item.status || "confirmed",
        });
      }
      return normalized;
    }
  } catch {
    // En producción (Vercel) si no hay CLI, retorna vacío de forma segura
  }

  return [];
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

  const googleItems = await fetchNormalizedGoogleEvents({
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
    const cleanDesc = item.description
      ? item.description
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      : null;

    const { data: existing } = await supabase
      .from("events")
      .select("id, status")
      .eq("user_id", userId)
      .eq("google_event_id", item.id)
      .maybeSingle();

    const eventPayload = {
      user_id: userId,
      workspace_id: workspaceId,
      title: item.summary || "Evento en Google Calendar",
      description: cleanDesc,
      event_type: item.eventType,
      status:
        existing?.status === "completed"
          ? "completed"
          : new Date(item.endIso) < new Date()
          ? "completed"
          : "scheduled",
      priority: "medium",
      start_time: item.startIso,
      end_time: item.endIso,
      all_day: item.allDay,
      timezone: item.timeZone || DEFAULT_TIMEZONE,
      location: item.location,
      meeting_url: item.htmlLink,
      color: "#D96299",
      source: "google_calendar",
      google_event_id: item.id,
      google_etag: item.etag,
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
