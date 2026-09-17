# Simple Dockerfile for building and running the Next.js app.
# - Default command runs the production build (`npm run build` then `npm run start`).
# - For development inside a container, mount the workspace and run `npm run dev`.

FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --production=false --legacy-peer-deps

# Copy source and build
COPY . .
RUN npm run build

EXPOSE 3000

# Default to production start. Override with `docker compose run --service-ports app npm run dev` for dev.
CMD ["npm", "run", "start"]
