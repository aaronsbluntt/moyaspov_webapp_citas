import { NextRequest, NextResponse } from "next/server";
import { syncGoogleCalendarToSupabase } from "@/lib/services/google-calendar";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const now = new Date();
    const defaultMin = new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    ).toISOString();
    const defaultMax = new Date(
      now.getFullYear(),
      now.getMonth() + 2,
      0,
      23,
      59,
      59
    ).toISOString();

    const result = await syncGoogleCalendarToSupabase({
      timeMin: body.timeMin || defaultMin,
      timeMax: body.timeMax || defaultMax,
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
            : "Error al sincronizar con Google Calendar",
      },
      { status: 500 }
    );
  }
}
