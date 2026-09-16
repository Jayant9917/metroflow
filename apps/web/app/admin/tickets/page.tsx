"use client";
import { useEffect, useState } from "react";
import { AppShell } from "../../app-shell";
import { getAccessToken, refreshAccessToken } from "../../auth-client";
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
type Ticket = { id: string; email: string; originStation: { name: string }; destinationStation: { name: string }; paidAmount: string; currency: string; status: string; expiresAt: string };
export default function AdminTicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]); const [error, setError] = useState("");
  useEffect(() => { void (async () => { const token = getAccessToken() ?? (await refreshAccessToken()); if (!token) return setError("Your operations session has expired."); const response = await fetch(`${api}/api/v1/tickets/operations`, { credentials: "include", headers: { authorization: `Bearer ${token}` } }); const body = await response.json(); if (!response.ok) return setError(body.message ?? "Unable to load tickets."); setTickets(body.data.tickets); })().catch(() => setError("Unable to load tickets.")); }, []);
  return <AppShell eyebrow="Administration"><div className="admin-header"><div><span className="sim-kicker">OPERATIONS</span><h1 className="page-title">Ticket operations</h1><p>Inspect the latest passenger tickets and their lifecycle status.</p></div></div>{error ? <p className="admin-notice error">{error}</p> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Passenger</th><th>Route</th><th>Fare</th><th>Status</th><th>Expires</th></tr></thead><tbody>{tickets.map((ticket) => <tr key={ticket.id}><td>{ticket.email}</td><td><strong>{ticket.originStation.name} → {ticket.destinationStation.name}</strong></td><td>{ticket.currency} {ticket.paidAmount}</td><td><span className="admin-tag">{ticket.status}</span></td><td>{new Date(ticket.expiresAt).toLocaleString()}</td></tr>)}</tbody></table></div>}</AppShell>;
}
