"use client";

import { useEffect, useState } from "react";
import { AppShell } from "../../app-shell";
import { getAccessToken, refreshAccessToken } from "../../auth-client";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function JourneyDetailPage({ params }: { params: Promise<{ journeyId: string }> }) {
  const [journey, setJourney] = useState<any>(null);
  const [message, setMessage] = useState("Loading journey...");

  useEffect(() => {
    async function load() {
      const token = getAccessToken() ?? await refreshAccessToken();
      if (!token) {
        setMessage("Your session has expired. Please sign in again.");
        return;
      }
      try {
        const resolvedParams = await params;
        const response = await fetch(`${api}/api/v1/journeys/${resolvedParams.journeyId}`, {
          credentials: "include",
          headers: { authorization: `Bearer ${token}` },
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          setMessage(body.message ?? "Journey not found.");
          return;
        }
        setJourney(body.data?.journey);
        setMessage("");
      } catch {
        setMessage("Unable to load journey details. Check your connection and retry.");
      }
    }
    void load();
  }, [params]);

  return (
    <AppShell eyebrow="Journey details">
      <a className="auth-link" href="/journeys">← Back to journey history</a>
      <h1 className="page-title">Journey details</h1>
      <p className="subtle page-description">Route progress and journey lifecycle details.</p>
      {message && <div className="feedback">{message}</div>}
      {journey && (
        <section className="dashboard-panel light-panel journey-detail-panel">
          <span className="eyebrow">{journey.status.replace("_", " ")}</span>
          <h2>{journey.entryStation.name} → {journey.actualExitStation?.name ?? journey.destinationStation.name}</h2>
          <p className="subtle">Ticket destination: {journey.destinationStation.name}</p>
          <div className="journey-detail-grid">
            <div><strong>Journey ID</strong><span>{journey.id}</span></div>
            <div><strong>Ticket ID</strong><span>{journey.ticketId}</span></div>
            <div><strong>Entered</strong><span>{new Date(journey.enteredAt).toLocaleString()}</span></div>
            <div><strong>Exited</strong><span>{journey.exitedAt ? new Date(journey.exitedAt).toLocaleString() : "Not exited yet"}</span></div>
            <div><strong>Entry gate</strong><span>{journey.entryGateId}</span></div>
            <div><strong>Exit gate</strong><span>{journey.exitGateId ?? "Not exited yet"}</span></div>
          </div>
        </section>
      )}
    </AppShell>
  );
}
