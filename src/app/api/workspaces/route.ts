import { NextRequest, NextResponse } from "next/server";
import {
  getUserIntegrations,
  getUserProfile,
  getUserWorkspaces,
  inviteUserToWorkspace,
  upsertUserIntegration,
} from "@/lib/services/workspaces";
import {
  DEFAULT_USER_ID,
  DEFAULT_WORKSPACE_ID,
  getSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    if (!isSupabaseServerConfigured()) {
      return NextResponse.json({
        configured: false,
        profile: null,
        workspaces: [],
        integrations: [],
        invitations: [],
      });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId") || DEFAULT_USER_ID;

    const [profile, workspaces, integrations] = await Promise.all([
      getUserProfile(userId),
      getUserWorkspaces(userId),
      getUserIntegrations(userId),
    ]);

    const supabase = getSupabaseServerClient();
    const { data: invitations } = await supabase
      .from("invitations")
      .select("*")
      .eq("workspace_id", workspaces[0]?.id || DEFAULT_WORKSPACE_ID)
      .order("created_at", { ascending: false });

    return NextResponse.json({
      configured: true,
      profile,
      workspaces,
      integrations,
      invitations: invitations || [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error al cargar datos del workspace",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.action === "invite") {
      const invitation = await inviteUserToWorkspace({
        workspaceId: body.workspaceId,
        invitedBy: body.invitedBy,
        invitedEmail: body.email,
        role: body.role || "member",
      });
      return NextResponse.json({ invitation }, { status: 201 });
    }

    if (body.action === "integration") {
      const integration = await upsertUserIntegration({
        userId: body.userId,
        workspaceId: body.workspaceId,
        provider: body.provider,
        externalEmail: body.externalEmail,
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        config: body.config,
      });
      return NextResponse.json({ integration });
    }

    return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error al procesar solicitud de workspace",
      },
      { status: 500 }
    );
  }
}
