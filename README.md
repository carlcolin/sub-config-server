# sub-config-server

一个最小可用的配置文件分发服务：

- 支持 `mihomo`
- 支持 `stash`
- 支持 `surge`
- 支持 `token` 鉴权
- 支持 `Authorization: Bearer <token>`
- 支持通过 URL 直接导入订阅

## 目录结构

```bash
sub-config-server/
  server.js
  package.json
  .env.example
  configs/
    mihomo.yaml
    stash.yaml
    surge.conf
```

## 启动

```bash
cd sub-config-server
npm install
ACCESS_TOKEN=你的token CONFIG_DIR=./configs npm start
```

默认端口：`3210`

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
- `MIHOMO_FILE`: 默认 `mihomo.yaml`
- `STASH_FILE`: 默认 `stash.yaml`
- `SURGE_FILE`: 默认 `surge.conf`
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
