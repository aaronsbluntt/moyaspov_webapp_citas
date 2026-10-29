"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Sparkles,
  RefreshCw,
  MessageSquareText,
  Trash2,
  Edit3,
  Check,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Send,
  X,
  Search,
  User,
  LogOut,
  Calendar as CalendarIcon,
  TrendingUp,
} from "lucide-react";
import { MoyaspovLogo } from "@/components/MoyaspovLogo";
import { ActivityChart, ChartPoint } from "@/components/ActivityChart";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  CalendarEvent,
  EventPriority,
  EventSource,
  EventStatus,
  EventType,
} from "@/types/database";

type ChartRange = "week" | "month";
type MobileSection = "agenda" | "chart";
type LuxuryTheme = "original" | "cinematic";

const DEFAULT_OWNER_PROFILE_ID = "00000000-0000-0000-0000-000000000001";

const THEME_CONFIG: Record<
  LuxuryTheme,
  {
    label: string;
    hex: string;
    hover: string;
    rgb: string;
  }
> = {
  original: {
    label: "Original Fucsia",
    hex: "#D96299",
    hover: "#e68ab5",
    rgb: "217, 98, 153",
  },
  cinematic: {
    label: "Cinematic Retro Beige",
    hex: "#C87A53",
    hover: "#D68E6A",
    rgb: "200, 122, 83",
  },
};

interface ParsedPreview {
  rawText: string;
  title: string;
  startTime: string;
  endTime: string;
  eventType: string;
}

const APP_TIMEZONE = "America/Santo_Domingo";
const SPANISH_DAYS_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const SPANISH_DAYS_LONG = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];
const SPANISH_MONTHS_SHORT = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

