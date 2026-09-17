This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Running the app (Docker and local)

Prerequisite: copy your updated `.env.example` to `.env` and ensure `DATABASE_URL` points to the desired Postgres instance.

1) Run with Docker (app + DB together)

- Build and start both services (app + Postgres):

```bash
docker compose up --build -d
```

- This composes the `db` (Postgres 16) and `app` services. By default the container runs the production build (`npm run start`).
- To run an interactive development container instead (auto-reloads), run:

```bash
docker compose run --service-ports app npm run dev
```

- Run migrations and seed from your host (or inside the app container):

```bash
npx prisma migrate dev --name init
npm run db:seed
```

2) Run locally (using `npm run dev`)

- Ensure a Postgres instance is available on your host and `.env` DATABASE_URL points at it (for local development you can use `docker compose up -d db` to bring only the DB).

```bash
# bring up only the DB if you don't have Postgres locally
docker compose up -d db

# copy env and start dev server
cp .env.example .env
npm run dev
```

- When running locally with `npm run dev`, the app will connect to your host Postgres at `DATABASE_URL` (commonly `postgresql://postgres:root@localhost:5432/pen_sms?schema=public`).

Notes:
- When using Docker for the app, the `app` service reads environment variables from `.env` (via `env_file`).
- For development inside Docker, we mount the project into `/app` so edits are visible in the container.
