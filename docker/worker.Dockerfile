FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --no-frozen-lockfile && pnpm --filter @metroflow/worker build
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/apps/worker/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3004
CMD ["node","dist/main.js"]
