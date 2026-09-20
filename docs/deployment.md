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
- Secrets live only in Wrangler secrets, Vercel environment variables and a folder outside the repository (below), never in git or in `NEXT_PUBLIC_*`.
- Only the DNS records for `sms` and `sms-api` are added; no other `inxapp.net` record is touched.
- The PostgreSQL deployment path stays available (`DATA_BACKEND=postgres`) but is not used here.

All `wrangler` commands run from `worker/` (`cd worker`) after `npm ci --prefix worker`. The commands are for bash (Git Bash on Windows).

## Phase 8: Cloudflare resources

### Status (19 Sep 2026): done, no production traffic yet

| Step | Result |
|---|---|
| 8.0 Account and zone | Account `b7fd79fc…87b2` owns the active zone `inxapp.net` |
| 8.1 D1 `inxapp-sms` (APAC) | `database_id` `c42f77c8-7337-4cab-956f-aa2689d844f7`. `0001_baseline.sql` applied: 9 tables, 28 indexes, 6 CHECK constraints, 11 foreign keys (enforced). `0002_rebrand_demo_emails.sql` follows in Phase 10 |
| 8.2 R2 `inxapp-sms-files` (APAC) | Private: r2.dev access disabled, no custom domain, no CORS configuration |
| 8.3 Secrets | Internal secret and demo password in `~/.inxapp-sms-deploy/`; the Worker holds the secret as `secret_text` |
| 8.4 Worker `inxapp-sms-api` | Version `8c727fd1-4dcc-435e-9c94-6d172165a73f`. Only at `https://sms-api.inxapp.net` (one proxied DNS record, valid certificate); `workers.dev` and preview URLs disabled; plain HTTP → 403 |
| 8.5 Demo data | 46 rows (bookmark right after the import: `00000009-0000000d-000050eb-9393fd4458f599199ceb9caf13eecd93`) and 6 PDFs, byte-identical in R2. Demo password from `~/.inxapp-sms-deploy/demo-password.txt` |
| 8.6 Smoke test | 16 of 16 passed. Afterwards: the same row counts, 4 published results, and exactly 6 R2 objects, one per submission |

**Other resources in the account:**
- **`pen_sms`:** a D1 database (`42bc3100…`, created 19 Sep 2026 17:42 UTC) that this deployment did not create and does not use.
- **`sms.inxapp.net`:** already points to Vercel (CNAME `….vercel-dns-017.com`), for Phase 9.

**Production CPU and latency (smoke test, 27 requests, all outcome `ok`):**

| Request | CPU | Wall time |
|---|---|---|
| `/health` | 6 – 7 ms | ~0.35 s |
| Sign-in lookup | 21 ms (first, cold), then 4 – 6 ms | ~0.17 s |
| Session, student list, marksheet | 3 – 5 ms | ~0.17 s |
| Dashboard view | 29 ms | 0.84 s |
| Grading view | 18 – 22 ms | 1.7 – 2.3 s |
| Publish a result | 7 – 11 ms | 0.5 – 0.7 s |
| Upload URL + upload (PUT) | 8 – 10 ms + 11 – 14 ms | 0.5 s + 1.6 s |
| Download URL + download | 5 – 6 ms + 5 ms | 0.3 s + 0.6 – 1.5 s |

- **CPU:** median 6 ms, maximum 29 ms. 7 of 27 requests were above the Workers Free 10 ms limit, and Cloudflare did not stop them. That is not guaranteed under real traffic; Workers Paid removes the risk.
- **Wall time:** each D1 query is a round trip to the database's primary (Osaka, KIX), so pages that run several queries take 1 – 2 s.

### 8.0 Pre-deployment checks

```sh
npx wrangler login              # browser sign-in; once per machine
npx wrangler whoami             # the account that owns the inxapp.net zone
npx wrangler r2 bucket list     # must list buckets, not "Please enable R2 through the Cloudflare Dashboard [code: 10042]"
```

