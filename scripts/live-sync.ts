import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://ihxnfazhmakudjyxmfkr.supabase.co";
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_226nik50VEn5cyavBG1L8Q_jbSvfnVC";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000002";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  const input = fs.readFileSync(0, "utf8").trim();
  if (!input.startsWith("[")) return;
  const gcalItems = JSON.parse(input);
  if (!Array.isArray(gcalItems)) return;

  const activeGoogleIds = new Set<string>();

  for (const item of gcalItems) {
    if (!item.id || item.status === "cancelled") continue;

    const summaryText = (item.summary || "").trim();
    if (!summaryText && !item.description && !item.location) continue;

    activeGoogleIds.add(item.id);

    const isAllDay = Boolean(item.start?.date && !item.start?.dateTime);
    const startIso =
      item.start?.dateTime ||
      (item.start?.date ? `${item.start.date}T09:00:00-04:00` : null);
    const endIso =
      item.end?.dateTime ||
      (item.end?.date ? `${item.end.date}T10:00:00-04:00` : null);

    if (!startIso || !endIso) continue;

    const cleanDesc = item.description
      ? item.description
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      : null;

    const { data: existing } = await supabase
      .from("events")
      .select("id, title, start_time, end_time, status")
      .eq("user_id", USER_ID)
      .eq("google_event_id", item.id)
      .maybeSingle();

    const nextTitle = summaryText || "Evento en Google Calendar";
    const nextStart = new Date(startIso).toISOString();
    const nextEnd = new Date(endIso).toISOString();

    if (
      !existing ||
      existing.title !== nextTitle ||
      new Date(existing.start_time).getTime() !==
        new Date(nextStart).getTime() ||
      new Date(existing.end_time).getTime() !== new Date(nextEnd).getTime()
    ) {
      const payload = {
        user_id: USER_ID,
        workspace_id: WORKSPACE_ID,
        title: nextTitle,
        description: cleanDesc,
        event_type: item.eventType === "focusTime" ? "block" : "appointment",
        status:
          existing?.status === "completed"
            ? "completed"
            : new Date(nextEnd) < new Date()
            ? "completed"
            : "scheduled",
        priority: "medium",
        start_time: nextStart,
        end_time: nextEnd,
        all_day: isAllDay,
        timezone: item.start?.timeZone || "America/Santo_Domingo",
        location: item.location || null,
        meeting_url: item.hangoutLink || item.htmlLink || null,
        color: "#D96299",
        source: "google_calendar",
        google_event_id: item.id,
        google_etag: item.etag || null,
        sync_status: "synced",
        last_synced_at: new Date().toISOString(),
      };

      if (existing?.id) {
        await supabase.from("events").update(payload).eq("id", existing.id);
        console.log(`[live-sync] Actualizado: ${nextTitle}`);
      } else {
        await supabase.from("events").insert(payload);
        console.log(`[live-sync] Nuevo evento Google: ${nextTitle}`);
      }
    }
  }
}

main().catch(() => {});
