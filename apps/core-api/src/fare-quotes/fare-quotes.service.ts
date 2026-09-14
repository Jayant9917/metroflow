import {
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Pool } from "pg";
import { uuidv7 } from "uuidv7";
import { CreateFareQuoteDto } from "./create-fare-quote.dto";

@Injectable()
export class FareQuotesService {
  private readonly pool = new Pool({
    connectionString: process.env.CORE_DATABASE_URL,
  });

  async create(userId: string, dto: CreateFareQuoteDto) {
    if (dto.originStationId === dto.destinationStationId)
      throw new HttpException(
        {
          code: "SAME_ORIGIN_DESTINATION",
          message: "Origin and destination stations must be different.",
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

    const route = (
      await this.pool.query(
        `SELECT
           origin.id AS origin_id,
           origin.code AS origin_code,
           origin.name AS origin_name,
           destination.id AS destination_id,
           destination.code AS destination_code,
           destination.name AS destination_name,
           fare_rules.amount,
           fare_rules.currency
         FROM fare_rules
         JOIN stations origin ON origin.id = fare_rules.origin_station_id
         JOIN stations destination ON destination.id = fare_rules.destination_station_id
         WHERE fare_rules.origin_station_id = $1
           AND fare_rules.destination_station_id = $2
           AND origin.is_active = TRUE
           AND destination.is_active = TRUE
           AND fare_rules.is_active = TRUE
           AND fare_rules.valid_from <= NOW()
           AND (fare_rules.valid_until IS NULL OR fare_rules.valid_until > NOW())
         ORDER BY fare_rules.valid_from DESC
         LIMIT 1`,
        [dto.originStationId, dto.destinationStationId],
      )
    ).rows[0];

    if (!route)
      throw new HttpException(
        {
          code: "FARE_NOT_FOUND",
          message: "No fare is available for this journey.",
        },
        HttpStatus.NOT_FOUND,
      );

    const id = uuidv7();
    const quote = (
      await this.pool.query(
        `INSERT INTO fare_quotes
          (id, user_id, origin_station_id, destination_station_id, fare_rule_id, amount, currency, expires_at)
         SELECT $1, $2, $3, $4, id, $5, $6, NOW() + INTERVAL '10 minutes'
         FROM fare_rules
         WHERE origin_station_id = $3
           AND destination_station_id = $4
           AND is_active = TRUE
           AND valid_from <= NOW()
           AND (valid_until IS NULL OR valid_until > NOW())
         ORDER BY valid_from DESC
         LIMIT 1
         RETURNING id, amount, currency, expires_at`,
        [
          id,
          userId,
          dto.originStationId,
          dto.destinationStationId,
          route.amount,
          route.currency,
        ],
      )
    ).rows[0];

    return {
      success: true,
      data: {
        fareQuote: {
          id: quote.id,
          originStation: {
            id: route.origin_id,
            code: route.origin_code,
            name: route.origin_name,
          },
          destinationStation: {
            id: route.destination_id,
            code: route.destination_code,
            name: route.destination_name,
          },
          amount: quote.amount,
          currency: quote.currency,
          expiresAt: quote.expires_at,
        },
      },
    };
  }
}