Confirm:
- the account shows the **inxapp.net** zone (its nameservers are Cloudflare's: `gina`/`austin.ns.cloudflare.com`);
- **R2 is enabled** (dashboard → R2 Object Storage). Cloudflare may ask for a payment method even for the free tier;
- there are no DNS records for `sms` or `sms-api`, no `*.inxapp.net` wildcard, and no Worker routes or custom domains on the zone (checked 19 Sep 2026: none);
- the names `inxapp-sms`, `inxapp-sms-files` and `inxapp-sms-api` are free.

**Wrangler behaviours to know (4.135):**
- **`wrangler deploy` creates missing resources itself.** A missing R2 bucket would be created without a location hint. Always create D1 (8.1) and R2 (8.2) before deploying (8.4).
- **Without a terminal** (CI, scripts, AI agents), `wrangler deploy` replaces an existing DNS record or custom domain for the Worker's hostname without asking. Re-check `sms-api` right before deploying (8.4).
- **`d1 create` and `r2 bucket create` offer to edit `wrangler.jsonc`** ("Would you like Wrangler to add it on your behalf?"). Answer **No**: the ID goes into `env.production` by hand.
- **A deploy without `--env production`** targets the local Worker name `inxapp-sms-api-local` (no public URL, placeholder database), never production.

**Plan limits on Workers Free:**

| | Workers Free |
|---|---|
| Requests | 100,000 per day |
| CPU per request | 10 ms |
| Bundle | 3 MB gzipped (ours: 992 KiB) |
| D1 | 5 GB storage, 5 M rows read and 100,000 rows written per day |
| R2 | 10 GB storage |

**CPU risk.** Prisma's WebAssembly query engine uses CPU on every query and when it starts in a new isolate. Measured locally (an upper bound, because locally the Worker process also runs the database), the dashboard and grading views and the first request of an isolate are well above 10 ms; the sign-in lookup and session calls are close to it. Expect "exceeded CPU time limit" (error 1102) on some requests on Workers Free; **Workers Paid** ($5/month, 30 s of CPU per request) removes the limit. bcrypt already runs on Vercel for this reason.

### 8.1 D1 database

```sh
npx wrangler d1 create inxapp-sms --location apac      # answer No to the config prompt
```

Put the printed `database_id` into `env.production.d1_databases[0].database_id` in `worker/wrangler.jsonc`. It is an identifier, not a secret. The top-level `database_id` stays a placeholder: it only names the local database.

Apply the migrations (never `prisma migrate` against D1):

```sh
npx wrangler d1 migrations list DB --env production --remote     # the migrations still to be applied
npx wrangler d1 migrations apply DB --env production --remote
npx wrangler d1 migrations list DB --env production --remote     # no migrations to apply
```

Verify the schema (read-only):

```sh
npx wrangler d1 execute DB --env production --remote --command "SELECT type, name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_autoindex%' ORDER BY type, name"
npx wrangler d1 execute DB --env production --remote --command "SELECT name, sql FROM sqlite_master WHERE sql LIKE '%CHECK%'"
npx wrangler d1 execute DB --env production --remote --command "SELECT name, (length(sql) - length(replace(sql, 'FOREIGN KEY', ''))) / 11 AS foreign_keys FROM sqlite_master WHERE type = 'table' AND sql LIKE '%FOREIGN KEY%' ORDER BY name"
npx wrangler d1 execute DB --env production --remote --command "PRAGMA foreign_key_list('Payment')"
```

Expected:
- **Tables:** the 9 application tables plus `d1_migrations` (and any internal `_cf_*` tables D1 adds).
- **Indexes:** 28.
- **CHECK constraints:** in ProgrammeFee, StudentFee, Payment, Student and User.
- **Foreign keys:** 11.

### 8.2 R2 bucket (private)

```sh
npx wrangler r2 bucket create inxapp-sms-files --location apac   # answer No to the config prompt
npx wrangler r2 bucket dev-url get inxapp-sms-files             # must say public access through r2.dev is disabled
```

- **No public access:** do not enable the `r2.dev` URL and do not connect a custom domain to the bucket. The Worker reads and writes it through its binding only.
- **No CORS on the bucket:** browsers never talk to R2 directly.
- **No lifecycle rules:** a replaced file's previous version is deleted by the Worker.

### 8.3 Secrets, outside the repository

Two values are generated once and kept in `~/.inxapp-sms-deploy/`, a folder outside the repository. Each command refuses to overwrite an existing file and prints nothing:

```sh
mkdir -p ~/.inxapp-sms-deploy
# The Worker's internal secret, as a Wrangler secrets file (also set on Vercel in Phase 9):
node -e "const fs=require('fs'),f=process.argv[1];if(fs.existsSync(f))throw new Error(f+' exists');fs.writeFileSync(f,JSON.stringify({WORKER_INTERNAL_SECRET:require('crypto').randomBytes(32).toString('base64url')})+'\n',{mode:0o600})" ~/.inxapp-sms-deploy/worker-secrets.json
# The demo accounts' password (the public default Password123! is in this repository):
node -e "const fs=require('fs'),f=process.argv[1];if(fs.existsSync(f))throw new Error(f+' exists');fs.writeFileSync(f,require('crypto').randomBytes(12).toString('base64url')+'\n',{mode:0o600})" ~/.inxapp-sms-deploy/demo-password.txt
```

- **Kept only there:** never in git, never on a command line.
- **After Phase 9:** move both values into a password manager and delete the folder.
- **Rotation:** see [worker/API.md](../worker/API.md) (`WORKER_INTERNAL_SECRET_PREVIOUS`).

### 8.4 Deploy the Worker and its API hostname

Right before deploying, check that `sms-api` is still unused, because the deploy would replace an existing record without asking:
- **DNS:** `nslookup sms-api.inxapp.net 1.1.1.1` must return no address.
- **Dashboard:** `inxapp.net` → DNS has no `sms-api` record, and Workers & Pages lists no custom domain `sms-api.inxapp.net`.

```sh
npx wrangler deploy --env production --secrets-file ~/.inxapp-sms-deploy/worker-secrets.json
npx wrangler deployments list --env production
npx wrangler secret list --env production                 # WORKER_INTERNAL_SECRET (name only)
curl https://sms-api.inxapp.net/health                    # {"status":"ok","d1":"ok","schema":{"ok":true,…,"latestMigration":"…"},…}
```

This deploys `inxapp-sms-api` with its secret, the D1 and R2 bindings and `ALLOWED_ORIGINS=https://sms.inxapp.net`. Because of the custom domain `sms-api.inxapp.net`, Cloudflare creates **one** DNS record (`sms-api`, proxied) and its certificate; the certificate can take a few minutes.
- There is no `*.workers.dev` URL (`workers_dev: false`) and no preview URL.
- Nothing else in the zone changes.

### 8.5 Demo data (fictional, private password)

The showcase uses the demo data of `prisma/d1/seed.ts`: invented students whose addresses sit on the company’s own `sms.inxapp.net` subdomain. The people are fictional and no mailbox exists behind any of the addresses; no real student information is imported. On the public site every demo account uses the password from `~/.inxapp-sms-deploy/demo-password.txt`, not the public `Password123!`.

Prepare on the day it is applied (the dates are relative to that day):

```sh
cd ..    # repository root
node node_modules/tsx/dist/cli.mjs worker/scripts/prepare-remote-seed.ts --password-file ~/.inxapp-sms-deploy/demo-password.txt
# → worker/.wrangler/remote-seed/seed.sql (46 INSERTs), files/ (6 PDFs), r2-commands.txt (git-ignored)
cd worker
npx wrangler d1 execute DB --env production --remote --file .wrangler/remote-seed/seed.sql
# then run the 6 `npx wrangler r2 object put … --remote` lines in .wrangler/remote-seed/r2-commands.txt
rm -rf .wrangler/remote-seed        # it holds the demo accounts' bcrypt hashes
```

- **Nothing can be overwritten:** `seed.sql` is plain INSERTs. On a database that already has data it fails at the first row.
- **All or nothing:** Wrangler applies a remote file in one import. If it fails, the database returns to its previous state.
- **Staff account:** `registry@sms.inxapp.net`. Share the demo password only with the people the demo is meant for.

### 8.6 Smoke test (Worker directly, before any traffic)

```sh
cd ..    # repository root
WORKER_API_URL=https://sms-api.inxapp.net WORKER_INTERNAL_SECRET_FILE=~/.inxapp-sms-deploy/worker-secrets.json \
  node node_modules/tsx/dist/cli.mjs worker/scripts/smoke-remote.ts
```

**What it checks:**
- health, D1 and the schema;
- plain HTTP is refused (403);
- unsigned requests are refused;
- the sign-in lookup;
- the session from D1;
- a database read;
- authorization (403s);
- a database write;
- an R2 upload and download through signed URLs;
- another student is refused (404);
- CORS allows only `https://sms.inxapp.net`.

**Its only writes are put back:**
- **A result:** an already-published result is withheld and published again, so no withheld grade is ever shown.
- **A submission:** Farhana's Business Strategy submission is replaced by a test file and then by its original file again. Only its upload time changes.

**Admin endpoints:** none. The Worker exposes no administrative or test endpoints.

**CPU:** while it runs, watch `npx wrangler tail --env production --format json`. Every event's `outcome` must be `ok`, not `exceededCpu`; the dashboard shows CPU time per request under the Worker's Metrics.

## Phase 9: Vercel and sms.inxapp.net

(Filled in during Phase 9.)

## Phase 10: Rebrand to INX SMS (INXAPP Limited)

### Status (21 Sep 2026): done

| Step | Result |
|---|---|
| 10.1 Secrets folder | Renamed to `~/.inxapp-sms-deploy/`; the values are unchanged |
| 10.2 D1 addresses | `0002_rebrand_demo_emails.sql` applied (3 commands). 7 of 8 accounts moved to `@sms.inxapp.net`; row counts unchanged in every other table |
| 10.3 Worker | `inxapp-sms-api` version `01bddb8a-8c05-4310-a78d-02bd7c5fd961` |
| 10.4 Verify | Smoke test 16 of 16 passed; staff and student both sign in at `https://sms.inxapp.net` |

**What went wrong the first time:** Vercel was redeployed on its own. The Worker was still the
pre-rebrand build, so it rejected every token the new Vercel build signed and *no* account could
sign in — with the old addresses or the new ones. The Worker deploy is not optional, and it is the
half to do first: it restores sign-in on the old addresses even before the migration runs.

**One account is deliberately left alone:** `anik89bd@gmail.com`, a STUDENT enrolled through the
app, keeps its address. The migration only rewrites the two old demo suffixes, never a real mailbox.

The product was renamed from PEN SMS to **INX SMS**, an INXAPP Limited product, and the demo
accounts moved onto the company domain. No Cloudflare resource is created, renamed or deleted:
`inxapp-sms`, `inxapp-sms-api` and `inxapp-sms-files` already carried the company name.

**What changed that affects a running deployment:**

| Change | Consequence |
|---|---|
| Account addresses: `registry@pensms.test` → `registry@sms.inxapp.net`, `<first>.<last>@student.pensms.test` → `<first>.<last>@sms.inxapp.net` | Everyone signs in with a new address. Passwords, roles, ids and all other data are untouched |
| `prisma/d1/migrations/0002_rebrand_demo_emails.sql` | Rewrites the address suffixes in place. Idempotent, and a no-op on a database seeded after the rebrand |
| `ISSUER`, `AUDIENCE` and the HKDF salt in `src/lib/internal-auth/token.ts` (`pen-sms*` → `inx-sms*`) | **The signing key is derived from these.** The Worker and Vercel must run the same build, or every signed request fails with 401 |
| The secrets folder `~/.pen-sms-deploy/` → `~/.inxapp-sms-deploy/` | Rename it before running any command below. The secret values themselves do not change |

### 10.1 Rename the secrets folder

```sh
mv ~/.pen-sms-deploy ~/.inxapp-sms-deploy      # only once; the files inside are unchanged
ls ~/.inxapp-sms-deploy                        # worker-secrets.json  demo-password.txt
```

### 10.2 Apply the address migration

```sh
cd worker
npx wrangler d1 execute DB --env production --remote --command "SELECT email FROM \"User\" ORDER BY email"
npx wrangler d1 migrations list DB --env production --remote     # 0002_rebrand_demo_emails.sql to be applied
npx wrangler d1 migrations apply DB --env production --remote
npx wrangler d1 execute DB --env production --remote --command "SELECT email FROM \"User\" ORDER BY email"
```

The second listing must show seven `@sms.inxapp.net` addresses and no `pensms.test`. Row counts,
results, submissions and the R2 objects are untouched — the migration only rewrites `User.email`.

### 10.3 Deploy the Worker and Vercel together

The token constants changed, so a Worker built before the rebrand cannot verify a request signed by
a Vercel build after it, and the reverse. **Between the two deploys the site returns 401s.** Deploy
back to back, at a quiet time, and do not leave the window open:

```sh
# 1. Worker first — it is the faster of the two to roll back.
npx wrangler deploy --env production --secrets-file ~/.inxapp-sms-deploy/worker-secrets.json
# 2. Then redeploy the Next.js app on Vercel (Deployments → Redeploy, "Use existing Build Cache" off).
```

`WORKER_INTERNAL_SECRET` itself does not change, so nothing needs re-entering on Vercel.

**If the window goes wrong:** `npx wrangler rollback --env production` puts the previous Worker back,
which matches the Vercel build that is still live.

### 10.4 Verify

```sh
cd ..
WORKER_API_URL=https://sms-api.inxapp.net WORKER_INTERNAL_SECRET_FILE=~/.inxapp-sms-deploy/worker-secrets.json   node node_modules/tsx/dist/cli.mjs worker/scripts/smoke-remote.ts
```

All 16 checks must pass; the health check now expects `latestMigration` `0002_rebrand_demo_emails.sql`.
Then sign in at `https://sms.inxapp.net` as `registry@sms.inxapp.net` with the password from
`~/.inxapp-sms-deploy/demo-password.txt`, and confirm the INXAPP credit shows on the sign-in screen
and in the sidebar footer.

## Rollback

Every step can be undone without touching data:

| To undo | How |
|---|---|
| A bad Worker version | `npx wrangler rollback --env production` (previous version), or pick one from `npx wrangler deployments list --env production` and run `npx wrangler rollback <version-id> --env production -m "<reason>"` |
| Worker traffic | Remove the custom domain `sms-api.inxapp.net` in the dashboard (Workers & Pages → inxapp-sms-api → Settings → Domains & Routes). The Worker and data stay |
| A leaked internal secret | Deploy a new one with `--secrets-file` and set it on Vercel (rotation in [worker/API.md](../worker/API.md)) |
| D1 data | **Never** delete, reset or re-create the database. Export first: `npx wrangler d1 export DB --env production --remote --output backup-$(date +%F).sql` |
| R2 files | Leave the bucket in place; objects are only deleted when a submission is replaced |

**D1 Time Travel is a last resort**, only with the owner's explicit approval. `npx wrangler d1 time-travel restore DB --env production --timestamp <RFC 3339 time>` returns the whole database to that moment (within 30 days) and discards every later write. Rules:
1. Before any restore, run `npx wrangler d1 time-travel info DB --env production` and export the database (above).
2. The restore prints a bookmark for the state it replaced; keep it, because it undoes the restore (`--bookmark <it>`).
