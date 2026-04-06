import { useNavigate } from "react-router-dom";

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="home-page">
      <header className="home-header">
        <div className="home-logo">🌉</div>
        <h1>Boyz Weekend 2026</h1>
        <p className="home-subtitle">San Francisco · April 9–12, 2026</p>
      </header>

      <nav className="home-nav">
        <button className="home-card packing-card" onClick={() => navigate("/packing")}>
          <span className="home-card-icon">🎒</span>
          <span className="home-card-title">What to Bring</span>
          <span className="home-card-desc">Packing list · Gear · Essentials</span>
        </button>

        <button className="home-card events-card" onClick={() => navigate("/events")}>
          <span className="home-card-icon">📅</span>
          <span className="home-card-title">Events</span>
          <span className="home-card-desc">Schedule · Locations · Timing</span>
        </button>

        <button className="home-card standings-card" onClick={() => navigate("/standings")}>
          <span className="home-card-icon">🏆</span>
          <span className="home-card-title">Teams &amp; Leaderboard</span>
          <span className="home-card-desc">Live scores · Team rosters · Standings</span>
        </button>

        <button className="home-card sportsbetting-card" onClick={() => navigate("/sportsbetting")}>
          <span className="home-card-icon">🎰</span>
          <span className="home-card-title">Sports Betting</span>
          <span className="home-card-desc">NBA · MLB · Masters · Pick winners</span>
        </button>

        <button className="home-card pubcrawl-card" onClick={() => navigate("/pubcrawl")}>
          <span className="home-card-icon">🍺</span>
          <span className="home-card-title">Pub Crawl</span>
          <span className="home-card-desc">Routes · Rules · Challenges</span>
        </button>

        <button className="home-card golf-card" onClick={() => navigate("/golf")}>
          <span className="home-card-icon">⛳</span>
          <span className="home-card-title">Golf</span>
          <span className="home-card-desc">Studio Golf · Salesforce Tower · Fri Apr 10</span>
        </button>

        <button className="home-card gamenight-card" onClick={() => navigate("/gamenight")}>
          <span className="home-card-icon">🎮</span>
          <span className="home-card-title">Game Night</span>
          <span className="home-card-desc">Schedule · Rules · Team Matchups</span>
        </button>

        <button className="home-card hunt-card" onClick={() => navigate("/hunt")}>
          <span className="home-card-icon">🗺️</span>
          <span className="home-card-title">Scavenger Hunt</span>
          <span className="home-card-desc">Join your team · Submit clues · Track progress</span>
        </button>

        <button className="home-card trivia-card" onClick={() => navigate("/trivia")}>
          <span className="home-card-icon">🧠</span>
          <span className="home-card-title">Trivia</span>
          <span className="home-card-desc">Saturday Night · Hosted by Doug</span>
        </button>

        <button className="home-card top100-card" onClick={() => navigate("/top100")}>
          <span className="home-card-icon">🏅</span>
          <span className="home-card-title">The Top 100</span>
          <span className="home-card-desc">Most influential people in any category</span>
          <span className="home-card-fun">For fun, not points</span>
        </button>

        <button className="home-card quiz-card" onClick={() => navigate("/quiz")}>
          <span className="home-card-icon">📸</span>
          <span className="home-card-title">Pop Culture Quiz</span>
          <span className="home-card-desc">60s &amp; 70s pop culture · New questions every game</span>
          <span className="home-card-fun">For fun, not points</span>
        </button>
      </nav>

      <footer className="home-footer">
        <a href="/admin" className="home-admin-link">Admin Console</a>
      </footer>
    </div>
  );
}
