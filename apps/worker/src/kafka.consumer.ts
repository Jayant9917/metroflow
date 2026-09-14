import { Kafka } from "kafkajs";
import Redis from "ioredis";
import { sendEmail } from "./email/resend.sender";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

const eventKey = (eventId: string) => `metroflow:email:event:${eventId}`;

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
          if (attempt === 3)
            await redis.del(eventKey(event.eventId));
          if (attempt === 3)
            console.error(
              JSON.stringify({ event: "email.failed", eventId: event.eventId }),
            );
        }
      }
      if (lastError) throw lastError;
    },
  });
}
