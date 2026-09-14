import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import { AuthUser } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreateFareQuoteDto } from "./create-fare-quote.dto";
import { FareQuotesService } from "./fare-quotes.service";

@Controller("api/v1/fare-quotes")
@UseGuards(JwtAuthGuard)
export class FareQuotesController {
  constructor(private readonly fareQuotes: FareQuotesService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFareQuoteDto,
  ) {
    return this.fareQuotes.create(user.sub, dto);
  }
}
