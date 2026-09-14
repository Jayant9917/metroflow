"use client";
import { useState } from "react";
import {
  clearAccessToken,
  getAccessToken,
  refreshAccessToken,
} from "../auth-client";
import { Toast } from "../toast";

export default function DashboardPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setLoading(true);
    setError("");
    try {
      const token = getAccessToken() ?? (await refreshAccessToken());
      if (!token) throw new Error("Your session has expired.");
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/auth/logout`,
        {
          method: "POST",
          credentials: "include",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) throw new Error("Unable to log out.");
      clearAccessToken();
      window.location.assign("/login");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Service temporarily unavailable.",
      );
      setLoading(false);
    }
  }
  return (
    <main className="dashboard">
      <header className="dashboard-nav">
        <a className="brand brand-lockup" href="/dashboard">
          <img src="/metro.png" alt="" aria-hidden="true" />
          MetroFlow
        </a>
        <nav>
          <a href="/tickets">Tickets</a>
          <a href="/journeys">Journeys</a>
          <a href="/account">Account</a>
          <button className="nav-logout" onClick={logout} disabled={loading}>
            {loading ? "Logging out…" : "Log Out"}
          </button>
        </nav>
      </header>
      <section className="dashboard-content">
        <div className="dashboard-intro">
          <div>
            <div className="eyebrow">Passenger dashboard</div>
            <h1>Welcome to MetroFlow</h1>
            <p className="subtle">
              Plan your next journey, manage your tickets, and move through the
              city with confidence.
            </p>
          </div>
          <div className="status-chip">
            <span>●</span> Account active
          </div>
        </div>
        {error && (
          <div className="feedback error" role="alert">
            {error}
          </div>
        )}
        <div className="dashboard-grid">
          <article className="dashboard-card featured">
            <div className="card-icon">→</div>
            <h2>Start a new journey</h2>
            <p>
              Choose your origin and destination to receive an authoritative
              fare quote.
            </p>
            <a className="card-action" href="/journey/new">
              Plan journey <span>↗</span>
            </a>
          </article>
          <article className="dashboard-card">
            <div className="card-icon">▣</div>
            <h2>Your tickets</h2>
            <p>View your active and previous MetroFlow tickets.</p>
            <a className="card-action" href="/tickets">
              View tickets <span>↗</span>
            </a>
          </article>
          <article className="dashboard-card">
            <div className="card-icon">◷</div>
            <h2>Journey history</h2>
            <p>Review your completed and active journeys.</p>
            <a className="card-action" href="/journeys">
              View journeys <span>↗</span>
            </a>
          </article>
        </div>
        <section className="dashboard-panel">
          <div>
            <div className="eyebrow">Next step</div>
            <h2>Ready to travel?</h2>
            <p className="subtle">
              Your MetroFlow account is ready. Start by selecting two stations
              for your next trip.
            </p>
          </div>
          <a className="primary dashboard-cta" href="/journey/new">
            Plan a journey
          </a>
        </section>
      </section>
    </main>
  );
}
