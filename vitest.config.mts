import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The D1 Prisma client (prisma/d1/schema.prisma). Vite reads a leading "." as a relative path.
      ".prisma/client-d1": fileURLToPath(new URL("./node_modules/.prisma/client-d1/index.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
})
