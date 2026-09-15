"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "../app-shell";
import { getAccessToken, refreshAccessToken } from "../auth-client";

type Gate = {
  id: string;
  code: string;
  station_name: string;
  station_order: number;
};
type Ticket = {
  identifier: string;
  status: string;
  originStation: { name: string };
  destinationStation: { name: string };
};
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
async function json(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `API returned an unexpected response (${response.status}).`,
    );
  }
}

export default function ExitGatePage() {
  const [ticketIdentifier, setTicketIdentifier] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [exitStation, setExitStation] = useState("");
  const [eligibleStations, setEligibleStations] = useState<string[]>([]);
  const [gates, setGates] = useState<Gate[]>([]);
  const [gateId, setGateId] = useState("");
  const [message, setMessage] = useState("");
  const [decision, setDecision] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const ticketId = new URLSearchParams(window.location.search).get(
      "ticketId",
    );
    if (!ticketId) {
      setMessage("Open this page from an active journey ticket.");
      return;
    }
    setTicketIdentifier(ticketId);
    void (async () => {
      const token = getAccessToken() ?? (await refreshAccessToken());
      const [ticketResponse, gatesResponse] = await Promise.all([
        fetch(`${api}/api/v1/tickets/${ticketId}`, {
          credentials: "include",
          headers: { authorization: `Bearer ${token ?? ""}` },
        }),
        fetch(`${api}/api/v1/gate/exit-gates`),
      ]);
      const ticketPayload = await json(ticketResponse);
      const gatesPayload = await json(gatesResponse);
      if (!ticketResponse.ok)
        throw new Error(ticketPayload.message ?? "Unable to load ticket.");
      if (!gatesResponse.ok)
        throw new Error(gatesPayload.message ?? "Unable to load exit gates.");
      const ticket = ticketPayload.data.ticket as Ticket;
      const allGates = gatesPayload.data.gates as Gate[];
      const originGate = allGates.find(
        (gate) => gate.station_name === ticket.originStation.name,
      );
      const destinationGate = allGates.find(
        (gate) => gate.station_name === ticket.destinationStation.name,
      );
      if (!originGate || !destinationGate)
        throw new Error("Unable to determine the ticket route.");
      const middleStations = [
        ...new Map(
          allGates
            .filter(
              (gate) =>
                gate.station_order >
                  Math.min(
                    originGate.station_order,
                    destinationGate.station_order,
                  ) &&
                gate.station_order <
                  Math.max(
                    originGate.station_order,
                    destinationGate.station_order,
                  ),
            )
            .map((gate) => [gate.station_name, gate]),
        ).values(),
      ];
      setEligibleStations([
        ...middleStations.map((gate) => gate.station_name),
        ticket.destinationStation.name,
      ]);
      setTicketIdentifier(ticket.identifier || ticketId);
      setOrigin(ticket.originStation.name);
      setDestination(ticket.destinationStation.name);
      setGates(allGates);
      if (middleStations[0]) setExitStation(middleStations[0].station_name);
      else setExitStation(ticket.destinationStation.name);
    })().catch((error: Error) => setMessage(error.message));
  }, []);
  useEffect(() => {
    const gate = gates.find((item) => item.station_name === exitStation);
    setGateId(gate?.id ?? "");
  }, [exitStation, gates]);
  async function validate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setDecision("");
    try {
      const token = getAccessToken() ?? await refreshAccessToken();
      const response = await fetch(`${api}/api/v1/gate/validate-exit`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token ?? ""}`,
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ gateId, ticketIdentifier }),
      });
      const payload = await json(response);
      if (!response.ok)
        throw new Error(payload.message ?? "Exit validation failed.");
      setDecision(payload.data.decision);
      setMessage(payload.data.message);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Exit validation failed.",
      );
    } finally {
      setLoading(false);
    }
  }
  const stationGates = gates.filter(
    (gate) => gate.station_name === exitStation,
  );
  return (
    <AppShell eyebrow="Gate simulator">
      <h1 className="page-title">Metro exit gate</h1>
      <p className="subtle page-description">
        Choose where you leave the metro, then present your ticket at that
        station.
      </p>
      <section
        className={`gate-scene ${decision === "ALLOW" ? "gate-open" : ""}`}
      >
        <div className="gate-scene-top">
          <div>
            <span className="gate-live-dot" /> LIVE EXIT SIMULATOR
          </div>
          <strong>{exitStation || "Metro station"}</strong>
        </div>
        <div className="gate-floor">
          <div className="gate-machine">
            <div className="gate-reader">
              <span>▣</span>
              <small>SCAN QR</small>
            </div>
            <div className="gate-pillar" />
            <div className="gate-arm gate-arm-left" />
            <div className="gate-arm gate-arm-right" />
          </div>
          <div className="gate-lane">
            <div className="gate-lane-light" />
            <span>{decision === "ALLOW" ? "EXIT OPEN" : "READY TO SCAN"}</span>
          </div>
        </div>
        <div
          className={`gate-status ${decision === "ALLOW" ? "gate-status-allow" : ""}`}
        >
          {decision === "ALLOW"
            ? "✓ Exit accepted — journey completed"
            : "Scan your ticket to leave the metro"}
        </div>
      </section>
      <form
        className="gate-console dashboard-panel light-panel"
        onSubmit={validate}
      >
        <div className="gate-console-title">
          <div>
            <span className="eyebrow">EXIT CONTROL PANEL</span>
            <h2>Complete journey</h2>
            <p className="gate-origin-note">
              Route: <strong>{origin || "Loading..."}</strong> →{" "}
              <strong>{destination || "Loading..."}</strong>
            </p>
          </div>
          <span
            className={`gate-state ${decision === "ALLOW" ? "allowed" : decision === "REJECT" ? "rejected" : ""}`}
          >
            {decision || "IDLE"}
          </span>
        </div>
        <div className="gate-fields">
          <label htmlFor="exit-station">
            Exit station
            <select
              id="exit-station"
              name="exitStation"
              value={exitStation}
              onChange={(event) => setExitStation(event.target.value)}
              required
            >
              {eligibleStations.map((station) => (
                <option key={station} value={station}>
                  {station}
                  {station === destination ? " (destination)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="exit-gate-id">
            Physical exit gate
            <select
              id="exit-gate-id"
              name="gateId"
              value={gateId}
              onChange={(event) => setGateId(event.target.value)}
              required
            >
              {stationGates.map((gate) => (
                <option key={gate.id} value={gate.id}>
                  {gate.code}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="exit-ticket-identifier">
            Ticket QR identifier
            <input
              id="exit-ticket-identifier"
              name="ticketIdentifier"
              value={ticketIdentifier}
              onChange={(event) => setTicketIdentifier(event.target.value)}
              required
            />
          </label>
        </div>
        {message ? (
          <div
            className={`feedback ${decision === "ALLOW" ? "success" : decision === "REJECT" ? "error" : ""}`}
          >
            {message}
          </div>
        ) : null}
        <div className="gate-actions">
          <button
            className="primary dashboard-cta"
            type="submit"
            disabled={loading || !gateId}
          >
            {loading ? "Reading ticket..." : "▣ Scan and exit"}
          </button>
          <Link href="/journeys">View journeys</Link>
        </div>
      </form>
    </AppShell>
  );
}
