# TODO

Work that is deliberately not done yet. Everything else is tracked in [PROGRESS.md](PROGRESS.md).

---

## Docker for a VPS — not yet verified

`Dockerfile` and `docker-compose.yml` are in the repository but have never been built or run. To be
done on a machine with a Docker engine. The assessment is submitted as the git repository, so this
is not needed for review.

### 1. Blockers — the current files will not work as they are

- [ ] **`Dockerfile` installs dependencies before copying `prisma/`.** `npm install` now runs
      `postinstall: prisma generate` (added in Phase 7 so a fresh clone can seed), which needs the
      schema. Copy `prisma/` and `prisma.config.ts` next to `package.json` **before** the install
      step, or the image build fails.
- [ ] **The app container cannot reach the database.** `docker-compose.yml` passes `.env` through
      `env_file`, where `DATABASE_URL` points at `localhost:5432` — inside the app container that is
      the app itself, not the `db` service. Override it for the container:
      `DATABASE_URL=postgresql://postgres:root@db:5432/pen_sms?schema=public` (host `db`, the service
      name).
- [ ] **The uploads mount is on the wrong service.** `./storage/uploads:/app/storage/uploads` is
      declared on the **`db`** service, which never touches files. Move it to the **`app`** service.

### 2. Persistent storage for uploads

- [ ] Give the **app** service a volume at `/app/storage/uploads` (bind mount or named volume).
      Uploaded submissions are written to `<app dir>/storage/uploads`; without a volume every
      submission is lost when the container is replaced, and the database rows point at files that
      no longer exist.
- [ ] Optional: make the location configurable (an env var read in `src/lib/storage/index.ts`,
      which currently uses `process.cwd()/storage/uploads`).

### 3. Database setup on the server

- [ ] Run these **on the server**, after the database container is healthy:
      ```bash
      npm run db:deploy   # applies committed migrations; never resets data
      npm run db:seed     # demo data (optional on a real deployment)
      ```
- [ ] Remember the seed also writes the sample submission PDFs to **that machine's**
      `storage/uploads`. Seeding from a laptop against a remote database leaves those submissions
      undownloadable on the server.
- [ ] Decide whether demo data belongs on the server at all; if not, skip `db:seed` and create real
      records instead.

### 4. Configuration and secrets

- [ ] Set a fresh `AUTH_SECRET` on the server (`npx auth secret`); never reuse the local one.
- [ ] Set `DEMO_MODE="false"` for anything reachable from the internet — otherwise the login page
      lists every demo account and the shared password.
- [ ] Keep `.env` out of the image: add a `.dockerignore` (see below) and pass configuration through
      the environment or secrets instead.

### 5. Image and compose hygiene

- [ ] Add a **`.dockerignore`**: `node_modules`, `.next`, `.git`, `.env*`, `storage/uploads`,
      `docs`, `tests`. There is none today, so the build context includes `.env` and `node_modules`.
- [ ] **Node 22** in the Dockerfile (`node:20-alpine` today). The project and CI run Node 22, and
      the Prisma 8 CLI — if it is ever adopted — needs 22.18+.
- [ ] Prefer **`npm ci`** over `npm install` for reproducible builds (the lockfile is committed).
      Check whether `--legacy-peer-deps` is still needed (it was added for the pinned `next-auth` v5
      beta).
- [ ] The `app` service bind-mounts the whole project (`./:/app` plus `/app/node_modules`), which is
      a development pattern: the container then runs the host's files, not the built image. For a
      VPS, drop the bind mounts and keep the image self-contained; put the dev setup in a separate
      `docker-compose.dev.yml` if it is still wanted.
- [ ] `version: '3.8'` at the top of `docker-compose.yml` is obsolete in Compose v2 and can go.
- [ ] Optional: `output: "standalone"` in `next.config.ts` plus a multi-stage build, for a much
      smaller runtime image.

### 6. Behind a reverse proxy (nginx / Caddy)

- [ ] Terminate HTTPS at the proxy and forward `Host` / `X-Forwarded-*`. Auth.js already runs with
      `trustHost: true`; session cookies must be served over HTTPS in production.
- [ ] Keep the request body limit above 6 MB in the proxy, or 5 MB uploads will be rejected before
      they reach the app (`client_max_body_size` in nginx).

### 7. Verify on the Docker machine

- [ ] `docker compose up --build -d` starts both services and the app answers on its port.
- [ ] Sign in as staff and as a student (demo accounts).
- [ ] Upload a submission, then `docker compose restart app` (or rebuild) and confirm the file still
      downloads — this is the real test of the uploads volume.
- [ ] `E2E_BASE_URL=http://<host>:<port> npm run test:e2e` passes against the container, on a
      freshly seeded database.
- [ ] Record the result in [PROGRESS.md](PROGRESS.md) and append a line to
      [development_log.md](development_log.md).
