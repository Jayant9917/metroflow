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

export async function startEmailConsumer() {
  const kafka = new Kafka({
    clientId: "metroflow-worker",
    brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
  });
  const consumer = kafka.consumer({ groupId: "metroflow-email-worker" });
  await consumer.connect();
  await consumer.subscribe({
    topics: ["otp.requested", "password.reset.requested"],
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

      let lastError: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await sendEmail(event);
          notificationMetrics.sent++;
          await redis.set(eventKey(event.eventId), "sent", "EX", 604800);
          console.log(
            JSON.stringify({
              event: "email.sent",
              eventId: event.eventId,
              type: event.type,
            }),
          );
          break;
        } catch (error) {
          lastError = error;
          console.error(
            JSON.stringify({
              event: "email.retry",
              eventId: event.eventId,
              attempt,
              error: String(error),
            }),
          );
          notificationMetrics.retried++;
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
          if (attempt === 3)
            await redis.set(deadLetterKey(event.eventId), JSON.stringify({ event, error: String(error) }), "EX", 604800);
          if (attempt === 3)
            console.error(
              JSON.stringify({ event: "email.failed", eventId: event.eventId }),
            );
        }
      }
      if (lastError) { notificationMetrics.deadLettered++; await redis.set(eventKey(event.eventId), "dead", "EX", 604800); }
    },
  });
}
