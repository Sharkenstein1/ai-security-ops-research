FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=80
COPY package.json package-lock.json ./
ARG NPM_CA_CERT
RUN set -eu; \
    trap 'rm -f /tmp/points-npm-ca.pem' EXIT; \
    if [ -n "${NPM_CA_CERT:-}" ]; then \
      printf '%s\n' "$NPM_CA_CERT" > /tmp/points-npm-ca.pem; \
      export NODE_EXTRA_CA_CERTS=/tmp/points-npm-ca.pem; \
    fi; \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund --fetch-timeout=30000 --fetch-retries=1
COPY server ./server
EXPOSE 80
CMD ["node", "server/index.js"]
