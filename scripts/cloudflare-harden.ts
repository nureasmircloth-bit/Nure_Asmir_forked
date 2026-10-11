// Applies the Nure Asmir Cloudflare configuration to a zone — everything here is available on the FREE plan.
//
//   CLOUDFLARE_API_TOKEN=... node ./node_modules/tsx/dist/cli.mjs scripts/cloudflare-harden.ts \
//     --zone <zone-id> [--security-only] [--cdn-host cdn.example.com] [--apply]
//
// Without --apply it only prints what it would send (dry run). The token needs, for the zone:
//   Zone Settings:Edit, Zone WAF:Edit, Cache Rules:Edit, Config Rules:Edit, Transform Rules:Edit,
//   Origin Rules (Zone:Rulesets:Edit), DNS:Edit, Bot Management:Edit (Zone:Zone Settings is enough on free).
//
// What it sets up
//   1. TLS/transport: Full (strict) SSL, Always-HTTPS, TLS >= 1.2 (1.3 on), HSTS (2 years like the app, no
//      subdomains/preload), automatic HTTPS rewrites, HTTP/3, Brotli, Early Hints.
//   2. Bot Fight Mode + Browser Integrity Check + security level "medium".
//   3. Custom WAF rules (free plan allows 5): block scanner paths, block empty-UA API calls,
//      managed-challenge the admin login page and the training-lab entrance.
//   4. One rate-limit rule (free plan allows 1): burst limiter on the sign-in and training-lab entrance, OTP, order creation, order
//      lookups (track / cancel / refund), coupon checks and the newsletter form.
//   5. Cache rule: /cdn/* and the CDN host are cached for a year at the edge and in browsers.
//   6. Optional dedicated CDN hostname (--cdn-host): proxied DNS record -> Neon storage host, an
//      origin rule that rewrites Host/SNI, and a URL rewrite that prefixes the bucket name, so
//      images are served by Cloudflare straight from Neon without ever invoking the Worker.
//
// NOTE: the "entrypoint" rulesets below are replaced wholesale for their phase. On a zone that
// already has rules in these phases, review the dry-run output first.

const API = "https://api.cloudflare.com/client/v4";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const apply = process.argv.includes("--apply");
// --security-only: only the security parts (1 to 4: TLS, bot protection, WAF rules, rate limit). Caching rules and the image host are left alone.
const securityOnly = process.argv.includes("--security-only");
const zone = arg("zone");
const cdnHost = arg("cdn-host");
const token = process.env.CLOUDFLARE_API_TOKEN;
const mediaBucket = process.env.STORAGE_PUBLIC_BUCKET || "nure-asmir-media";

if (!zone) {
  console.error("Missing --zone <zone-id>");
  process.exit(1);
}
if (apply && !token) {
  console.error("CLOUDFLARE_API_TOKEN is required with --apply");
  process.exit(1);
}

async function cf(method: string, path: string, body?: unknown): Promise<unknown> {
  console.log(`${apply ? "→" : "(dry-run)"} ${method} ${path}${body ? ` ${JSON.stringify(body)}` : ""}`);
  if (!apply) return null;
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await response.json()) as { success: boolean; errors?: Array<{ code: number; message: string }>; result?: unknown };
  if (!json.success) {
    console.error(`  ✗ ${response.status}`, JSON.stringify(json.errors));
    return null;
  }
  console.log("  ✓");
  return json.result ?? null;
}

const replaceExisting = process.argv.includes("--replace-existing");

/** Each `phase()` call REPLACES every rule in that phase. Show what is there now and refuse to wipe
 * a non-empty phase unless --replace-existing is passed. */
