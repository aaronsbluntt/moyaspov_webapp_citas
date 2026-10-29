import { NextRequest, NextResponse } from "next/server";
import {
  parseSmartNotionText,
  syncNotionEntriesToCalendarAndSupabase,
} from "@/lib/services/notion-parser";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // Modo 1: Vista previa rápida de parseo sin guardar
    if (body.previewOnly && typeof body.text === "string") {
      const parsed = parseSmartNotionText(body.text);
      return NextResponse.json({ parsed });
    }

    // Modo 2: Sincronizar texto rápido o página completa de Notion -> Google Calendar + Supabase
    const rawLines = body.text
      ? String(body.text)
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
      : body.rawLines;

    const result = await syncNotionEntriesToCalendarAndSupabase({
      rawLines,
      notionPageId: body.notionPageId,
      userId: body.userId,
      workspaceId: body.workspaceId,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error al sincronizar desde Notion",
      },
      { status: 500 }
    );
  }
}
