import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 6.12 config (early access). The database URL is read from DATABASE_URL by
// `env("DATABASE_URL")` in schema.prisma; "dotenv/config" loads it from .env.
export default defineConfig({
  earlyAccess: true,
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
  },
});
