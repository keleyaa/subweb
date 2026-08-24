FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.30.4-alpine@sha256:93722936b82ec8a1178d48448e619226680d2de3706a1640800e186cd5fa7fd3

LABEL org.opencontainers.image.title="Subweb" \
  org.opencontainers.image.description="A minimal frontend for subscription conversion backends" \
  org.opencontainers.image.source="https://github.com/keleyaa/subweb" \
  org.opencontainers.image.licenses="GPL-3.0-only"

USER root
RUN apk add --no-cache tzdata \
  && rm -f /etc/nginx/conf.d/default.conf

ENV TZ=Asia/Shanghai

COPY --chown=101:101 nginx/templates /etc/nginx/gateway/templates
COPY --chown=101:101 nginx/snippets /etc/nginx/gateway/snippets
COPY --chown=101:101 --from=build /app/dist /usr/share/nginx/html
COPY --chown=101:101 --from=build /app/public/conf/config.js /app/public/conf/config.js
COPY --chown=101:101 --chmod=755 scripts/render-gateway-config.sh /app/render-gateway-config.sh
COPY --chown=101:101 --chmod=755 start.sh /app/start.sh

USER 101

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD nginx -t -q -c /tmp/nginx/nginx.conf && wget -q -O /dev/null --header="Host: $APP_DOMAIN" http://127.0.0.1:8080/healthz

CMD ["/app/start.sh"]
