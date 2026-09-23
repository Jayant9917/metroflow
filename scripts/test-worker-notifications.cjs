const worker = process.env.WORKER_URL ?? "http://localhost:3004";
 (async () => {
const health = await fetch(`${worker}/health`);
if (!health.ok) throw new Error(`Worker health failed: ${health.status}`);
const metrics = await fetch(`${worker}/metrics`);
if (!metrics.ok) throw new Error(`Worker metrics failed: ${metrics.status}`);
const body = await metrics.json();
const notifications = body.notifications;
for (const key of ["processed", "sent", "retried", "deadLettered"]) {
  if (!Number.isInteger(notifications?.[key]) || notifications[key] < 0) {
    throw new Error(`Invalid notification metric: ${key}`);
  }
}
console.log("Worker notification health passed.", notifications);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
