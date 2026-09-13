FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --no-frozen-lockfile && pnpm --filter @metroflow/api-gateway build
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/apps/api-gateway/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3001
CMD ["node","dist/main.js"]
