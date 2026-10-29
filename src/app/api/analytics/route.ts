import { NextRequest, NextResponse } from "next/server";
import { getDashboardAnalytics } from "@/lib/services/events";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    if (!isSupabaseServerConfigured()) {
      return NextResponse.json({
        configured: false,
        series: [],
        upcomingEvents: [],
        totalEventsInPeriod: 0,
      });
    }

    const { searchParams } = new URL(request.url);
    const now = new Date();
    const startDate =
      searchParams.get("startDate") ||
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString();
    const endDate =
      searchParams.get("endDate") ||
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21).toISOString();
    const userId = searchParams.get("userId") || undefined;

    const analytics = await getDashboardAnalytics({
      userId,
      startDate,
      endDate,
    });

    return NextResponse.json({
      configured: true,
      ...analytics,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error al calcular analíticas",
      },
      { status: 500 }
    );
  }
}
