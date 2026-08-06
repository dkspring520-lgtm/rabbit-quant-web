# Production operations

## Automatic deployment

The deploy timer checks the production branch every minute. A release is built under an isolated Git worktree, and live containers are replaced only after both images build successfully. Failed health checks restore the previous images.

```bash
systemctl status rabbit-quant-deploy.timer --no-pager
journalctl -u rabbit-quant-deploy.service -n 100 --no-pager
curl -sS https://www.zhuandianmi.com/api/control/version
```

## Growth content automation

The growth timer runs daily at 02:00 Asia/Shanghai. It collects Baidu suggestions, generates one review draft, and stores it in `/opt/rabbit-quant-state/growth-content.json`. Configure `OPENAI_API_KEY` in `/etc/default/rabbit-quant-ops` for AI long-form generation; without it, the safe template fallback still runs.

```bash
systemctl status rabbit-quant-growth.timer --no-pager
systemctl start rabbit-quant-growth.service
journalctl -u rabbit-quant-growth.service -n 100 --no-pager
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

Before accepting paid users, a backup is considered verified only when the service exits successfully, a new archive exists, and its checksum passes. If the unit is marked failed, run the following on the VPS and keep the journal output for diagnosis:

```bash
systemctl reset-failed rabbit-quant-backup.service
docker inspect rabbit-quant-control --format '{{.State.Status}}'
docker exec rabbit-quant-control test -r /data/rabbit-control.sqlite
systemctl start rabbit-quant-backup.service
journalctl -u rabbit-quant-backup.service -n 120 --no-pager
ls -lt /opt/rabbit-quant-backups/rabbit-quant-*.tar.gz | head -n 1
sha256sum -c "$(ls -t /opt/rabbit-quant-backups/rabbit-quant-*.tar.gz.sha256 | head -n 1)"
```

The deployment script synchronizes the backup script and systemd unit whenever the production commit changes. A failed verification must be resolved before treating the release as commercially ready.

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
