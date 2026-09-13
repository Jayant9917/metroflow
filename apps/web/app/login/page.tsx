"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { setAccessToken } from "../auth-client";
import { Toast } from "../toast";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "otp">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function changeMode(next: "password" | "otp") {
    setMode(next);
    setError("");
    setOtpSent(false);
    setCode("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const path =
        mode === "password"
          ? "/api/v1/auth/login"
          : otpSent
            ? "/api/v1/auth/otp/verify"
            : "/api/v1/auth/otp/request";
      const body =
        mode === "password"
          ? { email, password }
          : otpSent
            ? { email, code }
            : { email };
      const response = await fetch(`${api}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Unable to continue.");
      if (mode === "otp" && !otpSent) {
        setOtpSent(true);
        return;
      }
      setAccessToken(data.accessToken);
      router.push("/dashboard");
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
          <h1>Your journey starts here.</h1>
          <p>Sign in to manage your tickets, journeys, and account securely.</p>
        </div>
        <div className="visual-foot">Smart transit, clear journeys.</div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          {error && <Toast message={error} onClose={() => setError("")} />}
          <div className="eyebrow">Welcome back</div>
          <h2>Sign in</h2>
          <p className="subtle">Use your MetroFlow account to continue.</p>
          <div className="login-tabs" role="tablist">
            <button
              type="button"
              className={mode === "password" ? "active" : ""}
              onClick={() => changeMode("password")}
            >
              Password
            </button>
            <button
              type="button"
              className={mode === "otp" ? "active" : ""}
              onClick={() => changeMode("otp")}
            >
              Email OTP
            </button>
          </div>
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
            {mode === "password" ? (
              <>
                <label className="field">
                  Password
                  <input
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </label>
                <p className="auth-link auth-link-right">
                  <a href="/forgot-password">Forgot password?</a>
                </p>
              </>
            ) : (
              otpSent && (
                <label className="field">
                  Email OTP
                  <input
                    required
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="Enter 6-digit code"
                    autoComplete="one-time-code"
                  />
                </label>
              )
            )}
            <button className="primary" disabled={loading}>
              {loading
                ? "Please wait…"
                : mode === "password"
                  ? "Sign in"
                  : otpSent
                    ? "Verify code"
                    : "Send login code"}
            </button>
          </form>
          <p className="auth-link">
            New to MetroFlow? <a href="/register">Create an account</a>
          </p>
        </div>
      </section>
    </main>
  );
}
