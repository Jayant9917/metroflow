import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import { Roles } from "../auth/auth.decorators";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { AdminOutboxService } from "./outbox.service";
import { AdminInconsistenciesService } from "./inconsistencies.service";
import { AdminAnalyticsService } from "./analytics.service";
import { AdminAuditService } from "./audit.service";

@Controller("api/v1/admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "OPERATOR")
export class AdminController {
  constructor(private readonly outbox: AdminOutboxService, private readonly inconsistencies: AdminInconsistenciesService, private readonly analytics: AdminAnalyticsService, private readonly audit: AdminAuditService) {}
  @Get("audit")
  @Roles("ADMIN")
  async auditEvents(@Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("action") action?: string, @Query("sortBy") sortBy?: string, @Query("sortDirection") sortDirection?: string) { const p = page ? Number(page) : 1, s = pageSize ? Number(pageSize) : 25; if (!Number.isInteger(p) || p < 1 || !Number.isInteger(s) || s < 1 || s > 100) throw new BadRequestException("Invalid pagination parameters."); if (action && !["STATION_STATUS_CHANGED", "GATE_STATUS_CHANGED"].includes(action)) throw new BadRequestException("Invalid audit action."); if (sortBy && !["createdAt", "action", "outcome", "email"].includes(sortBy)) throw new BadRequestException("Invalid audit sort field."); if (sortDirection && !["asc", "desc"].includes(sortDirection)) throw new BadRequestException("Invalid sort direction."); return { success: true, data: await this.audit.list(p, s, action, sortBy, sortDirection) }; }
  @Get("analytics")
  @Roles("ADMIN")
  async analyticsSummary() { return { success: true, data: { summary: await this.analytics.summary() } }; }
  @Get("outbox")
  @Roles("ADMIN")
  async outboxEvents() { return { success: true, data: { events: await this.outbox.list() } }; }
  @Get("inconsistencies")
  @Roles("ADMIN")
  async inconsistencyReport() { return { success: true, data: { issues: await this.inconsistencies.list() } }; }
}
