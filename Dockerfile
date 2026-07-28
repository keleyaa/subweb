FROM node:20.15.1-alpine AS build
LABEL maintainer="Stille <stille@ioiox.com>"

ENV VERSION 2.0

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.26.2-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/public/conf/config.js /app/public/conf/config.js
COPY start.sh /app/start.sh
EXPOSE 80
CMD [ "sh", "-c", "/app/start.sh" ]
