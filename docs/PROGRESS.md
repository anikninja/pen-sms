# Build Progress

Phase tracker for the Registry module. Phases and checklists come from
[prompt.md](../prompt.md) §7; the domain spec is [architecture.md](../architecture.md).
Requirement traceability against the assessment brief is in architecture.md §1.1.
Update this file at every phase boundary.

| Phase | Status |
|---|---|
| 0 — Foundation | 🟡 In progress |
| 1 — Domain + seed | ⬜ Not started |
| 2 — Services + actions + JSON API | ⬜ Not started |
| 3 — Staff UI | ⬜ Not started (scaffold shell only) |
| 4 — Student UI | ⬜ Not started |
| 5 — Quality | ⬜ Not started |
| 6 — Submission | ⬜ Not started |

---

## Phase 0 — Foundation

- [x] Next.js app scaffolds and runs (Next 16.3.5, React 19.2.8)
- [x] Postgres reachable; `DATABASE_URL` in `.env`; `.env.example` committed
- [x] `.env` is gitignored
- [x] Final schema in `prisma/schema.prisma` (revised after the requirements review)
- [x] `prisma migrate dev --name init` succeeds → `20260915195504_init`
- [ ] Prisma Studio visual check of all 8 tables (`npx prisma studio` → http://localhost:5555)

### Verified on 2026-09-16

- `prisma validate`: schema valid; `prisma migrate status`: 1 migration, database up to date
- Tables (8): `Programme`, `ProgrammeFee`, `StudentFee`, `Student`, `Payment`, `Assessment`, `Submission`, `Result`
- Enum `EnrolmentStatus`: `ENROLLED, DEFERRED, WITHDRAWN, COMPLETED`
- 33 indexes (primary keys, unique constraints, secondary indexes)
- Money columns are `numeric(12,2)`
- Delete rules:
  - `StudentFee.programmeFeeId → ProgrammeFee`: `SET NULL` (deleting a tariff keeps assigned fees)
  - `StudentFee.studentId → Student`: `CASCADE`
  - `Student.programmeId`, `Assessment.programmeId → Programme`: `RESTRICT`
  - `Payment`, `Submission`, `Result → Student/Assessment`: `CASCADE`

### Open items carried into Phase 1

- Add `src/lib/prisma.ts` singleton (guards against duplicate clients on dev hot reload).
- Install `date-fns`, `vitest`, `@vitejs/plugin-react`, `tsx`; add a `test` script.
- Seed wiring: `prisma.config.ts` exists, so the seed command likely belongs in its
  `migrations.seed` field rather than `package.json` → `prisma.seed`. Check against Prisma 6.12.
- `next.config.ts`: set `serverActions.bodySizeLimit: "6mb"` (top-level in Next 16).
- Create `storage/uploads/.gitkeep` and gitignore the uploads.
- `.env.example`: comment uses `//`, dotenv expects `#`.
- Remove the shadcn `dashboard-01` demo (mocked `data.json`, recharts chart, dnd-kit table)
  and the unused deps it added (`recharts`, `@dnd-kit/*`, `@tanstack/react-table`, `cn`).
- Repurpose `/login` as the Staff/Student role toggle (prompt.md §3.3) instead of a fake login.

---

## Decision & documentation log

### 2026-09-16 — Requirements review against the assessment brief

Re-checked the brief line by line. Gaps found and fixed in both architecture.md (§1.2) and
prompt.md (which overrides architecture.md on conflict):

| # | Gap | Change |
|---|---|---|
| 1 | Fee was derived live from the tariff; no in-app "assign fee"; tariff edits would rewrite paid balances | New `StudentFee` (snapshot at enrolment, staff-adjustable) |
| 2 | Assessments not linked to a programme | `Assessment.programmeId` |
| 3 | No "open assessment" state | `Assessment.isOpen` (staff-controlled) |
| 4 | prompt.md allowed resubmission at any time; brief says before the deadline | Replacement after deadline rejected; first late submission still accepted |
| 5 | No per-student publish/withhold | Per-student marksheet publish/withhold |
| 6 | prompt.md removed API routes; brief grades "working API routes" | JSON API over the shared service layer (architecture.md §17.1) |
| 7 | Non-enrolled students could submit / count as pending | Only ENROLLED students of the programme |

Schema impact: +1 model (`StudentFee`), +2 columns on `Assessment`. The first `init` migration was
uncommitted and the database was empty, so it was regenerated as a single `init` instead of
adding a second migration.

The brief PDF is marked "for recruitment purposes only, do not distribute", so it is **not
committed**. architecture.md §1.1 paraphrases its requirements.

### 2026-09-16 — Documentation committed

- `architecture.md` and `prompt.md` are committed instead of gitignored.
- architecture.md §15 ERD replaced with a Mermaid `erDiagram` (renders on GitHub); it includes the
  previously missing `Student → Result` edge. §37 stray citation artifact removed.
