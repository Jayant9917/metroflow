"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { GateRef, Journey as ContractJourney, RouteStation, Ticket } from "@metroflow/contracts";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../../../app-shell";
import { getAccessToken, refreshAccessToken } from "../../../auth-client";

type SimulatorState =
  | "LOADING_TICKET"
  | "READY_TO_ENTER"
  | "VALIDATING_ENTRY"
  | "BOARDING"
  | "IN_TRANSIT"
  | "SELECTING_EXIT"
  | "ARRIVED_AT_EXIT"
  | "VALIDATING_EXIT"
  | "EXITING"
  | "JOURNEY_COMPLETED"
  | "ERROR";
type Station = RouteStation;
type Gate = GateRef;
type Journey = Pick<ContractJourney, "id" | "status" | "enteredAt" | "expiresAt"> & {
  exitedAt?: string;
  actualExitStation?: { id: string; name: string } | null;
};
type Speed = "SLOW" | "NORMAL" | "FAST";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const durations: Record<Speed, number> = {
  SLOW: 5000,
  NORMAL: 1200,
  FAST: 300,
};
const rejectionMessages: Record<string, string> = {
  TICKET_NOT_FOUND: "Ticket not found. Please check your ticket.",
  TICKET_EXPIRED: "This ticket has expired and is no longer valid.",
  TICKET_ALREADY_IN_JOURNEY: "This ticket is already active on a journey.",
  TICKET_COMPLETED: "This ticket has already been used.",
  WRONG_ORIGIN: "This gate is not at your origin station.",
  WRONG_DESTINATION: "This station is outside your permitted route.",
  NO_ACTIVE_JOURNEY: "Enter through the origin gate before trying to exit.",
  JOURNEY_TIMED_OUT:
    "Your journey has timed out. Please contact station staff.",
  GATE_INACTIVE: "This gate is currently unavailable.",
};

type VisualCheckpoint = {
  trainIndex: number;
  selectedExit: number;
  updatedAt: number;
};

function checkpointKey(ticketId: string) {
  return `metroflow:journey-simulator:${ticketId}`;
}

function readCheckpoint(ticketId: string, routeLength: number) {
  try {
    const raw = window.sessionStorage.getItem(checkpointKey(ticketId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VisualCheckpoint>;
    if (!Number.isFinite(parsed.trainIndex) || !Number.isFinite(parsed.selectedExit)) return null;
    const last = Math.max(1, routeLength - 1);
    return {
      trainIndex: Math.min(last, Math.max(0, Math.floor(parsed.trainIndex!))),
      selectedExit: Math.min(last, Math.max(1, Math.floor(parsed.selectedExit!))),
    };
  } catch {
    return null;
  }
}

function clearCheckpoint(ticketId: string) {
  window.sessionStorage.removeItem(checkpointKey(ticketId));
}

async function read(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `API returned an unexpected response (${response.status}).`,
    );
  }
}

