#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="${RABBIT_QUANT_REPO:-/opt/rabbit-quant-web}"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "请使用 root 运行此安装脚本。" >&2
  exit 1
fi

for command in git docker curl flock systemctl; do
  command -v "$command" >/dev/null || { echo "缺少命令：$command" >&2; exit 1; }
done

install -d -m 0755 /var/lib/rabbit-quant-deploy /var/log/rabbit-quant-deploy
install -m 0755 "$REPO_DIR/scripts/deploy-production.sh" /usr/local/sbin/rabbit-quant-deploy
install -m 0644 "$REPO_DIR/deploy/systemd/rabbit-quant-deploy.service" /etc/systemd/system/rabbit-quant-deploy.service
install -m 0644 "$REPO_DIR/deploy/systemd/rabbit-quant-deploy.timer" /etc/systemd/system/rabbit-quant-deploy.timer
install -m 0644 "$REPO_DIR/deploy/logrotate/rabbit-quant-deploy" /etc/logrotate.d/rabbit-quant-deploy

systemctl daemon-reload
systemctl enable --now rabbit-quant-deploy.timer
systemctl start rabbit-quant-deploy.service

echo "自动部署已启用。"
echo "查看定时器：systemctl status rabbit-quant-deploy.timer"
echo "查看日志：journalctl -u rabbit-quant-deploy.service -n 100 --no-pager"