function toLocalDateKey(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: APP_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value || "2026";
    const m = parts.find((p) => p.type === "month")?.value || "01";
    const day = parts.find((p) => p.type === "day")?.value || "01";
    return `${y}-${m}-${day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function getTodayDateKey(): string {
  return toLocalDateKey(new Date().toISOString());
}

function formatTimeRange(
  startIso: string,
  endIso: string,
  allDay?: boolean
): string {
  if (allDay) return "Todo el día";
  const s = new Date(startIso);
  const e = new Date(endIso);
  const fmt = (d: Date) =>
    d.toLocaleTimeString("es-DO", {
      timeZone: APP_TIMEZONE,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  return `${fmt(s)} – ${fmt(e)}`;
}

function formatReadableDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  const dayName = SPANISH_DAYS_LONG[dateObj.getDay()];
  const monthName = SPANISH_MONTHS_SHORT[m - 1];
  return `${dayName}, ${d} ${monthName}`;
}

export default function MoyaspovApp() {
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    getTodayDateKey()
  );
  const [chartRange, setChartRange] = useState<ChartRange>("week");
  const [mobileSection, setMobileSection] = useState<MobileSection>("agenda");

  // Dos únicos temas oscuros Quiet Luxury: "original" (rosado/fucsia) y "cinematic" (retro beige + naranja lavado)
  const [themeStyle, setThemeStyle] = useState<LuxuryTheme>("original");
  const activeTheme = THEME_CONFIG[themeStyle];

  // Cargar preferencia de tema guardada
  useEffect(() => {
    try {
      const saved = localStorage.getItem("moyaspov_luxury_theme") as LuxuryTheme;
      if (saved === "original" || saved === "cinematic") {
        setThemeStyle(saved);
      }
    } catch {
      // Ignorar errores de almacenamiento local
    }
  }, []);

  // Aplicar tema Quiet Luxury globalmente al instante
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", themeStyle);
    root.style.setProperty("--accent", activeTheme.hex);
    root.style.setProperty("--accent-hover", activeTheme.hover);
    root.style.setProperty("--accent-rgb", activeTheme.rgb);
    try {
      localStorage.setItem("moyaspov_luxury_theme", themeStyle);
    } catch {
      // Ignorar errores de almacenamiento local
    }
  }, [themeStyle, activeTheme]);

  // Eventos desde Supabase
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);

  // Buscador y filtros bajo demanda
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<EventSource | "all">("all");

  // Modal de Texto Rápido Notion
  const [isNotionModalOpen, setIsNotionModalOpen] = useState<boolean>(false);
  const [notionInput, setNotionInput] = useState<string>("");
  const [notionPreview, setNotionPreview] = useState<ParsedPreview | null>(
    null
  );
  const [parsingNotion, setParsingNotion] = useState<boolean>(false);

  // Evento activo en el Modal de Detalle + Notas
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [newNoteContent, setNewNoteContent] = useState<string>("");
  const [savingNote, setSavingNote] = useState<boolean>(false);

  // Modal de Crear / Editar Cita
  const [isEventModalOpen, setIsEventModalOpen] = useState<boolean>(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [formTitle, setFormTitle] = useState<string>("");
  const [formDescription, setFormDescription] = useState<string>("");
  const [formDate, setFormDate] = useState<string>(() => getTodayDateKey());
  const [formStartTime, setFormStartTime] = useState<string>("18:00");
  const [formEndTime, setFormEndTime] = useState<string>("19:00");
  const [formType, setFormType] = useState<EventType>("session");
  const [formPriority, setFormPriority] = useState<EventPriority>("medium");
  const [formStatus, setFormStatus] = useState<EventStatus>("scheduled");
  const [formLocation, setFormLocation] = useState<string>("");
  const [formInitialNote, setFormInitialNote] = useState<string>("");
  const [savingEvent, setSavingEvent] = useState<boolean>(false);

  // Estado unificado de Autenticación (fluye igual al Header y a la Agenda principal)
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const [authName, setAuthName] = useState<string>("");
  const [authLoading, setAuthLoading] = useState<boolean>(false);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(
    null
  );
  const [userDisplayName, setUserDisplayName] = useState<string | null>(null);
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<boolean>(false);

  const isAuthenticated = Boolean(currentUserEmail);

  const showNotice = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  // Extraer datos del usuario y sincronizar su perfil de inmediato para que Header y Agenda compartan el mismo estado
  const resolveAndApplyAuthUser = useCallback(
    async (
      user: {
        id?: string;
        email?: string;
        user_metadata?: Record<string, unknown>;
        identities?: Array<{ identity_data?: Record<string, unknown> }>;
      } | null
    ) => {
      if (!user || (!user.email && !user.id)) {
        setCurrentUserId(null);
        setCurrentUserEmail(null);
        setUserDisplayName(null);
        setUserAvatarUrl(null);
        setAvatarError(false);
        setEvents([]);
        setLoading(false);
        return;
      }

      const meta = user.user_metadata || {};
      const identityMeta = user.identities?.[0]?.identity_data || {};

      const email =
        user.email ||
        (typeof meta.email === "string" ? meta.email : null) ||
        (typeof identityMeta.email === "string" ? identityMeta.email : null) ||
        "usuario@moyaspov.com";

      const rawAvatar =
        (typeof meta.avatar_url === "string" && meta.avatar_url) ||
        (typeof meta.picture === "string" && meta.picture) ||
        (typeof identityMeta.avatar_url === "string" &&
          identityMeta.avatar_url) ||
        (typeof identityMeta.picture === "string" && identityMeta.picture) ||
        null;

      const rawName =
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        (typeof identityMeta.full_name === "string" &&
          identityMeta.full_name) ||
        null;

      setCurrentUserEmail(email);
      setUserDisplayName(rawName);
      setUserAvatarUrl(rawAvatar);
      setAvatarError(false);

      // Si es el propietario principal, asignar de inmediato su ID de perfil para cargar la agenda sin demora
      if (email.toLowerCase() === "w.aaroncruz@gmail.com") {
        setCurrentUserId(DEFAULT_OWNER_PROFILE_ID);
      }

      try {
        const res = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            authUserId: user.id,
            fullName: rawName || email.split("@")[0],
            avatarUrl: rawAvatar,
          }),
        });
        const data = await res.json();
        const resolvedProfileId =
          data.profileId || data.user?.id || DEFAULT_OWNER_PROFILE_ID;
        setCurrentUserId(resolvedProfileId);
      } catch {
        // Fallback seguro al perfil activo si la red local demora
        setCurrentUserId((prev) => prev || DEFAULT_OWNER_PROFILE_ID);
      }
    },
    []
  );

  // Inicializar fecha local y escuchar sesión de Supabase Auth (getSession + getUser + onAuthStateChange)
  useEffect(() => {
    setSelectedDate(getTodayDateKey());

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        resolveAndApplyAuthUser(data.session.user);
      } else {
        supabase.auth.getUser().then(({ data: userData }) => {
          if (userData.user) {
            resolveAndApplyAuthUser(userData.user);
          } else {
            setEvents([]);
            setLoading(false);
          }
        });
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      resolveAndApplyAuthUser(session?.user || null);
    });

    return () => subscription.unsubscribe();
  }, [resolveAndApplyAuthUser]);

  // Inicial para mostrar cuando el usuario no tiene foto de perfil
  const userInitial = useMemo(() => {
    const source = (userDisplayName || currentUserEmail || "U").trim();
    return source.charAt(0).toUpperCase();
  }, [userDisplayName, currentUserEmail]);

  const fetchEvents = useCallback(
    async (silent = false) => {
      if (!isAuthenticated) {
        setEvents([]);
        setLoading(false);
        return;
      }

      const targetUserId = currentUserId || DEFAULT_OWNER_PROFILE_ID;

      if (!silent) setLoading(true);
      try {
        const res = await fetch(
          `/api/events?userId=${encodeURIComponent(
            targetUserId
          )}&startDate=2026-01-01T00:00:00.000Z&endDate=2026-12-31T23:59:59.999Z`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (Array.isArray(data.events)) {
          setEvents(data.events);
        } else {
          setEvents([]);
        }
      } catch {
        if (!silent) showNotice("Error al cargar la agenda");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [isAuthenticated, currentUserId, showNotice]
  );

  // Sincronización automática en tiempo real cuando el usuario está autenticado
  useEffect(() => {
    if (!isAuthenticated) {
      setEvents([]);
      setLoading(false);
      return;
    }

    const targetUserId = currentUserId || DEFAULT_OWNER_PROFILE_ID;

    fetchEvents(false);

    const syncPayload = JSON.stringify({ userId: targetUserId });

    fetch("/api/sync/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: syncPayload,
    })
      .then(() => fetchEvents(true))
      .catch(() => {});

    const interval = setInterval(() => {
      fetch("/api/sync/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: syncPayload,
      })
        .then(() => fetchEvents(true))
        .catch(() => fetchEvents(true));
    }, 10000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetch("/api/sync/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: syncPayload,
        })
          .then(() => fetchEvents(true))
          .catch(() => fetchEvents(true));
      }
    };

    window.addEventListener("focus", handleVisibility);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleVisibility);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isAuthenticated, currentUserId, fetchEvents]);

  // Previsualización del texto rápido de Notion
  useEffect(() => {
    if (!isNotionModalOpen || !notionInput.trim()) {
      setNotionPreview(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/sync/notion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: notionInput, previewOnly: true }),
        });
        const data = await res.json();
        setNotionPreview(data.parsed || null);
      } catch {
        setNotionPreview(null);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [notionInput, isNotionModalOpen]);

  const handleSyncNotionText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notionInput.trim()) return;
    if (!isAuthenticated) {
      setIsNotionModalOpen(false);
      setIsAuthModalOpen(true);
      showNotice("Inicia sesión para agendar citas");
      return;
    }
    setParsingNotion(true);
    try {
      const res = await fetch("/api/sync/notion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: notionInput,
          userId: currentUserId || DEFAULT_OWNER_PROFILE_ID,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al procesar");

      const created = data.syncedEvents?.[0];
      if (created?.start_time) {
        setSelectedDate(toLocalDateKey(created.start_time));
      }
      setNotionInput("");
      setIsNotionModalOpen(false);
      await fetchEvents(true);
      showNotice(`Cita "${created?.title || "Notion"}" agendada`);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Error al agendar");
    } finally {
      setParsingNotion(false);
    }
  };

  const handleManualSync = async () => {
    if (!isAuthenticated) {
      setIsAuthModalOpen(true);
      showNotice("Inicia sesión para sincronizar tu calendario");
      return;
    }
    setSyncing(true);
    try {
      await fetch("/api/sync/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: currentUserId || DEFAULT_OWNER_PROFILE_ID,
        }),
      });
      await fetchEvents(true);
      showNotice("Sincronizado con Google Calendar");
    } finally {
      setSyncing(false);
    }
  };

  const openCreateModal = (defaultDate?: string) => {
    if (!isAuthenticated) {
      setIsAuthModalOpen(true);
      showNotice("Inicia sesión para agregar citas");
      return;
    }
    setEditingEvent(null);
    setFormTitle("");
    setFormDescription("");
    setFormDate(defaultDate || selectedDate);
    setFormStartTime("18:00");
    setFormEndTime("19:00");
    setFormType("session");
    setFormPriority("medium");
    setFormStatus("scheduled");
    setFormLocation("");
    setFormInitialNote("");
    setIsEventModalOpen(true);
  };

  const openEditModal = (ev: CalendarEvent) => {
    setEditingEvent(ev);
    setFormTitle(ev.title);
    setFormDescription(ev.description || "");
    const startObj = new Date(ev.start_time);
    const endObj = new Date(ev.end_time);
    setFormDate(toLocalDateKey(ev.start_time));
    const fmtHM = (d: Date) =>
      d.toLocaleTimeString("en-GB", {
        timeZone: APP_TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    setFormStartTime(fmtHM(startObj));
    setFormEndTime(fmtHM(endObj));
    setFormType(ev.event_type);
    setFormPriority(ev.priority);
    setFormStatus(ev.status);
    setFormLocation(ev.location || "");
    setFormInitialNote("");
    setIsEventModalOpen(true);
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !isAuthenticated) return;
    setSavingEvent(true);
    try {
      const startIso = new Date(
        `${formDate}T${formStartTime}:00-04:00`
      ).toISOString();
      const endIso = new Date(
        `${formDate}T${formEndTime}:00-04:00`
      ).toISOString();

      if (editingEvent) {
        const res = await fetch(`/api/events/${editingEvent.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: formTitle.trim(),
            description: formDescription.trim() || null,
            event_type: formType,
            priority: formPriority,
            status: formStatus,
            start_time: startIso,
            end_time: endIso,
            location: formLocation.trim() || null,
          }),
        });
        if (!res.ok) throw new Error("Error al actualizar");
        showNotice("Cita actualizada");
      } else {
        const res = await fetch("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: currentUserId || DEFAULT_OWNER_PROFILE_ID,
            title: formTitle.trim(),
            description: formDescription.trim() || null,
            event_type: formType,
            priority: formPriority,
            status: formStatus,
            start_time: startIso,
            end_time: endIso,
            location: formLocation.trim() || null,
            color: activeTheme.hex,
            source: "webapp",
            initial_note: formInitialNote.trim() || undefined,
          }),
        });
        if (!res.ok) throw new Error("Error al crear");
        setSelectedDate(formDate);
        showNotice("Cita agregada");
      }
      setIsEventModalOpen(false);
      await fetchEvents(true);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSavingEvent(false);
    }
  };

  const handleToggleComplete = async (ev: CalendarEvent) => {
    const nextStatus: EventStatus =
      ev.status === "completed" ? "scheduled" : "completed";
    const res = await fetch(`/api/events/${ev.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (res.ok) {
      await fetchEvents(true);
    }
  };

  const handleDeleteEvent = async (ev: CalendarEvent) => {
    const res = await fetch(`/api/events/${ev.id}`, { method: "DELETE" });
    if (res.ok) {
      if (activeEventId === ev.id) setActiveEventId(null);
      await fetchEvents(true);
      showNotice("Cita eliminada");
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEventId || !newNoteContent.trim()) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/events/${activeEventId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author_id: currentUserId || DEFAULT_OWNER_PROFILE_ID,
          content: newNoteContent.trim(),
          note_type: "comment",
        }),
      });
      if (res.ok) {
        setNewNoteContent("");
        await fetchEvents(true);
      }
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!activeEventId) return;
    await fetch(`/api/events/${activeEventId}/notes?noteId=${noteId}`, {
      method: "DELETE",
    });
    await fetchEvents(true);
  };

  // Iniciar sesión con Google (Supabase Auth OAuth)
  const handleGoogleOAuth = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setAuthLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : "Error al conectar con Google"
      );
      setAuthLoading(false);
    }
  };

  // Iniciar sesión o registrarse con Correo y Contraseña en Supabase Auth
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setAuthLoading(true);
    try {
      if (authMode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) throw error;
        await resolveAndApplyAuthUser(data.user);
        setIsAuthModalOpen(false);
        showNotice("Sesión iniciada correctamente");
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
          options: {
            data: { full_name: authName.trim() || authEmail.split("@")[0] },
          },
        });
        if (error) throw error;
        if (data.user) await resolveAndApplyAuthUser(data.user);
        setIsAuthModalOpen(false);
        showNotice("Cuenta creada correctamente");
      }
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : "Error de autenticación"
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    await resolveAndApplyAuthUser(null);
    setIsAuthModalOpen(false);
    showNotice("Sesión cerrada");
  };

  // Eventos del día seleccionado
  const displayedEvents = useMemo(() => {
    if (!isAuthenticated) return [];
    const q = searchQuery.trim().toLowerCase();
    return events
      .filter((ev) => {
        if (sourceFilter !== "all" && ev.source !== sourceFilter) return false;
        if (q) {
          return (
            ev.title.toLowerCase().includes(q) ||
            (ev.description || "").toLowerCase().includes(q) ||
            (ev.location || "").toLowerCase().includes(q)
          );
        }
        return toLocalDateKey(ev.start_time) === selectedDate;
      })
      .sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      );
  }, [events, selectedDate, searchQuery, sourceFilter, isAuthenticated]);

  // Próximas citas cercanas
  const upcomingEvents = useMemo(() => {
    if (!isAuthenticated) return [];
    const startOfSelected = new Date(
      `${selectedDate}T00:00:00-04:00`
    ).getTime();
    return events
      .filter(
        (ev) =>
          ev.status !== "cancelled" &&
          toLocalDateKey(ev.start_time) > selectedDate &&
          new Date(ev.end_time).getTime() >= startOfSelected
      )
      .sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      )
      .slice(0, 4);
  }, [events, selectedDate, isAuthenticated]);

  const activeEvent = useMemo(
    () => events.find((e) => e.id === activeEventId) || null,
    [events, activeEventId]
  );

  // Tira de 7 días centrada en la fecha seleccionada
  const weekStripDays = useMemo(() => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    const base = new Date(y, m - 1, d, 12, 0, 0);
    const days = [];
    for (let offset = -3; offset <= 3; offset++) {
      const dt = new Date(base);
      dt.setDate(base.getDate() + offset);
      const key = toLocalDateKey(dt.toISOString());
      const count = isAuthenticated
        ? events.filter(
            (ev) =>
              ev.status !== "cancelled" && toLocalDateKey(ev.start_time) === key
          ).length
        : 0;
      days.push({
        key,
        dayName: SPANISH_DAYS_SHORT[dt.getDay()],
        dayNumber: dt.getDate(),
        hasEvents: count > 0,
        count,
      });
    }
    return days;
  }, [selectedDate, events, isAuthenticated]);

  // Datos para el Chart Line
  const chartData: ChartPoint[] = useMemo(() => {
    if (!isAuthenticated || events.length === 0) {
      return [];
    }

    const [y, m, d] = selectedDate.split("-").map(Number);
    const baseDate = new Date(y, m - 1, d, 12, 0, 0);

    if (chartRange === "week") {
      const points: ChartPoint[] = [];
      for (let i = -3; i <= 3; i++) {
        const dt = new Date(baseDate);
        dt.setDate(baseDate.getDate() + i);
        const key = toLocalDateKey(dt.toISOString());
        const dayEvents = events.filter(
          (e) => e.status !== "cancelled" && toLocalDateKey(e.start_time) === key
        );
        points.push({
          date: key,
          label: `${SPANISH_DAYS_SHORT[dt.getDay()]} ${dt.getDate()}`,
          totalEvents: dayEvents.length,
          hoursBooked: 0,
          googleEvents: dayEvents.filter((e) => e.source === "google_calendar")
            .length,
          notionEvents: dayEvents.filter((e) => e.source === "notion").length,
          webappEvents: dayEvents.filter((e) => e.source === "webapp").length,
        });
      }
      return points;
    }

    const daysInMonth = new Date(y, m, 0).getDate();
    const points: ChartPoint[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dt = new Date(y, m - 1, day, 12, 0, 0);
      const key = toLocalDateKey(dt.toISOString());
      const dayEvents = events.filter(
        (e) => e.status !== "cancelled" && toLocalDateKey(e.start_time) === key
      );
      if (dayEvents.length > 0 || day % 5 === 0) {
        points.push({
          date: key,
          label: `${day} ${SPANISH_MONTHS_SHORT[m - 1]}`,
          totalEvents: dayEvents.length,
          hoursBooked: 0,
          googleEvents: dayEvents.filter((e) => e.source === "google_calendar")
            .length,
          notionEvents: dayEvents.filter((e) => e.source === "notion").length,
          webappEvents: dayEvents.filter((e) => e.source === "webapp").length,
        });
      }
    }
    return points;
  }, [events, selectedDate, chartRange, isAuthenticated]);

  const shiftSelectedDate = (daysDelta: number) => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d + daysDelta, 12, 0, 0);
    setSelectedDate(toLocalDateKey(dt.toISOString()));
  };

  return (
    <div className="min-h-dvh bg-[var(--bg-primary)] text-[var(--text-primary)] flex flex-col pb-24 sm:pb-10 transition-colors duration-200">
      {/* Notificación flotante */}
      {toast && (
        <div
          className="fixed top-20 left-1/2 -translate-x-1/2 sm:top-auto sm:bottom-6 sm:left-auto sm:right-6 sm:translate-x-0 z-50 glass-panel px-4 py-2.5 rounded-2xl flex items-center gap-2.5 shadow-2xl w-[90%] max-w-xs sm:w-auto"
          style={{ borderColor: "rgba(var(--accent-rgb), 0.45)" }}
        >
          <span className="h-2 w-2 rounded-full bg-[var(--accent)] shrink-0" />
          <span className="text-xs font-medium text-[var(--text-primary)] truncate">
            {toast}
          </span>
        </div>
      )}

      {/* HEADER / NAVBAR MINIMALISTA — QUIET LUXURY */}
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/85 backdrop-blur-xl transition-colors duration-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-2">
          {/* Únicamente el logo SVG */}
          <button
            onClick={() => {
              setSearchQuery("");
              setSourceFilter("all");
              setSelectedDate(getTodayDateKey());
              setMobileSection("agenda");
            }}
            className="p-1.5 rounded-2xl hover:bg-[var(--bg-secondary)]/60 transition flex items-center justify-center shrink-0"
            title="Inicio"
          >
            <MoyaspovLogo size={40} />
          </button>

          {/* Controles derechos + Botón discreto para alternar entre los 2 temas + Avatar circular */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Único botón discreto para alternar entre el acento original (#D96299) y Cinematic Retro Beige (#C87A53) */}
            <button
              type="button"
              onClick={() =>
                setThemeStyle((prev) =>
                  prev === "original" ? "cinematic" : "original"
                )
              }
              title={
                themeStyle === "original"
                  ? "Cambiar a Cinematic Retro Beige"
                  : "Volver al acento original"
              }
              aria-label="Alternar tema de color"
              className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-[var(--bg-secondary)]/70 hover:bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[var(--accent)] flex items-center justify-center transition group"
            >
              <span
                className="h-3.5 w-3.5 rounded-full transition-transform duration-300 group-hover:scale-110"
                style={{
                  background:
                    themeStyle === "original"
                      ? "linear-gradient(135deg, #D96299 50%, #C87A53 50%)"
                      : "linear-gradient(135deg, #C87A53 50%, #EAE0D0 50%)",
                  boxShadow: "0 0 10px rgba(var(--accent-rgb), 0.35)",
                }}
              />
            </button>

            {/* Buscar / Filtrar */}
            <button
              onClick={() => setSearchOpen((prev) => !prev)}
              title="Buscar o filtrar"
              className={`h-9 w-9 sm:h-10 sm:w-10 rounded-xl border flex items-center justify-center transition ${
                searchOpen || searchQuery || sourceFilter !== "all"
                  ? "bg-[var(--bg-secondary)] border-[var(--accent)] text-[var(--accent)]"
                  : "bg-[var(--bg-secondary)]/70 border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Search className="w-4 h-4" />
            </button>

            <button
              onClick={() => setIsNotionModalOpen(true)}
              title="Agendar desde texto rápido (Notion)"
              className="hidden sm:flex h-10 w-10 rounded-xl bg-[var(--bg-secondary)]/70 hover:bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--accent)] items-center justify-center transition"
            >
              <Sparkles className="w-4 h-4" />
            </button>

            <button
              onClick={handleManualSync}
              disabled={syncing}
              title="Sincronizar con Google Calendar"
              className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-[var(--bg-secondary)]/70 hover:bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition"
            >
              <RefreshCw
                className={`w-4 h-4 ${
                  syncing ? "animate-spin text-[var(--accent)]" : ""
                }`}
              />
            </button>

            <button
              onClick={() => openCreateModal()}
              className="hidden sm:flex px-4 py-2.5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[#0d0d0d] font-semibold text-xs items-center gap-1.5 transition shadow-lg"
              style={{
                boxShadow: "0 8px 20px -4px rgba(var(--accent-rgb), 0.3)",
              }}
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Nueva Cita</span>
            </button>

            {/* AVATAR EN PEQUEÑO CÍRCULO MINIMALISTA (FOTO O INICIAL) SI INICIÓ SESIÓN */}
            {isAuthenticated ? (
              <button
                onClick={() => setIsAuthModalOpen(true)}
                title={userDisplayName || currentUserEmail || "Perfil"}
                aria-label="Perfil de usuario"
                className="h-9 w-9 sm:h-10 sm:w-10 rounded-full bg-[var(--bg-secondary)] border border-[var(--accent)] p-0.5 flex items-center justify-center transition shadow-sm overflow-hidden shrink-0"
              >
                {userAvatarUrl && !avatarError ? (
                  <img
                    src={userAvatarUrl}
                    alt={userDisplayName || currentUserEmail || "Usuario"}
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarError(true)}
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  <span className="text-xs sm:text-sm font-semibold text-[var(--accent)] uppercase select-none">
                    {userInitial}
                  </span>
                )}
              </button>
            ) : (
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="h-9 sm:h-10 px-3.5 rounded-xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-secondary)]/80 border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-primary)] flex items-center gap-1.5 transition"
              >
                <User className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span>Ingresar</span>
              </button>
            )}
          </div>
        </div>

        {/* Barra desplegable de búsqueda y filtros */}
        {searchOpen && (
          <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/90 backdrop-blur-xl">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 space-y-2.5 sm:space-y-0 sm:flex sm:items-center sm:gap-3">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar cita por título, nota o lugar..."
                  className="w-full rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent)] pl-9 pr-4 py-2 text-xs text-[var(--text-primary)] outline-none"
                />
              </div>

              <div className="flex items-center justify-between sm:justify-start gap-1.5 text-xs overflow-x-auto">
                <div className="flex items-center gap-1">
                  {(
                    ["all", "google_calendar", "notion", "webapp"] as const
                  ).map((src) => (
                    <button
                      key={src}
                      onClick={() => setSourceFilter(src)}
                      className={`px-2.5 py-1.5 rounded-lg border transition shrink-0 ${
                        sourceFilter === src
                          ? "border-[var(--accent)] text-[var(--accent)] font-medium"
                          : "bg-[var(--bg-input)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      }`}
                      style={
                        sourceFilter === src
                          ? {
                              backgroundColor:
                                "rgba(var(--accent-rgb), 0.14)",
                            }
                          : undefined
                      }
                    >
                      {src === "all"
                        ? "Todos"
                        : src === "google_calendar"
                        ? "Google"
                        : src === "notion"
                        ? "Notion"
                        : "App"}
                    </button>
                  ))}
                </div>

                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) =>
                    e.target.value && setSelectedDate(e.target.value)
                  }
                  className="rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)] shrink-0"
                />
              </div>
            </div>
          </div>
        )}
      </header>

      {/* CONTENIDO PRINCIPAL */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-8">
        <div className="mb-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] sm:text-[11px] uppercase tracking-widest text-[var(--accent)] font-semibold">
                {searchQuery ? "Resultados" : "Agenda Diaria"}
              </p>
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] tracking-tight truncate">
                {searchQuery
                  ? `"${searchQuery}"`
                  : formatReadableDate(selectedDate)}
              </h1>
            </div>

            {!searchQuery && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => shiftSelectedDate(-1)}
                  className="h-9 w-9 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[var(--accent)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSelectedDate(getTodayDateKey())}
                  className="h-9 px-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[var(--accent)] text-xs font-medium text-[var(--text-primary)] transition"
                >
                  Hoy
                </button>
                <button
                  onClick={() => shiftSelectedDate(1)}
                  className="h-9 w-9 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[var(--accent)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Tira de 7 días */}
          {!searchQuery && (
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {weekStripDays.map((d) => {
                const active = d.key === selectedDate;
                return (
                  <button
                    key={d.key}
                    onClick={() => setSelectedDate(d.key)}
                    className={`py-2 sm:py-2.5 rounded-2xl flex flex-col items-center justify-center border transition ${
                      active
                        ? "bg-[var(--accent)] text-[#0d0d0d] border-[var(--accent)] font-semibold shadow-md"
                        : "bg-[var(--bg-secondary)]/75 border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <span className="text-[9px] sm:text-[10px] uppercase tracking-tight">
                      {d.dayName}
                    </span>
                    <span className="text-xs sm:text-sm font-bold mt-0.5">
                      {d.dayNumber}
                    </span>
                    <span
                      className={`mt-1 h-1 w-1 rounded-full ${
                        d.hasEvents
                          ? active
                            ? "bg-[#0d0d0d]"
                            : "bg-[var(--accent)]"
                          : "bg-transparent"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          )}

          {/* Selector de vista en Teléfono (Citas vs Actividad) */}
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] lg:hidden">
            <button
              onClick={() => setMobileSection("agenda")}
              className={`py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition ${
                mobileSection === "agenda"
                  ? "bg-[var(--accent)] text-[#0d0d0d] font-semibold shadow"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              <CalendarIcon className="w-3.5 h-3.5" />
              <span>Citas ({displayedEvents.length})</span>
            </button>
            <button
              onClick={() => setMobileSection("chart")}
              className={`py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition ${
                mobileSection === "chart"
                  ? "bg-[var(--accent)] text-[#0d0d0d] font-semibold shadow"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Actividad</span>
            </button>
          </div>
        </div>

        {/* GRILLA PRINCIPAL */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-start">
          {/* COLUMNA IZQUIERDA (7 COLS): CITAS DEL DÍA Y PRÓXIMAS */}
          <div
            className={`lg:col-span-7 space-y-5 ${
              mobileSection === "chart" ? "hidden lg:block" : "block"
            }`}
          >
            <div className="space-y-2.5 sm:space-y-3">
              {loading ? (
                <div className="glass-panel rounded-3xl p-8 text-center text-xs text-[var(--text-muted)]">
                  Cargando agenda...
                </div>
              ) : !isAuthenticated ? (
                <div className="glass-panel rounded-3xl p-8 text-center space-y-3">
                  <p className="text-sm text-[var(--text-secondary)]">
                    Tu agenda está vacía. Inicia sesión para ver o agendar tus
                    citas.
                  </p>
                  <button
                    onClick={() => setIsAuthModalOpen(true)}
                    className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] font-semibold hover:underline"
                  >
                    <User className="w-3.5 h-3.5" />
                    <span>Ingresar a mi cuenta</span>
                  </button>
                </div>
              ) : displayedEvents.length === 0 ? (
                <div className="glass-panel rounded-3xl p-8 text-center space-y-3">
                  <p className="text-sm text-[var(--text-secondary)]">
                    Sin citas programadas para este día.
                  </p>
                  <button
                    onClick={() => openCreateModal(selectedDate)}
                    className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] font-semibold hover:underline"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Agregar cita en esta fecha</span>
                  </button>
                </div>
              ) : (
                displayedEvents.map((ev) => {
                  const notesCount = ev.event_notes?.length || 0;
                  const firstNote = ev.event_notes?.[0];
                  return (
                    <div
                      key={ev.id}
                      onClick={() => setActiveEventId(ev.id)}
                      className="glass-panel-interactive rounded-2xl p-3.5 sm:p-4 cursor-pointer flex items-stretch gap-3"
                    >
                      <div
                        className={`w-1 rounded-full shrink-0 ${
                          ev.status === "completed"
                            ? "bg-[var(--text-muted)]"
                            : "bg-[var(--accent)]"
                        }`}
                      />

                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-semibold text-[var(--accent)] truncate">
                              {formatTimeRange(
                                ev.start_time,
                                ev.end_time,
                                ev.all_day
                              )}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)] border border-[var(--border-subtle)] shrink-0">
                              {ev.source === "google_calendar"
                                ? "Google"
                                : ev.source === "notion"
                                ? "Notion"
                                : "App"}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {notesCount > 0 && (
                              <span
                                className="px-1.5 py-0.5 rounded-md text-[10px] text-[var(--accent)] flex items-center gap-1"
                                style={{
                                  backgroundColor:
                                    "rgba(var(--accent-rgb), 0.14)",
                                }}
                              >
                                <MessageSquareText className="w-3 h-3" />
                                {notesCount}
                              </span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleComplete(ev);
                              }}
                              className={`h-5 w-5 rounded-full border flex items-center justify-center transition ${
                                ev.status === "completed"
                                  ? "bg-[var(--accent)] border-[var(--accent)] text-[#0d0d0d]"
                                  : "border-[var(--border-subtle)] hover:border-[var(--accent)]"
                              }`}
                            >
                              {ev.status === "completed" && (
                                <Check className="w-3 h-3 stroke-[3]" />
                              )}
                            </button>
                          </div>
                        </div>

                        <h3
                          className={`text-sm sm:text-[15px] font-semibold leading-snug break-words ${
                            ev.status === "completed"
                              ? "line-through text-[var(--text-muted)]"
                              : "text-[var(--text-primary)]"
                          }`}
                        >
                          {ev.title}
                        </h3>

                        {(ev.location || firstNote) && (
                          <div className="pt-0.5 space-y-1">
                            {ev.location && (
                              <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1 truncate">
                                <MapPin className="w-3 h-3 text-[var(--accent)] shrink-0" />
                                <span className="truncate">{ev.location}</span>
                              </p>
                            )}
                            {firstNote && (
                              <p className="text-xs text-[var(--text-secondary)] line-clamp-1 flex items-center gap-1.5">
                                <MessageSquareText className="w-3 h-3 text-[var(--accent)] shrink-0" />
                                <span className="truncate">
                                  {firstNote.content}
                                </span>
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Próximas citas cercanas */}
            {!searchQuery && upcomingEvents.length > 0 && (
              <div className="pt-2 space-y-2.5">
                <h2 className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold px-1">
                  Próximas citas
                </h2>
                <div className="space-y-2">
                  {upcomingEvents.map((ev) => (
                    <div
                      key={ev.id}
                      onClick={() => setActiveEventId(ev.id)}
                      className="glass-panel-interactive rounded-2xl px-4 py-3 cursor-pointer flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {ev.title}
                        </p>
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
                          <span className="text-[var(--accent)] font-medium">
                            {formatReadableDate(toLocalDateKey(ev.start_time))}
                          </span>{" "}
                          •{" "}
                          {formatTimeRange(
                            ev.start_time,
                            ev.end_time,
                            ev.all_day
                          )}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* COLUMNA DERECHA (5 COLS): CHART LINE */}
          <div
            className={`lg:col-span-5 space-y-4 ${
              mobileSection === "agenda" ? "hidden lg:block" : "block"
            }`}
          >
            <div className="glass-panel rounded-3xl p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                    Actividad de la Agenda
                  </h2>
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    Días más ocupados (toca un punto para ir al día)
                  </p>
                </div>

                <div className="flex items-center rounded-xl bg-[var(--bg-input)] p-0.5 border border-[var(--border-subtle)] text-[11px]">
                  <button
                    onClick={() => setChartRange("week")}
                    className={`px-2.5 py-1 rounded-lg transition ${
                      chartRange === "week"
                        ? "bg-[var(--accent)] text-[#0d0d0d] font-semibold"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    Semana
                  </button>
                  <button
                    onClick={() => setChartRange("month")}
                    className={`px-2.5 py-1 rounded-lg transition ${
                      chartRange === "month"
                        ? "bg-[var(--accent)] text-[#0d0d0d] font-semibold"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    Mes
                  </button>
                </div>
              </div>

              <ActivityChart
                data={chartData}
                accentColor={activeTheme.hex}
                themeStyle={themeStyle}
                onSelectDate={(dateIso) => {
                  setSelectedDate(dateIso);
                  setMobileSection("agenda");
                }}
              />
            </div>

            <button
              onClick={() => setIsNotionModalOpen(true)}
              className="hidden lg:flex w-full glass-panel-interactive rounded-2xl p-4 items-center justify-between text-left"
            >
              <div className="flex items-center gap-3">
                <div
                  className="h-9 w-9 rounded-xl border flex items-center justify-center"
                  style={{
                    backgroundColor: "rgba(var(--accent-rgb), 0.14)",
                    borderColor: "rgba(var(--accent-rgb), 0.32)",
                  }}
                >
                  <Sparkles className="w-4 h-4 text-[var(--accent)]" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-[var(--text-primary)]">
                    Agendar con texto rápido (Notion)
                  </p>
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    Ej: &ldquo;Sesion jueves 29 oct 26 a las 8:00 pm&rdquo;
                  </p>
                </div>
              </div>
              <Plus className="w-4 h-4 text-[var(--accent)]" />
            </button>
          </div>
        </div>
      </main>

      {/* DOCK INFERIOR FIJO EN TELÉFONO (< SM) */}
      <div className="fixed bottom-0 inset-x-0 z-30 sm:hidden border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]/90 backdrop-blur-xl px-4 py-3">
        <div className="grid grid-cols-2 gap-2.5 max-w-md mx-auto">
          <button
            onClick={() => setIsNotionModalOpen(true)}
            className="py-2.5 px-3 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-primary)] flex items-center justify-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span>Texto Notion</span>
          </button>
          <button
            onClick={() => openCreateModal()}
            className="py-2.5 px-3 rounded-2xl bg-[var(--accent)] text-[#0d0d0d] font-semibold text-xs flex items-center justify-center gap-1.5 shadow-lg"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Nueva Cita</span>
          </button>
        </div>
      </div>

      {/* MODAL / BOTTOM SHEET DE DETALLE DE CITA Y NOTAS */}
      {activeEvent && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setActiveEventId(null)}
        >
          <div
            className="glass-panel border-t sm:border border-[var(--border-subtle)] rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 sm:p-6 pb-8 sm:pb-6 space-y-4 max-h-[88dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[11px] text-[var(--accent)] font-medium block">
                  {formatReadableDate(toLocalDateKey(activeEvent.start_time))} •{" "}
                  {formatTimeRange(
                    activeEvent.start_time,
                    activeEvent.end_time,
                    activeEvent.all_day
                  )}
                </span>
                <h3 className="text-base sm:text-lg font-bold text-[var(--text-primary)] mt-0.5 break-words">
                  {activeEvent.title}
                </h3>
                {activeEvent.location && (
                  <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1 mt-1">
                    <MapPin className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                    <span className="break-words">{activeEvent.location}</span>
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => {
                    const ev = activeEvent;
                    setActiveEventId(null);
                    openEditModal(ev);
                  }}
                  className="p-2 rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  title="Editar"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDeleteEvent(activeEvent)}
                  className="p-2 rounded-xl bg-[var(--bg-input)] hover:bg-red-500/20 text-[var(--text-secondary)] hover:text-red-400"
                  title="Eliminar"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setActiveEventId(null)}
                  className="p-2 rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {activeEvent.description && (
              <p className="text-xs text-[var(--text-secondary)] bg-[var(--bg-input)] p-3 rounded-2xl border border-[var(--border-subtle)] break-words">
                {activeEvent.description}
              </p>
            )}

            <div className="space-y-2.5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Notas y Resumen ({activeEvent.event_notes?.length || 0})
              </h4>

              <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                {!activeEvent.event_notes ||
                activeEvent.event_notes.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] py-4 text-center border border-dashed border-[var(--border-subtle)] rounded-2xl">
                    Sin notas todavía. Escribe un comentario abajo.
                  </p>
                ) : (
                  activeEvent.event_notes.map((note) => (
                    <div
                      key={note.id}
                      className="p-3 rounded-2xl bg-[var(--bg-input)] border border-[var(--border-subtle)] text-xs flex items-start justify-between gap-2"
                    >
                      <p className="text-[var(--text-primary)] leading-relaxed break-words">
                        {note.content}
                      </p>
                      <button
                        onClick={() => handleDeleteNote(note.id)}
                        className="text-[var(--text-muted)] hover:text-red-400 p-1 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <form
                onSubmit={handleAddNote}
                className="flex items-center gap-2 pt-2"
              >
                <input
                  type="text"
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  placeholder="Agregar nota o comentario..."
                  className="flex-1 rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent)] px-3.5 py-2.5 text-xs text-[var(--text-primary)] outline-none"
                />
                <button
                  type="submit"
                  disabled={savingNote || !newNoteContent.trim()}
                  className="p-2.5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-[#0d0d0d] transition shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL / BOTTOM SHEET DE TEXTO RÁPIDO NOTION */}
      {isNotionModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setIsNotionModalOpen(false)}
        >
          <div
            className="glass-panel border-t sm:border border-[var(--border-subtle)] rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 sm:p-6 pb-8 sm:pb-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--accent)]" />
                <h3 className="text-sm font-bold text-[var(--text-primary)]">
                  Agendar con Texto Rápido (Notion)
                </h3>
              </div>
              <button
                onClick={() => setIsNotionModalOpen(false)}
                className="p-1.5 rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSyncNotionText} className="space-y-3">
              <input
                type="text"
                autoFocus
                value={notionInput}
                onChange={(e) => setNotionInput(e.target.value)}
                placeholder='Ej: "Sesion jueves 29 oct 26 a las 8:00 pm"'
                className="w-full rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent)] px-3.5 py-3 text-sm text-[var(--text-primary)] outline-none"
              />

              {notionPreview && (
                <div className="p-3 rounded-2xl bg-[var(--bg-input)] border border-[var(--accent)] text-xs space-y-1">
                  <p className="text-[var(--text-primary)] font-semibold">
                    {notionPreview.title}
                  </p>
                  <p className="text-[var(--accent)]">
                    {formatReadableDate(
                      toLocalDateKey(notionPreview.startTime)
                    )}{" "}
                    •{" "}
                    {formatTimeRange(
                      notionPreview.startTime,
                      notionPreview.endTime
                    )}
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={parsingNotion || !notionInput.trim()}
                className="w-full py-3 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-[#0d0d0d] font-semibold text-xs transition"
              >
                {parsingNotion ? "Agendando..." : "Agendar Cita"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL / BOTTOM SHEET PARA CREAR / EDITAR CITA */}
      {isEventModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setIsEventModalOpen(false)}
        >
          <div
            className="glass-panel border-t sm:border border-[var(--border-subtle)] rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 sm:p-6 pb-8 sm:pb-6 space-y-4 max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[var(--text-primary)]">
                {editingEvent ? "Editar Cita" : "Nueva Cita"}
              </h3>
              <button
                onClick={() => setIsEventModalOpen(false)}
                className="p-1.5 rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEvent} className="space-y-3.5">
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">
                  Título *
                </label>
                <input
                  type="text"
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Nombre de la sesión o cita"
                  className="w-full rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">
                    Fecha
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 sm:contents gap-2.5">
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">
                      Inicio
                    </label>
                    <input
                      type="time"
                      required
                      value={formStartTime}
                      onChange={(e) => setFormStartTime(e.target.value)}
                      className="w-full rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">
                      Fin
                    </label>
                    <input
                      type="time"
                      required
                      value={formEndTime}
                      onChange={(e) => setFormEndTime(e.target.value)}
                      className="w-full rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">
                  Lugar / Enlace
                </label>
                <input
                  type="text"
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                  placeholder="Opcional"
                  className="w-full rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent)] px-3.5 py-2 text-xs text-[var(--text-primary)] outline-none"
                />
              </div>

              {!editingEvent && (
                <div>
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">
                    Nota o comentario
                  </label>
                  <input
                    type="text"
                    value={formInitialNote}
                    onChange={(e) => setFormInitialNote(e.target.value)}
                    placeholder="Opcional"
                    className="w-full rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent)] px-3.5 py-2 text-xs text-[var(--text-primary)] outline-none"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEventModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-[var(--bg-input)] text-xs text-[var(--text-secondary)]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEvent}
                  className="px-5 py-2.5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[#0d0d0d] font-semibold text-xs transition"
                >
                  {savingEvent ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE CUENTA / PERFIL / LOGIN */}
      {isAuthModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setIsAuthModalOpen(false)}
        >
          <div
            className="glass-panel border-t sm:border border-[var(--border-subtle)] rounded-t-3xl sm:rounded-3xl max-w-sm w-full p-5 sm:p-6 pb-8 sm:pb-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <MoyaspovLogo size={36} />
              <button
                onClick={() => setIsAuthModalOpen(false)}
                className="p-1.5 rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isAuthenticated ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-[var(--bg-input)] border border-[var(--border-subtle)]">
                  <div className="h-12 w-12 rounded-full bg-[var(--bg-secondary)] border border-[var(--accent)] p-0.5 flex items-center justify-center overflow-hidden shrink-0">
                    {userAvatarUrl && !avatarError ? (
                      <img
                        src={userAvatarUrl}
                        alt={userDisplayName || currentUserEmail || "Usuario"}
                        referrerPolicy="no-referrer"
                        onError={() => setAvatarError(true)}
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      <span className="text-base font-semibold text-[var(--accent)] uppercase">
                        {userInitial}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    {userDisplayName && (
                      <p className="text-sm font-bold text-[var(--text-primary)] truncate">
                        {userDisplayName}
                      </p>
                    )}
                    <p className="text-xs text-[var(--text-secondary)] truncate">
                      {currentUserEmail}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSignOut}
                  className="w-full py-2.5 rounded-xl bg-[var(--bg-input)] hover:bg-red-500/20 text-xs text-[var(--text-secondary)] hover:text-red-400 flex items-center justify-center gap-2 transition"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Cerrar sesión</span>
                </button>
              </div>
            ) : (
              <>
                <div>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">
                    {authMode === "login"
                      ? "Ingresa a tu cuenta"
                      : "Crear una cuenta"}
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    Accede con Google o con tu correo electrónico.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleGoogleOAuth}
                  disabled={authLoading}
                  className="w-full py-3 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[#0d0d0d] font-semibold text-xs flex items-center justify-center gap-2 transition shadow-lg"
                >
                  <span>Continuar con Google</span>
                </button>

                <div className="relative flex py-1 items-center">
                  <div className="flex-grow border-t border-[var(--border-subtle)]" />
                  <span className="flex-shrink mx-3 text-[11px] text-[var(--text-muted)]">
                    o con correo
                  </span>
                  <div className="flex-grow border-t border-[var(--border-subtle)]" />
                </div>

                <form onSubmit={handleEmailAuth} className="space-y-3">
                  {authMode === "register" && (
                    <input
                      type="text"
                      required
                      value={authName}
                      onChange={(e) => setAuthName(e.target.value)}
                      placeholder="Tu nombre"
                      className="w-full rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent)] px-3.5 py-2.5 text-xs text-[var(--text-primary)] outline-none"
                    />
                  )}
                  <input
                    type="email"
                    required
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="Correo electrónico"
                    className="w-full rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent)] px-3.5 py-2.5 text-xs text-[var(--text-primary)] outline-none"
                  />
                  <input
                    type="password"
                    required
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="Contraseña"
                    className="w-full rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent)] px-3.5 py-2.5 text-xs text-[var(--text-primary)] outline-none"
                  />

                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full py-2.5 rounded-xl bg-[var(--bg-secondary)] hover:opacity-90 border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] font-medium transition"
                  >
                    {authLoading
                      ? "Procesando..."
                      : authMode === "login"
                      ? "Ingresar con correo"
                      : "Registrarme"}
                  </button>
                </form>

                <p className="text-center text-xs text-[var(--text-secondary)]">
                  {authMode === "login" ? (
                    <>
                      ¿No tienes cuenta?{" "}
                      <button
                        type="button"
                        onClick={() => setAuthMode("register")}
                        className="text-[var(--accent)] hover:underline font-medium"
                      >
                        Regístrate
                      </button>
                    </>
                  ) : (
                    <>
                      ¿Ya tienes cuenta?{" "}
                      <button
                        type="button"
                        onClick={() => setAuthMode("login")}
                        className="text-[var(--accent)] hover:underline font-medium"
                      >
                        Inicia sesión
                      </button>
                    </>
                  )}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
