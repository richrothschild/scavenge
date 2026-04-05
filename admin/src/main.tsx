import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import HomePage from './HomePage.tsx'
import StandingsPage from './StandingsPage.tsx'
import EventsPage from './EventsPage.tsx'
import PackingPage from './PackingPage.tsx'
import PubCrawlPage from './PubCrawlPage.tsx'
import GameNightPage from './GameNightPage.tsx'
import GolfPage from './GolfPage.tsx'
import TriviaPage from './TriviaPage.tsx'
import SportsBettingPage from './SportsBettingPage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/hunt" element={<App forceMode="player" />} />
        <Route path="/standings" element={<StandingsPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/packing" element={<PackingPage />} />
        <Route path="/pubcrawl" element={<PubCrawlPage />} />
        <Route path="/gamenight" element={<GameNightPage />} />
        <Route path="/golf" element={<GolfPage />} />
        <Route path="/trivia" element={<TriviaPage />} />
        <Route path="/sportsbetting" element={<SportsBettingPage />} />
        <Route path="/admin" element={<App forceMode="admin" />} />
        <Route path="/admin/*" element={<App forceMode="admin" />} />
        {/* Legacy: bare domain without path goes to Home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
