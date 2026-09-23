"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { clearAccessToken, getAccessToken, refreshAccessToken } from "./auth-client";

export function AppShell({ children, eyebrow = "MetroFlow" }: { children: ReactNode; eyebrow?: string }) {
  const pathname = usePathname();
  const operations = pathname.startsWith("/admin");
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => {
    void (async () => {
      const token = getAccessToken() ?? await refreshAccessToken();
      if (!token) {
        window.location.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
        return;
      }
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/auth/me`, {
        credentials: "include",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        clearAccessToken();
        window.location.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
        return;
      }
      setSessionReady(true);
    })().catch(() => {
      clearAccessToken();
      window.location.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
    });
  }, [pathname]);
  async function logout() { const token = getAccessToken(); try { await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/auth/logout`, { method: "POST", credentials: "include", headers: token ? { authorization: `Bearer ${token}` } : undefined, signal: AbortSignal.timeout(10000) }); } finally { clearAccessToken(); window.location.href = "/login"; } }
  if (!sessionReady) return <main className="dashboard"><section className="dashboard-content"><div className="feedback">Checking your session...</div></section></main>;
  return <main className="dashboard"><header className="dashboard-nav"><a className="brand brand-lockup" href={operations ? "/admin" : "/dashboard"}><img src="/metro.png" alt="" aria-hidden="true" />MetroFlow</a><nav>{operations ? <><a href="/admin">Operations</a><button type="button" onClick={() => void logout()} className="nav-logout">Log out</button></> : <><a href="/journey/new">Plan journey</a><a href="/purchases">Purchases</a><a href="/tickets">Tickets</a><a href="/journeys">Journeys</a><a href="/account">Account</a></>}</nav></header><section className="dashboard-content"><div className="eyebrow">{eyebrow}</div>{children}</section></main>;
}

export function FeaturePage({ title, description, links = [], eyebrow = "MetroFlow" }: { title: string; description: string; links?: { label: string; href: string }[]; eyebrow?: string }) {
  return <AppShell eyebrow={eyebrow}><h1 className="page-title">{title}</h1><p className="subtle page-description">{description}</p><div className="dashboard-grid">{links.length ? links.map((link) => <a className="dashboard-card dashboard-card-link" href={link.href} key={link.href}><h2>{link.label}</h2><span className="card-action">Open section</span></a>) : <div className="dashboard-panel light-panel"><div><h2>Ready for the next step</h2><p className="subtle">This screen is connected to the documented route and will use the backend lifecycle as each service is completed.</p></div></div>}</div></AppShell>;
}
