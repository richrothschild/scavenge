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
        <Route path="/admin" element={<App forceMode="admin" />} />
        <Route path="/admin/*" element={<App forceMode="admin" />} />
        {/* Legacy: bare domain without path goes to Home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
