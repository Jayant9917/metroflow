"use client";
import { FormEvent, useEffect, useState } from "react";
import { Toast } from "../toast";
import { PasswordField } from "../password-field";
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!token) {
      setError("This reset link is invalid or incomplete.");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${api}/api/v1/auth/password-reset/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? "Unable to reset password.");
      setDone(true);
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
          <h1>A fresh start.</h1>
          <p>Choose a new secure password and continue your journey.</p>
        </div>
        <div className="visual-foot">Smart transit, clear journeys.</div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          {error && <Toast message={error} onClose={() => setError("")} />}
          <div className="eyebrow">Account recovery</div>
          <h2>Reset password</h2>
          {done ? (
            <>
              <p className="subtle">
                Your password was changed successfully. You can now sign in.
              </p>
              <a className="primary dashboard-cta" href="/login">
                Go to sign in
              </a>
            </>
          ) : (
            <form onSubmit={submit}>
              <PasswordField label="New password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} />
              <PasswordField label="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} />
              <button className="primary" disabled={loading}>
                {loading ? "Updating…" : "Reset password"}
              </button>
            </form>
          )}
          <p className="auth-link">
            <a href="/login">Back to sign in</a>
          </p>
        </div>
      </section>
    </main>
  );
}
