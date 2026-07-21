# Production build target for the Next.js web client — ships the actual
# CyCove chat UI, not just the backend API. NEXT_PUBLIC_API_BASE is passed
# as a build arg (not a runtime env var) since Next.js inlines NEXT_PUBLIC_*
# values into the client bundle at build time.

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY web/package*.json web/
RUN npm ci --workspace=web
COPY web web
COPY tsconfig.base.json ./
ARG NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
RUN npm run build --workspace=web

# `output: 'standalone'` (next.config.mjs) traces the monorepo layout
# actually needed at runtime — mirrors the repo root (node_modules/, web/)
# rather than requiring the full workspace tree.
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./web/.next/static
EXPOSE 3000
CMD ["node", "web/server.js"]
