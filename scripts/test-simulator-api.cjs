// Build Core first, then: node scripts/test-simulator-api.cjs
// Uses local seeded PostgreSQL. All fixture writes are rolled back, including
// service COMMITs (translated to savepoint releases). No payment calls are made.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const core = path.resolve('apps/core-api');
require(require.resolve('dotenv', { paths: [core] })).config({ path: path.resolve('.env') });
const { Pool } = require(require.resolve('pg', { paths: [core] }));
require(require.resolve('reflect-metadata', { paths: [core] }));
const { TicketsService } = require('../apps/core-api/dist/tickets/tickets.service');
const { JourneysService } = require('../apps/core-api/dist/journeys/journeys.service');
const { GateService } = require('../apps/core-api/dist/gate/gate.service');
const { JourneysController } = require('../apps/core-api/dist/journeys/journeys.controller');

test('simulator PostgreSQL lifecycle (rollback-only fixtures)', async (t) => {
  const database = new Pool({ connectionString: process.env.CORE_DATABASE_URL, connectionTimeoutMillis: 5000 });
  const client = await database.connect();
  const services = [new TicketsService(), new JourneysService(), new GateService()];
  const [tickets, journeys, gates] = services;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    const proxy = {
      query: (sql, args) => client.query(sql === 'BEGIN' ? 'SAVEPOINT scan' : sql === 'COMMIT' ? 'RELEASE SAVEPOINT scan' : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT scan' : sql, args),
      release() {},
    };
    for (const service of services) { await service.pool.end(); service.pool = { query: (sql, args) => client.query(sql, args), connect: async () => proxy }; }
    const template = (await client.query('SELECT * FROM tickets LIMIT 1')).rows[0];
    assert.ok(template, 'Create one test ticket before running the database suite.');
    const routeStations = (await client.query("SELECT s.* FROM stations s WHERE s.is_active AND EXISTS (SELECT 1 FROM gates g WHERE g.station_id=s.id AND g.type='ENTRY' AND g.status='ACTIVE') AND EXISTS (SELECT 1 FROM gates g WHERE g.station_id=s.id AND g.type='EXIT' AND g.status='ACTIVE') ORDER BY line_order LIMIT 5")).rows;
    assert.equal(routeStations.length, 5, 'Seed at least five active stations and gates.');
    async function fixture(origin, destination, expired = false) {
      const id = randomUUID(), quote = randomUUID(), purchase = randomUUID();
      await client.query(`INSERT INTO fare_quotes SELECT (jsonb_populate_record(NULL::fare_quotes, to_jsonb(q) || jsonb_build_object('id',$1::text))).* FROM fare_quotes q JOIN purchases p ON p.fare_quote_id=q.id WHERE p.id=$2`, [quote, template.purchase_id]);
      await client.query(`INSERT INTO purchases SELECT (jsonb_populate_record(NULL::purchases, to_jsonb(p) || jsonb_build_object('id',$1::text,'fare_quote_id',$2::text,'origin_station_id',$3::text,'destination_station_id',$4::text))).* FROM purchases p WHERE p.id=$5`, [purchase, quote, origin.id, destination.id, template.purchase_id]);
      await client.query(`INSERT INTO tickets SELECT (jsonb_populate_record(NULL::tickets, to_jsonb(t) || $1::jsonb)).* FROM tickets t WHERE t.id=$2`, [JSON.stringify({ id, purchase_id: purchase, payment_id: randomUUID(), status: 'ISSUED', origin_station_id: origin.id, destination_station_id: destination.id, issued_at: new Date(Date.now()-3600000), expires_at: new Date(Date.now()+(expired ? -1000 : 3600000)) }), template.id]);
      return id;
    }
    const ticket = await fixture(routeStations[0], routeStations[3]);
    const reverse = await fixture(routeStations[3], routeStations[0]);
    const gate = async (station, kind) => (await client.query("SELECT id FROM gates WHERE station_id=$1 AND type=$2 AND status='ACTIVE' ORDER BY code LIMIT 1", [station.id, kind])).rows[0].id;
    const entryGate = await gate(routeStations[0], 'ENTRY');
    const exitGate = await gate(routeStations[2], 'EXIT');
    let journeyId;
    await t.test('Nest constructor metadata survives the build', () => assert.equal(Reflect.getMetadata('design:paramtypes', JourneysController)[0], JourneysService));
    await t.test('route is ordered in both directions and rejects another owner', async () => {
      for (const [id, expected] of [[ticket, routeStations.slice(0,4)], [reverse, routeStations.slice(0,4).reverse()]]) {
        const result = await tickets.route(template.user_id, id);
        assert.deepEqual(result.data.stations.map(s => s.id), expected.map(s => s.id));
        assert.ok(result.data.stations.every(s => s.gates.length >= 2));
      }
      await assert.rejects(tickets.route(randomUUID(), ticket), e => e.getStatus() === 404);
    });
    await t.test('wrong entry station leaves issued ticket unchanged', async () => {
      const result = await gates.validateEntry({ ticketIdentifier: ticket, gateId: await gate(routeStations[1], 'ENTRY') }, randomUUID());
      assert.equal(result.data.rejectionCode, 'WRONG_ORIGIN');
      assert.equal((await tickets.get(template.user_id, ticket)).data.ticket.status, 'ISSUED');
    });
    await t.test('entry and duplicate request create exactly one journey and event', async () => {
      const key = randomUUID();
      const request = { ticketIdentifier: ticket, gateId: entryGate };
      const first = await gates.validateEntry(request, key);
      const again = await gates.validateEntry(request, key);
      assert.equal(first.data.decision, 'ALLOW');
      assert.equal(again.data.decision, 'ALLOW');
      assert.equal(first.data.journey.id, again.data.journey.id);
      journeyId = first.data.journey.id;
      assert.equal((await tickets.get(template.user_id, ticket)).data.ticket.status, 'IN_JOURNEY');
      assert.equal((await client.query('SELECT count(*)::integer n FROM gate_events WHERE request_id=$1', [key])).rows[0].n, 1);
      await assert.rejects(gates.validateEntry({ ...request, ticketIdentifier: reverse }, key), e => e.getStatus() === 409);
      const active = await journeys.list(template.user_id, ticket, 'ACTIVE');
      assert.equal(active.data.journeys.length, 1);
      await assert.rejects(journeys.get(randomUUID(), journeyId), e => e.getStatus() === 404);
    });
    await t.test('origin and outside-route exits are rejected', async () => {
      for (const station of [routeStations[0], routeStations[4]]) {
        const result = await gates.validateExit({ ticketIdentifier: ticket, gateId: await gate(station, 'EXIT') }, randomUUID());
        assert.equal(result.data.rejectionCode, 'WRONG_DESTINATION');
      }
    });
    await t.test('intermediate exit completes both records, keeps fare and replays safely', async () => {
      const before = (await tickets.get(template.user_id, ticket)).data.ticket;
      const request = { ticketIdentifier: ticket, gateId: exitGate }, key = randomUUID();
      const result = await gates.validateExit(request, key);
      assert.equal(result.data.decision, 'ALLOW');
      assert.equal((await gates.validateExit(request, key)).data.decision, 'ALLOW');
      const after = (await tickets.get(template.user_id, ticket)).data.ticket;
      assert.equal(after.status, 'COMPLETED');
      assert.equal(after.paidAmount, before.paidAmount);
      const completed = (await journeys.get(template.user_id, journeyId)).data.journey;
      assert.equal(completed.status, 'COMPLETED');
      assert.equal(completed.actualExitStation.id, routeStations[2].id);
      assert.ok(completed.enteredAt && completed.exitedAt);
    });
    await t.test('expired ticket is rejected', async () => {
      const expired = await fixture(routeStations[0], routeStations[3], true);
      assert.equal((await gates.validateEntry({ ticketIdentifier: expired, gateId: entryGate }, randomUUID())).data.rejectionCode, 'TICKET_EXPIRED');
    });
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await database.end();
  }
});
