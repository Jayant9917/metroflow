import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
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
  @Patch(":stationId/status")
  @UseGuards(RolesGuard)
  @Roles("OPERATOR")
  async setStationStatus(@Param("stationId") stationId: string, @Body() body: { isActive?: boolean }) {
    if (typeof body?.isActive !== "boolean") throw new Error("isActive must be boolean.");
    return { success: true, data: { station: await this.stations.setStationStatus(stationId, body.isActive) } };
  }
  @Patch("gates/:gateId/status")
  @UseGuards(RolesGuard)
  @Roles("OPERATOR")
  async setGateStatus(@Param("gateId") gateId: string, @Body() body: { status?: string }) {
    if (body?.status !== "ACTIVE" && body?.status !== "INACTIVE") throw new Error("status must be ACTIVE or INACTIVE.");
    return { success: true, data: { gate: await this.stations.setGateStatus(gateId, body.status) } };
  }
}
