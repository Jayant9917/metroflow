import { Controller, Get, UseGuards } from "@nestjs/common";
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
  async auditEvents() { return { success: true, data: { events: await this.audit.list() } }; }
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
