import 'reflect-metadata'; import { Controller, Get, Module } from '@nestjs/common'; import { NestFactory } from '@nestjs/core';
@Controller() class HealthController { @Get('health') health() { return { status: 'ok', service: 'core-api' }; }  }
@Module({ controllers: [HealthController] }) class AppModule {}
async function bootstrap() { const app = await NestFactory.create(AppModule); await app.listen(process.env.PORT ? Number(process.env.PORT) : 3002); } bootstrap();
