import { Kafka } from "kafkajs";
import Redis from "ioredis";
import { sendEmail } from "./email/resend.sender";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

const eventKey = (eventId: string) => `metroflow:email:event:${eventId}`;
const deadLetterKey = (eventId: string) => `metroflow:email:dead:${eventId}`;
export const notificationMetrics = { processed: 0, sent: 0, retried: 0, deadLettered: 0 };

export async function deliverWithRetry(
  event: { eventId: string; type?: string },
  sender: () => Promise<void>,
  store: { set: (...args: any[]) => Promise<unknown> },
  maxAttempts = 3,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sender();
      notificationMetrics.sent++;
      await store.set(eventKey(event.eventId), "sent", "EX", 604800);
      return { status: "sent" as const, attempts: attempt };
    } catch (error) {
      lastError = error;
      notificationMetrics.retried++;
      if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  notificationMetrics.deadLettered++;
  await store.set(deadLetterKey(event.eventId), JSON.stringify({ event, error: String(lastError) }), "EX", 604800);
  await store.set(eventKey(event.eventId), "dead", "EX", 604800);
  return { status: "dead" as const, attempts: maxAttempts };
}

export async function startEmailConsumer() {
  const kafka = new Kafka({
    clientId: "metroflow-worker",
    brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
  });
  const consumer = kafka.consumer({ groupId: "metroflow-email-worker" });
  await consumer.connect();
  await consumer.subscribe({
    topics: ["otp.requested", "password.reset.requested", "ticket.issued", "payment.succeeded", "payment.failed"],
    fromBeginning: false,
  });
  await redis.connect();
  await consumer.run({
    eachMessage: async ({ message }) => {
      const event = JSON.parse(message.value?.toString() ?? "{}");
      if (!event.eventId) return;
      notificationMetrics.processed++;

      const claimed = await redis.set(
        eventKey(event.eventId),
        "processing",
        "EX",
        86400,
        "NX",
      );
      if (!claimed) return;

      const result = await deliverWithRetry(event, () => sendEmail(event), redis);
      console.log(JSON.stringify({ event: result.status === "sent" ? "email.sent" : "email.failed", eventId: event.eventId, type: event.type, attempts: result.attempts }));
    },
  });
}
