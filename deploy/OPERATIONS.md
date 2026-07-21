# Production operations

## Automatic deployment

The deploy timer checks the production branch every minute. A release is built under an isolated Git worktree, and live containers are replaced only after both images build successfully. Failed health checks restore the previous images.

```bash
systemctl status rabbit-quant-deploy.timer --no-pager
journalctl -u rabbit-quant-deploy.service -n 100 --no-pager
curl -sS https://www.zhuandianmi.com/api/control/version
```

The newest five web and trainer releases are retained by default. The active and previous rollback images are never removed by the retention pass.

## Verified daily backup

The backup timer runs at 03:30 Asia/Shanghai with a randomized delay. It creates an online SQLite snapshot with `VACUUM INTO`, runs `PRAGMA integrity_check`, archives the account database, training state, shadow ledgers, deployment state and production configuration, then verifies gzip and writes a SHA-256 checksum.

```bash
systemctl status rabbit-quant-backup.timer --no-pager
systemctl start rabbit-quant-backup.service
journalctl -u rabbit-quant-backup.service -n 100 --no-pager
ls -lh /opt/rabbit-quant-backups
sha256sum -c /opt/rabbit-quant-backups/rabbit-quant-*.tar.gz.sha256
```

Backups are mode `0600` and kept for 14 days by default. Historical market datasets under `/opt/rabbit-quant-research` are intentionally excluded from daily archives because they are immutable and large; they should have a separate offline copy.

## Optional operations webhook

Edit `/etc/default/rabbit-quant-ops` and set a generic JSON webhook endpoint:

```bash
RABBIT_QUANT_ALERT_WEBHOOK_URL=https://example.com/operations-webhook
```

Then reload systemd:

```bash
systemctl daemon-reload
```

Deployment and backup results are also written locally even when no webhook is configured:

```bash
cat /var/lib/rabbit-quant-deploy/last-notification.json
cat /var/lib/rabbit-quant-deploy/last-backup-notification.json
```
