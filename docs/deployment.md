# 部署说明

Subweb 的生产镜像只提供静态前端文件，由 Nginx 提供服务；订阅转换后端需要单独部署并通过运行时配置接入。

## 构建镜像

```bash
docker build -t subweb:local .
```

## 通过环境变量启动

以下示例为容器注入站点名称和转换后端地址：

```bash
docker run -d --name subweb --restart unless-stopped -p 18080:80 -e SITE_NAME='Subweb' -e API_URL='https://converter.example.com' subweb:local
```

`SHORT_URL` 会覆盖默认短链服务地址：

```bash
docker run -d --name subweb --restart unless-stopped -p 18080:80 -e API_URL='https://converter.example.com' -e SHORT_URL='https://short.example.com' subweb:local
```

容器启动脚本只处理 `SITE_NAME`、`API_URL` 和 `SHORT_URL`。未传入时，默认使用 `https://api.ml1.one` 和 `https://ml1.one`。这些值会写入容器内的 `/usr/share/nginx/html/conf/config.js`。

## 挂载完整配置

需要关闭短链、设置导航或修改远程配置预设时，复制并编辑配置文件：

```bash
mkdir -p runtime-config
cp public/conf/config.js runtime-config/config.js
```

然后以只读挂载运行（不要同时传入会写入配置的环境变量）：

```bash
docker run -d --name subweb --restart unless-stopped -p 18080:80 -v "$(pwd)/runtime-config:/usr/share/nginx/html/conf:ro" subweb:local
```

## 发布前检查

运行 `npm test`、`npm run lint`、`npm run build`、`git diff --check` 和 `git status --short`。

仓库中的 GitHub Actions 工作流会在 `main` 分支更新时构建 Docker 镜像并同步 README。启用该流程前，需要在当前维护仓库配置 `DOCKER_USERNAME` 和 `DOCKER_PASSWORD` Secrets。
