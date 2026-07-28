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

## 安全自动部署

首次安装自动部署器时，在服务器仓库中执行一次：

```bash
cd /opt/rabbit-quant-web
git fetch origin codex/vps-production-20260716
git switch codex/vps-production-20260716
git pull --ff-only
bash scripts/install-production-deployer.sh
```

此后 systemd 每分钟检查生产分支。部署流程为：独立 worktree → 构建 Web 与训练器两个新镜像 → Compose 配置预检 → 切换容器 → 四服务健康检查 → 校验线上提交号。构建失败不会替换线上容器；切换后的健康检查失败会自动恢复旧镜像。

```bash
# 定时器与最近一次任务
systemctl status rabbit-quant-deploy.timer
systemctl status rabbit-quant-deploy.service

# systemd 日志与结构化历史
journalctl -u rabbit-quant-deploy.service -n 100 --no-pager
tail -n 100 /var/log/rabbit-quant-deploy/deploy.log
tail -n 20 /var/log/rabbit-quant-deploy/deploy-history.jsonl

# 当前线上提交号
curl -sS http://127.0.0.1:3000/api/control/version
curl -sS https://www.zhuandianmi.com/api/control/version
```
