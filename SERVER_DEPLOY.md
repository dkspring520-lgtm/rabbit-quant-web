# 做T神器 VPS 部署

生产容器仅监听服务器本机 `127.0.0.1:3000`，由 Nginx 对外提供 HTTPS。

```bash
mkdir -p /opt/rabbit-quant-research /opt/rabbit-quant-state /opt/rabbit-quant-training-runtime
# 首次部署前，将训练面板上传为：
# /opt/rabbit-quant-research/zijin-peer-panel-2022-2026.parquet
docker compose -f compose.web.yml build
docker compose -f compose.web.yml up -d
docker compose -f compose.web.yml ps
curl -I http://127.0.0.1:3000/
```

`rabbit-quant-zijin-trainer` 独立于 Web 运行。数据或实验协议变化时自动训练，空闲时每 30 分钟核对一次；训练心跳或定时检查超时后，监督器会写入 `/opt/rabbit-quant-state/zijin-trainer-alerts.jsonl` 并退出，由 Docker 自动重启。

Python 量化逻辑服务继续独立运行在 `127.0.0.1:8765`。真实自动交易默认关闭。
