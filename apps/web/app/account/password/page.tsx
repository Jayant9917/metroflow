"use client";
import { FormEvent, useState } from "react";
import { Toast } from "../../toast";
import { getAccessToken } from "../../auth-client";
import { PasswordField } from "../../password-field";
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    const token = getAccessToken();
    if (!token) {
      setError("Your session has expired. Please sign in again.");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${api}/api/v1/auth/password/change`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? "Unable to change password.");
      setDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
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
          <h1>Keep your account secure.</h1>
          <p>
            Change your password whenever you need to protect your MetroFlow
            access.
          </p>
        </div>
        <div className="visual-foot">Smart transit, clear journeys.</div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          {error && <Toast message={error} onClose={() => setError("")} />}
          {done && (
            <Toast
              message="Password changed. Other sessions were signed out."
              type="success"
              onClose={() => setDone(false)}
            />
          )}
          <div className="eyebrow">Account security</div>
          <h2>Change password</h2>
          <p className="subtle">
            Enter your current password and choose a new one.
          </p>
          <form onSubmit={submit}>
            <PasswordField label="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
            <PasswordField label="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} />
            <PasswordField label="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} />
            <button className="primary" disabled={loading}>
              {loading ? "Updating…" : "Change password"}
            </button>
          </form>
          <p className="auth-link">
            <a href="/account">Back to account</a>
          </p>
        </div>
      </section>
    </main>
  );
}
