# 做T神器现代前端：Ubuntu部署

此目录是现代版前端。生产容器仅监听服务器本机 `127.0.0.1:3000`，由 Nginx 提供 HTTPS。

```bash
docker compose -f compose.web.yml build
docker compose -f compose.web.yml up -d
docker compose -f compose.web.yml ps
curl -I http://127.0.0.1:3000/
```

Python量化逻辑服务继续独立运行在 `127.0.0.1:8765`。真实自动交易默认关闭。
