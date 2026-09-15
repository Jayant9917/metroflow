"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "../../app-shell";
import { getAccessToken, refreshAccessToken } from "../../auth-client";
import { QRCodeSVG } from "qrcode.react";

type Ticket = { id: string; identifier: string; purchaseId: string; originStation: { name: string }; destinationStation: { name: string }; paidAmount: string; currency: string; status: string; issuedAt: string; expiresAt: string };

export default function TicketDetailPage() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [message, setMessage] = useState("Loading ticket...");

  useEffect(() => {
    async function load() {
      const token = getAccessToken() ?? await refreshAccessToken();
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/tickets/${ticketId}`, { credentials: "include", headers: { authorization: `Bearer ${token ?? ""}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(body.message ?? "Unable to load this ticket."); return; }
      setTicket(body.data.ticket); setMessage("");
    }
    void load();
  }, [ticketId]);

  if (!ticket) return <AppShell eyebrow="Digital ticket"><h1 className="page-title">Digital ticket</h1><div className="feedback error">{message}</div><a className="text-link" href="/tickets">Back to tickets</a></AppShell>;
  return <AppShell eyebrow="Digital ticket"><div className="ticket-heading"><div><div className="eyebrow">Ready to board</div><h1 className="page-title">Your MetroFlow ticket</h1><p className="subtle page-description">Present this ticket at the entry gate when you are ready to travel.</p></div><span className="status-pill">{ticket.status.replace("_", " ")}</span></div><section className="ticket-card"><div className="ticket-qr" aria-label={`QR code for ticket ${ticket.identifier}`}><div className="qr-surface"><QRCodeSVG value={ticket.identifier} size={190} level="M" includeMargin /></div><span>Scan this QR code at the gate</span></div><div className="ticket-route"><div><span>From</span><strong>{ticket.originStation.name}</strong></div><div className="route-arrow">→</div><div><span>To</span><strong>{ticket.destinationStation.name}</strong></div></div><div className="ticket-meta"><div><span>Fare</span><strong>{ticket.currency} {ticket.paidAmount}</strong></div><div><span>Issued</span><strong>{new Date(ticket.issuedAt).toLocaleString()}</strong></div><div><span>Valid until</span><strong>{new Date(ticket.expiresAt).toLocaleString()}</strong></div></div><p className="ticket-identifier">Ticket ID: <code>{ticket.identifier}</code></p></section><div className="ticket-actions">{ticket.status === "ISSUED" ? <a className="primary dashboard-cta" href={`/gate?ticketId=${ticket.id}`}>Proceed to entry gate</a> : null}{ticket.status === "IN_JOURNEY" ? <a className="primary dashboard-cta" href={`/exit-gate?ticketId=${ticket.id}`}>Proceed to exit gate</a> : null}<a className="text-link" href="/tickets">View all tickets</a></div></AppShell>;
}
