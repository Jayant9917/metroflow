"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../app-shell";
import { getAccessToken, refreshAccessToken } from "../auth-client";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
type Kind = "tickets" | "journeys" | "purchases" | "audit";
const titles: Record<Kind, string> = { tickets: "Ticket detail", journeys: "Journey detail", purchases: "Purchase detail", audit: "Audit record detail" };

export function AdminDetail({ kind, id }: { kind: Kind; id: string }) {
  const [record, setRecord] = useState<any>(null);
  const [state, setState] = useState<"loading" | "error" | "empty" | "ready">("loading");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setState("loading"); setError("");
    try {
      const token = getAccessToken() ?? await refreshAccessToken();
      if (!token) throw new Error("Your operations session has expired.");
      const path = kind === "audit" ? "/api/v1/admin/audit?pageSize=100" : `/api/v1/${kind}/operations?search=${encodeURIComponent(id)}&pageSize=1`;
      const response = await fetch(`${api}${path}`, { credentials: "include", headers: { authorization: `Bearer ${token}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "Unable to load this record.");
      const items = kind === "audit" ? body.data?.events : body.data?.[kind];
      const match = kind === "audit" ? items?.find((item: any) => item.id === id) : items?.[0];
      if (!match) { setState("empty"); return; }
      setRecord(match); setState("ready");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load this record."); setState("error"); }
  }, [kind, id]);
  useEffect(() => { void load(); }, [load]);
  return <AppShell eyebrow="Administration"><a className="auth-link" href={`/admin/${kind}`}>← Back to {kind}</a><h1 className="page-title">{titles[kind]}</h1>{state === "loading" && <p className="admin-notice">Loading record...</p>}{state === "error" && <div className="admin-notice error"><p>{error}</p><button className="button" onClick={() => void load()}>Retry</button></div>}{state === "empty" && <p className="admin-notice">No record found for this identifier.</p>}{state === "ready" && <pre className="admin-detail-json">{JSON.stringify(record, null, 2)}</pre>}</AppShell>;
}
