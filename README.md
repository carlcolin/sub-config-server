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

```bash
cd sub-config-server
npm install
ACCESS_TOKEN=你的token CONFIG_DIR=./configs ROUTES_FILE=./routes.json npm start
```

默认端口：`3210`

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
http://127.0.0.1:3210/config/verge?token=你的token
http://127.0.0.1:3210/sub/verge?token=你的token
```

## 访问方式

### query token

```bash
curl 'http://127.0.0.1:3210/config/mihomo?token=你的token'
curl 'http://127.0.0.1:3210/config/stash?token=你的token'
curl 'http://127.0.0.1:3210/config/surge?token=你的token'
```

### Bearer Token

```bash
curl -H 'Authorization: Bearer 你的token' http://127.0.0.1:3210/config/mihomo
```

### 下载文件

```bash
curl -OJ 'http://127.0.0.1:3210/config/mihomo?token=你的token&download=1'
```

## 环境变量

- `PORT`: 服务端口，默认 `3210`
- `ACCESS_TOKEN`: 访问令牌，必填
- `CONFIG_DIR`: 配置文件目录，默认 `./configs`
- `ROUTES_FILE`: 路由映射文件，默认 `./routes.json`
- `TRUST_PROXY`: 是否信任反代，默认 `false`

## 健康检查

```bash
curl http://127.0.0.1:3210/healthz
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
