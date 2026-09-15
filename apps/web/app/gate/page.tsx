"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "../app-shell";
import { getAccessToken, refreshAccessToken } from "../auth-client";

type Gate = { id: string; code: string; station_name: string };
type Ticket = { id: string; identifier: string; originStation: { name: string } };
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function readJson(response: Response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error(`API returned an unexpected response (${response.status}).`); }
}

export default function GatePage() {
  const [gates, setGates] = useState<Gate[]>([]);
  const [gateId, setGateId] = useState("");
  const [ticketIdentifier, setTicketIdentifier] = useState("");
  const [message, setMessage] = useState("");
  const [decision, setDecision] = useState("");
  const [loading, setLoading] = useState(false);
  const [originStation, setOriginStation] = useState("");

  useEffect(() => {
    const ticketId = new URLSearchParams(window.location.search).get("ticketId");
    if (!ticketId) { setMessage("Open this page from an issued ticket."); return; }
    setTicketIdentifier(ticketId);
    const load = async () => {
      const token = getAccessToken() ?? await refreshAccessToken();
      const [ticketResponse, gatesResponse] = await Promise.all([
        fetch(`${api}/api/v1/tickets/${ticketId}`, { credentials: "include", headers: { authorization: `Bearer ${token ?? ""}` } }),
        fetch(`${api}/api/v1/gate/entry-gates`, { credentials: "include" }),
      ]);
      const ticketPayload = await readJson(ticketResponse); const gatesPayload = await readJson(gatesResponse);
      if (!ticketResponse.ok) throw new Error(ticketPayload.message ?? "Unable to load ticket.");
      if (!gatesResponse.ok) throw new Error(gatesPayload.message ?? "Unable to load gates.");
      const ticket = ticketPayload.data.ticket as Ticket;
      const station = ticket.originStation.name;
      const matchingGates = (gatesPayload.data.gates as Gate[]).filter((gate) => gate.station_name === station);
      setTicketIdentifier(ticket.identifier || ticketId);
      setOriginStation(station); setGates(matchingGates);
      if (matchingGates[0]) setGateId(matchingGates[0].id); else setMessage(`No active entry gate is configured at ${station}.`);
    };
    void load()
      .catch((error: Error) => setMessage(error.message));
  }, []);

  async function validateEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setMessage(""); setDecision("");
    try {
      const token = getAccessToken() ?? await refreshAccessToken();
      const response = await fetch(`${api}/api/v1/gate/validate-entry`, { method: "POST", credentials: "include", headers: { authorization: `Bearer ${token ?? ""}`, "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ gateId, ticketIdentifier }) });
      const payload = await readJson(response); if (!response.ok) throw new Error(payload.message ?? "Gate validation failed.");
      setDecision(payload.data.decision); setMessage(payload.data.decision === "ALLOW" ? "Entry allowed. Welcome aboard." : payload.data.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Gate validation failed."); }
    finally { setLoading(false); }
  }

  const selectedGate = gates.find((gate) => gate.id === gateId);
  return <AppShell eyebrow="Gate simulator"><h1 className="page-title">Metro entry gate</h1><p className="subtle page-description">Present your digital ticket and pass through the station barrier.</p><section className={`gate-scene ${decision === "ALLOW" ? "gate-open" : ""}`}><div className="gate-scene-top"><div><span className="gate-live-dot" /> LIVE STATION SIMULATOR</div><strong>{selectedGate?.station_name ?? originStation ?? "Metro station"}</strong></div><div className="gate-floor"><div className="gate-machine"><div className="gate-reader"><span>▣</span><small>SCAN QR</small></div><div className="gate-pillar" /><div className="gate-arm gate-arm-left" /><div className="gate-arm gate-arm-right" /></div><div className="gate-lane"><div className="gate-lane-light" /><span>{decision === "ALLOW" ? "GATE OPEN" : "READY TO SCAN"}</span></div></div>{decision === "ALLOW" ? <div className="gate-status gate-status-allow">✓ Entry accepted — welcome aboard</div> : <div className="gate-status">Scan your ticket to enter the metro</div>}</section><form className="gate-console dashboard-panel light-panel" onSubmit={validateEntry}><div className="gate-console-title"><div><span className="eyebrow">CONTROL PANEL</span><h2>Validate passenger ticket</h2><p className="gate-origin-note">Ticket origin: <strong>{originStation || "Loading..."}</strong></p></div><span className={`gate-state ${decision === "ALLOW" ? "allowed" : decision === "REJECT" ? "rejected" : ""}`}>{decision || "IDLE"}</span></div><div className="gate-fields"><label htmlFor="gate-id">Physical gate at origin<select id="gate-id" name="gateId" value={gateId} onChange={(event) => setGateId(event.target.value)} required>{gates.length === 0 ? <option value="">Loading gates...</option> : null}{gates.map((gate) => <option key={gate.id} value={gate.id}>{gate.code}</option>)}</select></label><label htmlFor="ticket-identifier">Ticket QR identifier<input id="ticket-identifier" name="ticketIdentifier" value={ticketIdentifier} onChange={(event) => setTicketIdentifier(event.target.value)} placeholder="Paste ticket ID" required /></label></div>{message ? <div className={`feedback ${decision === "ALLOW" ? "success" : decision === "REJECT" ? "error" : ""}`}>{message}</div> : null}<div className="gate-actions"><button className="primary dashboard-cta" type="submit" disabled={loading || !gateId}>{loading ? "Reading ticket..." : "▣ Scan and validate"}</button><Link href="/tickets">View tickets</Link></div></form></AppShell>;
}
