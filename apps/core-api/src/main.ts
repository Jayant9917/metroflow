import "reflect-metadata";
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "../../../.env") });
import { Controller, Get, Module, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RolesGuard } from "./auth/roles.guard";
import { KafkaPublisher } from "./infrastructure/kafka.publisher";
import { StationsController } from "./stations/stations.controller";
import { StationsService } from "./stations/stations.service";
import { FareQuotesController } from "./fare-quotes/fare-quotes.controller";
import { FareQuotesService } from "./fare-quotes/fare-quotes.service";
import { PurchasesController } from "./purchases/purchases.controller";
import { PurchasesService } from "./purchases/purchases.service";
import { PaymentsController } from "./payments/payments.controller";
import { PaymentsService } from "./payments/payments.service";
import { TicketsController } from "./tickets/tickets.controller";
import { TicketsService } from "./tickets/tickets.service";
@Controller()
class HealthController {
  @Get("health") health() {
    return { status: "ok", service: "core-api" };
  }
}
@Module({
  controllers: [
    HealthController,
    AuthController,
    StationsController,
    FareQuotesController,
    PurchasesController,
    PaymentsController,
    TicketsController,
  ],
  providers: [
    AuthService,
    JwtAuthGuard,
    RolesGuard,
    KafkaPublisher,
    StationsService,
    FareQuotesService,
    PurchasesService,
    PaymentsService,
    TicketsService,
  ],
})
class AppModule {}
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3002);
}
bootstrap();
