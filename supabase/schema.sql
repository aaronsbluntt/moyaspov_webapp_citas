-- ============================================================================
-- MOYASPOV - SUPABASE DATABASE SCHEMA
-- Arquitectura Multiusuario, Agenda Diaria, Notas y Sincronización Bidireccional
-- (Google Calendar + Notion Smart Parser + Webapp CRUD)
-- ============================================================================

-- 1. EXTENSIONES NECESARIAS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 2. TIPOS ENUMERADOS (ENUMS)
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE event_source AS ENUM ('webapp', 'google_calendar', 'notion');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE event_status AS ENUM ('scheduled', 'completed', 'cancelled', 'rescheduled', 'pending');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE event_type AS ENUM ('appointment', 'session', 'task', 'reminder', 'block');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE event_priority AS ENUM ('low', 'medium', 'high', 'urgent');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE sync_status AS ENUM ('synced', 'pending_push', 'sync_error', 'local_only');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE integration_provider AS ENUM ('google_calendar', 'notion');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE note_type AS ENUM ('comment', 'summary', 'action_item');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE workspace_role AS ENUM ('owner', 'admin', 'member', 'viewer');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'expired', 'revoked');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 3. TABLA DE PERFILES DE USUARIO (profiles)
-- Vinculada opcionalmente a auth.users de Supabase y preparada para multiusuario
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL DEFAULT 'Usuario Moyaspov',
    avatar_url TEXT,
    timezone TEXT NOT NULL DEFAULT 'America/Caracas',
    brand_color TEXT NOT NULL DEFAULT '#D96299',
    preferences JSONB NOT NULL DEFAULT '{
        "theme": "dark",
        "default_view": "agenda",
        "working_hours": {"start": "08:00", "end": "20:00"},
        "notifications_enabled": true
    }'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_auth_user_id ON public.profiles(auth_user_id);

-- ============================================================================
-- 4. ESCALABILIDAD MULTIUSUARIO: WORKSPACES, MIEMBROS E INVITACIONES
-- Permite que usuarios creen espacios, conecten cuentas e inviten colaboradores
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    description TEXT,
    settings JSONB NOT NULL DEFAULT '{"allow_member_invites": false}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role workspace_role NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_workspace_member UNIQUE (workspace_id, profile_id)
);

CREATE TABLE IF NOT EXISTS public.invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    invited_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    invited_email TEXT NOT NULL,
    role workspace_role NOT NULL DEFAULT 'member',
    token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
    status invitation_status NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_profile ON public.workspace_members(profile_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.invitations(invited_email);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.invitations(token);

-- ============================================================================
-- 5. INTEGRACIONES EXTERNAS POR USUARIO (user_integrations)
-- Guarda credenciales OAuth / API tokens de Google Calendar y Notion por usuario
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
    provider integration_provider NOT NULL,
    external_account_id TEXT,
    external_email TEXT,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    scopes TEXT[],
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Ejemplo config Google: {"calendar_id": "primary", "sync_token": "..."}
    -- Ejemplo config Notion: {"page_id": "...", "database_id": "...", "auto_parse": true}
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_synced_at TIMESTAMPTZ,
    last_sync_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_provider UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_integrations_user ON public.user_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_integrations_provider ON public.user_integrations(provider);

-- ============================================================================
-- 6. TABLA CENTRAL DE EVENTOS, CITAS Y TAREAS (events)
-- Soporta creación desde Webapp, Google Calendar y Notion Smart Parser
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
    
    -- Datos principales de la actividad / cita
    title TEXT NOT NULL,
    description TEXT,
    raw_input TEXT, -- Texto original si fue parseado de Notion (ej: "Sesion jueves 29 oct 26 a las 8:00 pm")
    event_type event_type NOT NULL DEFAULT 'appointment',
    status event_status NOT NULL DEFAULT 'scheduled',
    priority event_priority NOT NULL DEFAULT 'medium',
    
    -- Programación temporal
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    all_day BOOLEAN NOT NULL DEFAULT FALSE,
    timezone TEXT NOT NULL DEFAULT 'America/Caracas',
    
    -- Detalles adicionales y estética
    location TEXT,
    meeting_url TEXT,
    color TEXT NOT NULL DEFAULT '#D96299',
    attendees JSONB NOT NULL DEFAULT '[]'::jsonb,
    
    -- Metadatos de Sincronización Bidireccional
    source event_source NOT NULL DEFAULT 'webapp',
    google_event_id TEXT,
    google_calendar_id TEXT DEFAULT 'primary',
    google_etag TEXT,
    notion_block_id TEXT,
    notion_page_id TEXT,
    sync_status sync_status NOT NULL DEFAULT 'local_only',
    last_synced_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Restricción lógica: end_time debe ser mayor o igual a start_time
    CONSTRAINT chk_event_time_range CHECK (end_time >= start_time)
);

-- Índices para consultas rápidas de agenda diaria, analíticas y deduplicación de sincronización
CREATE INDEX IF NOT EXISTS idx_events_user_start ON public.events(user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_events_start_end ON public.events(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_events_status ON public.events(status);
CREATE INDEX IF NOT EXISTS idx_events_source ON public.events(source);
CREATE UNIQUE INDEX IF NOT EXISTS uq_events_google_id ON public.events(user_id, google_event_id) WHERE google_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_events_notion_block ON public.events(user_id, notion_block_id) WHERE notion_block_id IS NOT NULL;

-- ============================================================================
-- 7. MÓDULO DE NOTAS, COMENTARIOS Y RESÚMENES POR EVENTO (event_notes)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.event_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    note_type note_type NOT NULL DEFAULT 'comment',
    content TEXT NOT NULL,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_notes_event_id ON public.event_notes(event_id, created_at DESC);

-- ============================================================================
-- 8. HISTORIAL Y AUDITORÍA DE SINCRONIZACIONES (sync_logs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    provider integration_provider NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('pull', 'push', 'bidirectional', 'parse_notion')),
    status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'error')),
    items_processed INTEGER NOT NULL DEFAULT 0,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_user_executed ON public.sync_logs(user_id, executed_at DESC);

