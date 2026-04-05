import { useState } from "react";
import { useNavigate } from "react-router-dom";

const apiBase =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD
    ? "https://scavenge-backend-production.up.railway.app/api"
    : "http://localhost:3001/api");

type Top100Entry = {
  rank: number;
  name: string;
  categoryEra: string;
  whyTheyMatter: string;
  historicalImpact: string;
  notableDetail: string;
  learnMore: string;
};

type Top100Result = {
  category: string;
  count: number;
  atlas: string;
  entries: Top100Entry[];
};

// Render plain-text atlas with basic markdown-style formatting
function AtlasSection({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="top100-atlas-body">
      {lines.map((line, i) => {
        if (line.startsWith("# ")) {
          return <h2 key={i} className="top100-atlas-h1">{line.slice(2)}</h2>;
        }
        if (line.startsWith("## ")) {
          return <h3 key={i} className="top100-atlas-h2">{line.slice(3)}</h3>;
        }
        if (line.startsWith("### ")) {
          return <h4 key={i} className="top100-atlas-h3">{line.slice(4)}</h4>;
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return <p key={i} className="top100-atlas-bullet">• {line.slice(2)}</p>;
        }
        if (line.trim() === "") {
          return <div key={i} className="top100-atlas-spacer" />;
        }
        return <p key={i} className="top100-atlas-p">{line}</p>;
      })}
    </div>
  );
}

function EntryCard({ entry }: { entry: Top100Entry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="top100-entry-card">
      <button className="top100-entry-header" onClick={() => setExpanded((v) => !v)}>
        <span className="top100-entry-rank">#{entry.rank}</span>
        <span className="top100-entry-name">{entry.name}</span>
        <span className="top100-entry-era">{entry.categoryEra}</span>
        <span className="top100-entry-chevron">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="top100-entry-body">
          <div className="top100-entry-field">
            <span className="top100-field-label">Why They Matter</span>
            <span className="top100-field-value">{entry.whyTheyMatter}</span>
          </div>
          <div className="top100-entry-field">
            <span className="top100-field-label">Historical Impact</span>
            <span className="top100-field-value">{entry.historicalImpact}</span>
          </div>
          <div className="top100-entry-field">
            <span className="top100-field-label">Notable Detail</span>
            <span className="top100-field-value">{entry.notableDetail}</span>
          </div>
          {entry.learnMore && (
            <div className="top100-entry-field">
              <span className="top100-field-label">Learn More</span>
              <a
                className="top100-field-link"
                href={entry.learnMore}
                target="_blank"
                rel="noopener noreferrer"
              >
                {entry.learnMore}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Top100Page() {
  const navigate = useNavigate();
  const [category, setCategory] = useState("");
  const [count, setCount] = useState(25);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Top100Result | null>(null);
  const [activeTab, setActiveTab] = useState<"list" | "atlas">("list");

  const handleGenerate = async () => {
    const trimmed = category.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`${apiBase}/top100/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: trimmed, count })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Server error ${response.status}`);
      }

      const data = await response.json() as Top100Result;
      setResult(data);
      setActiveTab("list");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleGenerate();
  };

  return (
    <div className="pub-page">
      <header className="pub-header">
        <button className="pub-back" onClick={() => navigate("/")}>← Home</button>
        <h1>The Top 100</h1>
        <span className="pub-header-sub">Most Influential People &amp; Entities</span>
      </header>

      <div className="top100-content">
        <div className="top100-form">
          <label className="top100-label" htmlFor="top100-category">Category</label>
          <input
            id="top100-category"
            className="top100-input"
            type="text"
            placeholder="e.g. baseball, blues music, quantum physics, Renaissance art…"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />

          <div className="top100-count-row">
            <label className="top100-label" htmlFor="top100-count">
              Show top <strong>{count}</strong>
            </label>
            <input
              id="top100-count"
              className="top100-slider"
              type="range"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              disabled={loading}
            />
            <span className="top100-count-bounds"><span>1</span><span>100</span></span>
          </div>

          <button
            className="top100-generate-btn"
            onClick={handleGenerate}
            disabled={loading || !category.trim()}
          >
            {loading ? "Generating…" : "Generate"}
          </button>
        </div>

        {error && <div className="top100-error">{error}</div>}

        {loading && (
          <div className="top100-loading">
            <div className="top100-spinner" />
            <p>Building your Top {count} list for <em>{category}</em>…</p>
            <p className="top100-loading-sub">This usually takes 15–30 seconds.</p>
          </div>
        )}

        {result && !loading && (
          <div className="top100-results">
            <div className="top100-results-header">
              <h2 className="top100-results-title">
                Top {result.entries.length}: <em>{result.category}</em>
              </h2>
              <div className="top100-tabs">
                <button
                  className={`top100-tab${activeTab === "list" ? " top100-tab-active" : ""}`}
                  onClick={() => setActiveTab("list")}
                >
                  Ranked List
                </button>
                <button
                  className={`top100-tab${activeTab === "atlas" ? " top100-tab-active" : ""}`}
                  onClick={() => setActiveTab("atlas")}
                >
                  Atlas of Influence
                </button>
              </div>
            </div>

            {activeTab === "list" && (
              <div className="top100-list">
                {result.entries.map((entry) => (
                  <EntryCard key={entry.rank} entry={entry} />
                ))}
              </div>
            )}

            {activeTab === "atlas" && (
              <div className="top100-atlas">
                <AtlasSection text={result.atlas} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
