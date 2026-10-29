import { Client } from "@notionhq/client";
import * as chrono from "chrono-node";
import { CreateEventInput } from "@/types/database";
import {
  DEFAULT_TIMEZONE,
  DEFAULT_USER_ID,
  DEFAULT_WORKSPACE_ID,
  getSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";
import { pushEventToGoogleCalendar } from "@/lib/services/google-calendar";

export interface ParsedNotionEntry {
  rawText: string;
  title: string;
  startTime: string;
  endTime: string;
  eventType: "session" | "appointment" | "task" | "reminder";
  notionBlockId?: string;
  notionPageId?: string;
}

const SPANISH_MONTHS: Record<string, number> = {
  ene: 0,
  enero: 0,
  feb: 1,
  febrero: 1,
  mar: 2,
  marzo: 2,
  abr: 3,
  abril: 3,
  may: 4,
  mayo: 4,
  jun: 5,
  junio: 5,
  jul: 6,
  julio: 6,
  ago: 7,
  agosto: 7,
  sep: 8,
  sept: 8,
  septiembre: 8,
  oct: 9,
  octubre: 9,
  nov: 10,
  noviembre: 10,
  dic: 11,
  diciembre: 11,
};

/**
 * Parsea texto rápido en español o inglés escrito en Notion.
 * Ejemplo: "Sesion jueves 29 oct 26 a las 8:00 pm"
 * Resultado: { title: "Sesion", startTime: "2026-10-29T20:00:00...", endTime: "2026-10-29T21:00:00..." }
 */
export function parseSmartNotionText(
  rawInput: string,
  referenceDate: Date = new Date()
): ParsedNotionEntry | null {
  const cleaned = rawInput.trim();
  if (!cleaned || cleaned.length < 4) return null;

  // 1. Intentar patrón explícito en español:
  // Ej: "Sesion jueves 29 oct 26 a las 8:00 pm" o "Cita con cliente 15 nov 2026 14:30"
  const spanishRegex =
    /^(.*?)\s*(?:el\s+)?(?:(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+)?(\d{1,2})\s+(?:de\s+)?(ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:t(?:iembre)?)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)(?:\s+(?:de(?:l)?\s+)?(\d{2,4}))?(?:\s*(?:a\s+las|@|de)?\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?)?(?:\s*(?:-|a|hasta)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?)?$/i;

  const match = cleaned.match(spanishRegex);

  if (match) {
    const [
      ,
      title,
      day,
      month,
      year,
      hour,
      minute,
      meridiem,
      endHour,
      endMinute,
      endMeridiem,
    ] = match;

    const dayNum = parseInt(day, 10);
    const monthKey = month.toLowerCase();
    const monthIndex = SPANISH_MONTHS[monthKey];

    if (monthIndex !== undefined && dayNum >= 1 && dayNum <= 31) {
      let yearNum = referenceDate.getFullYear();
      if (year) {
        yearNum = year.length === 2 ? 2000 + parseInt(year, 10) : parseInt(year, 10);
      }

      let startH = hour ? parseInt(hour, 10) : 9;
      const startM = minute ? parseInt(minute, 10) : 0;

      if (meridiem) {
        const isPm = meridiem.toLowerCase().startsWith("p");
        const isAm = meridiem.toLowerCase().startsWith("a");
        if (isPm && startH < 12) startH += 12;
        if (isAm && startH === 12) startH = 0;
      }

      const startDate = new Date(yearNum, monthIndex, dayNum, startH, startM, 0, 0);
      let endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // Por defecto 1 hora

      if (endHour) {
        let endH = parseInt(endHour, 10);
        const endM = endMinute ? parseInt(endMinute, 10) : 0;
        const mer = endMeridiem || meridiem;
        if (mer) {
          const isPm = mer.toLowerCase().startsWith("p");
          const isAm = mer.toLowerCase().startsWith("a");
          if (isPm && endH < 12) endH += 12;
          if (isAm && endH === 12) endH = 0;
        }
        const candidateEnd = new Date(yearNum, monthIndex, dayNum, endH, endM, 0, 0);
        if (candidateEnd > startDate) {
          endDate = candidateEnd;
        }
      }

      const cleanTitle =
        (title || "").replace(/[-–:,\s]+$/, "").trim() || "Sesión agendada";

      return {
        rawText: cleaned,
        title: cleanTitle,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
        eventType: inferEventType(cleanTitle),
      };
    }
  }

  // 2. Fallback con parser NLP chrono-node (español + inglés)
  const parsedResults = chrono.es.parse(cleaned, referenceDate, {
    forwardDate: true,
  });

  if (parsedResults.length > 0) {
    const first = parsedResults[0];
    const startDate = first.start.date();
    const endDate = first.end
      ? first.end.date()
      : new Date(startDate.getTime() + 60 * 60 * 1000);

    const extractedTitle = cleaned
      .replace(first.text, "")
      .replace(/\b(el|a las|en|para)\b\s*$/i, "")
      .replace(/[-–:,\s]+$/, "")
      .trim();

    const finalTitle = extractedTitle || "Actividad de Notion";

    return {
      rawText: cleaned,
      title: finalTitle,
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      eventType: inferEventType(finalTitle),
    };
  }

  return null;
}

function inferEventType(
  title: string
): "session" | "appointment" | "task" | "reminder" {
  const lower = title.toLowerCase();
  if (lower.includes("sesion") || lower.includes("sesión") || lower.includes("shoot")) {
    return "session";
  }
  if (lower.includes("tarea") || lower.includes("entregar") || lower.includes("todo")) {
    return "task";
  }
  if (lower.includes("recordar") || lower.includes("recordatorio")) {
    return "reminder";
  }
  return "appointment";
}

/**
 * Extrae bloques de texto de una página de Notion configurada y parsea las citas automáticamente.
 */
export async function extractEventsFromNotionPage(
  notionPageId?: string,
  notionApiKey?: string
): Promise<ParsedNotionEntry[]> {
  const apiKey = notionApiKey || process.env.NOTION_API_KEY;
  const pageId = notionPageId || process.env.NOTION_PAGE_ID;

  if (!apiKey || !pageId || apiKey.includes("tu_token")) {
    throw new Error(
      "Credenciales de Notion no configuradas (NOTION_API_KEY / NOTION_PAGE_ID)."
    );
  }

  const notion = new Client({ auth: apiKey });
  const response = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 100,
  });

  const parsedEntries: ParsedNotionEntry[] = [];

  for (const block of response.results) {
    if (!("type" in block)) continue;

    let plainText = "";
    const b = block as Record<string, unknown>;
    const blockType = block.type;
    const typeContent = b[blockType] as
      | { rich_text?: Array<{ plain_text: string }> }
      | undefined;

    if (typeContent?.rich_text && Array.isArray(typeContent.rich_text)) {
      plainText = typeContent.rich_text.map((t) => t.plain_text).join("");
    }

    if (plainText) {
      const parsed = parseSmartNotionText(plainText);
      if (parsed) {
        parsedEntries.push({
          ...parsed,
          notionBlockId: block.id,
          notionPageId: pageId,
        });
      }
    }
  }

  return parsedEntries;
}