export default function JourneySimulatorPage() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const [state, setState] = useState<SimulatorState>("LOADING_TICKET");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [selectedExit, setSelectedExit] = useState(0);
  const [trainIndex, setTrainIndex] = useState(0);
  const [speed, setSpeed] = useState<Speed>("NORMAL");
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const retryState = useRef<SimulatorState>("READY_TO_ENTER");
  const [reload, setReload] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visualIndex, setVisualIndex] = useState(0);
  const scan = useRef<{ kind: string; gateId: string; key: string } | null>(
    null,
  );
  const busy = useRef(false);
  const journeyRefresh = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (state !== "BOARDING" && state !== "EXITING") return;
    const timer = window.setTimeout(
      () => setState(state === "BOARDING" ? "IN_TRANSIT" : "JOURNEY_COMPLETED"),
      reducedMotion ? 0 : 1500,
    );
    return () => window.clearTimeout(timer);
  }, [state, reducedMotion]);

  useEffect(() => {
    if (state !== "SELECTING_EXIT") return;
    if (trainIndex >= selectedExit) {
      setState("ARRIVED_AT_EXIT");
      return;
    }
    const target = reducedMotion ? selectedExit : trainIndex + 1;
    setVisualIndex(target);
    const timer = window.setTimeout(
      () => setTrainIndex(target),
      reducedMotion ? 0 : durations[speed] + 250,
    );
    return () => window.clearTimeout(timer);
  }, [state, trainIndex, selectedExit, speed, reducedMotion]);

  async function authGet(path: string) {
    const token = getAccessToken() ?? (await refreshAccessToken());
    let response = await fetch(`${api}${path}`, {
      credentials: "include",
      headers: { authorization: `Bearer ${token ?? ""}` },
    });
    if (response.status === 401) {
      const renewed = await refreshAccessToken();
      if (!renewed)
        throw new Error("Your session has expired. Please sign in again.");
      response = await fetch(`${api}${path}`, {
        credentials: "include",
        headers: { authorization: `Bearer ${renewed}` },
      });
    }
    const body = await read(response);
    if (!response.ok)
      throw new Error(body.message ?? "Unable to load journey.");
    return body;
  }
  useEffect(() => {
    let cancelled = false;
    setState("LOADING_TICKET");
    setTicket(null);
    setError(null);
    setTrainIndex(0);
    setVisualIndex(0);
    void (async () => {
      try {
        const [ticketBody, routeBody] = await Promise.all([
          authGet(`/api/v1/tickets/${ticketId}`),
          authGet(`/api/v1/tickets/${ticketId}/route`),
        ]);
        const loadedTicket = ticketBody.data.ticket as Ticket;
        const route = routeBody.data.stations as Station[];
        if (cancelled) return;
        if (
          route.length < 2 ||
          route[0].id !== loadedTicket.originStation.id ||
          route.at(-1)?.id !== loadedTicket.destinationStation.id
        )
          throw new Error(
            "This ticket has no complete active station route. Please contact station staff.",
          );
        setTicket(loadedTicket);
        setStations(route);
        const saved = readCheckpoint(ticketId, route.length);
        setSelectedExit(saved?.selectedExit ?? Math.max(1, route.length - 1));
        if (loadedTicket.status === "ISSUED") {
          if (Date.parse(loadedTicket.expiresAt) <= Date.now())
            throw new Error(rejectionMessages.TICKET_EXPIRED);
          setState("READY_TO_ENTER");
        } else {
          const status =
            loadedTicket.status === "COMPLETED" ? "COMPLETED" : "ACTIVE";
          const journeysBody = await authGet(
            `/api/v1/journeys?ticketId=${ticketId}&status=${status}`,
          );
          const loadedJourney = journeysBody.data.journeys[0] as
            Journey | undefined;
          if (cancelled) return;
          if (!loadedJourney)
            throw new Error(
              "No matching journey was found. Reload to reconcile your ticket.",
            );
          setJourney(loadedJourney ?? null);
          if (loadedTicket.status === "COMPLETED") {
            const actual = route.findIndex(
              (station) => station.id === loadedJourney.actualExitStation?.id,
            );
            if (actual < 1)
              throw new Error(
                "The recorded exit is unavailable on this route. Please view your journey history.",
              );
            setTrainIndex(actual);
            setVisualIndex(actual);
            setSelectedExit(actual);
            setState("JOURNEY_COMPLETED");
          } else if (loadedTicket.status === "IN_JOURNEY") {
            if (
              loadedJourney.status !== "ACTIVE" ||
              Date.parse(loadedJourney.expiresAt) <= Date.now()
            )
              throw new Error(rejectionMessages.JOURNEY_TIMED_OUT);
            setTrainIndex(saved?.trainIndex ?? 0);
            setVisualIndex(saved?.trainIndex ?? 0);
            setState("IN_TRANSIT");
          } else throw new Error("This ticket cannot start a journey.");
        }
      } catch (cause) {
        if (cancelled) return;
        setError({
          code: "LOAD_FAILED",
          message:
            cause instanceof Error
              ? cause.message
              : "Unable to load simulator.",
        });
        setState("ERROR");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticketId, reload]);

  useEffect(() => {
    if (
      !journey ||
      journey.status !== "ACTIVE" ||
      state === "VALIDATING_EXIT" ||
      state === "ERROR"
    )
      return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const body = await authGet(`/api/v1/journeys/${journey.id}`);
        if (cancelled) return;
        const latest = body.data.journey as Journey;
        if (latest.status === "COMPLETED") setReload((value) => value + 1);
        else if (
          latest.status === "TIMED_OUT" ||
          Date.parse(latest.expiresAt) <= Date.now()
        )
          fail("JOURNEY_TIMED_OUT");
      } catch {
        /* A failed read never changes the durable journey state. */
      }
    };
    journeyRefresh.current = refresh;
    const timer = window.setInterval(refresh, 5000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (journeyRefresh.current === refresh) journeyRefresh.current = null;
    };
  }, [journey?.id, journey?.status, state]);

  useEffect(() => {
    if (!ticketId || !ticket || ticket.status !== "IN_JOURNEY" || journey?.status !== "ACTIVE") return;
    window.sessionStorage.setItem(
      checkpointKey(ticketId),
      JSON.stringify({ trainIndex, selectedExit, updatedAt: Date.now() } satisfies VisualCheckpoint),
    );
  }, [ticketId, ticket?.status, journey?.status, trainIndex, selectedExit]);

  function fail(
    code: string,
    message?: string,
    previous: SimulatorState = "READY_TO_ENTER",
  ) {
    retryState.current = previous;
    setError({
      code,
      message:
        rejectionMessages[code] ??
        message ??
        "Something went wrong. Please try again.",
    });
    setState("ERROR");
  }
  async function validateGate(kind: "entry" | "exit", gateId: string) {
    if (
      !scan.current ||
      scan.current.kind !== kind ||
      scan.current.gateId !== gateId
    )
      scan.current = { kind, gateId, key: crypto.randomUUID() };
    const token = getAccessToken() ?? (await refreshAccessToken());
    const response = await fetch(`${api}/api/v1/gate/validate-${kind}`, {
      method: "POST",
      credentials: "include",
      headers: {
        authorization: `Bearer ${token ?? ""}`,
        "content-type": "application/json",
        "idempotency-key": scan.current.key,
      },
      body: JSON.stringify({ gateId, ticketIdentifier: ticket!.identifier }),
    });
    const body = await read(response);
    if (!response.ok)
      throw new Error(body.message ?? "Gate validation failed.");
    if (body.data.decision !== "ALLOW") {
      scan.current = null;
      fail(
        body.data.rejectionCode,
        body.data.message,
        kind === "entry" ? "READY_TO_ENTER" : "ARRIVED_AT_EXIT",
      );
      return null;
    }
    return body.data;
  }
  async function enter() {
    if (busy.current || state !== "READY_TO_ENTER") return;
    const gate = stations[0]?.gates.find(
      (item) => item.type === "ENTRY" && item.status === "ACTIVE",
    );
    if (!gate) return fail("GATE_INACTIVE", undefined, "READY_TO_ENTER");
    setError(null);
    setState("VALIDATING_ENTRY");
    busy.current = true;
    try {
      const data = await validateGate("entry", gate.id);
      if (!data) return;
      setJourney({
        id: data.journey.id,
        status: "ACTIVE",
        enteredAt: data.journey.entered_at,
        expiresAt: data.journey.expires_at,
      });
      setTicket((current) => current && { ...current, status: "IN_JOURNEY" });
      scan.current = null;
      setState("BOARDING");
    } catch (cause) {
      fail(
        "ENTRY_FAILED",
        cause instanceof Error ? cause.message : undefined,
        "READY_TO_ENTER",
      );
    } finally {
      busy.current = false;
    }
  }
  function travel() {
    if (state !== "IN_TRANSIT" || selectedExit < 1 || selectedExit < trainIndex)
      return;
    setState("SELECTING_EXIT");
  }
  async function exit() {
    if (
      busy.current ||
      state !== "ARRIVED_AT_EXIT" ||
      selectedExit !== trainIndex
    )
      return;
    const gate = stations[selectedExit]?.gates.find(
      (item) => item.type === "EXIT" && item.status === "ACTIVE",
    );
    if (!gate)
      return fail(
        "GATE_INACTIVE",
        "No active exit gate is available at this station.",
        "ARRIVED_AT_EXIT",
      );
    setError(null);
    setState("VALIDATING_EXIT");
    busy.current = true;
    try {
      const data = await validateGate("exit", gate.id);
      if (!data) return;
      setJourney((current) => ({
        ...(current ?? ({} as Journey)),
        id: data.journey.id,
        enteredAt: data.journey.entered_at,
        exitedAt: data.journey.exited_at,
        actualExitStation: {
          id: stations[selectedExit].id,
          name: stations[selectedExit].name,
        },
        status: "COMPLETED",
      }));
      setTicket((current) => current && { ...current, status: "COMPLETED" });
      clearCheckpoint(ticketId);
      scan.current = null;
      setState("EXITING");
    } catch (cause) {
      fail(
        "EXIT_FAILED",
        cause instanceof Error ? cause.message : undefined,
        "ARRIVED_AT_EXIT",
      );
    } finally {
      busy.current = false;
    }
  }

  const progress =
    stations.length > 1 ? (visualIndex / (stations.length - 1)) * 100 : 0;
  const current = stations[trainIndex];
  const next = stations[Math.min(trainIndex + 1, stations.length - 1)];
  const moving = state === "SELECTING_EXIT";
  const completedAt = journey?.exitedAt ? new Date(journey.exitedAt) : null;
  const duration = useMemo(
    () =>
      journey?.enteredAt && completedAt
        ? Math.max(
            1,
            Math.round(
              (completedAt.getTime() - new Date(journey.enteredAt).getTime()) /
                60000,
            ),
          )
        : null,
    [journey?.enteredAt, journey?.exitedAt],
  );
  if (!ticket || !stations.length)
    return (
      <AppShell eyebrow="Journey simulator">
        <div className="sim-loading">
          <span className="sim-spinner" />
          <h1>
            {state === "ERROR"
              ? "Unable to start simulator"
              : "Preparing your journey..."}
          </h1>
          {error ? <p>{error.message}</p> : null}
          {error && (
            <button onClick={() => setReload((value) => value + 1)}>
              Reload ticket
            </button>
          )}
          <Link href="/tickets">Back to tickets</Link>
        </div>
      </AppShell>
    );

  return (
    <AppShell eyebrow="Journey simulator">
      <div className="sim-header">
        <div>
          <h1 className="page-title">Your metro journey</h1>
          <p>
            Interactive passenger experience powered by the real ticket
            lifecycle.
          </p>
        </div>
        <span
          className={`sim-ticket-status status-${ticket.status.toLowerCase()}`}
        >
          {ticket.status.replace("_", " ")}
        </span>
      </div>
      <section className="sim-ticket">
        <div>
          <span>FROM</span>
          <strong>{ticket.originStation.name}</strong>
        </div>
        <b>→</b>
        <div>
          <span>TO</span>
          <strong>{ticket.destinationStation.name}</strong>
        </div>
        <div>
          <span>FARE PAID</span>
          <strong>
            {ticket.currency} {ticket.paidAmount}
          </strong>
        </div>
        <div>
          <span>VALID UNTIL</span>
          <strong>
            {new Date(ticket.expiresAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </strong>
        </div>
      </section>
      <section className="sim-map">
        <div className="sim-map-toolbar">
          <div>
            <span className="sim-live-dot" /> JOURNEY SIMULATION · NOT LIVE
            TRAIN TRACKING
          </div>
          <div className="sim-speeds">
            {(["SLOW", "NORMAL", "FAST"] as Speed[]).map((value) => (
              <button
                key={value}
                className={speed === value ? "active" : ""}
                aria-pressed={speed === value}
                onClick={() => setSpeed(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <div className="sim-map-scroll">
          <div
            className="sim-track"
            style={
              {
                "--station-count": stations.length,
                "--sim-progress": `${progress}%`,
              } as CSSProperties
            }
          >
            <div className="sim-line" />
            <div
              className="sim-line-passed"
              style={{ width: `${progress}%` }}
            />
            <div
              className={`sim-train ${moving ? "moving" : ""}`}
              style={
                {
                  left: `${progress}%`,
                  "--train-progress": `${progress}%`,
                  transitionDuration: `${reducedMotion ? 0 : durations[speed]}ms`,
                } as CSSProperties
              }
            >
              <span>🚇</span>
            </div>
            {stations.map((station, index) => (
              <button
                key={station.id}
                className={`sim-station ${index < trainIndex ? "passed" : ""} ${index === trainIndex ? "current" : ""} ${index === selectedExit ? "selected" : ""}`}
                style={
                  {
                    left: `${(index / (stations.length - 1)) * 100}%`,
                    "--station-progress": `${(index / (stations.length - 1)) * 100}%`,
                  } as CSSProperties
                }
                onClick={() => {
                  if (
                    ["IN_TRANSIT", "ARRIVED_AT_EXIT"].includes(state) &&
                    index > 0 &&
                    index >= trainIndex
                  ) {
                    setSelectedExit(index);
                    setState(
                      index === trainIndex ? "ARRIVED_AT_EXIT" : "IN_TRANSIT",
                    );
                  }
                }}
                disabled={
                  index === 0 ||
                  index < trainIndex ||
                  !["IN_TRANSIT", "ARRIVED_AT_EXIT"].includes(state)
                }
                aria-label={`${station.name}${index === 0 ? ", origin" : index === stations.length - 1 ? ", destination" : ""}${index === trainIndex ? ", current station" : index < trainIndex ? ", passed" : ", upcoming"}${index === selectedExit ? ", selected exit" : ""}`}
              >
                <span className="sim-station-dot">
                  {index < trainIndex ? "✓" : ""}
                </span>
                <small>
                  {station.name}
                  {index === 0
                    ? " (origin)"
                    : index === stations.length - 1
                      ? " (destination)"
                      : ""}
                </small>
              </button>
            ))}
          </div>
        </div>
      </section>
      <section className="sim-gates" aria-label="Station gates">
        {[
          { label: `Entry · ${stations[0].name}`, open: state === "BOARDING" },
          {
            label: `Exit · ${stations[selectedExit]?.name}`,
            open: state === "EXITING" || state === "JOURNEY_COMPLETED",
          },
        ].map((gate) => (
          <div key={gate.label}>
            <strong>{gate.label}</strong>
            <div
              className={`sim-barrier ${gate.open ? "open" : ""}`}
              aria-hidden="true"
            >
              <i />
              <b />
              <i />
            </div>
            <span>{gate.open ? "Access granted" : "Barrier closed"}</span>
          </div>
        ))}
      </section>
      <section className="sim-status-panel" aria-live="polite">
        {state === "READY_TO_ENTER" && (
          <>
            <div>
              <span className="sim-kicker">
                READY AT {stations[0].name.toUpperCase()}
              </span>
              <h2>Your train is waiting</h2>
              <p>Scan your digital ticket at the entry gate to board.</p>
            </div>
            <button className="sim-primary" onClick={enter}>
              Enter Metro →
            </button>
          </>
        )}
        {state === "VALIDATING_ENTRY" && (
          <div>
            <span className="sim-kicker amber">VALIDATING</span>
            <h2>Scanning your ticket...</h2>
            <p>The gate will open after the backend approves entry.</p>
          </div>
        )}
        {state === "BOARDING" && (
          <div>
            <span className="sim-kicker green">ACCESS GRANTED</span>
            <h2>Boarding your train...</h2>
            <p>The entry gate is open. Welcome aboard.</p>
          </div>
        )}
        {state === "IN_TRANSIT" && (
          <>
            <div>
              <span className="sim-kicker">JOURNEY ACTIVE</span>
              <h2>Currently at {current?.name}</h2>
              <p>
                Next station: {next?.name}. Choose where you want to leave the
                metro.
              </p>
              <label className="sim-exit-select">
                Exit at
                <select
                  name="exitStation"
                  value={selectedExit}
                  onChange={(event) =>
                    setSelectedExit(Number(event.target.value))
                  }
                >
                  {stations.slice(1).map((station, offset) => (
                    <option
                      key={station.id}
                      value={offset + 1}
                      disabled={offset + 1 < trainIndex}
                    >
                      {station.name}
                      {offset + 1 === stations.length - 1
                        ? " (destination)"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button className="sim-success" onClick={travel}>
              Travel to selected station
            </button>
          </>
        )}
        {state === "SELECTING_EXIT" && (
          <div>
            <span className="sim-kicker amber">TRAIN IN MOTION</span>
            <h2>Travelling to {stations[selectedExit]?.name}...</h2>
            <p>The train is passing through the stations on your route.</p>
          </div>
        )}
        {state === "ARRIVED_AT_EXIT" && (
          <>
            <div>
              <span className="sim-kicker green">ARRIVED</span>
              <h2>{stations[selectedExit]?.name}</h2>
              <p>The exit gate is ready for your ticket.</p>
            </div>
            <button className="sim-success" onClick={exit}>
              Exit Metro →
            </button>
          </>
        )}
        {state === "VALIDATING_EXIT" && (
          <div>
            <span className="sim-kicker amber">PROCESSING EXIT</span>
            <h2>Checking your active journey...</h2>
            <p>The exit gate will open only after approval.</p>
          </div>
        )}
        {state === "EXITING" && (
          <div>
            <span className="sim-kicker green">EXIT GRANTED</span>
            <h2>Journey completed</h2>
            <p>The exit gate is opening. Have a good journey.</p>
          </div>
        )}
        {state === "JOURNEY_COMPLETED" && (
          <div className="sim-complete">
            <span className="sim-complete-icon">✓</span>
            <div>
              <span className="sim-kicker green">JOURNEY COMPLETE</span>
              <h2>
                {ticket.originStation.name} →{" "}
                {journey?.actualExitStation?.name ??
                  ticket.destinationStation.name}
              </h2>
              <p>
                {journey?.enteredAt
                  ? `Entered ${new Date(journey.enteredAt).toLocaleTimeString()}`
                  : "Journey recorded"}
                {completedAt
                  ? ` · Exited ${completedAt.toLocaleTimeString()}`
                  : ""}
                {duration ? ` · ${duration} minutes` : ""} · Fare{" "}
                {ticket.currency} {ticket.paidAmount}
              </p>
              <div className="sim-complete-links">
                <Link href={`/tickets/${ticket.id}`}>View ticket</Link>
                <Link href="/dashboard">Back to dashboard</Link>
              </div>
            </div>
          </div>
        )}
        {state === "ERROR" && error && (
          <div className="sim-error">
            <div>
              <code>{error.code}</code>
              <h2>{error.message}</h2>
            </div>
            <button
              onClick={() => {
                setReload((value) => value + 1);
              }}
            >
              Reload and reconcile ticket
            </button>
          </div>
        )}
      </section>
    </AppShell>
  );
}
