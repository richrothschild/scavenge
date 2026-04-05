import { useNavigate } from "react-router-dom";

export default function GolfPage() {
  const navigate = useNavigate();

  return (
    <div className="pub-page">
      <header className="pub-header">
        <button className="pub-back" onClick={() => navigate("/")}>← Home</button>
        <h1>Golf</h1>
        <span className="pub-header-sub">Boyz Weekend 2026 · Friday, April 10</span>
      </header>

      <div className="pubcrawl-content">

        {/* Venue */}
        <div className="gn-card" style={{ borderLeftColor: "#86efac" }}>
          <p className="gn-card-title">Studio Golf — Salesforce Tower</p>
          <p className="gn-card-subtitle">350 Mission Street, San Francisco, CA 94105 · Mezzanine Level</p>
          <p className="gn-section-heading">Details</p>
          <ul className="gn-rule-list">
            <li>Two indoor golf simulators.</li>
            <li>Two teams per simulator.</li>
            <li>Leave hotel lobby at 10:00 AM — <strong style={{ color: "#f87171" }}>do not be late</strong>. Uber there and back. Team up.</li>
            <li>Tee time: 10:30 AM.</li>
          </ul>
        </div>

        {/* Simulator Assignment */}
        <div className="gn-card" style={{ borderLeftColor: "#86efac" }}>
          <p className="gn-card-title">Simulator Assignment — Dice Roll</p>
          <ul className="gn-rule-list">
            <li>Each team rolls one die.</li>
            <li>The two teams with the <strong>lowest rolls</strong> share Simulator 1.</li>
            <li>The two teams with the <strong>highest rolls</strong> share Simulator 2.</li>
            <li>In the event of a tie on the deciding roll, those teams re-roll.</li>
          </ul>
        </div>

        {/* Format */}
        <div className="gn-card" style={{ borderLeftColor: "#86efac" }}>
          <p className="gn-card-title">Format — Scramble</p>
          <ul className="gn-rule-list">
            <li>Each team plays a scramble: all players hit, the team selects the best shot, and everyone plays from that spot.</li>
            <li>18 holes total.</li>
            <li><strong>Gimme rule:</strong> Any ball within 15 feet of the hole is considered good — pick it up and count one stroke.</li>
            <li>Lowest team score after 18 holes wins.</li>
          </ul>
        </div>

        {/* Scoring */}
        <div className="gn-card" style={{ borderLeftColor: "#86efac" }}>
          <p className="gn-card-title">Scoring</p>
          <div className="golf-scoring-table">
            <div className="golf-score-row golf-score-first">
              <span className="golf-score-place">🥇 1st</span>
              <span className="golf-score-desc">Lowest score</span>
              <span className="golf-score-pts">20 pts</span>
            </div>
            <div className="golf-score-row golf-score-second">
              <span className="golf-score-place">🥈 2nd</span>
              <span className="golf-score-desc">Second lowest score</span>
              <span className="golf-score-pts">10 pts</span>
            </div>
            <div className="golf-score-row golf-score-third">
              <span className="golf-score-place">🥉 3rd</span>
              <span className="golf-score-desc">Third lowest score</span>
              <span className="golf-score-pts">5 pts</span>
            </div>
            <div className="golf-score-row golf-score-fourth">
              <span className="golf-score-place">4th</span>
              <span className="golf-score-desc">Highest score</span>
              <span className="golf-score-pts">0 pts</span>
            </div>
          </div>
        </div>

        {/* Tiebreak */}
        <div className="gn-card" style={{ borderLeftColor: "#fbbf24" }}>
          <p className="gn-card-title">Tiebreaker</p>
          <ul className="gn-rule-list">
            <li>If two or more teams finish with the same score, the tied teams play sudden death beginning at <strong>Hole 16</strong>.</li>
            <li>The team with the lower score on the sudden-death hole wins. Play continues to the next hole if still tied.</li>
          </ul>
        </div>

        {/* Rules */}
        <div className="gn-card" style={{ borderLeftColor: "#94a3b8" }}>
          <p className="gn-card-title">General Rules</p>
          <ul className="gn-rule-list">
            <li>All teams play by simulator rules. The simulator tracks scores.</li>
            <li>The gimme (15-foot) rule applies at all times — no exceptions.</li>
            <li>Any concerns, disputes, or challenges are decided by <strong>Curtis</strong>. His ruling is final.</li>
          </ul>
        </div>

      </div>
    </div>
  );
}
