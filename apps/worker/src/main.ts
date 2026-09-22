import "reflect-metadata";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { config } from "dotenv";
import { resolve } from "node:path";
import { notificationMetrics, startEmailConsumer } from "./kafka.consumer";
config({ path: resolve(__dirname, "../../../.env") });
@Controller()
class HealthController {
  @Get("health") health() {
    return { status: "ok", service: "worker" };
  }
  @Get("metrics") metrics() {
    return { service: "worker", notifications: notificationMetrics };
  }
}
@Module({ controllers: [HealthController] })
class AppModule {}
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3004);
  await startEmailConsumer();
}
bootstrap();
