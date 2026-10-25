# Moving Nure Asmir to Cloudflare (Workers + D1): cutover runbook

Everything below can be rehearsed on the `*.workers.dev` addresses before the real domain is touched. Vercel and the old Neon database stay as they are until the end,
so going back is always possible.

## 0. What you need once

| Need | Where |
| --- | --- |
| Cloudflare **Workers Paid** plan (about $5/month), strongly recommended | dash.cloudflare.com -> Workers & Pages -> Plans. The storefront bundle is about 2 MiB compressed, which fits the free plan's 3 MiB limit, but the free plan allows only 10 ms of CPU per request and rendering a shop page can exceed that (Cloudflare's 1102 error); the paid plan allows 30 s and also raises the D1 and request allowances. |
| A Cloudflare API token for GitHub Actions: Workers Scripts edit, Workers Routes edit, D1 edit, R2 edit, Account Settings read (and later Zone edit + DNS edit) | My Profile -> API Tokens -> Create; save it as the GitHub secret `CLOUDFLARE_API_TOKEN`, with `CLOUDFLARE_ACCOUNT_ID` = `50018d45c190768a55d57124618e5c07` |
| The old Neon database readable (free quota used up -> upgrade the Neon project for a day, or wait for 1 Nov) | console.neon.tech -> `nure-asmir-db` |

## 1. Rehearsal (nothing public changes)

1. `Actions -> Deploy to Cloudflare Workers -> Run workflow` (all four). It applies the D1 migrations to `nure-asmir-prod` and `nure-asmir-training`, builds and deploys the four Workers
   and checks `https://nure-asmir.<your-subdomain>.workers.dev/api/health`.
2. Copy the data (read-only on Neon):

   ```bash
   SOURCE_DATABASE_URL="<Neon production connection string>" npx tsx scripts/neon-to-d1.ts --to-sql .local-db/import
   npx wrangler d1 execute nure-asmir-prod --remote --file .local-db/import/0001.sql   # then 0002.sql, 0003.sql ... in order
   ```

   The script prints a row count and a checksum for every table (`copy-report.json`). Compare them with `select count(*)` on D1.
3. Training lab data: `D1_HTTP_DATABASE_ID=<training id> TRAINING_D1_DATABASE_ID=<same id> ADMIN_EMAIL=practice@nureasmir.com ADMIN_INITIAL_PASSWORD=<anything> npx tsx scripts/sandbox-setup.ts`
4. Click through on the workers.dev address: browse the shop, add to bag, place a cash-on-delivery test order, sign in to admin (`nure-asmir-admin`), edit a product and see it on the shop, upload a picture,
   open the price-on-request flow, sign in to the training lab.

## 2. Cutover (about 30 minutes)

1. In admin Settings turn on the top-bar note "Short maintenance" (optional) and stop taking orders: no new orders should arrive between the final copy and the DNS switch.
2. Run the data copy once more (it deletes and refills each table, so it is safe to repeat) and compare the checksums.
3. Add the zone: Cloudflare dashboard -> Add a domain -> `nureasmir.com` (Free plan). Recreate the records (mail records: Brevo `_domainkey`, `orders`, `rsend`, MX/SPF if any) - the field kit
   (`tools/field-kit`) lists the current Gcore records.
4. At domain.pk replace the nameservers with the two Cloudflare ones. Cloudflare creates the DNS records and certificates for the Workers' custom domains
   (`nureasmir.com`, `www`, `admin`, `developer`, `training`) when the Workers deploy with `routes` (already in the `wrangler*.jsonc` files).
5. Turn the `push: branches: [main]` trigger on in `.github/workflows/deploy-cloudflare.yml` so a merge to `main` deploys to Cloudflare.
6. Check the five addresses, place a real test order, sign in to admin.

## 3. After a quiet week

* Delete the Gcore zone.
* Delete (or keep read-only) the Vercel project and the Neon database. The Neon **storage buckets stay** (pictures).
* Run Actions -> "Retire Cloudflare Workers (one time)" only if old Workers with other names remain.

## Rolling back

Point the nameservers back at Gcore (the zone is untouched) and the last Vercel production deployment (still live, built from the code before this move) serves again; the old Neon database still has all data up to the freeze.