/**
 * Procesa una lista de textos rápidos o extrae directamente de Notion,
 * enviando cada evento tanto a Google Calendar como a Supabase.
 */
export async function syncNotionEntriesToCalendarAndSupabase(options: {
  rawLines?: string[];
  notionPageId?: string;
  userId?: string;
  workspaceId?: string;
}) {
  const userId = options.userId || DEFAULT_USER_ID;
  const workspaceId = options.workspaceId || DEFAULT_WORKSPACE_ID;

  const entries: ParsedNotionEntry[] = [];

  if (options.rawLines && options.rawLines.length > 0) {
    for (const line of options.rawLines) {
      const parsed = parseSmartNotionText(line);
      if (parsed) entries.push(parsed);
    }
  } else {
    const fromNotion = await extractEventsFromNotionPage(options.notionPageId);
    entries.push(...fromNotion);
  }

  const results = [];

  for (const entry of entries) {
    // 1. Enviar a Google Calendar si está configurado
    let googleEventId: string | null = null;
    try {
      const gcalCreated = await pushEventToGoogleCalendar({
        title: entry.title,
        description: `Sincronizado automáticamente desde Notion: "${entry.rawText}"`,
        start_time: entry.startTime,
        end_time: entry.endTime,
        timezone: DEFAULT_TIMEZONE,
      });
      if (gcalCreated?.id) {
        googleEventId = gcalCreated.id;
      }
    } catch {
      // Si Google Calendar aún no tiene credenciales activas, continuamos guardando en Supabase
    }

    // 2. Guardar en Supabase
    if (isSupabaseServerConfigured()) {
      const supabase = getSupabaseServerClient();
      const payload: CreateEventInput = {
        user_id: userId,
        workspace_id: workspaceId,
        title: entry.title,
        description: `Extraído de Notion: "${entry.rawText}"`,
        raw_input: entry.rawText,
        event_type: entry.eventType,
        status: "scheduled",
        priority: "medium",
        start_time: entry.startTime,
        end_time: entry.endTime,
        timezone: DEFAULT_TIMEZONE,
        color: "#D96299",
        source: "notion",
        google_event_id: googleEventId,
        notion_block_id: entry.notionBlockId || null,
        notion_page_id: entry.notionPageId || null,
      };

      let existingId: string | null = null;
      if (entry.notionBlockId) {
        const { data: existing } = await supabase
          .from("events")
          .select("id")
          .eq("user_id", userId)
          .eq("notion_block_id", entry.notionBlockId)
          .maybeSingle();
        existingId = existing?.id || null;
      }

      const eventRow = {
        ...payload,
        sync_status: googleEventId ? "synced" : "local_only",
        last_synced_at: new Date().toISOString(),
      };

      const { data, error } = existingId
        ? await supabase
            .from("events")
            .update(eventRow)
            .eq("id", existingId)
            .select("*, event_notes(*)")
            .single()
        : await supabase
            .from("events")
            .insert(eventRow)
            .select("*, event_notes(*)")
            .single();

      if (error) {
        throw new Error(`Error al guardar evento de Notion en Supabase: ${error.message}`);
      }

      results.push(data);
    } else {
      results.push({
        ...entry,
        google_event_id: googleEventId,
      });
    }
  }

  // Registrar auditoría en sync_logs si Supabase está configurado
  if (isSupabaseServerConfigured()) {
    const supabase = getSupabaseServerClient();
    await supabase.from("sync_logs").insert({
      user_id: userId,
      provider: "notion",
      direction: "parse_notion",
      status: "success",
      items_processed: results.length,
      details: { parsed_count: entries.length },
    });
  }

  return {
    parsedCount: entries.length,
    syncedEvents: results,
  };
}
