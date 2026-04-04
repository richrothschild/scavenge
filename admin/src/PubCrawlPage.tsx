import { useState } from "react";
import { useNavigate } from "react-router-dom";

type TabId = "rules" | "spades" | "hearts" | "diamonds" | "clubs";

const TABS: { id: TabId; label: string; color: string }[] = [
  { id: "rules",    label: "Master Rules", color: "#94a3b8" },
  { id: "spades",   label: "♠ Spades",     color: "#818cf8" },
  { id: "hearts",   label: "♥ Hearts",     color: "#f87171" },
  { id: "diamonds", label: "♦ Diamonds",   color: "#fbbf24" },
  { id: "clubs",    label: "♣ Clubs",      color: "#4ade80" },
];

function MasterRulesCard() {
  return (
    <div className="pubcrawl-card" style={{ borderLeftColor: "#94a3b8" }}>
      <p className="pubcrawl-card-title">Master Rules</p>

      <div className="pubcrawl-rule-section">
        <p className="pubcrawl-section-heading">Final Location</p>
        <ul className="pubcrawl-rule-list">
          <li>The Socialite Crafthouse &amp; Kitchen — 77 Jefferson St, San Francisco, CA 94133</li>
        </ul>
      </div>

      <div className="pubcrawl-rule-section">
        <p className="pubcrawl-section-heading">Objective</p>
        <ul className="pubcrawl-rule-list">
          <li>Teams compete across four locations to earn points. Final scores determined after the Socialite showdown.</li>
        </ul>
      </div>

      <div className="pubcrawl-rule-section">
        <p className="pubcrawl-section-heading">Time Rules</p>
        <ul className="pubcrawl-rule-list">
          <li>30 minutes per location. Move immediately when time expires.</li>
          <li className="pubcrawl-penalty">Late submissions = -2 points.</li>
        </ul>
      </div>

      <div className="pubcrawl-rule-section">
        <p className="pubcrawl-section-heading">Required Per Bar</p>
        <ul className="pubcrawl-rule-list">
          <li>Complete exactly 2 core challenges.</li>
          <li>Complete up to 1 extra credit challenge.</li>
          <li>No additional scoring beyond this limit.</li>
        </ul>
      </div>

      <div className="pubcrawl-rule-section">
        <p className="pubcrawl-section-heading">Proof Requirements</p>
        <ul className="pubcrawl-rule-list">
          <li>Every submission must include a photo or video.</li>
          <li>Show at least 2 team members.</li>
          <li>Clearly show the activity, location, and any required participants.</li>
          <li className="pubcrawl-penalty">If unclear → does not count.</li>
        </ul>
      </div>

      <div className="pubcrawl-rule-section">
        <p className="pubcrawl-section-heading">Submission Format</p>
        <ul className="pubcrawl-rule-list">
          <li>Team name · Location · Challenge name · Photo/video · Optional short caption.</li>
        </ul>
      </div>

      <div className="pubcrawl-rule-section">
        <p className="pubcrawl-section-heading">Bonuses</p>
        <ul className="pubcrawl-rule-list">
          <li className="pubcrawl-bonus">MVP Rotation: Different team member leads each bar. Full compliance = +3 points.</li>
          <li className="pubcrawl-bonus">Identity Bonus: Each team can earn +2 points per bar. Does it feel like your team identity?</li>
        </ul>
      </div>

      <div className="pubcrawl-rule-section">
        <p className="pubcrawl-section-heading">Penalties</p>
        <ul className="pubcrawl-rule-list">
          <li className="pubcrawl-penalty">Late submission → -2</li>
          <li className="pubcrawl-penalty">Invalid proof → 0 + -3</li>
          <li className="pubcrawl-penalty">Weak/unclear completion → 0</li>
          <li className="pubcrawl-penalty">Refusal → 0</li>
        </ul>
      </div>

      <div className="pubcrawl-rule-section">
        <p className="pubcrawl-section-heading">Win Condition</p>
        <ul className="pubcrawl-rule-list">
          <li>Highest total points wins.</li>
        </ul>
      </div>

      {/* Location challenge summaries */}
      <p className="pubcrawl-section-heading" style={{ marginTop: "0.5rem" }}>Location Challenges</p>

      <div className="pubcrawl-location-block">
        <span className="pubcrawl-location-name">Red Jack Saloon</span>
        <span className="pubcrawl-location-addr">131 Bay St</span>
        <ul className="pubcrawl-challenge-list">
          <li><span className="pubcrawl-pts">5</span> Win a game</li>
          <li><span className="pubcrawl-pts">6</span> Beat a stranger</li>
          <li><span className="pubcrawl-pts">5</span> Hit declared target</li>
          <li><span className="pubcrawl-pts">+3</span> Extra: Back-to-back win</li>
          <li><span className="pubcrawl-pts">+2</span> Extra: Different teammate wins</li>
          <li><span className="pubcrawl-pts">+4</span> Extra: Called shot success</li>
        </ul>
      </div>

      <div className="pubcrawl-location-block">
        <span className="pubcrawl-location-name">Player's Sports Grill &amp; Arcade</span>
        <span className="pubcrawl-location-addr">PIER 39</span>
        <ul className="pubcrawl-challenge-list">
          <li><span className="pubcrawl-pts">5</span> Photo with 2+ strangers</li>
          <li><span className="pubcrawl-pts">5</span> Bartender interaction</li>
          <li><span className="pubcrawl-pts">5</span> Sports-related moment</li>
          <li><span className="pubcrawl-pts">+3</span> Extra: 4+ strangers</li>
          <li><span className="pubcrawl-pts">+3</span> Extra: Unique interaction</li>
          <li><span className="pubcrawl-pts">+2</span> Extra: Strong identity</li>
        </ul>
      </div>

      <div className="pubcrawl-location-block">
        <span className="pubcrawl-location-name">Taco Bell Cantina <span style={{ color: "#64748b", fontWeight: 400, fontSize: "0.8rem" }}>(Snack only)</span></span>
        <span className="pubcrawl-location-addr">333 Jefferson St</span>
        <ul className="pubcrawl-challenge-list">
          <li><span className="pubcrawl-pts">5</span> Custom item (3+ mods)</li>
          <li><span className="pubcrawl-pts">5</span> Same item team-wide</li>
          <li><span className="pubcrawl-pts">6</span> Fastest order→bite</li>
          <li><span className="pubcrawl-pts">7</span> Special: Counter Choice — ask staff to add surprise item, entire team must consume</li>
          <li><span className="pubcrawl-pts">+4</span> Extra: Finish item</li>
          <li><span className="pubcrawl-pts">+3</span> Extra: Reaction captured</li>
          <li><span className="pubcrawl-pts">+10/-5</span> Extra: Double Down</li>
        </ul>
      </div>

      <div className="pubcrawl-location-block">
        <span className="pubcrawl-location-name">Sweetie's Art Bar</span>
        <span className="pubcrawl-location-addr">475 Francisco St</span>
        <ul className="pubcrawl-challenge-list">
          <li><span className="pubcrawl-pts">5</span> Table-object scene</li>
          <li><span className="pubcrawl-pts">5</span> Stranger defines team</li>
          <li><span className="pubcrawl-pts">5</span> Suit identity photo</li>
          <li><span className="pubcrawl-pts">+4</span> Extra: Highly creative</li>
          <li><span className="pubcrawl-pts">+3</span> Extra: Stranger contributes</li>
          <li><span className="pubcrawl-pts">+3</span> Extra: Use of environment</li>
        </ul>
      </div>

      <div className="pubcrawl-location-block">
        <span className="pubcrawl-location-name">Final — The Socialite</span>
        <span className="pubcrawl-location-addr">77 Jefferson St</span>
        <ul className="pubcrawl-challenge-list">
          <li><span className="pubcrawl-pts">10</span> Required: Water cup match (win)</li>
          <li><span className="pubcrawl-pts">+5/-3</span> Optional: vs Boyz</li>
          <li><span className="pubcrawl-pts">+10/-5</span> Optional: vs strangers</li>
          <li><span className="pubcrawl-pts">+10</span> Bonus: Beat group of strangers</li>
          <li><span className="pubcrawl-pts">+5</span> Extra: Win 2 in a row</li>
          <li><span className="pubcrawl-pts">+5</span> Extra: Beat undefeated</li>
          <li><span className="pubcrawl-pts">+2</span> Extra: Strong identity</li>
        </ul>
      </div>
    </div>
  );
}

