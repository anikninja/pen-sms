# INX SMS API Worker

The Cloudflare Worker that stands between the Next.js app and Cloudflare D1 (Prisma 6.12 with `@prisma/adapter-d1`) and the private R2 bucket of submission files.

- **Endpoints, access rules and the authentication design:** [API.md](API.md).
- **Schema, migrations and the D1 service layer it runs:** [../prisma/d1/README.md](../prisma/d1/README.md).

```
worker/
├── wrangler.jsonc        Worker config: D1 and R2 bindings, migrations dir (../prisma/d1/migrations), vars. No secrets
├── .dev.vars.example     Template for local secrets (copy to .dev.vars, which is git-ignored)
├── src/
│   ├── index.ts          Entry point
│   ├── app.ts            Route table and request pipeline (token → user → role → handler → errors)
│   ├── auth.ts           Internal-token verification and role checks (the trust boundary)
│   ├── db.ts             Per-request Prisma client over the D1 binding
│   ├── storage.ts        R2 object store and signed upload/download URLs
│   ├── http.ts, router.ts
│   └── routes/           Thin handlers: validate input, call ../src/lib/services/d1/*, shape JSON
├── scripts/seed-local.ts Seeds the local D1 (through the adapter) and the local R2 bucket
└── test/                 Integration tests against the real Worker (workerd + local D1)
```

The business logic is shared with the Next.js app in `../src/lib` (`domain`, `money`, `validations`, `services/shared`, `services/d1`). The Worker has its own `package.json`, so Wrangler and the D1 adapter are not installed on Vercel.

## Local development

Needs Node.js 22. Nothing here talks to Cloudflare or PostgreSQL.

```sh
npm ci                                  # repository root: the app and both Prisma clients
npm ci --prefix worker                  # Worker: wrangler, @prisma/adapter-d1

cp worker/.dev.vars.example worker/.dev.vars   # then set WORKER_INTERNAL_SECRET (≥ 32 random chars)

npm --prefix worker run db:migrate:local       # applies prisma/d1/migrations to the local D1 (worker/.wrangler)
npm --prefix worker run db:seed:local          # demo data through @prisma/adapter-d1, plus the seed PDFs in local R2
npm --prefix worker run dev                    # http://localhost:8787
curl http://localhost:8787/health
```

Every other endpoint needs a token signed with the same secret, which the Next.js app creates. The local R2 bucket lives in `worker/.wrangler/state` as well.

**To reset the local database and bucket**, stop `wrangler dev`, delete `worker/.wrangler/state`, then migrate and seed again.

## Checks

```sh
npm run test:worker                     # repository root: integration tests (each file starts its own Worker)
npm --prefix worker run typecheck       # Worker source (Workers types) and tests (Node types)
npm --prefix worker run build           # bundle into worker/dist without deploying (dry run)
npm run test:e2e:cloudflare             # repository root: Next.js → Worker → local D1/R2, end to end
```

The complete local workflow with Next.js, the end-to-end suite, consistency checks and performance numbers is in [docs/local-cloudflare.md](../docs/local-cloudflare.md).

## Size and CPU

- **Size:** the bundle is about 1 MB gzipped, most of it Prisma's query engine as WebAssembly. That is within the 3 MB limit of Workers Free.
- **CPU:** each request runs Prisma's wasm engine, whose CPU time per query is small but not zero. Workers Free allows about 10 ms of CPU per request. Measure in Phase 8, and consider Workers Paid if heavy pages exceed it.
- **bcrypt:** runs in Next.js, not here (see API.md).
