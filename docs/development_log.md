# Development Log

One line per completed step, oldest first. Details live in [PROGRESS.md](PROGRESS.md); the spec is [architecture.md](architecture.md).
`Fix:` marks something that was missed or broken earlier.

1. Project initialization - Next.js 16 setup (App Router, TypeScript, Tailwind)
2. Prisma setup - PostgreSQL connection, prisma.config.ts, .env.example
3. Shadcn UI initialization
4. UI scaffold - shadcn sidebar, login and dashboard blocks (demo data)
5. Architecture specification written - docs/architecture.md
6. Requirements review against the brief - StudentFee, assessment programme + open/closed, per-student publishing, JSON API
7. Final Prisma schema and init migration - 8 tables
8. Authentication schema - User model, Role enum, add_user_auth migration
9. Authentication setup - Auth.js (next-auth v5) credentials sign-in, session helpers, proxy
10. Login page and role-guarded staff / student dashboards with live data
11. Seed data - programmes, fee tariffs, 6 students with assigned fees, demo accounts
12. Removed shadcn demo dashboard, mocked data and unused packages
13. Fix: prisma.config.ts rewritten for Prisma 6.12 - npm run build had been failing since step 2
14. Docs - removed prompt.md (merged into architecture.md), added development_log.md
15. Test setup - Vitest, npm test, @types/node 22
16. Domain rules - fees, classification, submission lateness/replacement, Student ID, Dhaka calendar dates (unit tested)
17. Validation - Zod schemas for students, payments, fees, assessments, grades (unit tested)
18. Error model - DomainError, ActionResult, API error mapping, 401/403 auth guards
19. File storage - local storage behind FileStorage interface, safe keys, no overwrite
20. Services - students (race-safe ID, fee on enrolment), fees and payments (row-locked), assessments, submissions, results
21. Server Actions for all staff and student mutations
22. JSON API - 16 route handlers from architecture.md section 17.1
23. Seed completed - payments, assessments, submissions with real PDF files, results
24. Phase 3 verified - 99 unit tests, 106 API end-to-end checks, seed reset twice, build passes
25. Fix: next.config body size limit moved under experimental.serverActions (docs had the wrong key)
26. Fix: concurrent enrolments - advisory lock per year for Student ID generation (CI caught a failure under 5 simultaneous requests)
27. Staff UI foundations - shadcn dialog, alert-dialog, native-select; status badges, empty state, confirm dialog, toasts, staff navigation
28. Staff dashboard - six Registry figures and overdue fees table from live data
29. Staff students - server-side search and filters, create and edit forms, detail page with Details / Fees / Submissions / Results tabs
30. Staff fees - fees list by status, record payment and assign / adjust fee dialogs, reassign from tariff
31. Staff assessments and results - create / edit / open / close, grading table with live classification, publish and withhold per result, per student and per assessment with overdue warning
32. Fix: fee due dates are calendar days - overdue starts the day after the due date in Dhaka; seeded tariff due dates made calendar dates
33. Phase 4 verified - 14 staff flows in headless Chrome with no console errors, 111 unit tests, 106 API checks, build passes
34. Fix: Base UI uncontrolled input warning - key login email and students search form, freeze dialog and edit-form defaults; stale Status filter after Clear fixed
35. Student portal navigation and dashboard - outstanding balance, next deadline, work to do, published results
36. Student fees and marksheet - fee summary and payment history (shared with staff), published-only marksheet
37. Student assessments - own programme, upload with browser checks, replace with confirmation, late warning, blocked reasons
38. Fix: raw control bytes in submissions.ts made git treat it as binary - replaced with \u escapes
39. Fix: forms now report Server Action requests that fail before running (e.g. upload over the body size limit)
40. Phase 5 verified - 13 student flows across 4 students in headless Chrome, 14 staff flows, 111 unit tests, 106 API checks, build passes
41. Fix: use-mobile hook reads the media query with useSyncExternalStore - lint clean
42. Loading, error and not-found states per role area inside the app shell, plus root and global fallbacks
43. Fix: pages scrolled horizontally at 768px - app shell content column can shrink; students filters wrap until lg
44. Fix: sign-in shows "unavailable" instead of "invalid password" when the database is unreachable
45. Fix: "Not submitted" instead of "Pending" on closed assessments in staff screens too
46. Phase 6 verified - 18 quality checks (errors, not-found, loading, 4 widths, database down), 15 staff + 13 student flows, 106 API checks, 111 unit tests, build passes
47. Prisma Postgres (console.prisma.io) as the hosted database on Prisma 6 - db:deploy script, .env.example note; Prisma 8 rewrite declined
48. README for reviewers - features, architecture and ERD, API table with curl examples, setup, seed, rules, decisions, edge cases, testing, AI usage, limitations
49. Fix: npm install now generates Prisma Client (postinstall) - a fresh clone could not run the seed
50. Phase 7 verified - fresh clone set up from the README alone: install, migrate, seed, lint, 111 tests, build, curl examples, 106 API checks, 15 staff + 13 student flows
51. TODO.md for the unverified Docker/VPS setup - blockers found in the current files, uploads volume, server-side migrate and seed, secrets, image hygiene, verification steps
