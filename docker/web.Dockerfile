FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
ENV DOCKER_BUILD=true
RUN pnpm install --no-frozen-lockfile && pnpm --filter @metroflow/web build
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
EXPOSE 3000
CMD ["node","server.js"]
