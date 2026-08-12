# Paperclip 研究控制面

该目录只提供独立、隔离的部署样例，不属于主站自动部署流程，也不会自动启动任何服务。

## 固定版本与边界

- Paperclip 固定为 `paperclipai/paperclip@67001ec6eb96ae601aa27bc91d9b2415d665334a` 对应镜像 `ghcr.io/paperclipai/paperclip:sha-67001ec`。
- 组织名称为“双兔量化研究院”，七个角色定义在 `services/paperclip-bridge/agents.mjs`。
- 仅“验真兔”拥有 `backtest:run`；“铸码兔”默认禁用。
- Bridge 只运行固定的因子研究 CLI，没有任意命令、任意路径、交易、账户、生产数据库、Git push 或部署接口。
- 数据集只读挂载；研究制品和任务状态使用独立卷。
- Paperclip 和 Bridge 仅绑定到宿主机回环地址，并处于无外网出口的内部 Docker 网络。
- 不向 Paperclip 容器注入模型密钥，因此本阶段不启用本地 Codex、Claude 或 OpenClaw adapter。

## 准备配置

在目标主机新建 `deploy/paperclip/config`，将样例复制为以下文件并替换占位值：

```text
deploy/paperclip/.env
deploy/paperclip/config/dataset-catalog.json
deploy/paperclip/config/tokens.json
```

数据集 manifest 必须放在只读数据根目录内，路径与 catalog 的 `manifestPath` 一致。数据文件和 manifest 的 `datasetChecksum` 都使用原始数据文件 SHA-256；manifest 必须保留：

```json
{
  "researchOnly": true,
  "canPromoteAutomatically": false
}
```

使用 `openssl rand -hex 32` 分别生成 Paperclip 的两个密钥。Bridge token 也应逐个生成至少 32 字节的随机值；未启用角色保持空字符串。首期只建议为“验真兔”的 `backtest` 项设置 token。

`APP_COMMIT_SHA` 必须来自构建代码的 `git rev-parse HEAD`，用于镜像内没有 `.git` 时仍记录可复现的完整应用提交号。

## 验证与启动

该 Compose 不被现有发布脚本引用。人工确认配置后，先只做解析验证：

```bash
docker compose --env-file deploy/paperclip/.env \
  -f deploy/paperclip/compose.yml config
```

需要正式启动独立研发控制面时再人工执行：

```bash
docker compose --env-file deploy/paperclip/.env \
  -f deploy/paperclip/compose.yml up -d --build
```

默认仅本机可访问：

- Paperclip UI：`http://127.0.0.1:3100`
- Bridge 健康检查：`http://127.0.0.1:3210/health`
- 容器内 Paperclip 调用 Bridge：`http://research-bridge:3210`

首次打开 Paperclip 后，在认证页面创建管理员并领取 private instance。随后按 `services/paperclip-bridge/agents.mjs` 手工建立组织、目标、项目和七个角色；本阶段不激活 Heartbeat，也不把 adapter 接入实时交易链路。

## 回滚

停止并移除研发容器即可，主站、Smart-T、L2、控制服务和生产数据库不会受到影响：

```bash
docker compose --env-file deploy/paperclip/.env \
  -f deploy/paperclip/compose.yml down
```

不要附加 `-v`，这样审计、状态和 Paperclip 数据会保留。确认不再需要时再单独备份并删除三个研究卷。
