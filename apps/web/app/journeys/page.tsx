"use client";

import { useEffect, useState } from "react";
import { AppShell } from "../app-shell";
import { getAccessToken, refreshAccessToken } from "../auth-client";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Journey = {
  id: string;
  ticketId: string;
  status: string;
  entryStation: { name: string };
  destinationStation: { name: string };
  actualExitStation?: { name: string } | null;
  enteredAt: string;
  exitedAt?: string | null;
  expiresAt: string;
};

export default function JourneysPage() {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [message, setMessage] = useState("Loading journeys...");

  useEffect(() => {
    async function load() {
      const token = getAccessToken() ?? await refreshAccessToken();
      if (!token) {
        setMessage("Your session has expired. Please sign in again.");
        return;
      }
      try {
        const response = await fetch(`${api}/api/v1/journeys`, {
          credentials: "include",
          headers: { authorization: `Bearer ${token}` },
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          setMessage(body.message ?? "Unable to load journey history.");
          return;
        }
        setJourneys(body.data?.journeys ?? []);
        setMessage("");
      } catch {
        setMessage("Unable to load journey history. Check your connection and retry.");
      }
    }
    void load();
  }, []);

  return (
    <AppShell eyebrow="MetroFlow">
      <h1 className="page-title">Journey history</h1>
      <p className="subtle page-description">Your active and completed journeys will appear here.</p>
      {message && <div className="feedback">{message}</div>}
      {!message && journeys.length === 0 && (
        <div className="dashboard-panel light-panel">
          <h2>No journeys yet</h2>
          <p className="subtle">Your journey will appear here after you validate entry at a station gate.</p>
          <a className="primary dashboard-cta" href="/journey/new">Plan a journey</a>
        </div>
      )}
      <div className="ticket-list">
        {journeys.map((journey) => (
          <a className="ticket-list-card" href={`/journeys/${journey.id}`} key={journey.id}>
            <div>
              <span className="eyebrow">{journey.status.replace("_", " ")}</span>
              <h2>{journey.entryStation.name} → {journey.actualExitStation?.name ?? journey.destinationStation.name}</h2>
              <p className="subtle">
                Destination: {journey.destinationStation.name} · Entered {new Date(journey.enteredAt).toLocaleString()}
              </p>
            </div>
            <span className="card-action">View journey ↗</span>
          </a>
        ))}
      </div>
    </AppShell>
  );
}
