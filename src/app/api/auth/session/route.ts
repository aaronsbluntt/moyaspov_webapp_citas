import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_USER_ID,
  DEFAULT_WORKSPACE_ID,
  getSupabaseServerClient,
} from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body.email || "w.aaroncruz@gmail.com")
      .trim()
      .toLowerCase();
    const fullName = String(
      body.fullName || email.split("@")[0] || "Usuario"
    ).trim();
    const icalUrl = body.icalUrl ? String(body.icalUrl).trim() : undefined;

    const supabase = getSupabaseServerClient();

    // Actualizar o recuperar el perfil principal
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", DEFAULT_USER_ID)
      .maybeSingle();

    if (existingProfile) {
      await supabase
        .from("profiles")
        .update({
          full_name: fullName,
        })
        .eq("id", DEFAULT_USER_ID);
    }

    // Registrar o actualizar la integración de Google Calendar del usuario
    const { data: existingInt } = await supabase
      .from("user_integrations")
      .select("*")
      .eq("user_id", DEFAULT_USER_ID)
      .eq("provider", "google_calendar")
      .maybeSingle();

    const prevConfig =
      (existingInt?.config as Record<string, unknown> | undefined) || {};
    const nextConfig = {
      ...prevConfig,
      calendar_id: "primary",
      sync_mode: "bidirectional",
      ...(icalUrl !== undefined ? { ical_url: icalUrl } : {}),
    };

    if (existingInt?.id) {
      await supabase
        .from("user_integrations")
        .update({
          external_email: email,
          config: nextConfig,
          is_active: true,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", existingInt.id);
    } else {
      await supabase.from("user_integrations").insert({
        user_id: DEFAULT_USER_ID,
        workspace_id: DEFAULT_WORKSPACE_ID,
        provider: "google_calendar",
        external_email: email,
        config: nextConfig,
        is_active: true,
        last_synced_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: DEFAULT_USER_ID,
        email,
        fullName,
        icalUrl: nextConfig.ical_url || "",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error al iniciar sesión",
      },
      { status: 500 }
    );
  }
}
