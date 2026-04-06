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
  const [activeTab, setActiveTab] = useState<"list" | "atlas" | "methodology">("list");

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
                <button
                  className={`top100-tab${activeTab === "methodology" ? " top100-tab-active" : ""}`}
                  onClick={() => setActiveTab("methodology")}
                >
                  Methodology
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

            {activeTab === "methodology" && (
              <div className="top100-atlas top100-methodology">
                <div className="top100-atlas-body">
                  <h2 className="top100-atlas-h1">How the Rankings Work</h2>
                  <p className="top100-atlas-p">The Top 100 is a structured influence ranking, not a popularity contest. Every list is generated fresh by an AI model trained on a broad corpus of historical and cultural knowledge. The rankings reflect a deliberate set of principles designed to produce a balanced, intellectually serious reference document.</p>

                  <h3 className="top100-atlas-h2">What "Influence" Means Here</h3>
                  <p className="top100-atlas-p">Influence is measured across six dimensions:</p>
                  <p className="top100-atlas-bullet">• <strong>Foundational importance</strong> — Did this person or entity define the category, or create the conditions that made the field possible?</p>
                  <p className="top100-atlas-bullet">• <strong>Transformative effect</strong> — Did their contribution change how the field operates, thinks, or produces?</p>
                  <p className="top100-atlas-bullet">• <strong>Downstream impact</strong> — How many subsequent figures, movements, or works trace a direct line back to this entry?</p>
                  <p className="top100-atlas-bullet">• <strong>Institutional influence</strong> — Did they create or reshape the organizations, schools, or structures that govern the field?</p>
                  <p className="top100-atlas-bullet">• <strong>Conceptual reach</strong> — Did their ideas spread beyond the category into adjacent fields or broader culture?</p>
                  <p className="top100-atlas-bullet">• <strong>Historical durability</strong> — Does their influence persist decades or centuries later, or did it fade quickly?</p>

                  <h3 className="top100-atlas-h2">Ranking Principles</h3>
                  <p className="top100-atlas-bullet">• Rankings favor depth of influence over breadth of fame. A widely recognized name with shallow impact will rank lower than a lesser-known figure whose work reshaped the field.</p>
                  <p className="top100-atlas-bullet">• Non-person entities — institutions, movements, texts, technologies, companies, traditions — are included wherever they clearly outrank individual people in their influence on the category.</p>
                  <p className="top100-atlas-bullet">• The list is balanced across major subfields, eras, regions, and demographics where relevant. No single era or school dominates without historical justification.</p>
                  <p className="top100-atlas-bullet">• Recency bias is actively resisted. Modern figures are not ranked higher simply because they are more visible in contemporary discourse.</p>
                  <p className="top100-atlas-bullet">• Each list is generated independently — the same category run twice may produce a different ranking, reflecting the inherent subjectivity in any influence judgment.</p>

                  <h3 className="top100-atlas-h2">What the Atlas of Influence Is</h3>
                  <p className="top100-atlas-p">The Atlas is a companion document to the ranked list. Where the list answers "who mattered most," the Atlas answers "why" and "how." It traces the chains of influence through the field — who learned from whom, which ideas built on others, and which turning points changed the direction of the category entirely.</p>
                  <p className="top100-atlas-p">The Atlas is organized into standard sections: an introduction to the category, a survey of major contributors, key ideas and concepts, movements and schools, turning points, chains of influence, important institutions, and lasting legacy. Sections may vary by category.</p>
                  <p className="top100-atlas-p">The Atlas is written in the style of a compact educational reference guide — structured, readable, and designed to inform rather than entertain.</p>

                  <h3 className="top100-atlas-h2">Limitations</h3>
                  <p className="top100-atlas-bullet">• AI-generated rankings reflect patterns in the model's training data. Figures with less written about them in English may be underrepresented.</p>
                  <p className="top100-atlas-bullet">• Very narrow or highly specialized categories may produce thinner results. Broader categories generally yield more balanced and historically grounded lists.</p>
                  <p className="top100-atlas-bullet">• The rankings are a starting point for discussion, not a definitive verdict. Reasonable people familiar with a field will disagree with specific placements.</p>
                  <p className="top100-atlas-bullet">• Facts in both documents should be verified against authoritative sources before being cited. The "Learn More" link on each entry points to a reputable reference.</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
