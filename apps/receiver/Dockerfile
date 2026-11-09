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
# The worker keeps mirrors of the projects' repositories and packs working copies with these.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
# gitleaks finds secrets in a change before it is pushed: a pinned release, checked against
# the release's checksums.
ARG GITLEAKS_VERSION=8.28.0
ARG TARGETARCH
RUN set -eu; arch="$([ "${TARGETARCH:-amd64}" = arm64 ] && echo arm64 || echo x64)"; \
  base="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}"; \
  archive="gitleaks_${GITLEAKS_VERSION}_linux_${arch}.tar.gz"; \
  cd /tmp && curl -fsSLO "${base}/${archive}" && curl -fsSLO "${base}/gitleaks_${GITLEAKS_VERSION}_checksums.txt"; \
  grep " ${archive}\$" "gitleaks_${GITLEAKS_VERSION}_checksums.txt" | sha256sum -c -; \
  tar -xzf "${archive}" -C /usr/local/bin gitleaks; rm -f /tmp/gitleaks*; gitleaks version
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
RUN mkdir -p /var/lib/redline/blobs /var/lib/redline/mirrors /run/redline \
  && chown node:node /var/lib/redline/blobs /var/lib/redline/mirrors /run/redline
USER node
EXPOSE 8787
ENTRYPOINT ["node", "dist/receiver.mjs"]
CMD ["serve", "all"]
