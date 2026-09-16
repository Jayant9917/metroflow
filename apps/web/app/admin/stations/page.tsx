"use client";
import { useEffect, useState } from "react";
import { AppShell } from "../../app-shell";
import { getAccessToken, refreshAccessToken } from "../../auth-client";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
type Gate = { id: string; code: string; type: string; status: string };
type Station = { id: string; code: string; name: string; lineOrder: number; isActive: boolean; gates: Gate[] };

export default function AdminStationsPage() {
  const [stations, setStations] = useState<Station[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { void (async () => {
    const token = getAccessToken() ?? (await refreshAccessToken());
    if (!token) return setError("Your operations session has expired.");
    const response = await fetch(`${api}/api/v1/stations/operations`, { credentials: "include", headers: { authorization: `Bearer ${token}` } });
    const body = await response.json();
    if (!response.ok) return setError(body.message ?? "Unable to load station operations.");
    setStations(body.data.stations);
  })().catch(() => setError("Unable to load station operations.")); }, []);
  return <AppShell eyebrow="Administration"><div className="admin-header"><div><span className="sim-kicker">OPERATIONS</span><h1 className="page-title">Stations and gates</h1><p>Review the ordered demo line and the physical gates available at each station.</p></div></div>{error ? <p className="admin-notice error">{error}</p> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Order</th><th>Station</th><th>Code</th><th>Gates</th><th>Status</th></tr></thead><tbody>{stations.map((station) => <tr key={station.id}><td>{station.lineOrder}</td><td><strong>{station.name}</strong></td><td>{station.code}</td><td>{station.gates.map((gate) => <span className="admin-tag" key={gate.id}>{gate.type} · {gate.code}</span>)}</td><td>{station.isActive ? "ACTIVE" : "INACTIVE"}</td></tr>)}</tbody></table></div>}</AppShell>;
}
