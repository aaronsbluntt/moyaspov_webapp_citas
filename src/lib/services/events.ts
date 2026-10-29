import {
  CalendarEvent,
  CreateEventInput,
  EventNote,
  NoteType,
  UpdateEventInput,
} from "@/types/database";
import {
  DEFAULT_TIMEZONE,
  DEFAULT_USER_ID,
  DEFAULT_WORKSPACE_ID,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import {
  deleteGoogleCalendarEvent,
  isGoogleCalendarConfigured,
  pushEventToGoogleCalendar,
  updateGoogleCalendarEvent,
} from "@/lib/services/google-calendar";

/**
 * Obtiene la lista de eventos/actividades dentro de un rango de fechas,
 * incluyendo sus notas y comentarios asociados, ordenados cronológicamente.
 */
export async function getEventsByDateRange(options: {
  startDate: string;
  endDate: string;
  userId?: string;
}): Promise<CalendarEvent[]> {
  const supabase = getSupabaseServerClient();
  const userId = options.userId || DEFAULT_USER_ID;

  const { data, error } = await supabase
    .from("events")
    .select("*, event_notes(*)")
    .eq("user_id", userId)
    .gte("start_time", options.startDate)
    .lte("start_time", options.endDate)
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error(`Error al consultar eventos: ${error.message}`);
  }

  return (data || []) as CalendarEvent[];
}

/**
 * Obtiene la agenda diaria organizada por hora para una fecha específica (YYYY-MM-DD).
 */
export async function getDailyAgenda(
  dateIso: string,
  userId: string = DEFAULT_USER_ID
): Promise<CalendarEvent[]> {
  const dayStart = new Date(`${dateIso}T00:00:00.000Z`).toISOString();
  const dayEnd = new Date(`${dateIso}T23:59:59.999Z`).toISOString();

  return getEventsByDateRange({
    startDate: dayStart,
    endDate: dayEnd,
    userId,
  });
}

/**
 * Crea un nuevo evento o tarea en Supabase y opcionalmente lo sincroniza con Google Calendar.
 */
export async function createEvent(
  input: CreateEventInput
): Promise<CalendarEvent> {
  const supabase = getSupabaseServerClient();
  const userId = input.user_id || DEFAULT_USER_ID;
  const workspaceId = input.workspace_id || DEFAULT_WORKSPACE_ID;

  let googleEventId = input.google_event_id || null;
  let syncStatus: "synced" | "local_only" | "sync_error" = googleEventId
    ? "synced"
    : "local_only";

  // Si se solicita sincronización bidireccional con Google Calendar
  if (input.sync_to_google !== false && !googleEventId && isGoogleCalendarConfigured()) {
    try {
      const gcalEvent = await pushEventToGoogleCalendar(
        {
          title: input.title,
          description: input.description,
          start_time: input.start_time,
          end_time: input.end_time,
          location: input.location,
          timezone: input.timezone || DEFAULT_TIMEZONE,
        },
        userId
      );
      if (gcalEvent?.id) {
        googleEventId = gcalEvent.id;
        syncStatus = "synced";
      }
    } catch {
      syncStatus = "sync_error";
    }
  }

  const { data: createdEvent, error } = await supabase
    .from("events")
    .insert({
      user_id: userId,
      workspace_id: workspaceId,
      title: input.title,
      description: input.description || null,
      raw_input: input.raw_input || null,
      event_type: input.event_type || "appointment",
      status: input.status || "scheduled",
      priority: input.priority || "medium",
      start_time: input.start_time,
      end_time: input.end_time,
      all_day: input.all_day ?? false,
      timezone: input.timezone || DEFAULT_TIMEZONE,
      location: input.location || null,
      meeting_url: input.meeting_url || null,
      color: input.color || "#D96299",
      source: input.source || "webapp",
      google_event_id: googleEventId,
      notion_block_id: input.notion_block_id || null,
      notion_page_id: input.notion_page_id || null,
      sync_status: syncStatus,
      last_synced_at: syncStatus === "synced" ? new Date().toISOString() : null,
    })
    .select("*")
    .single();

  if (error || !createdEvent) {
    throw new Error(`Error al crear el evento: ${error?.message}`);
  }

  // Si incluye nota o resumen inicial, crearlo en event_notes
  if (input.initial_note && input.initial_note.trim()) {
    await addEventNote({
      eventId: createdEvent.id,
      content: input.initial_note.trim(),
      noteType: "summary",
      authorId: userId,
    });
  }

  // Retornar el evento completo con sus notas
  const { data: fullEvent } = await supabase
    .from("events")
    .select("*, event_notes(*)")
    .eq("id", createdEvent.id)
    .single();

  return (fullEvent || createdEvent) as CalendarEvent;
}

