"use client";
import { FormEvent, useState } from "react";
import { Toast } from "../toast";
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${api}/api/v1/auth/password-reset/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = await r.json();
      if (!r.ok)
        throw new Error(d.message ?? "Unable to send reset instructions.");
      setMessage(d.message);
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
          <h1>Get back on track.</h1>
          <p>
            We’ll help you securely regain access to your MetroFlow account.
          </p>
        </div>
        <div className="visual-foot">Smart transit, clear journeys.</div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          {error && <Toast message={error} onClose={() => setError("")} />}
          <div className="eyebrow">Account recovery</div>
          <h2>Forgot password?</h2>
          <p className="subtle">
            Enter your email and we’ll send reset instructions.
          </p>
          <form onSubmit={submit}>
            <label className="field">
              Email
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            {message && (
              <>
                <div className="feedback success" role="status">
                  {message}
                </div>
              </>
            )}
            <button className="primary" disabled={loading}>
              {loading ? "Sending…" : "Send reset instructions"}
            </button>
          </form>
          <p className="auth-link">
            <a href="/login">Back to sign in</a>
          </p>
        </div>
      </section>
    </main>
  );
}
