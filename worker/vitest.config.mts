import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Worker integration tests: each file starts the real Worker (workerd, local D1) with wrangler.
// Run from the repository root with `npm run test:worker` (needs `npm ci --prefix worker`).
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../src", import.meta.url)),
      // The D1 Prisma client, used by the tests to seed through @prisma/adapter-d1.
      ".prisma/client-d1": fileURLToPath(new URL("../node_modules/.prisma/client-d1/index.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // One Worker (workerd process) at a time keeps the machine responsive and the timings stable.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 240_000,
  },
})
