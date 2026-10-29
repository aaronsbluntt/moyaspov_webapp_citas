import { NextRequest, NextResponse } from "next/server";
import {
  createEvent,
  getDailyAgenda,
  getEventsByDateRange,
} from "@/lib/services/events";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    if (!isSupabaseServerConfigured()) {
      return NextResponse.json({ configured: false, events: [] });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    // Si no hay un usuario autenticado, devolver la agenda completamente vacía
    if (!userId) {
      return NextResponse.json({ configured: true, events: [] });
    }

    const date = searchParams.get("date");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (date) {
      const events = await getDailyAgenda(date, userId);
      return NextResponse.json({ configured: true, events });
    }

    const now = new Date();
    const defaultStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 7
    ).toISOString();
    const defaultEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 30
    ).toISOString();

    const events = await getEventsByDateRange({
      startDate: startDate || defaultStart,
      endDate: endDate || defaultEnd,
      userId,
    });

    return NextResponse.json({ configured: true, events });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Error al obtener eventos",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.user_id) {
      return NextResponse.json(
        { error: "Debes iniciar sesión para crear una cita" },
        { status: 401 }
      );
    }
    const created = await createEvent(body);
    return NextResponse.json({ event: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Error al crear el evento",
      },
      { status: 500 }
    );
  }
}
