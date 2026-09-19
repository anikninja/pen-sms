# Cloudflare D1 schema (migration target)

**Status: preparation only.** Nothing in the application uses these files yet, and no D1 database has been created or migrated. The app runs on PostgreSQL until the D1 migration is proven.

| Purpose | Schema | Migrations | Applied with |
|---|---|---|---|
| **Current application (PostgreSQL)** | `prisma/schema.prisma` (the default in `prisma.config.ts`) | `prisma/migrations/` | `npm run db:deploy` (`prisma migrate deploy`) |
| **Cloudflare D1 (target)** | `prisma/d1/schema.prisma` | `prisma/d1/migrations/*.sql` | Wrangler, in a later phase |

Every Prisma command for D1 must pass `--schema prisma/d1/schema.prisma`. Without it, the CLI uses the PostgreSQL schema.

## Differences from the PostgreSQL schema

Everything else (models, fields, nullability, defaults, IDs, relations, cascade rules, unique constraints and indexes) is identical. The 28 index names and 11 foreign keys match the PostgreSQL migrations one for one.

| | PostgreSQL | D1 | Why |
|---|---|---|---|
| Datasource | `postgresql`, `url = env("DATABASE_URL")` | `sqlite`, no URL | D1 is reached through a Worker binding, not a connection string. Leaving out the URL also means no D1 command can pick up the PostgreSQL `DATABASE_URL`. |
| Generator | default output | `previewFeatures = ["driverAdapters"]`, output `node_modules/.prisma/client-d1` | Prisma 6.12 needs the preview flag for `@prisma/adapter-d1`. The separate output keeps the app's PostgreSQL client (`node_modules/.prisma/client`) untouched. |
| `ProgrammeFee.amount`, `StudentFee.amount`, `Payment.amount` | `Decimal @db.Decimal(12, 2)` | `BigInt` in **minor units** | See [Money](#money). |
| `Role`, `EnrolmentStatus` | Native enum types | Prisma enums stored as `TEXT`, plus CHECK constraints | SQLite has no enum types. The Prisma Client API is unchanged. |
| `User` role/student rule | `User_role_student_link_check` added with `ALTER TABLE` | The same CHECK, inline in `CREATE TABLE "User"` | SQLite cannot add constraints to an existing table. |
| `DateTime` columns | `TIMESTAMP(3)` | `DATETIME` | SQLite has no timestamp type. Prisma reads and writes the values itself. |

## Money

All three money columns hold an integer number of **minor units**, meaning 1/100 of the row's currency (paisa for BDT): `150000.00 BDT` is stored as `15000000`.

Why `BigInt` and not `Int`:
- **The amount limit.** The app accepts amounts up to `9_999_999_999.99` (`MAX_MONEY` in `src/lib/validations/common.ts`, matching `Decimal(12, 2)`). In minor units that is `999_999_999_999`, far above Prisma `Int` (32-bit, max `2_147_483_647`, about 21.4 million BDT). Using `Int` would silently lower the amount limit and could overflow sums.
- **Exactness.** `BigInt` is a SQLite 64-bit `INTEGER`, so storage and `SUM()` are exact integer arithmetic.
- **Safe in JavaScript.** Every allowed value is below `Number.MAX_SAFE_INTEGER` (about 9.0e15), so it survives D1's JavaScript number conversion.
- **Not floating point.** Floating-point storage (SQLite `DECIMAL`/`REAL`) was rejected.

The baseline's CHECK constraints (`*_amount_check`) make the database reject non-integer values and anything outside the `Decimal(12, 2)` range.

Impact on application code (Phase 3, not done yet):
- **Reading.** Prisma returns `bigint` for these fields, not `Prisma.Decimal`. `toFixed(2)` does not exist on `bigint`, so the TypeScript compiler will flag every use.
- **Writing.** Validated input is already a normalised `"150000.00"` string (`moneySchema`). Convert it exactly: `BigInt(whole) * 100n + BigInt(fraction)`. Never go through `Number`.
- **Output.** DTOs already carry money as strings. Format minor units back to `"150000.00"`. `bigint` cannot go through `JSON.stringify`, so convert before it crosses an API or Worker boundary.
- **Affected code.**
  - `src/lib/domain/fees.ts` (all functions take `Prisma.Decimal`)
  - `src/lib/services/fees.ts` (`aggregate`/`groupBy` `_sum`, `toFixed(2)`, `new Prisma.Decimal(...)`)
  - `src/lib/services/students.ts` (copies `tariff.amount` into `StudentFee`)
  - `src/lib/validations/common.ts` (`moneySchema` output)
  - `prisma/seed.ts` (string amounts)
  - `tests/domain/fees.test.ts`, `tests/domain/dates.test.ts` (`Prisma.Decimal`)
- **Data migration.** PostgreSQL `amount * 100` is exact for `NUMERIC(12,2)`. Cast it to `bigint` in the export query.

## Migrations

- `migrations/0001_baseline.sql` is the D1 equivalent of both PostgreSQL migrations. It was generated with `prisma migrate diff --from-empty`, and the lines marked `HAND-ADDED` were added by hand: 6 CHECK constraints the Prisma schema cannot express (3 money, 2 enum, 1 user role/student link).
- File names follow Wrangler's `NNNN_name.sql` convention, so this folder can be Wrangler's `migrations_dir` for the D1 database.
- The PostgreSQL migrations in `prisma/migrations/` are **not** reused and must not be applied to D1.
- **Later schema changes:**
  1. Edit `prisma/d1/schema.prisma` (and `prisma/schema.prisma` while both exist).
  2. Create an empty numbered file (`wrangler d1 migrations create`), then fill it with the diff from the local D1 database:
     ```sh
     npx prisma migrate diff --from-local-d1 --to-schema-datamodel prisma/d1/schema.prisma --script --output prisma/d1/migrations/000N_name.sql
     ```
  3. Review it. If Prisma rebuilds a table (SQLite's "redefine table" pattern), it drops that table's hand-added CHECK constraints, so put them back in the new `CREATE TABLE`.
- **Never** run `prisma migrate dev`, `migrate deploy`, `migrate reset` or `db push` with the D1 schema. `prisma.config.ts` points `migrations.path` at the PostgreSQL migrations.
- Use `--output` instead of shell redirection (`> file`). With `prisma.config.ts` present, the CLI prints "Loaded Prisma config…" to stdout, which would end up inside the SQL file.

## Commands

None of these connect to a database:

```sh
npx prisma validate --schema prisma/d1/schema.prisma     # check the D1 schema
npx prisma generate --schema prisma/d1/schema.prisma     # D1 client → node_modules/.prisma/client-d1
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/d1/schema.prisma --script --output <file>
```

`npm install` regenerates only the PostgreSQL client (the `postinstall` script). Re-run the `generate` command above when you need the D1 client.

## Runtime (later phase: Cloudflare Worker)

- Install `@prisma/adapter-d1` at the **same version as `prisma`/`@prisma/client`** (6.12.x).
- In the Worker, create the client per request from the binding: `new PrismaClient({ adapter: new PrismaD1(env.DB) })`. The `globalThis` singleton in `src/lib/prisma.ts` does not apply there.
- The generated client's Workers build is its `wasm` entry (`wasm.js` + `query_engine_bg.wasm`). In 6.12 the package root has no `workerd` export condition, so import the `wasm` entry explicitly.
- D1 has no interactive transactions, and the PostgreSQL-only SQL in `src/lib/services/students.ts` and `src/lib/services/fees.ts` does not run on SQLite. Both are Phase 3 work.
