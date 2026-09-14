"use client";
import { useState } from "react";
import {
  clearAccessToken,
  getAccessToken,
  refreshAccessToken,
} from "../auth-client";

export default function AccountPage() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function logout() {
    setLoading(true);
    setError("");
    try {
      const token = getAccessToken() ?? (await refreshAccessToken());
      if (!token) {
        clearAccessToken();
        window.location.assign("/login");
        return;
      }
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/auth/logout`,
        {
          method: "POST",
          credentials: "include",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Unable to log out.");
      }
      clearAccessToken();
      window.location.assign("/login");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Service temporarily unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="auth-shell">
      <section className="auth-visual">
        <div className="brand">MetroFlow</div>
        <div className="visual-copy">
          <h1>Your account, in your control.</h1>
          <p>Manage your MetroFlow access and keep your journeys moving.</p>
        </div>
        <div className="visual-foot">Smart transit, clear journeys.</div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="eyebrow">Account</div>
          <h2>Account settings</h2>
          <p className="subtle">Manage your session and account access.</p>
          {error && (
            <div className="feedback error" role="alert">
              {error}
            </div>
          )}
          {message && (
            <div className="feedback success" role="status">
              {message}
            </div>
          )}
          <a className="primary dashboard-cta" href="/account/password">
            Change password
          </a>
          <button className="primary" disabled={loading} onClick={logout}>
            {loading ? "Logging out…" : "Log Out"}
          </button>
        </div>
      </section>
    </main>
  );
}
