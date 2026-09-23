const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { deliverWithRetry, notificationMetrics } = require('../apps/worker/dist/kafka.consumer');

async function run() {
  const event = { eventId: randomUUID(), type: 'ticket.issued' };
  const stored = new Map();
  const store = { set: async (key, value) => stored.set(key, value) };
  let attempts = 0;
  const success = await deliverWithRetry(event, async () => {
    attempts++;
    if (attempts < 2) throw new Error('temporary provider failure');
  }, store);
  assert.deepEqual(success, { status: 'sent', attempts: 2 });
  assert.equal(stored.get(`metroflow:email:event:${event.eventId}`), 'sent');

  const deadEvent = { eventId: randomUUID(), type: 'payment.failed' };
  const dead = await deliverWithRetry(deadEvent, async () => { throw new Error('permanent provider failure'); }, store, 3);
  assert.deepEqual(dead, { status: 'dead', attempts: 3 });
  assert.equal(stored.get(`metroflow:email:event:${deadEvent.eventId}`), 'dead');
  assert.ok(stored.has(`metroflow:email:dead:${deadEvent.eventId}`));
  assert.ok(notificationMetrics.retried >= 4);
  assert.ok(notificationMetrics.deadLettered >= 1);
  console.log('Worker delivery tests passed: success, retry, and dead-letter handling.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
