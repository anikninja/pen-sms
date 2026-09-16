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
