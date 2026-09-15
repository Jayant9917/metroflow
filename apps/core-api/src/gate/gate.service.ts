import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Pool } from "pg";
import { uuidv7 } from "uuidv7";

@Injectable()
export class GateService {
  private readonly pool = new Pool({ connectionString: process.env.CORE_DATABASE_URL });
  async listEntryGates() { const rows = (await this.pool.query(`SELECT g.id, g.code, s.code station_code, s.name station_name FROM gates g JOIN stations s ON s.id=g.station_id WHERE g.type='ENTRY' AND g.status='ACTIVE' ORDER BY s.name`)).rows; return { success: true, data: { gates: rows }, requestId: uuidv7() }; }
  async listExitGates() { const rows = (await this.pool.query(`SELECT g.id, g.code, s.code station_code, s.name station_name, ROW_NUMBER() OVER (ORDER BY s.created_at, s.id) - 1 station_order FROM gates g JOIN stations s ON s.id=g.station_id WHERE g.type='EXIT' AND g.status='ACTIVE' ORDER BY s.created_at, s.id`)).rows; return { success: true, data: { gates: rows }, requestId: uuidv7() }; }
  async validateEntry(dto: { gateId: string; ticketIdentifier: string }, requestId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const gate = (await client.query(`SELECT g.id gate_id, g.type, g.status, s.id station_id, s.code station_code, s.name station_name FROM gates g JOIN stations s ON s.id=g.station_id WHERE g.id=$1 FOR UPDATE`, [dto.gateId])).rows[0];
      const ticket = (await client.query(`SELECT t.*, o.code origin_code, o.name origin_name, d.code destination_code, d.name destination_name FROM tickets t JOIN stations o ON o.id=t.origin_station_id JOIN stations d ON d.id=t.destination_station_id WHERE t.id=$1 FOR UPDATE`, [dto.ticketIdentifier])).rows[0];
      let rejection: string | undefined;
      if (!gate || gate.status !== "ACTIVE" || gate.type !== "ENTRY") rejection = "GATE_INACTIVE";
      else if (!ticket) rejection = "TICKET_NOT_FOUND";
      else if (new Date(ticket.expires_at).getTime() <= Date.now()) rejection = "TICKET_EXPIRED";
      else if (ticket.status === "IN_JOURNEY") rejection = "TICKET_ALREADY_IN_JOURNEY";
      else if (ticket.status === "COMPLETED") rejection = "TICKET_COMPLETED";
      else if (ticket.origin_station_id !== gate.station_id) rejection = "WRONG_ORIGIN";
      if (rejection) {
        if (gate) await client.query(`INSERT INTO gate_events (id, gate_id, station_id, ticket_id, event_type, rejection_reason, request_id) VALUES ($1,$2,$3,$4,'ENTRY_REJECTED',$5,$6) ON CONFLICT (request_id) DO NOTHING`, [uuidv7(), gate.gate_id, gate.station_id, ticket?.id ?? null, rejection, requestId]);
        await client.query("COMMIT");
        return { success: true, data: { decision: "REJECT", rejectionCode: rejection, message: `Entry rejected: ${rejection.replaceAll("_", " ").toLowerCase()}.` }, requestId: uuidv7() };
      }
      const journey = (await client.query(`INSERT INTO journeys (id,ticket_id,user_id,entry_station_id,entry_gate_id,expires_at) VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '2 hours 30 minutes') RETURNING id, entered_at, expires_at`, [uuidv7(), ticket.id, ticket.user_id, gate.station_id, gate.gate_id])).rows[0];
      await client.query("UPDATE tickets SET status='IN_JOURNEY', updated_at=NOW() WHERE id=$1", [ticket.id]);
      await client.query(`INSERT INTO gate_events (id,gate_id,station_id,ticket_id,event_type,request_id) VALUES ($1,$2,$3,$4,'ENTRY_ACCEPTED',$5)`, [uuidv7(), gate.gate_id, gate.station_id, ticket.id, requestId]);
      await client.query("COMMIT");
      return { success: true, data: { decision: "ALLOW", ticket: { id: ticket.id, originStation: { code: ticket.origin_code, name: ticket.origin_name }, destinationStation: { code: ticket.destination_code, name: ticket.destination_name } }, journey }, requestId: uuidv7() };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async validateExit(dto: { gateId: string; ticketIdentifier: string }, requestId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const gate = (await client.query(`SELECT g.id gate_id, g.type, g.status, s.id station_id, s.name station_name FROM gates g JOIN stations s ON s.id=g.station_id WHERE g.id=$1 FOR UPDATE`, [dto.gateId])).rows[0];
      const ticket = (await client.query(`SELECT t.*, d.name destination_name FROM tickets t JOIN stations d ON d.id=t.destination_station_id WHERE t.id=$1 FOR UPDATE`, [dto.ticketIdentifier])).rows[0];
      const journey = ticket ? (await client.query(`SELECT * FROM journeys WHERE ticket_id=$1 FOR UPDATE`, [ticket.id])).rows[0] : null;
      let rejection: string | undefined;
      if (!gate || gate.status !== "ACTIVE" || gate.type !== "EXIT") rejection = "GATE_INACTIVE";
      else if (!ticket) rejection = "TICKET_NOT_FOUND";
      else if (ticket.status === "COMPLETED") rejection = "TICKET_COMPLETED";
      else if (!journey || journey.status !== "ACTIVE") rejection = journey?.status === "TIMED_OUT" ? "JOURNEY_TIMED_OUT" : "NO_ACTIVE_JOURNEY";
      else if (new Date(journey.expires_at).getTime() <= Date.now()) rejection = "JOURNEY_TIMED_OUT";
      else {
        const route = (await client.query(`SELECT id FROM stations WHERE is_active=TRUE ORDER BY created_at, id`)).rows.map((row) => row.id as string);
        const originIndex = route.indexOf(ticket.origin_station_id);
        const destinationIndex = route.indexOf(ticket.destination_station_id);
        const exitIndex = route.indexOf(gate.station_id);
        const onRoute = originIndex >= 0 && destinationIndex >= 0 && exitIndex >= 0 && exitIndex !== originIndex && ((originIndex < destinationIndex && exitIndex > originIndex && exitIndex <= destinationIndex) || (originIndex > destinationIndex && exitIndex < originIndex && exitIndex >= destinationIndex));
        if (!onRoute) rejection = "WRONG_DESTINATION";
      }
      if (rejection) {
        if (gate) await client.query(`INSERT INTO gate_events (id,gate_id,station_id,ticket_id,event_type,rejection_reason,request_id) VALUES ($1,$2,$3,$4,'EXIT_REJECTED',$5,$6) ON CONFLICT (request_id) DO NOTHING`, [uuidv7(), gate.gate_id, gate.station_id, ticket?.id ?? null, rejection, requestId]);
        await client.query("COMMIT");
        return { success: true, data: { decision: "REJECT", rejectionCode: rejection, message: `Exit rejected: ${rejection.replaceAll("_", " ").toLowerCase()}.` }, requestId: uuidv7() };
      }
      const completed = (await client.query(`UPDATE journeys SET status='COMPLETED', exit_station_id=$1, exit_gate_id=$2, exited_at=NOW(), updated_at=NOW() WHERE id=$3 RETURNING id, entered_at, exited_at`, [gate.station_id, gate.gate_id, journey.id])).rows[0];
      await client.query("UPDATE tickets SET status='COMPLETED', updated_at=NOW() WHERE id=$1", [ticket.id]);
      await client.query(`INSERT INTO gate_events (id,gate_id,station_id,ticket_id,event_type,request_id) VALUES ($1,$2,$3,$4,'EXIT_ACCEPTED',$5)`, [uuidv7(), gate.gate_id, gate.station_id, ticket.id, requestId]);
      await client.query("COMMIT");
      return { success: true, data: { decision: "ALLOW", message: "Exit allowed. Journey completed.", journey: completed }, requestId: uuidv7() };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
