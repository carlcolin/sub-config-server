# sub-config-server

一个最小可用的配置文件分发服务：

- 支持 `mihomo`
- 支持 `stash`
- 支持 `surge`
- 支持 `token` 鉴权
- 支持 `Authorization: Bearer <token>`
- 支持通过 URL 直接导入订阅
- 路由从 `routes.json` 读取，后续新增路由不用改代码
- 修改 `routes.json` 后自动热加载，无需重启服务
- 支持 `.env` 自动加载
- 支持多 token
- 支持启动校验、`/readyz`、`/profiles`
- 日志支持记录 token 指纹（不输出明文 token）

## 目录结构

```bash
sub-config-server/
  server.js
  package.json
  .env.example
  routes.json
  routes.example.json
  configs/
    mihomo.yaml
    stash.yaml
    surge.conf
```

## 启动

### 方式一：使用 `.env`

```bash
cd sub-config-server
cp .env.example .env
npm install
npm start
```

### 方式二：命令行传环境变量

```bash
cd sub-config-server
npm install
ACCESS_TOKEN=*** CONFIG_DIR=./configs ROUTES_FILE=./routes.json npm start
```

默认端口：`3210`

## 启动校验

服务启动时会提前检查：

- `ACCESS_TOKEN` / `ACCESS_TOKENS` 是否已配置
- `CONFIG_DIR` 是否存在
- `routes.json` 是否可解析
- 每个路由对应的配置文件是否真实存在

如果有问题，会直接启动失败并打印清晰错误。

## routes.json

示例：

```json
{
  "mihomo": "mihomo.yaml",
  "stash": "stash.yaml",
  "surge": "surge.conf",
  "verge": "verge.yaml",
  "loon": "loon.conf"
}
```

说明：
- 左边是路由名
- 右边是 `configs/` 目录中的文件名
- 修改 `routes.json` 后会自动热加载，通常无需重启服务
- 如果你改的是配置文件内容本身（如 `configs/mihomo.yaml`），也不需要重启，服务本来就是按请求实时读取文件

例如加了：

```json
{
  "verge": "verge.yaml"
}
```

就能访问：

```bash
http://127.0.0.1:3210/config/verge?token=***
http://127.0.0.1:3210/sub/verge?token=***
```

## 访问方式

### query token

```bash
curl 'http://127.0.0.1:3210/config/mihomo?token=***'
curl 'http://127.0.0.1:3210/config/stash?token=***'
curl 'http://127.0.0.1:3210/config/surge?token=***'
```

### Bearer Token

```bash
curl -H 'Authorization: Bearer 你的token' http://127.0.0.1:3210/config/mihomo
```

### 下载文件

```bash
curl -OJ 'http://127.0.0.1:3210/config/mihomo?token=***&download=1'
```

### 查询可用 profile

```bash
curl 'http://127.0.0.1:3210/profiles?token=***'
```

## 环境变量

- `PORT`: 服务端口，默认 `3210`
- `HOST`: 监听地址，默认 `127.0.0.1`；若使用 Docker 直接映射端口，通常应设为 `0.0.0.0`
- `ACCESS_TOKEN`: 单个访问令牌
- `ACCESS_TOKENS`: 多个访问令牌，英文逗号分隔；如果配置它，优先使用它
- `CONFIG_DIR`: 配置文件目录，默认 `./configs`
- `ROUTES_FILE`: 路由映射文件，默认 `./routes.json`
- `TRUST_PROXY`: 是否信任反代，默认 `false`
- `PUBLIC_BASE_URL`: 可选；用于启动日志和 `/profiles` 中生成更实用的外部访问地址，例如 `https://sub.example.com`

## 健康检查

### 存活检查

```bash
curl http://127.0.0.1:3210/healthz
```

### 就绪检查

```bash
curl http://127.0.0.1:3210/readyz
```

## 日志说明

- 成功请求会记录：状态码、profile、token 指纹、是否下载、IP、文件路径、字节数、耗时
- 失败请求也会记录：例如缺 token、错 token、profile 不存在、配置文件不存在
- 为了安全，日志中不会输出明文 token，只会输出 token 指纹（SHA-256 前 12 位）
- 启动时会打印已配置 token 的指纹映射，便于排查是哪一个 token 在访问

## 返回接口

### `/profiles`

示例返回：

```json
{
  "profiles": [
    {
      "name": "mihomo",
      "file": "mihomo.yaml",
      "subUrl": "http://127.0.0.1:3210/sub/mihomo?token=<ACCESS_TOKEN>",
      "configUrl": "http://127.0.0.1:3210/config/mihomo?token=<ACCESS_TOKEN>"
    }
  ],
  "count": 1,
  "tokenMode": "single"
}
```

## GitHub Actions 构建 Docker 镜像

仓库已包含 GitHub Actions 工作流：

- push 到 `main`：构建并推送 Docker 镜像到 Docker Hub
- push `v*` tag：构建并推送对应版本 tag
- Pull Request：只构建，不推送

镜像仓库：

```text
skyes/sub-config-server
```

在 GitHub 仓库 `Settings -> Secrets and variables -> Actions` 中配置：

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

其中 `DOCKERHUB_TOKEN` 建议使用 Docker Hub Access Token，不要直接使用登录密码。

当前工作流默认会构建多架构镜像：

- `linux/amd64`
- `linux/arm64`

默认 tag 策略：

- push 到 `main`：推送 `main`、`sha-...`、`latest`
- push `v*` tag：推送对应 tag（例如 `v1.0.0`）和 `sha-...`
- Pull Request：只构建，不推送

## Docker 运行示例

### 拉取镜像

```bash
docker pull skyes/sub-config-server:latest
```

### docker run

> 如果使用 Docker 直接 `-p 3210:3210` 暴露端口，请确保 `.env` 中设置 `HOST=0.0.0.0`。

```bash
docker run -d \
  --name sub-config-server \
  -p 3210:3210 \
  --env-file .env \
  -v $(pwd)/configs:/app/configs:ro \
  -v $(pwd)/routes.json:/app/routes.json:ro \
  --restart always \
  skyes/sub-config-server:latest
```

### docker compose

> 如果使用 Docker 直接映射端口到宿主机，请在 `.env` 中设置 `HOST=0.0.0.0`。

仓库同时提供了 Docker 场景示例配置文件：

```bash
cp .env.docker.example .env
```

仓库已提供现成的 `docker-compose.yml`，可直接使用：

```bash
docker compose up -d
```

其内容如下：

```yaml
services:
  sub-config-server:
    image: skyes/sub-config-server:latest
    container_name: sub-config-server
    restart: always
    ports:
      - "3210:3210"
    env_file:
      - .env
    volumes:
      - ./configs:/app/configs:ro
      - ./routes.json:/app/routes.json:ro
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

## Nginx 反代示例

```nginx
server {
    listen 80;
    server_name sub.example.com;

    location / {
        proxy_pass http://127.0.0.1:3210;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
