import { Controller, Get, UseGuards } from "@nestjs/common";
import { Roles } from "../auth/auth.decorators";
import { RolesGuard } from "../auth/roles.guard";
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

  @Get("operations")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "OPERATOR")
  async operations() {
    return { success: true, data: { stations: await this.stations.listForOperations() } };
  }
}
