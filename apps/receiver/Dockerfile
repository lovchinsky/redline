# The receiver's image. Build from the repository root:
#   docker build -f apps/receiver/Dockerfile -t redline-receiver .
FROM node:22-bookworm-slim AS build
ENV CI=true
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @redline/receiver...
RUN pnpm --filter @redline/receiver build
RUN pnpm --filter @redline/receiver deploy --prod --legacy /out

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
RUN mkdir -p /var/lib/redline/blobs && chown node:node /var/lib/redline/blobs
USER node
EXPOSE 8787
ENTRYPOINT ["node", "dist/receiver.mjs"]
CMD ["serve", "all"]
