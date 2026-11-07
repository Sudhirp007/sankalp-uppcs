import { parseEnv } from "@neon/env";
import neonConfig from "../../neon";

/**
 * Node CLI helper using `@neon/env` + `neon.ts` service configuration
 * for migrations, Drizzle Kit, and seeding scripts.
 */
export function loadNodeNeonDatabaseUrl(): string {
  const { postgres } = parseEnv(neonConfig, ["DATABASE_URL"]);
  return postgres.databaseUrl;
}
