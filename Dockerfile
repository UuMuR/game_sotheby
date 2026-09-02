FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vitest.config.ts eslint.config.mjs ./
COPY packages ./packages
COPY apps/server ./apps/server
COPY docs/data ./docs/data
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN ./node_modules/.bin/esbuild apps/server/src/server.ts --bundle --platform=node --format=esm --target=node22 --outfile=apps/server/dist/server.js --external:fastify --external:@fastify/websocket --external:ioredis --external:mysql2 --external:mysql2/* --external:drizzle-orm --external:drizzle-orm/* --external:ws --external:zod
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/server/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/server.js"]
