import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_USER_ID,
  DEFAULT_WORKSPACE_ID,
  getSupabaseServerClient,
} from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawEmail = String(body.email || "")
      .trim()
      .toLowerCase();

    if (!rawEmail) {
      return NextResponse.json(
        { error: "Se requiere un correo electrónico válido" },
        { status: 400 }
      );
    }

    const authUserId = body.authUserId ? String(body.authUserId) : null;
    const fullName = String(
      body.fullName || rawEmail.split("@")[0] || "Usuario"
    ).trim();

    const supabase = getSupabaseServerClient();

    // 1. Buscar si ya existe un perfil con este correo o auth_user_id
    let { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", rawEmail)
      .maybeSingle();

    if (!profile && authUserId) {
      const { data: byAuth } = await supabase
        .from("profiles")
        .select("*")
        .eq("auth_user_id", authUserId)
        .maybeSingle();
      profile = byAuth;
    }

    // Caso especial: si es el propietario original (w.aaroncruz@gmail.com) y el perfil inicial tenía admin@moyaspov.com
    if (!profile && rawEmail === "w.aaroncruz@gmail.com") {
      const { data: defaultProfile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", DEFAULT_USER_ID)
        .maybeSingle();

      if (defaultProfile) {
        const { data: updated } = await supabase
          .from("profiles")
          .update({
            email: rawEmail,
            full_name: fullName,
            ...(authUserId ? { auth_user_id: authUserId } : {}),
          })
          .eq("id", DEFAULT_USER_ID)
          .select("*")
          .single();
        profile = updated || defaultProfile;
      }
    }

    // 2. Si es una cuenta nueva, crear un perfil nuevo (su agenda empezará 100% vacía)
    if (!profile) {
      const { data: createdProfile, error: createErr } = await supabase
        .from("profiles")
        .insert({
          email: rawEmail,
          full_name: fullName,
          auth_user_id: authUserId,
          timezone: "America/Santo_Domingo",
          brand_color: "#D96299",
        })
        .select("*")
        .single();

      if (createErr || !createdProfile) {
        throw new Error(
          createErr?.message || "No se pudo crear el perfil del usuario"
        );
      }
      profile = createdProfile;
    }

    // Registrar o actualizar integración de Google Calendar para este perfil si corresponde
    if (profile.id === DEFAULT_USER_ID) {
      const { data: existingInt } = await supabase
        .from("user_integrations")
        .select("id")
        .eq("user_id", profile.id)
        .eq("provider", "google_calendar")
        .maybeSingle();

      if (!existingInt) {
        await supabase.from("user_integrations").insert({
          user_id: profile.id,
          workspace_id: DEFAULT_WORKSPACE_ID,
          provider: "google_calendar",
          external_email: rawEmail,
          config: { calendar_id: "primary", sync_mode: "bidirectional" },
          is_active: true,
          last_synced_at: new Date().toISOString(),
        });
      }
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Error al iniciar sesión",
      },
      { status: 500 }
    );
  }
}
