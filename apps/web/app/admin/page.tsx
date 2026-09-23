"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "../app-shell";
import { clearAccessToken, getAccessToken, refreshAccessToken } from "../auth-client";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const areas = [
  ["Stations and gates", "/admin/stations", "Inspect station order and gate availability."],
  ["Tickets", "/admin/tickets", "Search issued, active, completed, and expired tickets."],
  ["Journeys", "/admin/journeys", "Review active and completed passenger journeys."],
  ["Payments", "/admin/payments", "Inspect payment status and reconciliation."],
  ["Gate events", "/admin/gate-events", "Review accepted, rejected, and replayed scans."],
  ["Inconsistencies", "/admin/inconsistencies", "Find records that need operational review."],
  ["Outbox", "/admin/outbox", "Monitor pending and published domain events."],
  ["Operator audit", "/admin/audit", "Review station and gate changes made by operations staff."],
] as const;

export default function AdminPage() {
  const [status, setStatus] = useState<string>("loading");
  const [role, setRole] = useState<"ADMIN" | "OPERATOR" | null>(null);
  const [summary, setSummary] = useState<Record<string, Record<string, number>> & { activeStations?: number; revenue?: number } | null>(null);
  useEffect(() => {
    const deny = () => {
      clearAccessToken();
      window.location.replace("/login?reason=operations");
    };
    void (async () => {
      const token = getAccessToken() ?? (await refreshAccessToken());
      if (!token) return deny();
      const headers = { authorization: `Bearer ${token}` };
      const me = await fetch(`${api}/api/v1/auth/me`, { credentials: "include", headers });
      if (!me.ok) return deny();
      const user = (await me.json()).user;
      if (!user || !["ADMIN", "OPERATOR"].includes(user.role)) return deny();
      setRole(user.role);
      const operations = await fetch(`${api}/api/v1/auth/operations`, { credentials: "include", headers });
      if (!operations.ok) return deny();
      setStatus("allowed");
      const analytics = await fetch(`${api}/api/v1/admin/analytics`, { credentials: "include", headers });
      if (analytics.ok) setSummary((await analytics.json()).data.summary);
    })().catch(() => deny());
  }, []);

  if (!["allowed"].includes(status)) return <main className="dashboard"><section className="dashboard-content"><p className="admin-notice">Verifying operations access...</p></section></main>;
  const roleLabel = role === "ADMIN" ? "ADMINISTRATOR" : "OPERATOR";
  return <AppShell eyebrow="Administration"><style jsx global>{`.admin-header{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;margin-bottom:28px}.admin-header p{color:#607895;font-size:17px}.admin-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.admin-card{display:block;min-height:178px;padding:24px;border:1px solid #d8e4f2;border-radius:18px;background:#fff;box-shadow:0 10px 28px rgba(28,65,108,.06);text-decoration:none;transition:.18s}.admin-card:hover{transform:translateY(-3px);border-color:#6ea8f7;box-shadow:0 16px 34px rgba(28,65,108,.12)}.admin-card h2{margin:12px 0 8px;color:#102b4e;font-size:23px}.admin-card p{min-height:42px;color:#607895;line-height:1.5}.admin-card strong{color:#1769e0}.admin-notice{padding:18px 20px;border:1px solid #d8e4f2;border-radius:14px;background:#fff;color:#526b89}.admin-notice.error{background:#fff4f3;color:#a32924}@media(max-width:900px){.admin-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.admin-grid{grid-template-columns:1fr}.admin-header{align-items:flex-start;flex-direction:column}}`}</style>
    <div className="admin-header"><div><span className="sim-kicker">CONTROL ROOM</span><h1 className="page-title">Operations overview</h1><p>Protected tools for monitoring MetroFlow’s ticket and journey lifecycle.</p></div><span className={`sim-ticket-status status-${status}`}>{status === "loading" ? "VERIFYING ACCESS" : status === "allowed" ? `${role} ACCESS` : "ACCESS DENIED"}</span></div>
    <p className="admin-role-label">Signed in as <strong>{roleLabel}</strong></p>
    {status === "loading" && <p className="admin-notice">Checking your operations role...</p>}
    {status === "denied" && <p className="admin-notice error">This area is restricted to administrators and operators. Sign in with an operations account.</p>}
    {status === "allowed" && summary && <div className="admin-metrics" style={{display:"grid",gridTemplateColumns:"repeat(9,minmax(0,1fr))",gap:14,marginBottom:28}}>{[["Active stations", summary.activeStations ?? 0], ["Issued tickets", summary.tickets?.ISSUED ?? 0], ["Active journeys", summary.journeys?.ACTIVE ?? 0], ["Completed journeys", summary.journeys?.COMPLETED ?? 0], ["Paid purchases", summary.purchases?.PAID ?? 0], ["Pending payments", summary.purchases?.PENDING ?? 0], ["Failed payments", summary.purchases?.FAILED ?? 0], ["Revenue", `INR ${Number(summary.revenue ?? 0).toFixed(2)}`], ["Rejected scans", (summary.gateEvents?.ENTRY_REJECTED ?? 0) + (summary.gateEvents?.EXIT_REJECTED ?? 0)]].map(([label, value]) => <div className="admin-metric" style={{padding:18,border:"1px solid #d8e4f2",borderRadius:16,background:"#fff"}} key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>}
    {status === "allowed" && <div className="admin-grid">{areas.filter(([title]) => role === "ADMIN" || !["Inconsistencies", "Outbox", "Operator audit"].includes(title)).map(([title, href, description]) => <Link className="admin-card" href={href} key={href}><span className="sim-kicker">OPERATIONS</span><h2>{title}</h2><p>{description}</p><strong>Open area →</strong></Link>)}</div>}
  </AppShell>;
}