interface TeamCardProps {
  color: string;
  title: string;
  identity: string;
  strategy: string;
  route: { stop: string | number; name: string; addr: string; finish?: boolean }[];
}

function TeamCard({ color, title, identity, strategy, route }: TeamCardProps) {
  return (
    <div className="pubcrawl-card" style={{ borderLeftColor: color }}>
      <p className="pubcrawl-card-title" style={{ color }}>{title}</p>
      <p className="pubcrawl-identity">{identity}</p>

      <p className="pubcrawl-section-heading">Your Route</p>
      <ol className="pubcrawl-route">
        {route.map((stop, i) => (
          <li key={i}>
            <span className="pubcrawl-stop-num" style={{ color }}>{stop.stop}.</span>
            <span>
              <span className={stop.finish ? "pubcrawl-stop-finish" : ""}>{stop.name}</span>
              {" "}<span style={{ color: "#64748b", fontSize: "0.82rem" }}>— {stop.addr}</span>
            </span>
          </li>
        ))}
      </ol>

      <p className="pubcrawl-section-heading">Strategy</p>
      <div className="pubcrawl-strategy">{strategy}</div>
    </div>
  );
}

export default function PubCrawlPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("rules");

  return (
    <div className="pub-page">
      <header className="pub-header">
        <button className="pub-back" onClick={() => navigate("/")}>← Home</button>
        <h1>Pub Crawl</h1>
        <span className="pub-header-sub">Boyz Weekend 2026 · San Francisco</span>
      </header>

      <div className="pubcrawl-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`pubcrawl-tab${activeTab === tab.id ? " active" : ""}`}
            style={activeTab === tab.id ? { color: tab.color, borderColor: tab.color } : {}}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="pubcrawl-content">
        {activeTab === "rules" && <MasterRulesCard />}

        {activeTab === "spades" && (
          <TeamCard
            color="#818cf8"
            title="♠ Spades"
            identity="Play aggressively. Identity bonus easiest when team chooses harder option, moves quickly, shows confidence."
            strategy="Take risks where the upside is highest, especially at Taco Bell and The Socialite."
            route={[
              { stop: 1, name: "Red Jack Saloon",               addr: "131 Bay St" },
              { stop: 2, name: "Player's Sports Grill & Arcade", addr: "PIER 39" },
              { stop: 3, name: "Taco Bell Cantina",              addr: "333 Jefferson St" },
              { stop: 4, name: "Sweetie's Art Bar",              addr: "475 Francisco St" },
              { stop: "Finish", name: "The Socialite",           addr: "77 Jefferson St", finish: true },
            ]}
          />
        )}

        {activeTab === "hearts" && (
          <TeamCard
            color="#f87171"
            title="♥ Hearts"
            identity="Win through friendliness, smooth interactions, and clean teamwork. Identity bonus easiest when strangers and staff clearly enjoy engaging with you."
            strategy="Best edge is smooth stranger interaction. Earn identity bonus consistently and avoid penalties."
            route={[
              { stop: 1, name: "Player's Sports Grill & Arcade", addr: "PIER 39" },
              { stop: 2, name: "Taco Bell Cantina",              addr: "333 Jefferson St" },
              { stop: 3, name: "Sweetie's Art Bar",              addr: "475 Francisco St" },
              { stop: 4, name: "Red Jack Saloon",               addr: "131 Bay St" },
              { stop: "Finish", name: "The Socialite",           addr: "77 Jefferson St", finish: true },
            ]}
          />
        )}

        {activeTab === "diamonds" && (
          <TeamCard
            color="#fbbf24"
            title="♦ Diamonds"
            identity="Look sharp, think clearly, win the margin with cleaner execution and smarter ideas. Identity bonus easiest when submissions are polished and obviously intentional."
            strategy="Be crisp. Use cleaner proof, smarter choices, and strong extra credit execution to separate from the field."
            route={[
              { stop: 1, name: "Taco Bell Cantina",              addr: "333 Jefferson St" },
              { stop: 2, name: "Sweetie's Art Bar",              addr: "475 Francisco St" },
              { stop: 3, name: "Red Jack Saloon",               addr: "131 Bay St" },
              { stop: 4, name: "Player's Sports Grill & Arcade", addr: "PIER 39" },
              { stop: "Finish", name: "The Socialite",           addr: "77 Jefferson St", finish: true },
            ]}
          />
        )}

        {activeTab === "clubs" && (
          <TeamCard
            color="#4ade80"
            title="♣ Clubs"
            identity="Win by being efficient, disciplined, and mistake-free. Identity bonus easiest when proof is clean, choices are smart, team wastes no time."
            strategy="Avoid penalties, move fast, and choose highest-certainty points unless upside clearly justifies risk."
            route={[
              { stop: 1, name: "Sweetie's Art Bar",              addr: "475 Francisco St" },
              { stop: 2, name: "Red Jack Saloon",               addr: "131 Bay St" },
              { stop: 3, name: "Player's Sports Grill & Arcade", addr: "PIER 39" },
              { stop: 4, name: "Taco Bell Cantina",              addr: "333 Jefferson St" },
              { stop: "Finish", name: "The Socialite",           addr: "77 Jefferson St", finish: true },
            ]}
          />
        )}
      </div>
    </div>
  );
}
