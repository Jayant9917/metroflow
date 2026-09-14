import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { StationsService } from "./stations.service";

@Controller("api/v1/stations")
@UseGuards(JwtAuthGuard)
export class StationsController {
  constructor(private readonly stations: StationsService) {}

  @Get()
  async list() {
    return {
      success: true,
      data: { stations: await this.stations.listActive() },
    };
  }
}
