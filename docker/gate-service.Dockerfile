FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --no-frozen-lockfile && pnpm --filter @metroflow/gate-service build
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/apps/gate-service/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3005
CMD ["node","dist/main.js"]
