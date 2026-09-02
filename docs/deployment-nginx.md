# 外部 TLS 反向代理示例

该文件只描述项目外的 TLS 入口，不是 Subweb 的 Compose 服务，也不负责启动或更新任何容器。生产部署仍以 [`compose.yaml`](../compose.yaml) 和 [`deployment-docker.md`](deployment-docker.md) 为准。

下面的 Nginx 配置将 APP、API 和 SHORT 三个 HTTPS 主机转发到 Gateway 唯一的 loopback 端口。请将域名、证书路径和端口替换为实际值；证书续期、80/443 端口、防火墙和公网 DNS 由部署者负责。

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

upstream subweb_gateway {
    server 127.0.0.1:18080;
}

server {
    listen 443 ssl http2;
    server_name app.example.com api.example.com short.example.com;

    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

    location / {
        proxy_pass http://subweb_gateway;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}

server {
    listen 80;
    server_name app.example.com api.example.com short.example.com;
    return 301 https://$host$request_uri;
}
```

Gateway 只信任显式配置的外层代理 CIDR。不要把 `0.0.0.0/0`、`::/0` 或任意公网网段配置为可信代理；代理必须保留原始 Host，并将三个域名转发到同一个 Gateway 端口。启用短链时，`server_name` 必须与 `APP_DOMAIN`、`API_DOMAIN`、`SHORT_DOMAIN` 完全对应；关闭短链时不要配置 SHORT 域名或 SHORT 虚拟主机。

完成外层代理配置后，从项目目录运行：

```sh
./scripts/validate-compose.sh
./scripts/subweb.sh status
npm run verify:integration
```

这里的示例不会替代 TLS 扫描、证书续期检查或部署前发布门禁。
