# Production build target — not wired into local dev (see ../docker-compose.yml,
# which only runs Postgres/Redis; the backend itself runs via `npm run dev` on
# the host for fast iteration). This Dockerfile is what eventually ships to the
# Hetzner VPS — see Projects/CyCove.md -> Key decisions -> Hosting.

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY backend/package*.json backend/
COPY backend/prisma backend/prisma
RUN npm ci --workspace=backend
COPY backend backend
COPY tsconfig.base.json ./
RUN npm run build --workspace=backend
RUN npx --workspace=backend prisma generate

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/prisma ./prisma
COPY backend/package.json ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
