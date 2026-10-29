import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite. Everything runs against a disposable local SQLite file (.local-db/e2e.sqlite, the stand-in for Cloudflare D1, created
 * and filled by `npm run e2e:db`), never production data. Pictures go to the test storage bucket: AWS_ENDPOINT_URL_S3 comes from
 * .env.development.local (git-ignored). For the servers started below, Algolia / email / WhatsApp
 * credentials are blanked and TCS points at a local mock. Push notifications are tested against a local mock of
 * Google's OAuth + FCM endpoints (e2e/support/mock-fcm.mjs).
 *
 *   npm run test:e2e                         everything
 *   npx playwright test --project=api        server-side race / pricing / push tests
 *   npx playwright test --project=unit       pure logic
 *   npx playwright test --project=mobile-safari
 */
function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}

const root = process.cwd();
const base = parseEnvFile(path.join(root, ".env.local"));
const dev = parseEnvFile(path.join(root, ".env.development.local"));
const testEnv: Record<string, string> = { ...base, ...dev };

// `--project=unit` alone (what CI runs) never touches a database or starts a server, so it needs neither guard nor servers.
const unitOnly = process.env.E2E_UNIT_ONLY === "1" || (process.argv.some((arg) => arg === "--project=unit") && !process.argv.some((arg) => /^--project=(?!unit$)/.test(arg)));
// Playwright's worker processes load this file again without the command line – pass the decision on.
if (unitOnly) process.env.E2E_UNIT_ONLY = "1";

const E2E_DB = path.resolve(process.env.E2E_LOCAL_DB ?? ".local-db/e2e.sqlite");
// The suite writes to the database it is given (settings, categories, orders). It may only ever be the local SQLite file: refuse to start when a real
// D1 database is configured in this shell, and never talk to a server that was started by something else (see reuseExistingServer below).
if (!unitOnly && process.env.D1_HTTP_DATABASE_ID) {
  throw new Error("Refusing to run: D1_HTTP_DATABASE_ID is set in this shell, so the app under test could reach a real database. Unset it first.");
}
if (!unitOnly && !fs.existsSync(E2E_DB)) {
  throw new Error(`The test database ${E2E_DB} does not exist yet. Create it with: npm run e2e:db`);
}

// One RSA key pair per run: the app signs with the private half, the mock verifies with the public half.
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
// (each port can be moved with E2E_MOCK_FCM_PORT, so two people or two sessions can run the suite side by side)
const MOCK_PORT = Number(process.env.E2E_MOCK_FCM_PORT ?? 4010);
// (each port can be moved with E2E_MOCK_TCS_PORT, so two people or two sessions can run the suite side by side)
const TCS_PORT = Number(process.env.E2E_MOCK_TCS_PORT ?? 4011);
// (each port can be moved with E2E_APP_PORT, so two people or two sessions can run the suite side by side)
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
// (each port can be moved with E2E_PROD_PORT, so two people or two sessions can run the suite side by side)
const PROD_PORT = Number(process.env.E2E_PROD_PORT ?? 3200);

