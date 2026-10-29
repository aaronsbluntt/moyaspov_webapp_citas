"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar as CalendarIcon,
  Clock,
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
  SlidersHorizontal,
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
  NoteType,
} from "@/types/database";

type ChartRange = "week" | "month";

interface ParsedPreview {
  rawText: string;
  title: string;
  startTime: string;
  endTime: string;
  eventType: string;
}

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
  const d = new Date(isoStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTimeRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const fmt = (d: Date) =>
    d.toLocaleTimeString("es-DO", {
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
    toLocalDateKey(new Date().toISOString())
  );
  const [chartRange, setChartRange] = useState<ChartRange>("week");

  // Eventos desde Supabase
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);

  // Buscador y filtros bajo demanda ("si las quiero buscarlas yo directamente")
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<EventSource | "all">("all");

  // Modal de Texto Rápido Notion (bajo demanda)
  const [isNotionModalOpen, setIsNotionModalOpen] = useState<boolean>(false);
  const [notionInput, setNotionInput] = useState<string>("");
  const [notionPreview, setNotionPreview] = useState<ParsedPreview | null>(null);
  const [parsingNotion, setParsingNotion] = useState<boolean>(false);

  // Evento activo en el Drawer/Modal de Detalle + Notas
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [newNoteContent, setNewNoteContent] = useState<string>("");
  const [newNoteType, setNewNoteType] = useState<NoteType>("comment");
  const [savingNote, setSavingNote] = useState<boolean>(false);

  // Modal de Crear / Editar / Reprogramar Cita
  const [isEventModalOpen, setIsEventModalOpen] = useState<boolean>(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [formTitle, setFormTitle] = useState<string>("");
  const [formDescription, setFormDescription] = useState<string>("");
  const [formDate, setFormDate] = useState<string>(selectedDate);
  const [formStartTime, setFormStartTime] = useState<string>("18:00");
  const [formEndTime, setFormEndTime] = useState<string>("19:00");
  const [formType, setFormType] = useState<EventType>("session");
  const [formPriority, setFormPriority] = useState<EventPriority>("medium");
  const [formStatus, setFormStatus] = useState<EventStatus>("scheduled");
  const [formLocation, setFormLocation] = useState<string>("");
  const [formInitialNote, setFormInitialNote] = useState<string>("");
  const [savingEvent, setSavingEvent] = useState<boolean>(false);

  // Apartado para ingresar con su cuenta (Supabase Auth)
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const [authName, setAuthName] = useState<string>("");
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  const showNotice = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  // Verificar sesión activa de Supabase Auth
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) {
        setCurrentUserEmail(data.user.email);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUserEmail(session?.user?.email || null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/events?startDate=2026-01-01T00:00:00.000Z&endDate=2026-12-31T23:59:59.999Z`
      );
      const data = await res.json();
      if (data.events) {
        setEvents(data.events);
      }
    } catch {
      showNotice("No se pudieron cargar las citas");
    } finally {
      setLoading(false);
    }
  }, [showNotice]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Previsualización del texto rápido de Notion cuando el modal está abierto
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
      await fetchEvents();
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
      await fetchEvents();
      showNotice("Calendario actualizado");
    } finally {
      setSyncing(false);
    }
  };

  // Abrir modal de Nueva Cita / Editar
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
    setFormStartTime(
      `${String(startObj.getHours()).padStart(2, "0")}:${String(
        startObj.getMinutes()
      ).padStart(2, "0")}`
    );
    setFormEndTime(
      `${String(endObj.getHours()).padStart(2, "0")}:${String(
        endObj.getMinutes()
      ).padStart(2, "0")}`
    );
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
      const startIso = new Date(`${formDate}T${formStartTime}:00`).toISOString();
      const endIso = new Date(`${formDate}T${formEndTime}:00`).toISOString();

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
      await fetchEvents();
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
      await fetchEvents();
    }
  };

  const handleDeleteEvent = async (ev: CalendarEvent) => {
    const res = await fetch(`/api/events/${ev.id}`, { method: "DELETE" });
    if (res.ok) {
      if (activeEventId === ev.id) setActiveEventId(null);
      await fetchEvents();
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
          note_type: newNoteType,
        }),
      });
      if (res.ok) {
        setNewNoteContent("");
        await fetchEvents();
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
    await fetchEvents();
  };

  // Autenticación de cuenta de usuario (Supabase Auth)
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setAuthLoading(true);
    try {
      if (authMode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) throw error;
        showNotice("Sesión iniciada correctamente");
        setIsAuthModalOpen(false);
      } else {
        const { error } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
          options: {
            data: { full_name: authName.trim() || "Usuario" },
          },
        });
        if (error) throw error;
        showNotice("Cuenta creada. Revisa tu correo o inicia sesión.");
        setIsAuthModalOpen(false);
      }
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : "Error de autenticación"
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleOAuth = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  };

  const handleSignOut = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    await supabase.auth.signOut();
    setCurrentUserEmail(null);
    showNotice("Sesión cerrada");
  };

  // Eventos del día seleccionado (o resultados de búsqueda si el usuario está buscando)
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

  // Próximas citas cercanas (para mostrar debajo si no hay filtro de búsqueda)
  const upcomingEvents = useMemo(() => {
    const startOfToday = new Date(`${selectedDate}T00:00:00`).getTime();
    return events
      .filter(
        (ev) =>
          ev.status !== "cancelled" &&
          toLocalDateKey(ev.start_time) !== selectedDate &&
          new Date(ev.end_time).getTime() >= startOfToday
      )
      .sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      )
      .slice(0, 4);
  }, [events, selectedDate]);

  // Evento activo para el modal de notas/detalle
  const activeEvent = useMemo(
    () => events.find((e) => e.id === activeEventId) || null,
    [events, activeEventId]
  );

  // Tira de 7 días centrada en la fecha seleccionada
  const weekStripDays = useMemo(() => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    const base = new Date(y, m - 1, d);
    const days = [];
    for (let offset = -3; offset <= 3; offset++) {
      const dt = new Date(base);
      dt.setDate(base.getDate() + offset);
      const key = toLocalDateKey(dt.toISOString());
      const hasEvents = events.some(
        (ev) =>
          ev.status !== "cancelled" && toLocalDateKey(ev.start_time) === key
      );
      days.push({
        key,
        dayName: SPANISH_DAYS_SHORT[dt.getDay()],
        dayNumber: dt.getDate(),
        hasEvents,
      });
    }
    return days;
  }, [selectedDate, events]);

  // Datos para el Chart Line (Semana o Mes)
  const chartData: ChartPoint[] = useMemo(() => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    const baseDate = new Date(y, m - 1, d);

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
      const dt = new Date(y, m - 1, day);
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
    const dt = new Date(y, m - 1, d + daysDelta);
    setSelectedDate(toLocalDateKey(dt.toISOString()));
  };

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-zinc-100 flex flex-col">
      {/* Notificación discreta */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 glass-panel border-[#D96299]/40 px-4 py-2.5 rounded-2xl flex items-center gap-2.5 shadow-2xl">
          <span className="h-2 w-2 rounded-full bg-[#D96299]" />
          <span className="text-xs font-medium text-zinc-100">{toast}</span>
        </div>
      )}

      {/* HEADER MINIMALISTA — SOLO EL LOGO SVG A LA IZQUIERDA */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#0d0d0d]/80 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-5 h-20 flex items-center justify-between">
          {/* Únicamente el logo SVG sin texto al lado */}
          <button
            onClick={() => {
              setSearchQuery("");
              setSourceFilter("all");
              setSelectedDate(toLocalDateKey(new Date().toISOString()));
            }}
            className="p-2 rounded-2xl hover:bg-white/[0.03] transition flex items-center justify-center"
            title="Inicio"
          >
            <MoyaspovLogo size={46} />
          </button>

          {/* Opciones discretas a la derecha */}
          <div className="flex items-center gap-2">
            {/* Botón para buscar / filtrar cuando el usuario lo desee */}
            <button
              onClick={() => setSearchOpen((prev) => !prev)}
              title="Buscar o filtrar citas"
              className={`p-2.5 rounded-xl border transition ${
                searchOpen || searchQuery || sourceFilter !== "all"
                  ? "bg-[#181426] border-[#D96299]/50 text-[#D96299]"
                  : "bg-[#181426]/60 border-white/[0.07] text-zinc-400 hover:text-white"
              }`}
            >
              <Search className="w-4 h-4" />
            </button>

            {/* Botón de Entrada Rápida de Notion (bajo demanda) */}
            <button
              onClick={() => setIsNotionModalOpen(true)}
              title="Agendar desde texto rápido (Notion)"
              className="p-2.5 rounded-xl bg-[#181426]/60 hover:bg-[#181426] border border-white/[0.07] hover:border-[#D96299]/40 text-zinc-400 hover:text-[#D96299] transition"
            >
              <Sparkles className="w-4 h-4" />
            </button>

            {/* Botón de Sincronizar */}
            <button
              onClick={handleManualSync}
              disabled={syncing}
              title="Sincronizar con Google Calendar"
              className="p-2.5 rounded-xl bg-[#181426]/60 hover:bg-[#181426] border border-white/[0.07] text-zinc-400 hover:text-white transition"
            >
              <RefreshCw
                className={`w-4 h-4 ${syncing ? "animate-spin text-[#D96299]" : ""}`}
              />
            </button>

            {/* Nueva Cita */}
            <button
              onClick={() => openCreateModal()}
              className="px-4 py-2.5 rounded-xl bg-[#D96299] hover:bg-[#e68ab5] text-[#0d0d0d] font-semibold text-xs flex items-center gap-1.5 transition shadow-lg shadow-[#D96299]/20"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Nueva Cita</span>
            </button>

            {/* Apartado de Cuenta / Ingresar */}
            {currentUserEmail ? (
              <div className="flex items-center gap-1.5 pl-1">
                <button
                  onClick={() => setIsAuthModalOpen(true)}
                  className="px-3 py-2 rounded-xl bg-[#181426] border border-[#D96299]/30 text-xs text-zinc-200 flex items-center gap-2"
                >
                  <User className="w-3.5 h-3.5 text-[#D96299]" />
                  <span className="max-w-[110px] truncate hidden sm:inline">
                    {currentUserEmail.split("@")[0]}
                  </span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="px-3.5 py-2.5 rounded-xl bg-[#181426] hover:bg-[#181426]/90 border border-white/10 hover:border-[#D96299]/40 text-xs font-medium text-zinc-200 flex items-center gap-1.5 transition"
              >
                <User className="w-3.5 h-3.5 text-[#D96299]" />
                <span>Ingresar</span>
              </button>
            )}
          </div>
        </div>

        {/* Barra desplegable de búsqueda y filtros (solo visible si el usuario la abre) */}
        {searchOpen && (
          <div className="border-t border-white/[0.05] bg-[#181426]/60 backdrop-blur-xl">
            <div className="max-w-5xl mx-auto px-5 py-3 flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[220px]">
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

              <div className="flex items-center gap-1.5 text-xs">
                <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-500 mr-1" />
                {(["all", "google_calendar", "notion", "webapp"] as const).map(
                  (src) => (
                    <button
                      key={src}
                      onClick={() => setSourceFilter(src)}
                      className={`px-2.5 py-1.5 rounded-lg border transition ${
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
                  )
                )}
              </div>

              <input
                type="date"
                value={selectedDate}
                onChange={(e) =>
                  e.target.value && setSelectedDate(e.target.value)
                }
                className="rounded-xl bg-[#0d0d0d] border border-white/10 px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-[#D96299]"
              />
            </div>
          </div>
        )}
      </header>

      {/* CONTENIDO PRINCIPAL: DIRECTO AL GRANO (AGENDA + GRÁFICO) */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-5 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* COLUMNA PRINCIPAL (7 COLS): AGENDA DEL DÍA Y CITAS CERCANAS */}
          <div className="lg:col-span-7 space-y-6">
            {/* Navegador de Fecha Limpio */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-widest text-[#D96299] font-semibold">
                  {searchQuery ? "Resultados de búsqueda" : "Agenda"}
                </p>
                <h1 className="text-2xl font-bold text-white tracking-tight mt-0.5">
                  {searchQuery
                    ? `"${searchQuery}"`
                    : formatReadableDate(selectedDate)}
                </h1>
              </div>

              {!searchQuery && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => shiftSelectedDate(-1)}
                    className="p-2 rounded-xl bg-[#181426] border border-white/[0.07] hover:border-[#D96299]/40 text-zinc-300 transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() =>
                      setSelectedDate(toLocalDateKey(new Date().toISOString()))
                    }
                    className="px-3 py-1.5 rounded-xl bg-[#181426] border border-white/[0.07] hover:border-[#D96299]/40 text-xs font-medium text-zinc-200 transition"
                  >
                    Hoy
                  </button>
                  <button
                    onClick={() => shiftSelectedDate(1)}
                    className="p-2 rounded-xl bg-[#181426] border border-white/[0.07] hover:border-[#D96299]/40 text-zinc-300 transition"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Tira minimalista de 7 días */}
            {!searchQuery && (
              <div className="grid grid-cols-7 gap-2">
                {weekStripDays.map((d) => {
                  const active = d.key === selectedDate;
                  return (
                    <button
                      key={d.key}
                      onClick={() => setSelectedDate(d.key)}
                      className={`py-2.5 rounded-2xl flex flex-col items-center border transition ${
                        active
                          ? "bg-[#D96299] text-[#0d0d0d] border-[#D96299] font-semibold shadow-lg shadow-[#D96299]/20"
                          : "bg-[#181426]/60 border-white/[0.06] text-zinc-400 hover:text-white hover:border-white/15"
                      }`}
                    >
                      <span className="text-[10px] uppercase">{d.dayName}</span>
                      <span className="text-sm font-bold mt-0.5">
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

            {/* Lista de Citas del Día */}
            <div className="space-y-3">
              {loading ? (
                <div className="glass-panel rounded-3xl p-10 text-center text-xs text-zinc-500">
                  Cargando agenda...
                </div>
              ) : displayedEvents.length === 0 ? (
                <div className="glass-panel rounded-3xl p-10 text-center space-y-3">
                  <p className="text-sm text-zinc-300">
                    No hay citas programadas para este día.
                  </p>
                  <button
                    onClick={() => openCreateModal(selectedDate)}
                    className="inline-flex items-center gap-1.5 text-xs text-[#D96299] font-medium hover:underline"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Agregar cita</span>
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
                      className="glass-panel-interactive rounded-2xl p-4 cursor-pointer group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3.5 min-w-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleComplete(ev);
                            }}
                            className={`mt-0.5 h-5 w-5 rounded-full border flex items-center justify-center shrink-0 transition ${
                              ev.status === "completed"
                                ? "bg-[#D96299] border-[#D96299] text-[#0d0d0d]"
                                : "border-white/25 hover:border-[#D96299]"
                            }`}
                          >
                            {ev.status === "completed" && (
                              <Check className="w-3 h-3 stroke-[3]" />
                            )}
                          </button>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-xs text-[#D96299] font-medium">
                              <span>
                                {formatTimeRange(ev.start_time, ev.end_time)}
                              </span>
                              {ev.location && (
                                <span className="text-zinc-500 flex items-center gap-1 truncate">
                                  • <MapPin className="w-3 h-3 inline" />{" "}
                                  {ev.location}
                                </span>
                              )}
                            </div>

                            <h3
                              className={`text-sm font-semibold mt-0.5 ${
                                ev.status === "completed"
                                  ? "line-through text-zinc-500"
                                  : "text-white"
                              }`}
                            >
                              {ev.title}
                            </h3>

                            {firstNote && (
                              <p className="text-xs text-zinc-400 mt-1.5 line-clamp-1 flex items-center gap-1.5">
                                <MessageSquareText className="w-3 h-3 text-[#D96299] shrink-0" />
                                <span>{firstNote.content}</span>
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition shrink-0">
                          {notesCount > 0 && (
                            <span className="px-2 py-1 rounded-lg bg-white/[0.04] text-[11px] text-zinc-400 flex items-center gap-1">
                              <MessageSquareText className="w-3 h-3 text-[#D96299]" />
                              {notesCount}
                            </span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditModal(ev);
                            }}
                            className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white"
                            title="Editar"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Próximas citas cercanas (si hay en los siguientes días) */}
            {!searchQuery && upcomingEvents.length > 0 && (
              <div className="pt-4 space-y-3">
                <h2 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">
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
                        <p className="text-xs text-zinc-400 mt-0.5">
                          <span className="text-[#D96299]">
                            {formatReadableDate(toLocalDateKey(ev.start_time))}
                          </span>{" "}
                          • {formatTimeRange(ev.start_time, ev.end_time)}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* COLUMNA DERECHA (5 COLS): CHART LINE LIMPIO */}
          <div className="lg:col-span-5 space-y-5">
            <div className="glass-panel rounded-3xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Actividad de la Agenda
                  </h2>
                  <p className="text-[11px] text-zinc-400">
                    Días con mayor carga de citas
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
                onSelectDate={(dateIso) => setSelectedDate(dateIso)}
              />
            </div>

            {/* Acceso directo minimalista para pegar texto rápido de Notion */}
            <button
              onClick={() => setIsNotionModalOpen(true)}
              className="w-full glass-panel-interactive rounded-2xl p-4 flex items-center justify-between text-left"
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

      {/* MODAL DE DETALLE DE CITA Y MÓDULO DE NOTAS / RESUMEN */}
      {activeEvent && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setActiveEventId(null)}
        >
          <div
            className="glass-panel border-[#D96299]/35 rounded-3xl max-w-md w-full p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[11px] text-[#D96299] font-medium">
                  {formatReadableDate(toLocalDateKey(activeEvent.start_time))} •{" "}
                  {formatTimeRange(
                    activeEvent.start_time,
                    activeEvent.end_time
                  )}
                </span>
                <h3 className="text-lg font-bold text-white mt-0.5">
                  {activeEvent.title}
                </h3>
                {activeEvent.location && (
                  <p className="text-xs text-zinc-400 flex items-center gap-1 mt-1">
                    <MapPin className="w-3.5 h-3.5 text-[#D96299]" />
                    {activeEvent.location}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    const ev = activeEvent;
                    setActiveEventId(null);
                    openEditModal(ev);
                  }}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300"
                  title="Editar o reprogramar"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDeleteEvent(activeEvent)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-red-500/20 text-zinc-400 hover:text-red-300"
                  title="Eliminar cita"
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
              <p className="text-xs text-zinc-300 bg-[#0d0d0d]/60 p-3 rounded-2xl border border-white/[0.05]">
                {activeEvent.description}
              </p>
            )}

            {/* Notas / Comentarios de la Cita */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Notas y Resumen ({activeEvent.event_notes?.length || 0})
              </h4>

              <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                {!activeEvent.event_notes ||
                activeEvent.event_notes.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-4 text-center border border-dashed border-white/10 rounded-2xl">
                    Sin notas todavía. Escribe un comentario o resumen abajo.
                  </p>
                ) : (
                  activeEvent.event_notes.map((note) => (
                    <div
                      key={note.id}
                      className="p-3 rounded-2xl bg-[#0d0d0d]/80 border border-white/[0.06] text-xs flex items-start justify-between gap-2"
                    >
                      <p className="text-zinc-200 leading-relaxed">
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

              <form onSubmit={handleAddNote} className="flex items-center gap-2 pt-2">
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
                  className="p-2.5 rounded-xl bg-[#D96299] hover:bg-[#e68ab5] disabled:opacity-50 text-[#0d0d0d] transition"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE TEXTO RÁPIDO NOTION (BAJO DEMANDA) */}
      {isNotionModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setIsNotionModalOpen(false)}
        >
          <div
            className="glass-panel border-[#D96299]/40 rounded-3xl max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
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
                className="w-full rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] px-4 py-3 text-sm text-white outline-none"
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
                className="w-full py-2.5 rounded-xl bg-[#D96299] hover:bg-[#e68ab5] disabled:opacity-50 text-[#0d0d0d] font-semibold text-xs transition"
              >
                {parsingNotion ? "Agendando..." : "Agendar Cita"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL PARA CREAR / EDITAR CITA */}
      {isEventModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setIsEventModalOpen(false)}
        >
          <div
            className="glass-panel border-[#D96299]/40 rounded-3xl max-w-md w-full p-6 space-y-4"
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

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    Fecha
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] px-2.5 py-2 text-xs text-white outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    Inicio
                  </label>
                  <input
                    type="time"
                    required
                    value={formStartTime}
                    onChange={(e) => setFormStartTime(e.target.value)}
                    className="w-full rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] px-2.5 py-2 text-xs text-white outline-none"
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
                    className="w-full rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] px-2.5 py-2 text-xs text-white outline-none"
                  />
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
                  className="px-4 py-2 rounded-xl bg-white/5 text-xs text-zinc-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEvent}
                  className="px-5 py-2 rounded-xl bg-[#D96299] hover:bg-[#e68ab5] text-[#0d0d0d] font-semibold text-xs transition"
                >
                  {savingEvent ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* APARTADO PARA INGRESAR CON SU CUENTA (LOGIN / REGISTRO) */}
      {isAuthModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setIsAuthModalOpen(false)}
        >
          <div
            className="glass-panel border-[#D96299]/40 rounded-3xl max-w-sm w-full p-6 space-y-5"
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

            {currentUserEmail ? (
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-zinc-400">Sesión activa como</p>
                  <p className="text-sm font-semibold text-white mt-0.5">
                    {currentUserEmail}
                  </p>
                </div>
                <button
                  onClick={handleSignOut}
                  className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-red-500/20 text-xs text-zinc-300 hover:text-red-300 flex items-center justify-center gap-2 transition"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Cerrar sesión</span>
                </button>
              </div>
            ) : (
              <>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {authMode === "login"
                      ? "Ingresa a tu cuenta"
                      : "Crear una cuenta"}
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Sincroniza tu agenda personal y tus notas.
                  </p>
                </div>

                <form onSubmit={handleAuthSubmit} className="space-y-3">
                  {authMode === "register" && (
                    <input
                      type="text"
                      required
                      value={authName}
                      onChange={(e) => setAuthName(e.target.value)}
                      placeholder="Tu nombre"
                      className="w-full rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] px-3.5 py-2.5 text-xs text-white outline-none"
                    />
                  )}
                  <input
                    type="email"
                    required
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="Correo electrónico"
                    className="w-full rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] px-3.5 py-2.5 text-xs text-white outline-none"
                  />
                  <input
                    type="password"
                    required
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="Contraseña"
                    className="w-full rounded-xl bg-[#0d0d0d] border border-white/10 focus:border-[#D96299] px-3.5 py-2.5 text-xs text-white outline-none"
                  />

                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full py-2.5 rounded-xl bg-[#D96299] hover:bg-[#e68ab5] text-[#0d0d0d] font-semibold text-xs transition"
                  >
                    {authLoading
                      ? "Procesando..."
                      : authMode === "login"
                      ? "Ingresar"
                      : "Registrarme"}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={handleGoogleOAuth}
                  className="w-full py-2.5 rounded-xl bg-[#0d0d0d] hover:bg-white/5 border border-white/10 text-xs text-zinc-200 font-medium transition"
                >
                  Continuar con Google
                </button>

                <p className="text-center text-xs text-zinc-400">
                  {authMode === "login" ? (
                    <>
                      ¿No tienes cuenta?{" "}
                      <button
                        type="button"
                        onClick={() => setAuthMode("register")}
                        className="text-[#D96299] hover:underline font-medium"
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
                        className="text-[#D96299] hover:underline font-medium"
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
