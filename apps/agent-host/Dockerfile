# redline-agent: the base image of a run's sandbox. agent-host is its entrypoint; the setup
# phase runs the project's own install command in place of it. Projects extend it with `FROM`
# for their toolchains. Build from the repository root:
#   docker build -f apps/agent-host/Dockerfile -t redline-agent .
FROM node:22-bookworm-slim AS build
ENV CI=true
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @redline/agent-host...
RUN pnpm --filter @redline/agent-host build
RUN pnpm --filter @redline/agent-host deploy --prod --legacy /out

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
COPY --from=build /out /opt/agent-host
# The run's directories, owned by the sandbox user (`node`, 1000:1000): Docker gives a new
# volume the owner of the directory it is mounted on.
RUN mkdir -p /workspace /redline/input /redline/out /redline/session \
  && chown node:node /workspace /redline/input /redline/out /redline/session
ENV NODE_ENV=production
USER node
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/agent-host/dist/agent-host.mjs"]
