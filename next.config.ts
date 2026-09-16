import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  experimental: {
    // Submissions are uploaded through Server Actions; files are capped at 5 MB (architecture.md §32).
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
}

export default nextConfig
