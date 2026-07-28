FROM node:20.15.1-alpine AS build
LABEL maintainer="Stille <stille@ioiox.com>"

ENV VERSION 2.0

WORKDIR /app
COPY . /app
RUN npm ci
RUN npm run build

FROM nginx:1.26.2-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY . /app
EXPOSE 80
CMD [ "sh", "-c", "/app/start.sh" ]
