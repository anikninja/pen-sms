# Cloudflare D1 schema and services (migration target)

**Status: preparation only.** The application still runs on PostgreSQL, and no D1 database has been created or migrated. This folder holds the D1 schema, its SQL migrations and its seed. `src/lib/services/d1/` holds D1 versions of the services whose PostgreSQL versions depend on PostgreSQL-only behaviour. Nothing in the app calls them yet.

| Purpose | Schema | Migrations | Services | Applied with |
|---|---|---|---|---|
| **Current application (PostgreSQL)** | `prisma/schema.prisma` (the default in `prisma.config.ts`) | `prisma/migrations/` | `src/lib/services/*.ts` | `npm run db:deploy` (`prisma migrate deploy`) |
| **Cloudflare D1 (target)** | `prisma/d1/schema.prisma` | `prisma/d1/migrations/*.sql` | `src/lib/services/d1/*.ts` | Wrangler, in a later phase |

Both service sets share one implementation of the business rules, DTOs and messages: `src/lib/domain/*`, `src/lib/money.ts` and `src/lib/services/shared/*`.

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
| `DateTime` columns | `TIMESTAMP(3)` | `DATETIME` | SQLite has no timestamp type. Prisma reads and writes the values itself. See [DateTime encoding](#datetime-encoding). |

## Money

All three money columns hold an integer number of **minor units**, meaning 1/100 of the row's currency (paisa for BDT): `150000.00 BDT` is stored as `15000000`. The field is still called `amount`.

Why `BigInt` and not `Int`:
- **The amount limit.** The largest amount is `9,999,999,999.99` (`MAX_AMOUNT_MINOR` in `src/lib/money.ts`, matching `Decimal(12, 2)`). In minor units that is `999_999_999_999`, far above Prisma `Int` (32-bit, max `2_147_483_647`, about 21.4 million BDT).
- **Exactness.** `BigInt` is a SQLite 64-bit `INTEGER`, so storage and `SUM()` are exact.
- **Safe on D1.** `@prisma/adapter-d1` passes Int64 values to D1 as JavaScript numbers and rejects unsafe ones. Every allowed amount is below `Number.MAX_SAFE_INTEGER`.

The baseline's CHECK constraints (`*_amount_check`) make the database reject non-integer values and anything outside the `Decimal(12, 2)` range.

How the code handles money:
- `src/lib/money.ts` holds exact conversions: `parseMoney("100.50") → 10050n`, `formatMoney(10050n) → "100.50"`, and `formatMoneyGrouped` for display. No floating point is used.
- `src/lib/domain/fees.ts` runs every fee rule on minor-unit `bigint`s.
- **PostgreSQL** keeps its `Decimal` columns. `src/lib/services/decimal.ts` is the explicit boundary (`fromDecimal` / `toDecimal`).
- **D1** reads and writes `bigint` directly.
- DTOs and the UI keep decimal strings (`"150000.00"`), so nothing visible changes. A `bigint` never reaches `JSON.stringify` or a client component.
- **Data migration.** PostgreSQL `amount * 100` is exact for `NUMERIC(12,2)`. Cast it to `bigint` in the export query.

## D1 service layer (`src/lib/services/d1/`)

What @prisma/adapter-d1 6.12 actually does, verified in its source:
- **Transactions.** *"implicit & explicit transactions will be ignored and run as individual queries"*. This covers `$transaction(async tx => …)`, `$transaction([…])`, nested writes and non-native upserts: none of them is atomic on D1. The `D1Client` type therefore has no `$transaction`, and a test checks that no D1 source file calls it.
- **Atomicity.** D1 runs statements one at a time, and each one is atomic. So every invariant is enforced inside a **single statement**:

| Operation | PostgreSQL | D1 |
|---|---|---|
| Student ID | Advisory lock, then `MAX(split_part(..)::int)` over IDs matching `~ '^SMS-<year>-[0-9]+$'` | The ID is computed inside the student `INSERT … SELECT` (MAX + 1 using `substr`/`GLOB`, same matching rule) |
| Enrolment (student + fee + login) | One transaction | Student row (atomic ID), then fee copied from the tariff in one `INSERT … SELECT`, then the login. If the fee or login step fails, a compensating `DELETE` of the student cascades away the fee. |
| Student update (student + login) | One transaction | Login first, then student. If the student update fails, the login is restored, but only if it still holds this request's values. |
| Payment | `FOR UPDATE`, then check, then insert | One conditional `INSERT … SELECT … WHERE amount ≤ fee − SUM(payments)` |
| Fee assignment | `FOR UPDATE`, then check, then upsert | One conditional `INSERT … SELECT … ON CONFLICT(studentId) DO UPDATE` ("fee ≥ paid" and the currency lock are checked in the statement) |
| Search | `mode: "insensitive"` | `contains` (SQLite `LIKE`, case-insensitive for ASCII). Programme code is compared case-insensitively in code. |
| Overdue list | `studentId IN (…all overdue ids…)` | Relation filter: no ID list, so no risk of hitting D1's 98-parameter limit |

When a conditional write writes nothing, the service reads the current state and applies the shared rules to report the same error message as PostgreSQL.

**Residual risk.** Compensation leaves a short window in which a student can exist without its fee or login. If the Worker is killed inside that window, a partial enrolment remains. Removing the window needs D1's native `batch()`, which Prisma does not use (a decision for the Worker phase).

## DateTime encoding

Prisma's native SQLite engine (used by the tests and `seed-local.ts`) stores `DateTime` as **integer milliseconds**. `@prisma/adapter-d1` stores **ISO text**. The code therefore:
- never compares dates in raw SQL (date filters stay in Prisma queries);
- passes `Date` values to raw SQL as parameters, so each engine encodes them its own way;
- does not load data written by the native engine into real D1.

## Seed

- `prisma/d1/seed.ts` exports `seedD1(db)`. It loads the same demo data as `prisma/seed.ts`, with money in minor units, and is idempotent. It never reads `DATABASE_URL` and uses no transactions. It returns the submission PDFs, which are not written here; R2 is a later phase. Keep its data in step with `prisma/seed.ts`.
- **Real D1:** run `seedD1` through the D1 adapter inside the Worker (later phase), because of the DateTime encoding.
- **Local try-out:**
  ```sh
  D1_LOCAL_SQLITE_URL="file:/absolute/path/pen-sms-d1.sqlite" npx tsx prisma/d1/seed-local.ts
  ```
  A new file is created from the baseline first. The script refuses non-`file:` URLs and Wrangler state.

## Tests

`tests/d1/` runs the D1 services against a throwaway SQLite database built from `0001_baseline.sql` (`tests/d1/harness.ts`). It uses the D1 Prisma client over one connection, so statements run one at a time as on D1 while concurrent requests interleave between them. Negative controls (naive read-then-write versions) show that the harness does catch races.

The harness does not exercise `@prisma/adapter-d1` itself or D1's 98-parameter limit. That needs Wrangler/Miniflare in the Worker phase.

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

`npm install` generates both clients (`postinstall`). The D1 client is needed to type-check the project and run the D1 tests.

## Runtime (later phase: Cloudflare Worker)

- Install `@prisma/adapter-d1` at the **same version as `prisma`/`@prisma/client`** (6.12.x).
- In the Worker, create the client per request from the binding: `new PrismaClient({ adapter: new PrismaD1(env.DB) })`. Pass it to the `src/lib/services/d1/*` functions. The `globalThis` singleton in `src/lib/prisma.ts` does not apply there.
- The generated client maps the `workerd` export condition to its Workers build (`wasm.js` + `query_engine_bg.wasm`), so the Worker imports the package root.
- The adapter reports CHECK-constraint failures as foreign-key violations (`P2003`). Unique violations are recognised in every shape by `uniqueViolation()` in `src/lib/errors.ts`.
