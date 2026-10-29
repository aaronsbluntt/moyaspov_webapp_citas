export type EventSource = "webapp" | "google_calendar" | "notion";
export type EventStatus = "scheduled" | "completed" | "cancelled" | "rescheduled" | "pending";
export type EventType = "appointment" | "session" | "task" | "reminder" | "block";
export type EventPriority = "low" | "medium" | "high" | "urgent";
export type SyncStatus = "synced" | "pending_push" | "sync_error" | "local_only";
export type IntegrationProvider = "google_calendar" | "notion";
export type NoteType = "comment" | "summary" | "action_item";
export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";
export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export interface Profile {
  id: string;
  auth_user_id?: string | null;
  email: string;
  full_name: string;
  avatar_url?: string | null;
  timezone: string;
  brand_color: string;
  preferences: {
    theme: "dark" | "light";
    default_view: "agenda" | "dashboard";
    working_hours: { start: string; end: string };
    notifications_enabled: boolean;
  };
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  description?: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UserIntegration {
  id: string;
  user_id: string;
  workspace_id?: string | null;
  provider: IntegrationProvider;
  external_account_id?: string | null;
  external_email?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  token_expires_at?: string | null;
  scopes?: string[] | null;
  config: {
    calendar_id?: string;
    sync_token?: string;
    page_id?: string;
    database_id?: string;
    auto_parse?: boolean;
  };
  is_active: boolean;
  last_synced_at?: string | null;
  last_sync_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventNote {
  id: string;
  event_id: string;
  author_id?: string | null;
  note_type: NoteType;
  content: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface CalendarEvent {
  id: string;
  user_id: string;
  workspace_id?: string | null;
  title: string;
  description?: string | null;
  raw_input?: string | null;
  event_type: EventType;
  status: EventStatus;
  priority: EventPriority;
  start_time: string;
  end_time: string;
  all_day: boolean;
  timezone: string;
  location?: string | null;
  meeting_url?: string | null;
  color: string;
  attendees: Array<{ email: string; name?: string; responseStatus?: string }>;
  source: EventSource;
  google_event_id?: string | null;
  google_calendar_id?: string | null;
  google_etag?: string | null;
  notion_block_id?: string | null;
  notion_page_id?: string | null;
  sync_status: SyncStatus;
  last_synced_at?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  event_notes?: EventNote[];
}

export interface CreateEventInput {
  user_id?: string;
  workspace_id?: string | null;
  title: string;
  description?: string | null;
  raw_input?: string | null;
  event_type?: EventType;
  status?: EventStatus;
  priority?: EventPriority;
  start_time: string;
  end_time: string;
  all_day?: boolean;
  timezone?: string;
  location?: string | null;
  meeting_url?: string | null;
  color?: string;
  source?: EventSource;
  google_event_id?: string | null;
  notion_block_id?: string | null;
  notion_page_id?: string | null;
  sync_to_google?: boolean;
  initial_note?: string;
}

export interface UpdateEventInput extends Partial<CreateEventInput> {
  sync_status?: SyncStatus;
}

export interface DailyActivityMetric {
  user_id: string;
  activity_date: string;
  total_events: number;
  google_events: number;
  notion_events: number;
  webapp_events: number;
  completed_events: number;
  total_hours_booked: number;
}
