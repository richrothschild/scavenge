import { useNavigate } from "react-router-dom";

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="home-page">
      <header className="home-header">
        <div className="home-logo">🏙️</div>
        <h1>Boyz Weekend 2026</h1>
        <p className="home-subtitle">San Francisco · April 9–12, 2026</p>
      </header>

      <nav className="home-nav">
        <button className="home-card hunt-card" onClick={() => navigate("/hunt")}>
          <span className="home-card-icon">🗺️</span>
          <span className="home-card-title">Scavenger Hunt</span>
          <span className="home-card-desc">Join your team · Submit clues · Track progress</span>
        </button>

        <button className="home-card standings-card" onClick={() => navigate("/standings")}>
          <span className="home-card-icon">🏆</span>
          <span className="home-card-title">Teams &amp; Leaderboard</span>
          <span className="home-card-desc">Live scores · Team rosters · Standings</span>
        </button>

        <button className="home-card events-card" onClick={() => navigate("/events")}>
          <span className="home-card-icon">📅</span>
          <span className="home-card-title">Events</span>
          <span className="home-card-desc">Schedule · Locations · Timing</span>
        </button>
      </nav>

      <footer className="home-footer">
        <a href="/admin" className="home-admin-link">Admin Console</a>
      </footer>
    </div>
  );
}
