FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY next.config.ts tsconfig.json ./
COPY app ./app
COPY components ./components
COPY lib ./lib
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/package.json /app/next.config.ts /app/tsconfig.json ./
COPY --chown=node:node db ./db
COPY --chown=node:node lib ./lib
COPY --chown=node:node scripts ./scripts

USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