const serverEnv = {
  ...testEnv,
  // The app under test reads and writes this SQLite file instead of a Cloudflare D1 binding (see db/index.ts).
  LOCAL_DB_PATH: E2E_DB,
  D1_HTTP_DATABASE_ID: "", // never a real D1 database
  D1_STRICT: "1", // refuse statements D1 would refuse (more than 100 bound values)
  NEXT_PUBLIC_SITE_URL: `http://localhost:${APP_PORT}`,
  // Settings apply at once in tests (in production a save waits 5 minutes in a safety buffer).
  SETTINGS_BUFFER_SECONDS: "0",
  // No third-party side effects from tests.
  ALGOLIA_ADMIN_KEY: "",
  NEXT_PUBLIC_ALGOLIA_SEARCH_KEY: "",
  RESEND_API_KEY: "",
  RESEND_API_KEY_2: "",
  BREVO_API_KEY: "",
  GROQ_API_KEY: "",
  GROQ_API_KEY_2: "",
  GROQ_API_KEY_3: "",
  WHATSAPP_ACCESS_TOKEN: "",
  // TCS talks to the local mock below (never to the real courier).
  TCS_USERNAME: "tcs-user",
  TCS_PASSWORD: "tcs-pass",
  TCS_ACCOUNT_NO: "A1234",
  TCS_COST_CENTER_CODE: "CC-01",
  TCS_ENV: "",
  TCS_BASE_URL: `http://127.0.0.1:${TCS_PORT}`,
  TURNSTILE_SECRET_KEY: "",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
  NEXT_PUBLIC_SENTRY_DSN: "",
  // Push goes to the local mock.
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: "mock-project", client_email: "mock@mock-project.iam.gserviceaccount.com", private_key: privateKey }),
  FCM_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  GOOGLE_OAUTH_TOKEN_URL: `http://127.0.0.1:${MOCK_PORT}/token`,
  CRON_SECRET: testEnv.CRON_SECRET || "e2e-cron-secret",
  SALES_MEMO_MS: "0",
  // All browser tests come from one address; the real limit (8 a minute) would throttle them.
  CHECKOUT_RATE_MAX: "500",
};
// Expose to the test processes too.
// Test-process access to lib/* modules that import the db client (always the local test file).
if (!unitOnly) process.env.LOCAL_DB_PATH = E2E_DB;
process.env.E2E_BASE_URL = `http://localhost:${APP_PORT}`;
process.env.E2E_PROD_URL = `http://localhost:${PROD_PORT}`;
process.env.E2E_MOCK_FCM = `http://127.0.0.1:${MOCK_PORT}`;
process.env.E2E_MOCK_TCS = `http://127.0.0.1:${TCS_PORT}`;
process.env.E2E_S3_ENDPOINT = testEnv.AWS_ENDPOINT_URL_S3;
process.env.E2E_CRON_SECRET = serverEnv.CRON_SECRET;
process.env.E2E_ADMIN_EMAIL = testEnv.ADMIN_EMAIL || "admin@nureasmir.com";
process.env.E2E_ADMIN_PASSWORD = testEnv.ADMIN_INITIAL_PASSWORD || "";

const only = (project: string, device: Record<string, unknown>) => ({
  name: project,
  testDir: "./e2e/ui",
  testIgnore: ["**/pwa.spec.ts"],
  use: { baseURL: `http://localhost:${APP_PORT}`, ...device },
});

export default defineConfig({
  globalSetup: unitOnly ? undefined : "./e2e/support/global-setup.ts",
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "e2e/.artifacts",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure", video: "off", actionTimeout: 15_000, navigationTimeout: 45_000 },

  projects: [
    { name: "unit", testDir: "./e2e/unit", use: {} },
    { name: "api", testDir: "./e2e/api", use: { baseURL: `http://localhost:${APP_PORT}` } },

    // Desktop browsers
    only("chromium", devices["Desktop Chrome"]),
    only("firefox", devices["Desktop Firefox"]),
    only("webkit", devices["Desktop Safari"]),
    // Phones & tablet
    only("mobile-chrome", devices["Pixel 7"]),
    only("mobile-safari", devices["iPhone 14"]),
    only("small-android", { ...devices["Galaxy S9+"], viewport: { width: 360, height: 640 } }),
    only("tablet", devices["iPad Mini"]),

    // Production build only: service worker / cache behaviour.
    { name: "pwa", testDir: "./e2e/ui", testMatch: ["**/pwa.spec.ts"], use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PROD_PORT}`, serviceWorkers: "allow" } },
  ],

  webServer: unitOnly
    ? []
    : [
    {
      command: "node e2e/support/mock-tcs.mjs",
      url: `http://127.0.0.1:${TCS_PORT}/health`,
      reuseExistingServer: true,
      env: { MOCK_TCS_PORT: String(TCS_PORT) },
    },
    {
      command: "node e2e/support/mock-fcm.mjs",
      url: `http://127.0.0.1:${MOCK_PORT}/health`,
      reuseExistingServer: true,
      env: { MOCK_FCM_PORT: String(MOCK_PORT), MOCK_FCM_PUBLIC_KEY: publicKey },
    },
    {
      command: `npx next dev -p ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}/api/health`,
      // An already-running server on this port could be pointed at a real database, so it is only reused when you say so (E2E_REUSE_SERVER=1).
      reuseExistingServer: process.env.E2E_REUSE_SERVER === "1" && !process.env.CI,
      timeout: 180_000,
      env: serverEnv as Record<string, string>,
    },
    ...(process.env.E2E_PROD
      ? [
          {
            command: `npx next start -p ${PROD_PORT}`,
            url: `http://localhost:${PROD_PORT}/api/health`,
            reuseExistingServer: process.env.E2E_REUSE_SERVER === "1" && !process.env.CI,
            timeout: 120_000,
            env: { ...serverEnv, NEXT_DIST_DIR: ".next-prod", NODE_ENV: "production", ALLOW_INSECURE_HTTP: "1" } as Record<string, string>,
          },
        ]
      : []),
  ],
});
