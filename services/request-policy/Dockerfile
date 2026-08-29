FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force \
  && apk update \
  && apk upgrade libcrypto3 libssl3 \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY src ./src

USER node
EXPOSE 25501
CMD ["node", "src/index.mjs"]
