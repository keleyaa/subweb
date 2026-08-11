FROM node:alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:alpine

LABEL org.opencontainers.image.title="Subweb" \
  org.opencontainers.image.description="A minimal frontend for subscription conversion backends" \
  org.opencontainers.image.source="https://github.com/keleyaa/subweb" \
  org.opencontainers.image.licenses="GPL-3.0-only"

USER root
RUN apk add --no-cache openssl tzdata \
  && rm -f /etc/nginx/conf.d/default.conf

ENV TZ=Asia/Shanghai

COPY --chown=101:101 nginx/templates /etc/nginx/gateway/templates
COPY --chown=101:101 nginx/snippets /etc/nginx/gateway/snippets
COPY --chown=101:101 --from=build /app/dist /usr/share/nginx/html
COPY --chown=101:101 --from=build /app/public/conf/config.js /app/public/conf/config.js
COPY --chown=101:101 --chmod=755 scripts/render-gateway-config.sh /app/render-gateway-config.sh
COPY --chown=101:101 --chmod=755 start.sh /app/start.sh

USER 101

EXPOSE 8080 8443
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD nginx -t -q -c /tmp/nginx/nginx.conf && if [ "$GATEWAY_MODE" = direct-tls ]; then wget --no-check-certificate -q -O /dev/null --header="Host: $APP_DOMAIN" https://127.0.0.1:8443/healthz; elif [ "$GATEWAY_MODE" = behind-proxy ]; then wget -q -O /dev/null --header="Host: $APP_DOMAIN" http://127.0.0.1:8080/healthz; else exit 1; fi

CMD ["/app/start.sh"]