-- ============================================================================
-- 9. TRIGGERS AUTOMÁTICOS DE UPDATED_AT Y CREACIÓN DE PERFIL
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_workspaces_updated_at ON public.workspaces;
CREATE TRIGGER trg_workspaces_updated_at
    BEFORE UPDATE ON public.workspaces
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_user_integrations_updated_at ON public.user_integrations;
CREATE TRIGGER trg_user_integrations_updated_at
    BEFORE UPDATE ON public.user_integrations
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_events_updated_at ON public.events;
CREATE TRIGGER trg_events_updated_at
    BEFORE UPDATE ON public.events
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_event_notes_updated_at ON public.event_notes;
CREATE TRIGGER trg_event_notes_updated_at
    BEFORE UPDATE ON public.event_notes
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Trigger para crear automáticamente perfil y workspace personal cuando un usuario se registra en Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
    new_profile_id UUID;
    new_workspace_id UUID;
BEGIN
    INSERT INTO public.profiles (auth_user_id, email, full_name, avatar_url)
    VALUES (
        NEW.id,
        COALESCE(NEW.email, NEW.id::text || '@moyaspov.local'),
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email, 'Usuario'), '@', 1)),
        NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (email) DO UPDATE
        SET auth_user_id = EXCLUDED.auth_user_id
    RETURNING id INTO new_profile_id;

    INSERT INTO public.workspaces (name, slug, owner_id, description)
    VALUES (
        'Espacio de ' || COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email, 'moyaspov'), '@', 1)),
        'ws-' || substr(replace(new_profile_id::text, '-', ''), 1, 12),
        new_profile_id,
        'Workspace personal creado automáticamente'
    )
    RETURNING id INTO new_workspace_id;

    INSERT INTO public.workspace_members (workspace_id, profile_id, role)
    VALUES (new_workspace_id, new_profile_id, 'owner')
    ON CONFLICT DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ============================================================================
-- 10. VISTA ANALÍTICA PARA EL DASHBOARD (Chart Line de Días Más Ocupados)
-- Consolida eventos por día, origen y horas totales agendadas
-- ============================================================================
CREATE OR REPLACE VIEW public.daily_activity_analytics AS
SELECT
    e.user_id,
    DATE_TRUNC('day', e.start_time AT TIME ZONE COALESCE(e.timezone, 'America/Caracas'))::DATE AS activity_date,
    COUNT(e.id) FILTER (WHERE e.status != 'cancelled') AS total_events,
    COUNT(e.id) FILTER (WHERE e.source = 'google_calendar' AND e.status != 'cancelled') AS google_events,
    COUNT(e.id) FILTER (WHERE e.source = 'notion' AND e.status != 'cancelled') AS notion_events,
    COUNT(e.id) FILTER (WHERE e.source = 'webapp' AND e.status != 'cancelled') AS webapp_events,
    COUNT(e.id) FILTER (WHERE e.status = 'completed') AS completed_events,
    ROUND(
        COALESCE(
            SUM(
                EXTRACT(EPOCH FROM (e.end_time - e.start_time)) / 3600.0
            ) FILTER (WHERE e.status != 'cancelled'),
            0
        )::numeric,
        2
    ) AS total_hours_booked
FROM public.events e
GROUP BY e.user_id, DATE_TRUNC('day', e.start_time AT TIME ZONE COALESCE(e.timezone, 'America/Caracas'))::DATE;

-- ============================================================================
-- 11. ROW LEVEL SECURITY (RLS) Y POLÍTICAS DE ACCESO
-- ============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

-- Políticas permisivas para el propietario autenticado y operaciones del cliente/servidor en desarrollo
CREATE POLICY "Acceso a perfiles" ON public.profiles
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Acceso a workspaces" ON public.workspaces
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Acceso a miembros de workspace" ON public.workspace_members
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Acceso a invitaciones" ON public.invitations
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Acceso a integraciones de usuario" ON public.user_integrations
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Acceso a eventos" ON public.events
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Acceso a notas de eventos" ON public.event_notes
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Acceso a logs de sincronización" ON public.sync_logs
    FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 12. PERFIL INICIAL POR DEFECTO (SEED PARA MOYASPOV)
-- Garantiza que la app tenga un perfil maestro listo desde el primer arranque
-- ============================================================================
INSERT INTO public.profiles (id, email, full_name, timezone, brand_color)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'admin@moyaspov.com',
    'Moyaspov Studio',
    'America/Caracas',
    '#D96299'
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.workspaces (id, name, slug, owner_id, description)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    'Moyaspov HQ',
    'moyaspov-hq',
    '00000000-0000-0000-0000-000000000001',
    'Espacio principal de citas, sesiones y sincronización Notion + Google Calendar'
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.workspace_members (workspace_id, profile_id, role)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'owner'
)
ON CONFLICT (workspace_id, profile_id) DO NOTHING;