/**
 * Actualiza o reprograma un evento existente en Supabase y sincroniza el cambio con Google Calendar.
 */
export async function updateEvent(
  eventId: string,
  updates: UpdateEventInput
): Promise<CalendarEvent> {
  const supabase = getSupabaseServerClient();

  const { data: existing, error: fetchErr } = await supabase
    .from("events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (fetchErr || !existing) {
    throw new Error(`Evento no encontrado: ${fetchErr?.message}`);
  }

  // Si se cambió la hora de inicio/fin y no se especificó estado, podemos marcarlo o mantenerlo activo
  const payload: Record<string, unknown> = {};
  const allowedFields: Array<keyof UpdateEventInput> = [
    "title",
    "description",
    "event_type",
    "status",
    "priority",
    "start_time",
    "end_time",
    "all_day",
    "timezone",
    "location",
    "meeting_url",
    "color",
    "sync_status",
  ];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      payload[field] = updates[field];
    }
  }

  // Sincronizar cambio con Google Calendar si el evento está vinculado
  if (existing.google_event_id && isGoogleCalendarConfigured()) {
    try {
      await updateGoogleCalendarEvent(
        existing.google_event_id,
        {
          title: updates.title,
          description: updates.description,
          start_time: updates.start_time,
          end_time: updates.end_time,
          location: updates.location,
          timezone: updates.timezone || existing.timezone,
        },
        existing.user_id
      );
      payload.sync_status = "synced";
      payload.last_synced_at = new Date().toISOString();
    } catch {
      payload.sync_status = "sync_error";
    }
  }

  const { data: updated, error: updateErr } = await supabase
    .from("events")
    .update(payload)
    .eq("id", eventId)
    .select("*, event_notes(*)")
    .single();

  if (updateErr || !updated) {
    throw new Error(`Error al actualizar el evento: ${updateErr?.message}`);
  }

  return updated as CalendarEvent;
}

/**
 * Reprograma rápidamente la fecha/hora de inicio y fin de un evento.
 */
export async function rescheduleEvent(
  eventId: string,
  newStartTime: string,
  newEndTime: string
): Promise<CalendarEvent> {
  return updateEvent(eventId, {
    start_time: newStartTime,
    end_time: newEndTime,
    status: "rescheduled",
  });
}

/**
 * Elimina un evento de Supabase y de Google Calendar si estaba sincronizado.
 */
export async function deleteEvent(eventId: string): Promise<{ deleted: boolean }> {
  const supabase = getSupabaseServerClient();

  const { data: existing } = await supabase
    .from("events")
    .select("id, google_event_id, user_id")
    .eq("id", eventId)
    .maybeSingle();

  if (existing?.google_event_id && isGoogleCalendarConfigured()) {
    try {
      await deleteGoogleCalendarEvent(existing.google_event_id, existing.user_id);
    } catch {
      // Continuar con el borrado en base de datos aunque el evento externo ya no exista
    }
  }

  const { error } = await supabase.from("events").delete().eq("id", eventId);
  if (error) {
    throw new Error(`Error al eliminar el evento: ${error.message}`);
  }

  return { deleted: true };
}

// ============================================================================
// MÓDULO DE NOTAS, COMENTARIOS Y RESÚMENES POR EVENTO (event_notes)
// ============================================================================

