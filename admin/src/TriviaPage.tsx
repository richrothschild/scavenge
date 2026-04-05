import { useNavigate } from "react-router-dom";

export default function TriviaPage() {
  const navigate = useNavigate();

  return (
    <div className="pub-page">
      <header className="pub-header">
        <button className="pub-back" onClick={() => navigate("/")}>← Home</button>
        <h1>Trivia</h1>
        <span className="pub-header-sub">Boyz Weekend 2026 · Saturday, April 11</span>
      </header>

      <div className="pubcrawl-content">
        <div className="trivia-quote-card">
          <p className="trivia-quote-text">"I will either be there or I won't."</p>
          <p className="trivia-quote-attr">— Doug Meier</p>
        </div>
      </div>
    </div>
  );
}