async function existingRules(name: string): Promise<number> {
  if (!token) return 0;
  const response = await fetch(`${API}/zones/${zone}/rulesets/phases/${name}/entrypoint`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return 0; // 404 = no ruleset yet
  const json = (await response.json()) as { result?: { rules?: Array<{ description?: string }> } };
  const rules = json.result?.rules ?? [];
  if (rules.length) console.log(`  ! phase ${name} already has ${rules.length} rule(s): ${rules.map((r) => r.description ?? "(unnamed)").join("; ")}`);
  return rules.length;
}

const setting = (name: string, value: unknown) => cf("PATCH", `/zones/${zone}/settings/${name}`, { value });
const phase = async (name: string, rules: unknown[]) => {
  const present = await existingRules(name);
  if (present && apply && !replaceExisting) {
    console.error(`  ✗ skipped ${name}: it has ${present} existing rule(s). Re-run with --replace-existing to overwrite them.`);
    return null;
  }
  return cf("PUT", `/zones/${zone}/rulesets/phases/${name}/entrypoint`, { rules });
};

async function main() {
  console.log(`\n== ${apply ? "APPLYING" : "DRY RUN"} for zone ${zone} ==\n`);

  // 1. Transport security & performance
  await setting("ssl", "strict");
  await setting("always_use_https", "on");
  await setting("min_tls_version", "1.2");
  await setting("tls_1_3", "on");
  await setting("automatic_https_rewrites", "on");
  await setting("security_header", {
    strict_transport_security: { enabled: true, max_age: 63072000, include_subdomains: false, preload: false, nosniff: true },
  });
  await setting("http3", "off");
  await setting("brotli", "on");
  await setting("early_hints", "off");
  await setting("ipv6", "on");

  // 2. Bots / browser checks — kept off/low on the public storefront to prevent challenging
  // real customers on shared residential CGNAT IPs or mobile in-app webviews (Instagram, WhatsApp).
  await cf("PUT", `/zones/${zone}/bot_management`, { fight_mode: false });
  await setting("browser_check", "off");
  await setting("security_level", "essentially_off");
  await setting("challenge_ttl", 1800);

  // 3. Custom WAF rules
  await phase("http_request_firewall_custom", [
    {
      description: "Block scanner / CMS probe paths",
      expression:
        '(http.request.uri.path contains "/wp-admin") or (http.request.uri.path contains "/wp-login") or (http.request.uri.path contains "/wp-content") or (http.request.uri.path contains "/xmlrpc.php") or (http.request.uri.path contains "/.env") or (http.request.uri.path contains "/.git") or (http.request.uri.path contains "phpmyadmin")',
      action: "block",
    },
    {
      description: "Block API calls without a user agent",
      expression: '(starts_with(http.request.uri.path, "/api/") and http.user_agent eq "")',
      action: "block",
    },
    {
      description: "Challenge the admin login page and the training-lab entrance",
      expression: '(http.request.uri.path in {"/admin/login" "/admin/training-login"})',
      action: "managed_challenge",
    },
  ]);

  // 4. Rate limiting (free plan: 1 rule, 10 s window / 10 s block)
  await phase("http_ratelimit", [
    {
      description: "Burst limiter: sign-in, training entrance, OTP, orders, order lookups, coupons, newsletter",
      expression:
        '(http.request.uri.path in {"/api/admin/login" "/api/admin/sandbox/enter" "/api/checkout/request-otp" "/api/checkout/verify-otp" "/api/checkout/validate-coupon" "/api/orders" "/api/orders/track" "/api/orders/cancel" "/api/orders/refund" "/api/newsletter"} and http.request.method eq "POST")',
      action: "block",
      ratelimit: { characteristics: ["cf.colo.id", "ip.src"], period: 10, requests_per_period: 6, mitigation_timeout: 10 },
    },
  ]);

  if (securityOnly) {
    console.log("--security-only: cache rules and the image host were left alone.");
    console.log(apply ? "\nDone." : "\nDry run complete — re-run with --apply to send these changes.");
    return;
  }

  // 5. Cache rules (media + HTML) – see 5b.
  const cdnMatch = cdnHost ? `(http.host eq "${cdnHost}") or ` : "";

  // 5b. Storefront HTML: cache at the edge exactly as long as Next.js says (ISR s-maxage / stale-while-
  // revalidate); dynamic and private responses carry no-store and stay uncached.
  await phase("http_request_cache_settings", [
    {
      description: "Cache product imagery for a year",
      expression: `${cdnMatch}starts_with(http.request.uri.path, "/cdn/")`,
      action: "set_cache_settings",
      action_parameters: {
        cache: true,
        edge_ttl: { mode: "override_origin", default: 31536000 },
        browser_ttl: { mode: "override_origin", default: 31536000 },
      },
    },
    {
      description: "Edge-cache storefront pages per Cache-Control",
      expression:
        '(http.request.method eq "GET") and not starts_with(http.request.uri.path, "/api/") and not starts_with(http.request.uri.path, "/admin") and not starts_with(http.request.uri.path, "/cart") and not starts_with(http.request.uri.path, "/checkout") and not starts_with(http.request.uri.path, "/track-order") and not starts_with(http.request.uri.path, "/wishlist") and not starts_with(http.request.uri.path, "/search")',
      action: "set_cache_settings",
      action_parameters: { cache: true, edge_ttl: { mode: "respect_origin" }, browser_ttl: { mode: "respect_origin" } },
    },
  ]);

  // 6. Optional dedicated CDN hostname in front of the Neon bucket
  if (cdnHost) {
    const endpoint = process.env.AWS_ENDPOINT_URL_S3;
    if (!endpoint) throw new Error("AWS_ENDPOINT_URL_S3 is required for --cdn-host");
    const neonHost = new URL(endpoint).host;
    const label = cdnHost.split(".")[0];

    await cf("POST", `/zones/${zone}/dns_records`, { type: "CNAME", name: label, content: neonHost, proxied: true, ttl: 1, comment: "Nure Asmir media CDN (Neon bucket origin)" });

    await phase("http_request_origin", [
      {
        description: "CDN host -> Neon storage origin",
        expression: `(http.host eq "${cdnHost}")`,
        action: "route",
        action_parameters: { host_header: neonHost, sni: { value: neonHost } },
      },
    ]);

    await phase("http_request_transform", [
      {
        description: "Prefix the bucket name onto CDN paths",
        expression: `(http.host eq "${cdnHost}")`,
        action: "rewrite",
        action_parameters: { uri: { path: { expression: `concat("/${mediaBucket}", http.request.uri.path)` } } },
      },
    ]);

    await phase("http_response_headers_transform", [
      {
        description: "CORS + nosniff for CDN responses",
        expression: `(http.host eq "${cdnHost}")`,
        action: "rewrite",
        action_parameters: {
          headers: {
            "X-Content-Type-Options": { operation: "set", value: "nosniff" },
          },
        },
      },
    ]);
    console.log(`\nSet NEXT_PUBLIC_CDN_URL=https://${cdnHost} and redeploy to switch images onto the dedicated host.`);
  }

  console.log(apply ? "\nDone." : "\nDry run complete — re-run with --apply to send these changes.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
