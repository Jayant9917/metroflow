import "reflect-metadata"; import { Controller, Get, Module } from "@nestjs/common"; import { NestFactory } from "@nestjs/core";
import { config } from "dotenv"; import { resolve } from "node:path";
import { PaymentsController } from "./payments/payments.controller";
import { PaymentsService } from "./payments/payments.service";
import { RazorpayWebhookController } from "./payments/webhook.controller";
config({ path: resolve(__dirname, "../../../.env") });
@Controller() class HealthController { @Get('health') health() { return { status: 'ok', service: 'payment-service' }; }  }
@Module({ controllers: [HealthController, PaymentsController, RazorpayWebhookController], providers: [PaymentsService] }) class AppModule {}
async function bootstrap() { const app = await NestFactory.create(AppModule, { rawBody: true }); await app.listen(process.env.PORT ? Number(process.env.PORT) : 3003); } bootstrap();
