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
@Controller()
class HealthController {
  @Get("health") health() {
    return { status: "ok", service: "core-api" };
  }
}
@Module({
  controllers: [HealthController, AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
})
class AppModule {}
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3002);
}
bootstrap();
