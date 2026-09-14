import { config } from "dotenv";
import { resolve } from "node:path";
import { Pool } from "pg";
import { uuidv7 } from "uuidv7";

config({ path: resolve(__dirname, "../../../../.env") });

const stations = [
  { code: "RAJIV_CHOWK", name: "Rajiv Chowk" },
  { code: "KASHMERE_GATE", name: "Kashmere Gate" },
  { code: "CHANDNI_CHOWK", name: "Chandni Chowk" },
  { code: "HAUZ_KHAS", name: "Hauz Khas" },
  { code: "SAKET", name: "Saket" },
  { code: "VISHWAVIDYALAYA", name: "Vishwavidyalaya" },
  { code: "CIVIL_LINES", name: "Civil Lines" },
  { code: "VIDHAN_SABHA", name: "Vidhan Sabha" },
  { code: "MODEL_TOWN", name: "Model Town" },
  { code: "AZADPUR", name: "Azadpur" },
  { code: "SHALIMAR_BAGH", name: "Shalimar Bagh" },
  { code: "JAHANGIRPURI", name: "Jahangirpuri" },
  { code: "ADARSH_NAGAR", name: "Adarsh Nagar" },
  { code: "NETAJI_SUBHASH_PLACE", name: "Netaji Subhash Place" },
  { code: "KOHAT_ENCLAVE", name: "Kohat Enclave" },
  { code: "PITAMPURA", name: "Pitampura" },
  { code: "ROHINI_EAST", name: "Rohini East" },
  { code: "ROHINI_WEST", name: "Rohini West" },
  { code: "RITHALA", name: "Rithala" },
  { code: "KAROL_BAGH", name: "Karol Bagh" },
  { code: "JHANDEWALAN", name: "Jhandewalan" },
  { code: "RAJENDRA_PLACE", name: "Rajendra Place" },
  { code: "PATEL_NAGAR", name: "Patel Nagar" },
  { code: "SHADIPUR", name: "Shadipur" },
  { code: "MOTI_NAGAR", name: "Moti Nagar" },
  { code: "RAMESH_NAGAR", name: "Ramesh Nagar" },
  { code: "RAJOURI_GARDEN", name: "Rajouri Garden" },
  { code: "TAGORE_GARDEN", name: "Tagore Garden" },
  { code: "SUBHASH_NAGAR", name: "Subhash Nagar" },
  { code: "TILAK_NAGAR", name: "Tilak Nagar" },
  { code: "JANAKPURI_WEST", name: "Janakpuri West" },
  { code: "DABRI_MOR", name: "Dabri Mor" },
  { code: "DHAULA_KUAN", name: "Dhaula Kuan" },
  { code: "AIIMS", name: "AIIMS" },
  { code: "GREEN_PARK", name: "Green Park" },
];

// Development-only fare model. The real production fare matrix should be
// imported or managed through an admin workflow, then stored in fare_rules.
// This keeps local setup scalable when the station list grows to 90+ stations.
function fareForDistance(distance: number) {
  if (distance <= 1) return "20.00";
  if (distance <= 3) return "30.00";
  if (distance <= 5) return "40.00";
  if (distance <= 8) return "50.00";
  return "60.00";
}

async function main() {
  const connectionString = process.env.CORE_DATABASE_URL;
  if (!connectionString) throw new Error("CORE_DATABASE_URL is required");
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const stationIds = new Map<string, string>();

    for (const station of stations) {
      const result = await client.query(
        `INSERT INTO stations (id, code, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
         RETURNING id`,
        [uuidv7(), station.code, station.name],
      );
      stationIds.set(station.code, result.rows[0].id);

      await client.query(
        `INSERT INTO gates (id, station_id, code, type)
         VALUES ($1, $2, 'GATE-A', 'ENTRY'), ($3, $2, 'GATE-B', 'EXIT')
         ON CONFLICT (station_id, code) DO NOTHING`,
        [uuidv7(), result.rows[0].id, uuidv7()],
      );
    }

    let fareCount = 0;
    for (let originIndex = 0; originIndex < stations.length; originIndex++) {
      for (
        let destinationIndex = 0;
        destinationIndex < stations.length;
        destinationIndex++
      ) {
        if (originIndex === destinationIndex) continue;
        const originId = stationIds.get(stations[originIndex].code);
        const destinationId = stationIds.get(stations[destinationIndex].code);
        if (!originId || !destinationId) throw new Error("Seed station missing");

        await client.query(
          `INSERT INTO fare_rules
            (origin_station_id, destination_station_id, amount)
           SELECT $1, $2, $3
           WHERE NOT EXISTS (
             SELECT 1 FROM fare_rules
             WHERE origin_station_id = $1
               AND destination_station_id = $2
               AND is_active = TRUE
               AND valid_until IS NULL
           )`,
          [
            originId,
            destinationId,
            fareForDistance(Math.abs(originIndex - destinationIndex)),
          ],
        );
        fareCount++;
      }
    }

    await client.query("COMMIT");
    console.log(
      `Seeded ${stations.length} stations and ${fareCount} generated directional fare rules.`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error.message ?? error);
  process.exitCode = 1;
});
