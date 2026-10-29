import {
  DEFAULT_USER_ID,
  DEFAULT_WORKSPACE_ID,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import {
  IntegrationProvider,
  Profile,
  UserIntegration,
  Workspace,
  WorkspaceRole,
} from "@/types/database";

/**
 * Obtiene el perfil del usuario actual o el perfil maestro por defecto.
 */
export async function getUserProfile(
  userId: string = DEFAULT_USER_ID
): Promise<Profile | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al obtener perfil: ${error.message}`);
  }
  return data as Profile | null;
}

/**
 * Obtiene los espacios de trabajo (workspaces) del usuario.
 */
export async function getUserWorkspaces(
  userId: string = DEFAULT_USER_ID
): Promise<Workspace[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("workspaces")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Error al obtener workspaces: ${error.message}`);
  }
  return (data || []) as Workspace[];
}

/**
 * Crea una invitación para que otro usuario se una al workspace (Escalabilidad Multiusuario).
 */
export async function inviteUserToWorkspace(options: {
  workspaceId?: string;
  invitedBy?: string;
  invitedEmail: string;
  role?: WorkspaceRole;
}) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("invitations")
    .insert({
      workspace_id: options.workspaceId || DEFAULT_WORKSPACE_ID,
      invited_by: options.invitedBy || DEFAULT_USER_ID,
      invited_email: options.invitedEmail.trim().toLowerCase(),
      role: options.role || "member",
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Error al crear invitación: ${error.message}`);
  }
  return data;
}

/**
 * Guarda o actualiza las credenciales de integración (Google Calendar o Notion) de un usuario.
 */
export async function upsertUserIntegration(options: {
  userId?: string;
  workspaceId?: string;
  provider: IntegrationProvider;
  externalEmail?: string;
  accessToken?: string;
  refreshToken?: string;
  config?: Record<string, unknown>;
}): Promise<UserIntegration> {
  const supabase = getSupabaseServerClient();
  const userId = options.userId || DEFAULT_USER_ID;

  const { data, error } = await supabase
    .from("user_integrations")
    .upsert(
      {
        user_id: userId,
        workspace_id: options.workspaceId || DEFAULT_WORKSPACE_ID,
        provider: options.provider,
        external_email: options.externalEmail || null,
        access_token: options.accessToken || null,
        refresh_token: options.refreshToken || null,
        config: options.config || {},
        is_active: true,
      },
      { onConflict: "user_id,provider" }
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Error al guardar integración: ${error?.message}`);
  }
  return data as UserIntegration;
}

/**
 * Lista las integraciones activas de un usuario.
 */
export async function getUserIntegrations(
  userId: string = DEFAULT_USER_ID
): Promise<UserIntegration[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("user_integrations")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Error al consultar integraciones: ${error.message}`);
  }
  return (data || []) as UserIntegration[];
}
