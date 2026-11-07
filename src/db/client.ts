import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type AppDatabase = NeonHttpDatabase<typeof schema>;

/**
 * Pure Web/Edge-safe Neon HTTP driver for Cloudflare Workers (`@neondatabase/serverless`).
 * Reads `env.DATABASE_URL` from Worker bindings (`.dev.vars` locally / Cloudflare Secrets in prod)
 * with `process.env.DATABASE_URL` fallback under `nodejs_compat`.
 */
export function resolveDatabaseUrl(workerDatabaseUrl?: string): string {
  const candidate = workerDatabaseUrl || process.env?.DATABASE_URL;
  if (!candidate || candidate.trim().length === 0) {
    throw new Error(
      "Missing DATABASE_URL binding. Ensure .dev.vars (local) or Cloudflare Worker Secret (prod) defines DATABASE_URL."
    );
  }
  return candidate.trim();
}

export function createDb(workerDatabaseUrl?: string): AppDatabase {
  const connectionString = resolveDatabaseUrl(workerDatabaseUrl);
  const sql = neon(connectionString);
  return drizzle(sql, { schema });
}
