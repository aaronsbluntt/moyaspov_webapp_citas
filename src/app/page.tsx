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
import {
  CalendarEvent,
  EventPriority,
  EventSource,
  EventStatus,
  EventType,
} from "@/types/database";

type ChartRange = "week" | "month";
type MobileSection = "agenda" | "chart";

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

/**
 * Convierte cualquier ISO string a YYYY-MM-DD en la zona horaria America/Santo_Domingo (-04:00)
 * evitando que el reloj UTC de Vercel salte al día siguiente después de las 8:00 PM.
 */
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
    const m = parts.find((p) => p.type === "month")?.value || "10";
    const day = parts.find((p) => p.type === "day")?.value || "28";
    return `${y}-${m}-${day}`;
  } catch {
    return "2026-10-28";
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
  const [selectedDate, setSelectedDate] = useState<string>("2026-10-28");
  const [chartRange, setChartRange] = useState<ChartRange>("week");
  const [mobileSection, setMobileSection] = useState<MobileSection>("agenda");

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
  const [notionPreview, setNotionPreview] = useState<ParsedPreview | null>(null);
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
  const [formDate, setFormDate] = useState<string>("2026-10-28");
  const [formStartTime, setFormStartTime] = useState<string>("18:00");
  const [formEndTime, setFormEndTime] = useState<string>("19:00");
  const [formType, setFormType] = useState<EventType>("session");
  const [formPriority, setFormPriority] = useState<EventPriority>("medium");
  const [formStatus, setFormStatus] = useState<EventStatus>("scheduled");
  const [formLocation, setFormLocation] = useState<string>("");
  const [formInitialNote, setFormInitialNote] = useState<string>("");
  const [savingEvent, setSavingEvent] = useState<boolean>(false);

  // Apartado para ingresar con su cuenta (Google / Correo)
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authEmail, setAuthEmail] = useState<string>("w.aaroncruz@gmail.com");
  const [authName, setAuthName] = useState<string>("Aaron Cruz");
  const [icalUrlInput, setIcalUrlInput] = useState<string>("");
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  const showNotice = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  // Inicializar fecha local y sesión guardada en el navegador
  useEffect(() => {
    setSelectedDate(getTodayDateKey());
    const savedEmail = localStorage.getItem("moyaspov_user_email");
    const savedIcal = localStorage.getItem("moyaspov_ical_url");
    if (savedEmail) {
      setCurrentUserEmail(savedEmail);
      setAuthEmail(savedEmail);
    }
    if (savedIcal) {
      setIcalUrlInput(savedIcal);
    }
  }, []);

  const fetchEvents = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(
        `/api/events?startDate=2026-01-01T00:00:00.000Z&endDate=2026-12-31T23:59:59.999Z`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (data.events) {
        setEvents(data.events);
      }
    } catch {
      if (!silent) showNotice("Error al cargar la agenda");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [showNotice]);

  // Sincronización automática en tiempo real (al cargar, al volver a la app en el teléfono y cada 10s)
  useEffect(() => {
    fetchEvents(false);

    // Disparar sincronización con Google Calendar en segundo plano
    fetch("/api/sync/google", { method: "POST" })
      .then(() => fetchEvents(true))
      .catch(() => {});

    const interval = setInterval(() => {
      fetch("/api/sync/google", { method: "POST" })
        .then(() => fetchEvents(true))
        .catch(() => fetchEvents(true));
    }, 10000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetch("/api/sync/google", { method: "POST" })
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
  }, [fetchEvents]);

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
    setParsingNotion(true);
    try {
      const res = await fetch("/api/sync/notion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: notionInput }),
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
    setSyncing(true);
    try {
      await fetch("/api/sync/google", { method: "POST" });
      await fetchEvents(true);
      showNotice("Sincronizado con Google Calendar");
    } finally {
      setSyncing(false);
    }
  };

  const openCreateModal = (defaultDate?: string) => {
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
    if (!formTitle.trim()) return;
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
            title: formTitle.trim(),
            description: formDescription.trim() || null,
            event_type: formType,
            priority: formPriority,
            status: formStatus,
            start_time: startIso,
            end_time: endIso,
            location: formLocation.trim() || null,
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

  // Ingresar con Google / Vincular Cuenta (Sin el error de OAuth deshabilitado)
  const handleGoogleSignIn = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const targetEmail = authEmail.trim() || "w.aaroncruz@gmail.com";
    setAuthLoading(true);
    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: targetEmail,
          fullName: authName.trim() || targetEmail.split("@")[0],
          icalUrl: icalUrlInput.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo conectar");

      localStorage.setItem("moyaspov_user_email", targetEmail);
      if (icalUrlInput.trim()) {
        localStorage.setItem("moyaspov_ical_url", icalUrlInput.trim());
      }
      setCurrentUserEmail(targetEmail);
      setIsAuthModalOpen(false);

      // Sincronizar Google Calendar inmediatamente
      await fetch("/api/sync/google", { method: "POST" });
      await fetchEvents(true);
      showNotice(`Conectado como ${targetEmail}`);
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : "Error al vincular cuenta"
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = () => {
    localStorage.removeItem("moyaspov_user_email");
    setCurrentUserEmail(null);
    setIsAuthModalOpen(false);
    showNotice("Sesión cerrada");
  };

  // Eventos del día seleccionado
  const displayedEvents = useMemo(() => {
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
  }, [events, selectedDate, searchQuery, sourceFilter]);

  // Próximas citas cercanas (posteriores al día seleccionado)
  const upcomingEvents = useMemo(() => {
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
  }, [events, selectedDate]);

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
      const count = events.filter(
        (ev) =>
          ev.status !== "cancelled" && toLocalDateKey(ev.start_time) === key
      ).length;
      days.push({
        key,
        dayName: SPANISH_DAYS_SHORT[dt.getDay()],
        dayNumber: dt.getDate(),
        hasEvents: count > 0,
        count,
      });
    }
    return days;
  }, [selectedDate, events]);

  // Datos para el Chart Line
  const chartData: ChartPoint[] = useMemo(() => {
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
  }, [events, selectedDate, chartRange]);

  const shiftSelectedDate = (daysDelta: number) => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d + daysDelta, 12, 0, 0);
    setSelectedDate(toLocalDateKey(dt.toISOString()));
  };

  return (
    <div className="min-h-dvh bg-[#0d0d0d] text-zinc-100 flex flex-col pb-24 sm:pb-10">
      {/* Notificación flotante */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 sm:top-auto sm:bottom-6 sm:left-auto sm:right-6 sm:translate-x-0 z-50 glass-panel border-[#D96299]/40 px-4 py-2.5 rounded-2xl flex items-center gap-2.5 shadow-2xl w-[90%] max-w-xs sm:w-auto">
          <span className="h-2 w-2 rounded-full bg-[#D96299] shrink-0" />
          <span className="text-xs font-medium text-zinc-100 truncate">
            {toast}
          </span>
        </div>
      )}

      {/* HEADER MINIMALISTA — SOLO EL LOGO A LA IZQUIERDA */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#0d0d0d]/85 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-2">
          {/* Únicamente el logo SVG */}
          <button
            onClick={() => {
              setSearchQuery("");
              setSourceFilter("all");
              setSelectedDate(getTodayDateKey());
              setMobileSection("agenda");
            }}
            className="p-1.5 rounded-2xl hover:bg-white/[0.04] transition flex items-center justify-center shrink-0"
            title="Inicio"
          >
            <MoyaspovLogo size={40} />
          </button>

          {/* Controles derechos bien estructurados en móvil y desktop */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => setSearchOpen((prev) => !prev)}
              title="Buscar o filtrar"
              className={`h-9 w-9 sm:h-10 sm:w-10 rounded-xl border flex items-center justify-center transition ${
                searchOpen || searchQuery || sourceFilter !== "all"
                  ? "bg-[#181426] border-[#D96299]/50 text-[#D96299]"
                  : "bg-[#181426]/60 border-white/[0.07] text-zinc-400 hover:text-white"
              }`}
            >
              <Search className="w-4 h-4" />
            </button>

            <button
              onClick={() => setIsNotionModalOpen(true)}
              title="Agendar desde texto rápido (Notion)"
              className="hidden sm:flex h-10 w-10 rounded-xl bg-[#181426]/60 hover:bg-[#181426] border border-white/[0.07] hover:border-[#D96299]/40 text-zinc-400 hover:text-[#D96299] items-center justify-center transition"
            >
              <Sparkles className="w-4 h-4" />
            </button>

            <button
              onClick={handleManualSync}
              disabled={syncing}
              title="Sincronizar con Google Calendar"
              className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-[#181426]/60 hover:bg-[#181426] border border-white/[0.07] text-zinc-400 hover:text-white flex items-center justify-center transition"
            >
              <RefreshCw
                className={`w-4 h-4 ${
                  syncing ? "animate-spin text-[#D96299]" : ""
                }`}
              />
            </button>

            <button
              onClick={() => openCreateModal()}
              className="hidden sm:flex px-4 py-2.5 rounded-xl bg-[#D96299] hover:bg-[#e68ab5] text-[#0d0d0d] font-semibold text-xs items-center gap-1.5 transition shadow-lg shadow-[#D96299]/20"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Nueva Cita</span>
            </button>

            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="h-9 sm:h-10 px-3 sm:px-3.5 rounded-xl bg-[#181426] hover:bg-[#181426]/90 border border-white/10 hover:border-[#D96299]/40 text-xs font-medium text-zinc-200 flex items-center gap-1.5 transition"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  currentUserEmail ? "bg-emerald-400" : "bg-[#D96299]"
                }`}
              />
              <span className="max-w-[90px] sm:max-w-[120px] truncate">
                {currentUserEmail
                  ? currentUserEmail.split("@")[0]
                  : "Ingresar"}
              </span>
            </button>
          </div>
        </div>

        {/* Barra desplegable de búsqueda y filtros */}
        {searchOpen && (
          <div className="border-t border-white/[0.06] bg-[#181426]/80 backdrop-blur-xl">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 space-y-2.5 sm:space-y-0 sm:flex sm:items-center sm:gap-3">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar cita por título, nota o lugar..."
                  className="w-full rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] pl-9 pr-4 py-2 text-xs text-white outline-none"
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
                          ? "bg-[#D96299]/20 border-[#D96299] text-[#D96299] font-medium"
                          : "bg-[#0d0d0d] border-white/10 text-zinc-400 hover:text-white"
                      }`}
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
                  className="rounded-xl bg-[#0d0d0d] border border-white/10 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-[#D96299] shrink-0"
                />
              </div>
            </div>
          </div>
        )}
      </header>

      {/* CONTENIDO PRINCIPAL BIEN ESTRUCTURADO EN TELÉFONO Y DESKTOP */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-8">
        {/* Cabecera de Fecha y Tira Semanal (Siempre visible arriba) */}
        <div className="mb-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] sm:text-[11px] uppercase tracking-widest text-[#D96299] font-semibold">
                {searchQuery ? "Resultados" : "Agenda Diaria"}
              </p>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate">
                {searchQuery
                  ? `"${searchQuery}"`
                  : formatReadableDate(selectedDate)}
              </h1>
            </div>

            {!searchQuery && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => shiftSelectedDate(-1)}
                  className="h-9 w-9 rounded-xl bg-[#181426] border border-white/[0.07] hover:border-[#D96299]/40 text-zinc-300 flex items-center justify-center transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSelectedDate(getTodayDateKey())}
                  className="h-9 px-3 rounded-xl bg-[#181426] border border-white/[0.07] hover:border-[#D96299]/40 text-xs font-medium text-zinc-200 transition"
                >
                  Hoy
                </button>
                <button
                  onClick={() => shiftSelectedDate(1)}
                  className="h-9 w-9 rounded-xl bg-[#181426] border border-white/[0.07] hover:border-[#D96299]/40 text-zinc-300 flex items-center justify-center transition"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Tira de 7 días perfectamente proporcionada para pantallas móviles */}
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
                        ? "bg-[#D96299] text-[#0d0d0d] border-[#D96299] font-semibold shadow-lg shadow-[#D96299]/20"
                        : "bg-[#181426]/65 border-white/[0.06] text-zinc-400 hover:text-white"
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
                            : "bg-[#D96299]"
                          : "bg-transparent"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          )}

          {/* Selector de vista en Teléfono (Agenda vs Gráfico) para evitar scroll desordenado */}
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-[#181426]/90 border border-white/[0.07] lg:hidden">
            <button
              onClick={() => setMobileSection("agenda")}
              className={`py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition ${
                mobileSection === "agenda"
                  ? "bg-[#D96299] text-[#0d0d0d] font-semibold shadow"
                  : "text-zinc-400"
              }`}
            >
              <CalendarIcon className="w-3.5 h-3.5" />
              <span>Citas ({displayedEvents.length})</span>
            </button>
            <button
              onClick={() => setMobileSection("chart")}
              className={`py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition ${
                mobileSection === "chart"
                  ? "bg-[#D96299] text-[#0d0d0d] font-semibold shadow"
                  : "text-zinc-400"
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
            {/* Lista de Citas del Día */}
            <div className="space-y-2.5 sm:space-y-3">
              {loading ? (
                <div className="glass-panel rounded-3xl p-8 text-center text-xs text-zinc-500">
                  Cargando agenda...
                </div>
              ) : displayedEvents.length === 0 ? (
                <div className="glass-panel rounded-3xl p-8 text-center space-y-3">
                  <p className="text-sm text-zinc-300">
                    Sin citas programadas para este día.
                  </p>
                  <button
                    onClick={() => openCreateModal(selectedDate)}
                    className="inline-flex items-center gap-1.5 text-xs text-[#D96299] font-medium hover:underline"
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
                      {/* Barra lateral de acento */}
                      <div
                        className={`w-1 rounded-full shrink-0 ${
                          ev.status === "completed"
                            ? "bg-zinc-600"
                            : "bg-[#D96299]"
                        }`}
                      />

                      <div className="flex-1 min-w-0 space-y-1">
                        {/* Fila 1: Horario + Origen + Botón Completar */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-semibold text-[#D96299] truncate">
                              {formatTimeRange(
                                ev.start_time,
                                ev.end_time,
                                ev.all_day
                              )}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.05] text-zinc-400 border border-white/[0.06] shrink-0">
                              {ev.source === "google_calendar"
                                ? "Google"
                                : ev.source === "notion"
                                ? "Notion"
                                : "App"}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {notesCount > 0 && (
                              <span className="px-1.5 py-0.5 rounded-md bg-[#D96299]/10 text-[10px] text-[#D96299] flex items-center gap-1">
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
                                  ? "bg-[#D96299] border-[#D96299] text-[#0d0d0d]"
                                  : "border-white/25 hover:border-[#D96299]"
                              }`}
                            >
                              {ev.status === "completed" && (
                                <Check className="w-3 h-3 stroke-[3]" />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Fila 2: Título completo bien legible en móvil */}
                        <h3
                          className={`text-sm sm:text-[15px] font-semibold leading-snug break-words ${
                            ev.status === "completed"
                              ? "line-through text-zinc-500"
                              : "text-white"
                          }`}
                        >
                          {ev.title}
                        </h3>

                        {/* Fila 3: Ubicación o vista previa de nota */}
                        {(ev.location || firstNote) && (
                          <div className="pt-0.5 space-y-1">
                            {ev.location && (
                              <p className="text-xs text-zinc-400 flex items-center gap-1 truncate">
                                <MapPin className="w-3 h-3 text-[#D96299] shrink-0" />
                                <span className="truncate">{ev.location}</span>
                              </p>
                            )}
                            {firstNote && (
                              <p className="text-xs text-zinc-400 line-clamp-1 flex items-center gap-1.5">
                                <MessageSquareText className="w-3 h-3 text-[#D96299] shrink-0" />
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
                <h2 className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold px-1">
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
                        <p className="text-sm font-medium text-white truncate">
                          {ev.title}
                        </p>
                        <p className="text-xs text-zinc-400 mt-0.5 truncate">
                          <span className="text-[#D96299] font-medium">
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
                      <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" />
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
                  <h2 className="text-sm font-semibold text-white">
                    Actividad de la Agenda
                  </h2>
                  <p className="text-[11px] text-zinc-400">
                    Días más ocupados (toca un punto para ir al día)
                  </p>
                </div>

                <div className="flex items-center rounded-xl bg-[#0d0d0d] p-0.5 border border-white/[0.07] text-[11px]">
                  <button
                    onClick={() => setChartRange("week")}
                    className={`px-2.5 py-1 rounded-lg transition ${
                      chartRange === "week"
                        ? "bg-[#D96299] text-[#0d0d0d] font-semibold"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    Semana
                  </button>
                  <button
                    onClick={() => setChartRange("month")}
                    className={`px-2.5 py-1 rounded-lg transition ${
                      chartRange === "month"
                        ? "bg-[#D96299] text-[#0d0d0d] font-semibold"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    Mes
                  </button>
                </div>
              </div>

              <ActivityChart
                data={chartData}
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
                <div className="h-9 w-9 rounded-xl bg-[#D96299]/15 border border-[#D96299]/30 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-[#D96299]" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-white">
                    Agendar con texto rápido (Notion)
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    Ej: &ldquo;Sesion jueves 29 oct 26 a las 8:00 pm&rdquo;
                  </p>
                </div>
              </div>
              <Plus className="w-4 h-4 text-[#D96299]" />
            </button>
          </div>
        </div>
      </main>

      {/* DOCK INFERIOR FIJO EN TELÉFONO (< SM) PARA ACCIONES RÁPIDAS */}
      <div className="fixed bottom-0 inset-x-0 z-30 sm:hidden border-t border-white/[0.08] bg-[#0d0d0d]/90 backdrop-blur-xl px-4 py-3">
        <div className="grid grid-cols-2 gap-2.5 max-w-md mx-auto">
          <button
            onClick={() => setIsNotionModalOpen(true)}
            className="py-2.5 px-3 rounded-2xl bg-[#181426] border border-[#D96299]/30 text-xs font-medium text-zinc-100 flex items-center justify-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#D96299]" />
            <span>Texto Notion</span>
          </button>
          <button
            onClick={() => openCreateModal()}
            className="py-2.5 px-3 rounded-2xl bg-[#D96299] text-[#0d0d0d] font-semibold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-[#D96299]/25"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Nueva Cita</span>
          </button>
        </div>
      </div>

      {/* MODAL / BOTTOM SHEET DE DETALLE DE CITA Y NOTAS */}
      {activeEvent && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setActiveEventId(null)}
        >
          <div
            className="glass-panel border-t sm:border border-[#D96299]/35 rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 sm:p-6 pb-8 sm:pb-6 space-y-4 max-h-[88dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[11px] text-[#D96299] font-medium block">
                  {formatReadableDate(toLocalDateKey(activeEvent.start_time))} •{" "}
                  {formatTimeRange(
                    activeEvent.start_time,
                    activeEvent.end_time,
                    activeEvent.all_day
                  )}
                </span>
                <h3 className="text-base sm:text-lg font-bold text-white mt-0.5 break-words">
                  {activeEvent.title}
                </h3>
                {activeEvent.location && (
                  <p className="text-xs text-zinc-400 flex items-center gap-1 mt-1">
                    <MapPin className="w-3.5 h-3.5 text-[#D96299] shrink-0" />
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
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300"
                  title="Editar"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDeleteEvent(activeEvent)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-red-500/20 text-zinc-400 hover:text-red-300"
                  title="Eliminar"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setActiveEventId(null)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {activeEvent.description && (
              <p className="text-xs text-zinc-300 bg-[#0d0d0d]/60 p-3 rounded-2xl border border-white/[0.05] break-words">
                {activeEvent.description}
              </p>
            )}

            {/* Notas / Comentarios */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Notas y Resumen ({activeEvent.event_notes?.length || 0})
              </h4>

              <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                {!activeEvent.event_notes ||
                activeEvent.event_notes.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-4 text-center border border-dashed border-white/10 rounded-2xl">
                    Sin notas todavía. Escribe un comentario abajo.
                  </p>
                ) : (
                  activeEvent.event_notes.map((note) => (
                    <div
                      key={note.id}
                      className="p-3 rounded-2xl bg-[#0d0d0d]/80 border border-white/[0.06] text-xs flex items-start justify-between gap-2"
                    >
                      <p className="text-zinc-200 leading-relaxed break-words">
                        {note.content}
                      </p>
                      <button
                        onClick={() => handleDeleteNote(note.id)}
                        className="text-zinc-500 hover:text-red-400 p-1 shrink-0"
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
                  className="flex-1 rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] px-3.5 py-2.5 text-xs text-white outline-none"
                />
                <button
                  type="submit"
                  disabled={savingNote || !newNoteContent.trim()}
                  className="p-2.5 rounded-xl bg-[#D96299] hover:bg-[#e68ab5] disabled:opacity-50 text-[#0d0d0d] transition shrink-0"
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
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setIsNotionModalOpen(false)}
        >
          <div
            className="glass-panel border-t sm:border border-[#D96299]/40 rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 sm:p-6 pb-8 sm:pb-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#D96299]" />
                <h3 className="text-sm font-bold text-white">
                  Agendar con Texto Rápido (Notion)
                </h3>
              </div>
              <button
                onClick={() => setIsNotionModalOpen(false)}
                className="p-1.5 rounded-xl bg-white/5 text-zinc-400 hover:text-white"
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
                className="w-full rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] px-3.5 py-3 text-sm text-white outline-none"
              />

              {notionPreview && (
                <div className="p-3 rounded-2xl bg-[#0d0d0d]/80 border border-[#D96299]/30 text-xs space-y-1">
                  <p className="text-white font-semibold">
                    {notionPreview.title}
                  </p>
                  <p className="text-[#D96299]">
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
                className="w-full py-3 rounded-xl bg-[#D96299] hover:bg-[#e68ab5] disabled:opacity-50 text-[#0d0d0d] font-semibold text-xs transition"
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
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setIsEventModalOpen(false)}
        >
          <div
            className="glass-panel border-t sm:border border-[#D96299]/40 rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 sm:p-6 pb-8 sm:pb-6 space-y-4 max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                {editingEvent ? "Editar Cita" : "Nueva Cita"}
              </h3>
              <button
                onClick={() => setIsEventModalOpen(false)}
                className="p-1.5 rounded-xl bg-white/5 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEvent} className="space-y-3.5">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Título *
                </label>
                <input
                  type="text"
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Nombre de la sesión o cita"
                  className="w-full rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] px-3.5 py-2.5 text-sm text-white outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    Fecha
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] px-3 py-2 text-xs text-white outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 sm:contents gap-2.5">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">
                      Inicio
                    </label>
                    <input
                      type="time"
                      required
                      value={formStartTime}
                      onChange={(e) => setFormStartTime(e.target.value)}
                      className="w-full rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] px-3 py-2 text-xs text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">
                      Fin
                    </label>
                    <input
                      type="time"
                      required
                      value={formEndTime}
                      onChange={(e) => setFormEndTime(e.target.value)}
                      className="w-full rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] px-3 py-2 text-xs text-white outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Lugar / Enlace
                </label>
                <input
                  type="text"
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                  placeholder="Opcional"
                  className="w-full rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] px-3.5 py-2 text-xs text-white outline-none"
                />
              </div>

              {!editingEvent && (
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    Nota o comentario
                  </label>
                  <input
                    type="text"
                    value={formInitialNote}
                    onChange={(e) => setFormInitialNote(e.target.value)}
                    placeholder="Opcional"
                    className="w-full rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] px-3.5 py-2 text-xs text-white outline-none"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEventModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-white/5 text-xs text-zinc-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEvent}
                  className="px-5 py-2.5 rounded-xl bg-[#D96299] hover:bg-[#e68ab5] text-[#0d0d0d] font-semibold text-xs transition"
                >
                  {savingEvent ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* APARTADO PARA INGRESAR CON GOOGLE / CUENTA */}
      {isAuthModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setIsAuthModalOpen(false)}
        >
          <div
            className="glass-panel border-t sm:border border-[#D96299]/40 rounded-t-3xl sm:rounded-3xl max-w-sm w-full p-5 sm:p-6 pb-8 sm:pb-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <MoyaspovLogo size={36} />
              <button
                onClick={() => setIsAuthModalOpen(false)}
                className="p-1.5 rounded-xl bg-white/5 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <h3 className="text-base font-bold text-white">
                {currentUserEmail
                  ? "Cuenta de Google Conectada"
                  : "Ingresar con Google"}
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Sincroniza tus actividades de Google Calendar con tu agenda.
              </p>
            </div>

            <form onSubmit={handleGoogleSignIn} className="space-y-3">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Correo de Google Calendar
                </label>
                <input
                  type="email"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="tu-correo@gmail.com"
                  className="w-full rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] px-3.5 py-2.5 text-xs text-white outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Enlace iCal secreto de Google Calendar (Opcional para nube)
                </label>
                <input
                  type="url"
                  value={icalUrlInput}
                  onChange={(e) => setIcalUrlInput(e.target.value)}
                  placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                  className="w-full rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] px-3.5 py-2 text-xs text-white outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-3 rounded-xl bg-[#D96299] hover:bg-[#e68ab5] text-[#0d0d0d] font-semibold text-xs flex items-center justify-center gap-2 transition shadow-lg shadow-[#D96299]/20"
              >
                <User className="w-4 h-4" />
                <span>
                  {authLoading
                    ? "Conectando y sincronizando..."
                    : currentUserEmail
                    ? "Actualizar y Sincronizar con Google"
                    : "Continuar con Google"}
                </span>
              </button>
            </form>

            {currentUserEmail && (
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-red-500/20 text-xs text-zinc-300 hover:text-red-300 flex items-center justify-center gap-2 transition"
              >
                <LogOut className="w-4 h-4" />
                <span>Cerrar sesión ({currentUserEmail})</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
