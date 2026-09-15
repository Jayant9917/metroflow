"use client";
import { useEffect, useState } from "react";
import { AppShell } from "../app-shell";
import { getAccessToken, refreshAccessToken } from "../auth-client";

export default function TicketsPage() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [message, setMessage] = useState("Loading tickets...");
  useEffect(() => { async function load() { const token = getAccessToken() ?? await refreshAccessToken(); const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/tickets`, { credentials: "include", headers: { authorization: `Bearer ${token ?? ""}` } }); const body = await response.json().catch(() => ({})); if (!response.ok) { setMessage(body.message ?? "Unable to load tickets."); return; } setTickets(body.data?.tickets ?? []); setMessage(""); } void load(); }, []);
  return <AppShell eyebrow="Tickets"><h1 className="page-title">Your tickets</h1><p className="subtle page-description">Present an issued ticket at the entry gate to begin your journey.</p>{message && <div className="feedback">{message}</div>}{!message && tickets.length === 0 && <div className="dashboard-panel light-panel"><h2>No tickets yet</h2><p className="subtle">Choose two stations and complete payment to receive a ticket.</p><a className="primary dashboard-cta" href="/journey/new">Start a journey</a></div>}<div className="ticket-list">{tickets.map((ticket) => <a className="ticket-list-card" href={`/tickets/${ticket.id}`} key={ticket.id}><div><span className="eyebrow">{ticket.status.replace("_", " ")}</span><h2>{ticket.originStation.name} → {ticket.destinationStation.name}</h2><p className="subtle">{ticket.currency} {ticket.paidAmount} · Valid until {new Date(ticket.expiresAt).toLocaleString()}</p></div><span className="card-action">View ticket ↗</span></a>)}</div></AppShell>;
}