export async function getEventNotes(eventId: string): Promise<EventNote[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("event_notes")
    .select("*")
    .eq("event_id", eventId)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Error al obtener notas del evento: ${error.message}`);
  }

  return (data || []) as EventNote[];
}

export async function addEventNote(options: {
  eventId: string;
  content: string;
  noteType?: NoteType;
  authorId?: string;
  isPinned?: boolean;
}): Promise<EventNote> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("event_notes")
    .insert({
      event_id: options.eventId,
      author_id: options.authorId || DEFAULT_USER_ID,
      note_type: options.noteType || "comment",
      content: options.content,
      is_pinned: options.isPinned ?? false,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Error al agregar nota: ${error?.message}`);
  }

  return data as EventNote;
}

export async function updateEventNote(
  noteId: string,
  updates: { content?: string; noteType?: NoteType; isPinned?: boolean }
): Promise<EventNote> {
  const supabase = getSupabaseServerClient();
  const payload: Record<string, unknown> = {};
  if (updates.content !== undefined) payload.content = updates.content;
  if (updates.noteType !== undefined) payload.note_type = updates.noteType;
  if (updates.isPinned !== undefined) payload.is_pinned = updates.isPinned;

  const { data, error } = await supabase
    .from("event_notes")
    .update(payload)
    .eq("id", noteId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Error al actualizar nota: ${error?.message}`);
  }

  return data as EventNote;
}

export async function deleteEventNote(noteId: string): Promise<{ deleted: boolean }> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("event_notes").delete().eq("id", noteId);
  if (error) {
    throw new Error(`Error al eliminar nota: ${error.message}`);
  }
  return { deleted: true };
}

// ============================================================================
// ANALÍTICAS DEL DASHBOARD (Chart Line de Días Más Ocupados)
// ============================================================================

export async function getDashboardAnalytics(options: {
  userId?: string;
  startDate: string;
  endDate: string;
}) {
  const supabase = getSupabaseServerClient();
  const userId = options.userId || DEFAULT_USER_ID;

  const events = await getEventsByDateRange({
    startDate: options.startDate,
    endDate: options.endDate,
    userId,
  });

  // Agrupar por fecha (YYYY-MM-DD) para el Chart Line
  const dailyMap = new Map<
    string,
    {
      date: string;
      totalEvents: number;
      googleEvents: number;
      notionEvents: number;
      webappEvents: number;
      hoursBooked: number;
    }
  >();

  for (const ev of events) {
    if (ev.status === "cancelled") continue;
    const dateKey = ev.start_time.slice(0, 10);
    const current = dailyMap.get(dateKey) || {
      date: dateKey,
      totalEvents: 0,
      googleEvents: 0,
      notionEvents: 0,
      webappEvents: 0,
      hoursBooked: 0,
    };

    const durationHours = Math.max(
      0,
      (new Date(ev.end_time).getTime() - new Date(ev.start_time).getTime()) /
        (1000 * 60 * 60)
    );

    current.totalEvents += 1;
    if (ev.source === "google_calendar") current.googleEvents += 1;
    if (ev.source === "notion") current.notionEvents += 1;
    if (ev.source === "webapp") current.webappEvents += 1;
    current.hoursBooked = Number((current.hoursBooked + durationHours).toFixed(2));

    dailyMap.set(dateKey, current);
  }

  const series = Array.from(dailyMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  // Próximas citas cercanas con sus comentarios
  const nowIso = new Date().toISOString();
  const { data: upcomingEvents } = await supabase
    .from("events")
    .select("*, event_notes(*)")
    .eq("user_id", userId)
    .neq("status", "cancelled")
    .gte("end_time", nowIso)
    .order("start_time", { ascending: true })
    .limit(8);

  return {
    series,
    upcomingEvents: (upcomingEvents || []) as CalendarEvent[],
    totalEventsInPeriod: events.filter((e) => e.status !== "cancelled").length,
  };
}
