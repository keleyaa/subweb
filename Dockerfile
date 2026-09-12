FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81 AS frontend-build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM golang:1.27-alpine@sha256:cf6fca6641884b8433441b2b0652976f975e1d0fdd26d177eaaf8596087f3125 AS gateway-build

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /src
COPY services/gateway/go.mod services/gateway/go.sum ./services/gateway/
WORKDIR /src/services/gateway
RUN go mod download
COPY services/gateway .
RUN go test ./...
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/gateway ./cmd/gateway

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab

LABEL org.opencontainers.image.title="Subweb Gateway" \
  org.opencontainers.image.description="Unified Subweb Gateway and controlled egress proxy" \
  org.opencontainers.image.source="https://github.com/keleyaa/subweb" \
  org.opencontainers.image.licenses="GPL-3.0-only"

COPY --from=frontend-build --chown=65532:65532 /app/dist /app/dist
COPY --from=gateway-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=gateway-build /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=gateway-build --chown=65532:65532 /out/gateway /app/gateway

USER 65532:65532
WORKDIR /app
ENV STATIC_ROOT=/app/dist

EXPOSE 8080 25502
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/app/gateway", "--healthcheck"]

ENTRYPOINT ["/app/gateway"]
