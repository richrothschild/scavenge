import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const apiBase =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD
    ? "https://scavenge-backend-production.up.railway.app/api"
    : "http://localhost:3001/api");

type PackingItem = {
  id: string;
  text: string;
  category: string;
  sortOrder: number;
  note: string;
};

const CATEGORY_ICONS: Record<string, string> = {
  clothing:  "👕",
  gear:      "🎒",
  documents: "📄",
  health:    "💊",
  other:     "📦",
};

const CATEGORY_LABELS: Record<string, string> = {
  clothing:  "Clothing",
  gear:      "Gear & Accessories",
  documents: "Documents & IDs",
  health:    "Health & Toiletries",
  other:     "Other",
};

export default function PackingPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<PackingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${apiBase}/packing`)
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items ?? []);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load packing list. Check connection.");
        setLoading(false);
      });
  }, []);

  // Group by category
  const grouped = items.reduce<Record<string, PackingItem[]>>((acc, item) => {
    const key = item.category || "other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const categoryOrder = ["clothing", "gear", "documents", "health", "other"];
  const sortedCategories = Object.keys(grouped).sort(
    (a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b)
  );

  return (
    <div className="pub-page">
      <header className="pub-header">
        <button className="pub-back" onClick={() => navigate("/")}>← Home</button>
        <h1>What to Bring</h1>
        <span className="pub-header-sub">Boyz Weekend 2026 · San Francisco</span>
      </header>

      {loading && <p className="pub-loading">Loading packing list…</p>}
      {error && <p className="pub-error">{error}</p>}

      {!loading && items.length === 0 && (
        <div className="pub-empty-events">
          <p>🎒 No packing list items yet.</p>
          <p>Check back closer to the weekend!</p>
        </div>
      )}

      {sortedCategories.map((cat) => (
        <section key={cat} className="packing-category-group">
          <h2 className="packing-category-heading">
            {CATEGORY_ICONS[cat] ?? "📦"} {CATEGORY_LABELS[cat] ?? cat}
          </h2>
          <ul className="packing-list">
            {grouped[cat].map((item) => (
              <li key={item.id} className="packing-item">
                <span className="packing-item-check">☐</span>
                <span className="packing-item-text">{item.text}</span>
                {item.note && <span className="packing-item-note">{item.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
