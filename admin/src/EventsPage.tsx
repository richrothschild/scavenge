import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const apiBase =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD
    ? "https://scavenge-backend-production.up.railway.app/api"
    : "http://localhost:3001/api");

type EventItem = {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  category: "hunt" | "meal" | "activity" | "transport" | "other";
  sortOrder: number;
};

const CATEGORY_ICONS: Record<string, string> = {
  hunt:      "🗺️",
  meal:      "🍽️",
  activity:  "🎯",
  transport: "🚗",
  other:     "📌",
};

const CATEGORY_LABELS: Record<string, string> = {
  hunt:      "Scavenger Hunt",
  meal:      "Meal",
  activity:  "Activity",
  transport: "Transport",
  other:     "Event",
};

function formatTime(timeStr: string) {
  if (!timeStr) return "";
  // Handle "HH:MM" 24h format
  const [hh, mm] = timeStr.split(":").map(Number);
  if (isNaN(hh) || isNaN(mm)) return timeStr;
  const ampm = hh >= 12 ? "PM" : "AM";
  const h = hh % 12 || 12;
  return `${h}:${String(mm).padStart(2, "0")} ${ampm}`;
}

function formatDate(dateStr: string) {
  if (!dateStr) return "";
  try {
    // dateStr is "YYYY-MM-DD"
    const [year, month, day] = dateStr.split("-").map(Number);
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

export default function EventsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${apiBase}/events`)
      .then((r) => r.json())
      .then((data) => {
        setEvents(data.events ?? []);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load events. Check connection.");
        setLoading(false);
      });
  }, []);

  // Group events by date
  const grouped = events.reduce<Record<string, EventItem[]>>((acc, ev) => {
    const key = ev.date || "TBD";
    if (!acc[key]) acc[key] = [];
    acc[key].push(ev);
    return acc;
  }, {});

  const sortedDates = Object.keys(grouped).sort();

  return (
    <div className="pub-page">
      <header className="pub-header">
        <button className="pub-back" onClick={() => navigate("/")}>← Home</button>
        <h1>Events</h1>
        <span className="pub-header-sub">Boyz Weekend 2026 · San Francisco</span>
      </header>

      {loading && <p className="pub-loading">Loading events…</p>}
      {error && <p className="pub-error">{error}</p>}

      {!loading && events.length === 0 && (
        <div className="pub-empty-events">
          <p>📅 No events scheduled yet.</p>
          <p>Check back closer to the weekend!</p>
        </div>
      )}

      {sortedDates.map((dateKey) => (
        <section key={dateKey} className="events-day-group">
          <h2 className="events-day-heading">
            {dateKey === "TBD" ? "Date TBD" : formatDate(dateKey)}
          </h2>
          <div className="events-list">
            {grouped[dateKey].map((ev) => (
              <div key={ev.id} className={`event-card event-cat-${ev.category}`}>
                <div className="event-card-time">
                  {ev.time ? formatTime(ev.time) : "Time TBD"}
                </div>
                <div className="event-card-body">
                  <div className="event-card-category">
                    {CATEGORY_ICONS[ev.category] ?? "📌"} {CATEGORY_LABELS[ev.category] ?? ev.category}
                  </div>
                  <div className="event-card-title">{ev.title}</div>
                  {ev.description && (
                    <div className="event-card-desc">{ev.description}</div>
                  )}
                  <div className="event-card-location">📍 {ev.location}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
