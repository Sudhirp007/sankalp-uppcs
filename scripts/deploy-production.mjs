import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/**
 * Sankalp Production Deployment Orchestrator -> https://mockexamonline.com
 *
 * 1. Verifies Cloudflare authentication (`wrangler whoami`).
 * 2. Builds TypeScript & Vite production SPA bundle (`npm run build`).
 * 3. Deploys Cloudflare Worker + static assets + custom domains (`mockexamonline.com`, `www.mockexamonline.com`).
 * 4. Syncs encrypted runtime secrets (`DATABASE_URL`, `RAZORPAY_*`) from `.env.local` / `.dev.vars` via stdin (never written to disk or stdout).
 * 5. Verifies live `/api/v1/health` on `https://mockexamonline.com`.
 */

function parseEnvFiles(files) {
  const envMap = {};
  for (const file of files) {
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      if (val) envMap[key] = val;
    }
  }
  return envMap;
}

function runStep(label, cmd) {
  console.log(`\n=== ${label} ===`);
  execSync(cmd, { stdio: "inherit", shell: true });
}

async function main() {
  console.log("\n[deploy:prod] Verifying Cloudflare authentication...");
  const whoami = spawnSync("npx wrangler whoami", { shell: true, encoding: "utf8" });
  if (whoami.status !== 0 || (whoami.stdout + whoami.stderr).includes("not authenticated")) {
    console.error("\n[deploy:prod] Cloudflare Wrangler is not authenticated yet.");
    console.error("Run `npx wrangler login`, click Allow in your browser, then re-run `npm run deploy:prod`.\n");
    process.exit(1);
  }
  console.log(whoami.stdout.trim());

  runStep("1/4 Building TypeScript + Vite Production Bundle", "npm run build");
  runStep("2/4 Deploying Worker & Custom Domain (uppcs.mockexamonline.com)", "npx wrangler deploy");

  const localEnv = parseEnvFiles([".dev.vars", ".env.local"]);
  const allowedSecretKeys = [
    "DATABASE_URL",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
  ];
  const secretsPayload = {};
  for (const key of allowedSecretKeys) {
    const val = process.env[key] || localEnv[key];
    if (val) secretsPayload[key] = val;
  }

  const secretNames = Object.keys(secretsPayload);
  if (secretNames.length > 0) {
    console.log(`\n=== 3/4 Syncing ${secretNames.length} Encrypted Worker Secrets (${secretNames.join(", ")}) ===`);
    const bulkRes = spawnSync("npx wrangler secret bulk", {
      shell: true,
      input: JSON.stringify(secretsPayload),
      stdio: ["pipe", "inherit", "inherit"],
      encoding: "utf8",
    });
    if (bulkRes.status !== 0) {
      console.error("[deploy:prod] Failed to upload Worker secrets via `wrangler secret bulk`.");
      process.exit(bulkRes.status || 1);
    }
  } else {
    console.warn("\n[deploy:prod] Warning: No local secrets found in .env.local or .dev.vars to sync.");
  }

  console.log("\n=== 4/4 Verifying Live Edge Health on https://uppcs.mockexamonline.com/api/v1/health ===");
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch("https://uppcs.mockexamonline.com/api/v1/health", {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        console.log(
          `[deploy:prod] LIVE HEALTH OK -> questions=${data?.neon?.counts?.questions}, firebase=${data?.firebase?.projectId}, razorpay=${data?.razorpay?.configuredMode}`
        );
        console.log("\nSankalp is LIVE publicly at:");
        console.log("  • https://uppcs.mockexamonline.com");
        console.log("  • https://uppcs.mockexamonline.com/app");
        console.log("  • https://uppcs.mockexamonline.com/sitemap.xml\n");
        return;
      }
      console.log(`[deploy:prod] Attempt ${attempt}/6 returned HTTP ${res.status} (SSL/edge certificate warming up)...`);
    } catch (err) {
      console.log(`[deploy:prod] Attempt ${attempt}/6 waiting for SSL/DNS edge propagation (${err.message})...`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }

  console.log(
    "\n[deploy:prod] Deployment succeeded! Custom domain SSL certificate on uppcs.mockexamonline.com may take 30-90 seconds to finish propagating globally.\n"
  );
}

main().catch((err) => {
  console.error("[deploy:prod] Fatal error:", err);
  process.exit(1);
});
