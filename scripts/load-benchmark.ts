import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const TARGET = process.env.BENCH_URL || "http://127.0.0.1:8787";

interface ScenarioResult {
  name: string;
  concurrency: number;
  totalRequests: number;
  succeeded: number;
  failed: number;
  rps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]! * 10) / 10;
}

async function runScenario(opts: {
  name: string;
  concurrency: number;
  totalRequests: number;
  makeRequest: (idx: number) => Promise<Response>;
}): Promise<ScenarioResult> {
  const latencies: number[] = [];
  let succeeded = 0;
  let failed = 0;
  let cursor = 0;

  // Warmup 3 requests so isolate & TLS pool are warm
  for (let w = 0; w < 3; w++) {
    const r = await opts.makeRequest(w);
    await r.arrayBuffer();
  }

  const wallStart = performance.now();

  const workers = Array.from({ length: opts.concurrency }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= opts.totalRequests) break;
      const t0 = performance.now();
      try {
        const res = await opts.makeRequest(idx);
        await res.arrayBuffer();
        const dt = performance.now() - t0;
        latencies.push(dt);
        if (res.status >= 200 && res.status < 400) {
          succeeded++;
        } else {
          failed++;
        }
      } catch {
        failed++;
        latencies.push(performance.now() - t0);
      }
    }
  });

  await Promise.all(workers);
  const wallSec = (performance.now() - wallStart) / 1000;
  latencies.sort((a, b) => a - b);

  return {
    name: opts.name,
    concurrency: opts.concurrency,
    totalRequests: opts.totalRequests,
    succeeded,
    failed,
    rps: Math.round((opts.totalRequests / wallSec) * 10) / 10,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
  };
}

async function main() {
  console.log(`\n=== Sankalp Controlled Concurrency & Load Benchmark (${TARGET}) ===\n`);

  // Pre-provision 1 shared benchmark guest user so DB read benchmarks don't spam new user rows
  const benchUser = `asp_bench_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await fetch(`${TARGET}/api/v1/bootstrap`, {
    headers: { "x-aspirant-id": benchUser },
  }).then((r) => r.arrayBuffer());

  const scenarios: ScenarioResult[] = [];

  // Scenario 1: 100 Concurrent Visitors hitting Edge SEO Homepage (/)
  scenarios.push(
    await runScenario({
      name: "Edge SEO Landing Page (GET /)",
      concurrency: 100,
      totalRequests: 400,
      makeRequest: () => fetch(`${TARGET}/`),
    })
  );

  // Scenario 2: 100 Concurrent Visitors hitting Cached Public Marketing Feed (/api/v1/public/home)
  scenarios.push(
    await runScenario({
      name: "Edge-Cached Public API (GET /api/v1/public/home)",
      concurrency: 100,
      totalRequests: 400,
      makeRequest: () =>
        fetch(`${TARGET}/api/v1/public/home?lang=EN`, {
          headers: { "x-aspirant-id": benchUser },
        }),
    })
  );

  // Scenario 3: 50 Concurrent Active Aspirants loading Live Neon Postgres Dashboard
  scenarios.push(
    await runScenario({
      name: "Live Neon DB Dashboard (GET /api/v1/journeys/uppcs-prelims/dashboard)",
      concurrency: 50,
      totalRequests: 150,
      makeRequest: () =>
        fetch(`${TARGET}/api/v1/journeys/uppcs-prelims/dashboard`, {
          headers: { "x-aspirant-id": benchUser },
        }),
    })
  );

  // Scenario 4: 100 Concurrent Active Aspirants hitting Live Neon Bootstrap
  scenarios.push(
    await runScenario({
      name: "Live Neon DB Bootstrap (GET /api/v1/bootstrap)",
      concurrency: 100,
      totalRequests: 200,
      makeRequest: () =>
        fetch(`${TARGET}/api/v1/bootstrap`, {
          headers: { "x-aspirant-id": benchUser },
        }),
    })
  );

  console.table(scenarios);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
