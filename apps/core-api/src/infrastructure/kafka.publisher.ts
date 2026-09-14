import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Kafka, Producer } from "kafkajs";
import { EmailEvent } from "./events";
@Injectable()
export class KafkaPublisher implements OnModuleDestroy {
  private readonly producer: Producer;
  private readonly connected: Promise<void>;
  constructor() {
    const kafka = new Kafka({
      clientId: "metroflow-core",
      brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
    });
    this.producer = kafka.producer();
    this.connected = this.producer.connect();
  }
  async publish(event: EmailEvent) {
    await this.connected;
    await this.producer.send({
      topic: event.type,
      messages: [{ key: event.eventId, value: JSON.stringify(event) }],
    });
  }
  async onModuleDestroy() {
    await this.connected;
    await this.producer.disconnect();
  }
}
