# Deployment: sms.inxapp.net

```
https://sms.inxapp.net ──► Vercel (Next.js, DATA_BACKEND=worker)
                              │ HTTPS, signed requests
                              ▼
https://sms-api.inxapp.net ─► Cloudflare Worker "inxapp-sms-api"
                              ├─► D1 "inxapp-sms"          (data)
                              └─► R2 "inxapp-sms-files"    (private: submission files)
```

**Rules:**
- Every resource is new and dedicated to SMS.
- Secrets live only in Wrangler secrets and Vercel environment variables, never in git or in `NEXT_PUBLIC_*`.
- Only the DNS records for `sms` and `sms-api` are added; no other `inxapp.net` record is touched.
- The PostgreSQL deployment path stays available (`DATA_BACKEND=postgres`) but is not used here.

All `wrangler` commands run from `worker/` (`cd worker`) after `npm ci --prefix worker`.

## Phase 8: Cloudflare resources

### 8.0 Pre-deployment checks

```sh
npx wrangler login              # browser sign-in; once per machine
npx wrangler whoami             # the account that owns the inxapp.net zone
```

Confirm:
- the account shows the **inxapp.net** zone (its nameservers are Cloudflare's: `gina`/`austin.ns.cloudflare.com`);
- there are no existing records for `sms` or `sms-api` (checked 19 Sep 2026: none);
- the names `inxapp-sms`, `inxapp-sms-files` and `inxapp-sms-api` are free.

**Plan limits on Workers Free** (a demo usually fits):

| | Workers Free |
|---|---|
| Requests | 100,000 per day |
| CPU per request | 10 ms |
| Bundle | 3 MB gzipped (ours: about 1 MB) |
| D1 | 5 GB storage, 5 M rows read and 100,000 rows written per day |
| R2 | 10 GB storage |

Prisma's WebAssembly query engine uses CPU on every query. If requests fail with "exceeded CPU time limit" (error 1102), switch to **Workers Paid** ($5/month, 30 s of CPU per request). bcrypt already runs on Vercel for this reason.

### 8.1 D1 database

```sh
npx wrangler d1 create inxapp-sms --location apac      # prints the database_id
```

1. Put the printed `database_id` into `env.production.d1_databases[0].database_id` in `worker/wrangler.jsonc`. It is an identifier, not a secret.
2. Apply the migrations, locally first, then remotely:

```sh
npx wrangler d1 migrations apply DB --local
npx wrangler d1 migrations apply DB --env production --remote
npx wrangler d1 migrations list DB --env production --remote       # 0001_baseline.sql applied
```

Never use `prisma migrate` against D1. Verify the schema:

```sh
npx wrangler d1 execute DB --env production --remote --command "SELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY name"
npx wrangler d1 execute DB --env production --remote --command "SELECT sql FROM sqlite_master WHERE name IN ('Payment','User')"   # CHECK constraints present
npx wrangler d1 execute DB --env production --remote --command "PRAGMA foreign_key_list('Payment')"
```

### 8.2 R2 bucket (private)

```sh
npx wrangler r2 bucket create inxapp-sms-files --location apac
npx wrangler r2 bucket dev-url get inxapp-sms-files       # must say public access through r2.dev is disabled
```

- **No public access:** do not enable the `r2.dev` URL and do not connect a custom domain to the bucket. The Worker reads and writes it through its binding only.
- **No CORS on the bucket:** browsers never talk to R2 directly.
- **No lifecycle rules:** a replaced file's previous version is deleted by the Worker.

### 8.3 Worker secret

Use a new random value (32 bytes), set without echoing:

```sh
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler secret put WORKER_INTERNAL_SECRET --env production
```

The same value must be set on Vercel in Phase 9. Keep it in a password manager, never in a file in the repository.

### 8.4 Deploy the Worker and its API hostname

```sh
npx wrangler deploy --env production
```

This deploys `inxapp-sms-api` with the D1 and R2 bindings and `ALLOWED_ORIGINS=https://sms.inxapp.net`. Because of the custom domain `sms-api.inxapp.net`, Cloudflare creates **one** DNS record (`sms-api`, proxied) and its certificate.
- There is no `*.workers.dev` URL (`workers_dev: false`).
- Nothing else in the zone changes.

### 8.5 Demo data (safe, non-real)

The showcase uses the demo data of `prisma/d1/seed.ts`: fictional students, all with password `Password123!`. No real student information is imported.

```sh
cd ..    # repository root
node node_modules/tsx/dist/cli.mjs worker/scripts/prepare-remote-seed.ts
# → worker/.wrangler/remote-seed/seed.sql (46 INSERTs), files/ (6 PDFs), r2-commands.txt (git-ignored)
cd worker
npx wrangler d1 execute DB --env production --remote --file .wrangler/remote-seed/seed.sql
# then run the 6 `wrangler r2 object put … --remote` lines in .wrangler/remote-seed/r2-commands.txt
```

- **Why these steps:** the dates are generated relative to that day and stored in the adapter's format. The plain INSERTs fail on a database that already has data, so they can never overwrite anything.
- **Afterwards:** delete `worker/.wrangler/remote-seed`.
- **Demo passwords:** share them only with the people the demo is meant for.

### 8.6 Smoke test (Worker directly, before any traffic)

```sh
WORKER_API_URL=https://sms-api.inxapp.net WORKER_INTERNAL_SECRET=<the secret> \
  node node_modules/tsx/dist/cli.mjs worker/scripts/smoke-remote.ts
```

- **What it checks:** health; unsigned requests refused; the sign-in lookup; the session from D1; a database read; authorization (403s); a database write (a publish flag, put back); an R2 upload and download through signed URLs; another student refused (404); CORS limited to `https://sms.inxapp.net`.
- **Admin endpoints:** none; the Worker exposes no administrative or test endpoints.

To watch logs: `npx wrangler tail --env production`.

## Phase 9: Vercel and sms.inxapp.net

(Filled in during Phase 9.)

## Rollback

Every step can be undone without touching data:

| To undo | How |
|---|---|
| A bad Worker version | `npx wrangler rollback --env production` (previous deployment), or `npx wrangler deployments list --env production` to pick one |
| Worker traffic | Remove the custom domain `sms-api.inxapp.net` in the dashboard (Workers → inxapp-sms-api → Domains). The Worker and data stay |
| D1 data | **Never** delete or reset the database. Export first: `npx wrangler d1 export DB --env production --remote --output backup.sql`. D1 Time Travel restores to a point in the last 30 days: `npx wrangler d1 time-travel info DB --env production` / `restore` |
| R2 files | Leave the bucket in place; objects are only deleted when a submission is replaced |
