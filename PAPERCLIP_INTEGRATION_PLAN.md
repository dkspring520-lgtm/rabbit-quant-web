# Paperclip 接入 AI 做T神器方案

> 状态：Phase 1 研究 Bridge 已实现；Paperclip 控制面尚未启动
> 审计日期：2026-08-12
> 适用范围：AI 量化研发、多 Agent 协作、回测、风控、QA、候选策略审批
> 明确排除：实时交易、账户操作、生产数据库写入、正式策略自动替换、自动部署

## 1. 执行摘要

Paperclip 适合接入本项目，但只能作为独立的“AI 量化研发控制面”，不能进入实时行情和交易数据面。

推荐结构如下：

```text
AI 做T神器（用户入口和现有量化能力）
        |
        | 内部 HTTP API
        v
Paperclip Bridge（鉴权、契约、审计、幂等、权限裁剪）
        |
        +--> Paperclip（组织、目标、项目、任务、Heartbeat、预算、审批、活动）
        |
        +--> 隔离 Agent 运行环境
                  |
                  +--> 只读数据集 / 研究 API
                  +--> 隔离回测 Worker
                  +--> 隔离开发 Worktree
                  +--> 不可变研究制品
        |
        v
人工审批后的候选策略库
        |
        | 现有发布流程中的第二次人工批准
        v
正式策略（不由 Paperclip 自动写入或部署）
```

核心决定：

1. Paperclip 独立部署，不把其源码复制进当前仓库。
2. 现有 `Smart-T` 实时引擎、行情轮询、L2、用户系统和部署流程保持不变。
3. 所有 Agent 通过 Bridge 使用最小权限 API，不直连生产数据库。
4. 原始 L2 文件不进入 Paperclip，只传 `datasetId`、manifest、时间范围和校验和。
5. Agent 结果是不可变研究制品，不是可执行交易指令。
6. Codex 只作为 Level 4 开发 Agent，在隔离 worktree/container 内生成候选 diff。
7. Paperclip 的 Approval 只是研发审批；正式策略晋级还必须经过现有系统的人工批准。

## 2. 审计范围与原则

本次审计只读取现有代码和 Paperclip 当前 GitHub 源码，没有修改交易策略、账户逻辑、数据库、部署配置或现有页面。

现有工作区包含用户尚未提交的修改和研究文件。本方案不依赖清理这些内容，也不建议 Paperclip 使用当前脏工作区作为 Agent 工作目录。

接入原则：

- 复用现有行情、指标、回放、回测、策略和 AI 能力。
- 快速信号保持确定性，LLM/Agent 不进入秒级或分钟级信号循环。
- 研究与生产彻底隔离，默认拒绝所有未显式授予的能力。
- 数据、代码、回测结果和审批均可追溯到同一 `correlationId`。
- 不允许 Agent 因“高置信度”绕过费用、滑点、VWAP、趋势、持仓和风险约束。

## 3. 当前项目架构

### 3.1 前端技术栈

- Next.js `16.2.6`
- React / React DOM `19.2.6`
- TypeScript `5.9.3`
- CSS 和 Tailwind 工具链
- vinext `0.0.50`、Vite `8.0.13`
- Node.js `>=22.13.0`

主要应用位于 `app/`，操盘台和认证后应用由现有 React/Next 页面承担。当前没有必要为了 Paperclip 重写前端；首期直接使用 Paperclip 自带 Web UI 管理研发任务即可。

### 3.2 后端技术栈

项目不是单一后端，而是多服务组合：

- Next.js Route Handlers：行情、市场上下文、回放和研究查询 API。
- Node.js 控制服务：`server/control-plane.mjs`。
- Node.js SQLite 存储层：`server/control-store.mjs`。
- JavaScript 量化核心：`lib/smart-t-engine.mjs`。
- Python 服务/脚本：L2 采集、审计、训练、历史导入和影子研究。
- Docker Compose：Web 蓝绿、控制服务、L2、训练、因子日报、影子和 L2 审计。

### 3.3 数据库与持久化

当前生产控制数据库使用 Node `node:sqlite`：

- 默认容器路径：`/data/rabbit-control.sqlite`
- 主要表：`users`、`sessions`、`profiles`、`monitors`、`alerts`、`service_settings`、`push_subscriptions`、`monitor_scan_logs`、`reset_requests`、`memberships`、`membership_grants`、`membership_codes`、`referrals`

项目同时配置了 Drizzle SQLite/D1 工具链，但 `db/schema.ts` 当前没有承载生产主模型，不应把它误认作现有主数据库。

研究与训练数据还包含 JSON、JSONL、Parquet、分钟归档和挂载卷。Paperclip 不应接管这些数据，只保存它自己的编排元数据和外部制品引用。

### 3.4 行情数据接口

`app/api/market-data/route.ts` 当前封装：

- 腾讯公开行情：报价、日线和分钟数据的主要来源。
- 新浪公开行情：报价回退来源。
- 东方财富公开行情：报价和分钟数据回退来源。
- 数据质量、延迟、源时间戳和失败来源说明。

`app/api/market-context/route.ts` 当前封装：

- 上证指数、沪深 300 等市场上下文。
- 有色金属 ETF、黄金 ETF 等板块/相关资产。
- 紫金港股、沪铜、沪金、伦铜、纽约黄金、美元/人民币等跨市场因子。

这些公开源适合界面展示和研究补充，但 Agent 在回测时必须使用带版本、交易日范围和校验和的数据集，不能把实时公开接口响应当作可复现训练数据。

### 3.5 股票实时数据模块

- `server/control-plane.mjs` 约每 15 秒扫描监控标的。
- `MARKET_DATA_ORIGIN` 指向当前激活 Web 服务。
- L2 由独立 Python 容器/脚本采集、审计和持久化。
- 紫金影子服务按固定周期读取市场和 L2 状态，写入独立 ledger/state。
- Web 端通过 HTTP 请求获取快照。

没有发现 WebSocket、SSE 或 Socket.IO。当前实时架构是 HTTP 轮询加 Web Push，不应为了 Paperclip 强行改成 WebSocket。

### 3.6 指标计算模块

核心指标和条件主要集中或被调用于 `lib/smart-t-engine.mjs` 及研究脚本，包括：

- VWAP 及偏离度
- 分钟动量、成交量和量比
- ATR/真实分钟 OHLC 质量门
- 趋势、开盘结构、价格路径和时段约束
- L2/OFI、资金持续性和价格响应的研究确认层
- 费用、佣金、印花税、滑点和收益风险过滤
- 正 T/反 T 独立的候选、正式、退出和闭环状态

当前并不是一个统一的“通用指标 SDK”。MACD、KDJ、RSI、Bollinger 等研究指标在后续接入中应先复用已有实现；缺失的才增加到独立研究库，不能直接塞入实时核心。

### 3.7 做T策略模块

- `lib/smart-t-engine.mjs`：实时监控与因果回放共用的 Smart-T 核心。
- `lib/stock-agent-router.mjs`：通用 Smart-T 与股票专属研究 Agent 路由。
- `lib/zijin-strategy-experiments.mjs` 及 `scripts/`：紫金专属、影子策略、参数实验和样本外研究。
- `lib/trading-adapter.ts`：disabled/paper/live 接口边界；当前 API 明确 `liveTradingEnabled: false`，并要求人工批准。

Paperclip 不能调用或获得 `trading-adapter` 的 live 能力。即使未来项目启用真实交易，Paperclip 网络和凭证层也必须保持不可达。

### 3.8 回放与回测模块

- `lib/personal-replay-training.mjs`：个人回放训练。
- `app/api/personal-replay-sessions/route.ts`：读取五年分钟归档，提供回放会话。
- `lib/smart-t-engine.mjs`：因果回放、固定窗口标签和研究后验审计。
- `scripts/`：紫金历史导入、影子 A/B、参数搜索和样本外实验。
- `tests/`：策略、L2、因果回放、费用、会员、推送和部署相关测试。

重要边界：回测输入必须带 `datasetId` 和 `asOf`，只允许读取当时及之前的数据，避免未来数据泄漏。

### 3.9 AI 分析模块

- `lib/stock-agent-router.mjs` 已有股票研究 Agent 概念。
- 紫金研究 Agent 当前是观察/解释层，`canExecute: false`。
- `OPENAI_API_KEY`、`OPENAI_MODEL` 主要用于慢速内容生成和分析路径。
- “训练兔/挑战兔/风控兔”等是产品角色或专用流程，不是通用的多 Agent 任务编排平台。

Paperclip 可以补足任务依赖、预算、Heartbeat、审批、活动和审计，但不应替换这些业务分析模块。

### 3.10 API 接口

已确认的 API 分组：

| 分组 | 现有入口 | 用途 | Paperclip 首期权限 |
| --- | --- | --- | --- |
| 行情 | `/api/market-data` | 报价、分钟、日线、质量 | 不直接调用；由 Bridge 包装只读接口 |
| 市场环境 | `/api/market-context` | 指数、板块、商品、跨市场 | 不直接调用；由 Bridge 固化快照 |
| 回放 | `/api/personal-replay-sessions` | 历史会话 | 只读数据集 manifest |
| 研究 | `/api/research/*` | 紫金 L2、影子、训练进度 | 只读或由专用 Worker 生成 |
| 控制 | `/api/control/*` | 用户、监控、会员和控制面 | 禁止 Agent 调用 |
| 交易适配 | `/api/trading-adapter` | 交易能力状态 | 禁止 Agent 调用 |

### 3.11 WebSocket 与实时推送

- 没有发现 WebSocket/SSE 服务。
- 实时监控由 HTTP 轮询完成。
- 用户提醒使用 Web Push 和 `push_subscriptions`。
- Paperclip 自己的 UI 实时状态属于其控制面，不应接入交易分钟链路。

### 3.12 用户系统

当前用户、会话、资料、会员权益、监控、提醒、推荐等由控制服务和 SQLite 管理。Paperclip 使用独立认证和独立用户域；两套用户系统首期不做账号合并。

需要进入 Paperclip 的只有管理员/研发人员，不是所有交易产品用户。未来如需单点登录，应通过 OIDC/反向代理设计单独评审。

### 3.13 配置与环境变量

现有配置按职责分组：

- 控制服务：`CONTROL_DB_PATH`、`CONTROL_PLANE_ORIGIN`、`CONTROL_PORT`、`MARKET_DATA_ORIGIN`、`MONITOR_INTERVAL_MS`
- AI：`OPENAI_API_KEY`、`OPENAI_MODEL`
- 构建版本：`NEXT_PUBLIC_APP_COMMIT_SHA`、`NEXT_PUBLIC_APP_BUILD_TIME`
- Smart-T 回放：`SMART_T_ENGINE_PATH`、`SMART_T_MAX_YEAR`、`SMART_T_OVERRIDES`、`SMART_T_SESSION_LIMIT`、`SMART_T_VARIANTS`
- 紫金研究：`ZIJIN_*` 系列路径、轮询、费用、滑点、L2、影子、训练和生命周期配置

Agent 不得直接获得生产 `.env`。Bridge 只向每个任务注入白名单变量和短期凭证，且不记录变量值。

### 3.14 当前 Agent/AI 任务系统判断

当前项目存在业务角色化 AI、影子任务、定时训练和监控循环，但不存在以下统一能力：

- 组织和 Agent 组织图
- Goal/Project/Task 依赖图
- 原子任务领取
- 跨 Agent Heartbeat
- 每 Agent 预算
- 结构化人工审批
- 统一活动审计

因此 Paperclip 的价值是补充研发编排，而不是替换量化能力。

### 3.15 Codex 最适合的接入层

Codex 应定位为 **Level 4 Code Agent**：

- 输入：已批准的 `CodeChangeRequest`、策略候选和测试要求。
- 工作区：临时只读基线克隆加隔离 worktree/container。
- 输出：候选 diff、变更说明、测试证据、回滚说明。
- 禁止：访问生产密钥、使用当前脏工作区、自动 push、自动部署、修改正式策略注册表。

## 4. Paperclip 当前版本审计

### 4.1 审计基线

本方案以 GitHub 当前默认分支源码为准：

- 仓库：`paperclipai/paperclip`
- 默认分支：`master`
- 审计 commit：`67001ec6eb96ae601aa27bc91d9b2415d665334a`
- commit 时间：`2026-08-12T04:37:07Z`

部署时必须固定 commit 或发行版本，不能直接跟随可变的 `latest`。

### 4.2 技术架构

- 前端：React 19、Vite、React Router、Radix、Tailwind、TanStack Query。
- 后端：Node.js 20+、Express 5、TypeScript。
- 数据：PostgreSQL 17/PGlite、Drizzle ORM。
- 认证：Better Auth、用户会话、Agent API Key、Heartbeat 短期 JWT。
- 存储：本地文件或 S3 兼容对象存储。
- 默认端口：`3100`。

### 4.3 核心能力映射

| Paperclip 概念 | 当前能力 | 本项目用途 |
| --- | --- | --- |
| Company / Organization | 公司和 Agent 组织关系 | “AI量化研发中心”及七个 Agent |
| Goal | 层级目标 | 扣费后收益、稳健性和数据质量目标 |
| Project | 交付项目和工作区 | 紫金策略优化、通用指标研究等 |
| Issue / Task | 可依赖、可分派的工作项 | 数据、研究、回测、风控、QA、代码任务 |
| Heartbeat Run | 定时/事件唤醒 Agent | 推进慢速研发任务，不参与实时信号 |
| Budget / Cost | Token/费用记录和上限 | 控制每个 Agent 的月度研究成本 |
| Approval | 批准、拒绝、修订、重提 | 候选研究审批，不等于生产发布批准 |
| Activity / Audit | 追加式活动记录 | 任务、Agent、run、制品和审批追踪 |
| Adapter | Agent 运行适配器 | Codex、HTTP Worker、OpenClaw 等 |
| Web UI | 组织、任务、预算、审批界面 | 研发管理后台 |

### 4.4 Agent adapters

当前源码确认的主要适配方式包括：

- `codex_local`：运行 Codex CLI，可延续会话并采集输出/成本。
- `claude_local`：本地 Claude 类适配器。
- `process`：通用进程。
- `http`：调用外部 HTTP Agent/Worker。
- `openclaw_gateway`：通过 OpenClaw Gateway 接入。
- 另有 OpenCode、Cursor、Pi、Hermes 等扩展。

本项目首选：

- Data、Backtest：HTTP adapter 调用隔离 Worker。
- Quant、Strategy、Risk、QA：HTTP 或受限 Codex adapter。
- Code：受限 `codex_local`，只能进入临时开发 worktree。
- OpenClaw：保留为后续外部 Agent 网关，不作为第一阶段依赖。

Paperclip 本地 CLI adapter 默认可能拥有较宽的主机权限，因此禁止把它的 `cwd` 指向生产目录或当前业务工作区。

### 4.5 Heartbeat、预算和审批

- Heartbeat 可由定时、任务分配、评论提及、人工调用和审批结果触发。
- Agent 通过原子 `checkout` 领取 Issue，避免重复执行。
- 长任务应拆为子 Issue，由完成事件唤醒父任务，不让 Agent 高频轮询。
- 每月预算达到上限时可自动暂停 Agent。
- Approval 支持 approve、reject、request-revision、resubmit。
- 所有变更请求应携带 run 身份，并写入追加式活动记录。

注意：Paperclip 的预算是算力/Token 预算，不是仓位或交易风险预算；交易风险仍由本项目 Risk Agent 和现有规则判断。

### 4.6 数据存储边界

Paperclip 只保存：

- 组织、目标、项目、任务和依赖
- Agent 配置和运行记录
- 成本、审批、评论、活动和审计
- 研究制品的引用、摘要和校验和

Paperclip 不保存：

- 用户账户和持仓
- 生产控制数据库副本
- 原始逐笔/L2 大文件
- 实时下单凭证
- 正式交易策略的可写主副本

## 5. 推荐接入方式

### 5.1 为什么需要 Bridge

不建议让 Paperclip Agent 直接调用现有 `/api/*`，因为现有接口是产品接口，不是 Agent 权限边界。新增独立 Bridge 可以统一实现：

- Agent 身份到 scope 的映射
- 输入 schema 校验
- 幂等和关联 ID
- HMAC/Webhook 验证
- 数据集版本固化
- 输出脱敏和大小限制
- 速率限制、超时、重试和熔断
- 禁止交易及生产写入的硬拦截

### 5.2 通信选择

第一阶段：

- 普通编排：内部 HTTP API。
- 完成通知：签名 Webhook。
- 长时间回测：返回 `202 + jobId`，由持久 Worker 执行。
- 状态查询：低频 GET 或完成 Webhook，不在 Agent 中忙轮询。

第二阶段只有在并发量和可靠性证明确有需要时，才增加 PostgreSQL 持久任务队列或专用消息队列。当前不建议先引入 RabbitMQ，避免为了很低的研究并发增加运维复杂度。

### 5.3 谁调用谁

```text
产品管理员
  -> AI 做T神器研发入口
  -> Bridge: 创建研发任务
  -> Paperclip: 创建 Project/父 Issue/子 Issue

Paperclip Agent
  -> Bridge: 获取白名单数据集、启动研究或回测
  -> Quant Worker: 读取只读数据，生成不可变制品
  -> Bridge: 回写制品引用和状态
  -> Paperclip: 更新 Issue、Activity、Cost、Approval

人工审批者
  -> Paperclip: 批准“研发候选”
  -> Bridge: 创建候选策略包（仍不可执行）
  -> 现有系统: 独立人工批准后才进入正式策略库
```

## 6. AI 量化 Agent 团队

### 6.1 组织结构

Paperclip Company：`AI 做T神器量化研发中心`

建议 Goal：

- 提高扣费后净收益和盈利因子。
- 控制最大回撤和样本外退化。
- 提高行情/L2 数据质量和可复现性。
- 保持生产策略人工审批和交易权限隔离。

每个策略研究建立独立 Project，例如 `601899 紫金多因子T引擎`，每轮实验建立父 Issue 和有依赖关系的子 Issue。

### 6.2 Agent 职责

| Agent | 主要职责 | 输入 | 输出 | 最高权限 |
| --- | --- | --- | --- | --- |
| Quant Research Agent | MACD、KDJ、RSI、Bollinger、VWAP、量价、振幅、分时、趋势、资金、多因子假设 | DatasetManifest、研究目标 | ResearchHypothesis | L2 |
| Data Agent | 实时/历史数据清单、缺失、延迟、异常、复权、交易日、L2 质量 | 数据集请求 | DatasetManifest、DataQualityReport | L1 |
| Strategy Agent | 组合指标、参数边界、正反T独立状态、失效条件 | 假设和数据质量 | StrategyCandidate | L2/L5 |
| Backtest Agent | 因果回测、费用、滑点、市场环境、样本内外、滚动窗口 | 候选和数据集 | BacktestReport | L3 |
| Risk Agent | 回撤、尾部行情、仓位、流动性、过拟合和稳定性 | 候选及回测报告 | RiskVerdict | L3 |
| QA Agent | schema、API、策略不变量、前端、数据、回归和未来泄漏测试 | 所有制品或代码 diff | QAReport | L3 |
| Code Agent | 按已批准变更请求修改隔离开发代码并生成 diff | CodeChangeRequest | PatchArtifact、TestEvidence | L4 |

### 6.3 Agent 硬约束

所有 Agent 必须遵守：

- 不得调用真实交易接口。
- 不得读写用户持仓、账户和会员数据。
- 不得修改生产 SQLite 或其他生产数据库。
- 不得修改生产策略注册表。
- 不得拥有部署、服务器 SSH、Docker daemon 或 Git push 凭证。
- 不得把候选信号包装为确定性的投资建议。
- 证据冲突时输出“观察/等待/拒绝”，不能强制产生买卖结论。

## 7. Agent 工作流

### 7.1 标准流程

以“优化紫金矿业做T策略”为例：

```text
用户创建研发任务
  -> Paperclip 创建父 Issue 和验收标准
  -> Data Agent 固化数据集并出具质量报告
  -> Quant Research Agent 形成可证伪假设
  -> Strategy Agent 形成候选策略（不执行）
  -> Backtest Agent 进行因果、扣费和滑点回测
  -> Risk Agent 审查回撤、过拟合、流动性和稳定性
  -> QA Agent 做研究制品预检
  -> Code Agent 在隔离 worktree 生成候选 diff
  -> Backtest Agent 对候选代码再次回测
  -> QA Agent 做回归和安全不变量检查
  -> Paperclip 请求人工研发审批
  -> Bridge 生成不可执行的候选策略包
  -> 现有系统中的人工发布审批
  -> 才可能进入正式策略库
```

Paperclip 可以按用户期望展示 Quant -> Data 的任务讨论顺序，但执行依赖必须要求 Data Agent 先完成可复现数据集，Quant 假设才允许进入正式回测。

### 7.2 审批门

| 门 | 必须证据 | 失败处理 |
| --- | --- | --- |
| G0 任务受理 | 目标、标的、周期、指标、基线、预算 | 退回补充，不启动 Agent |
| G1 数据可用 | manifest、覆盖率、缺失、时区、复权、校验和 | 阻断研究或标记可接受缺口 |
| G2 假设合格 | 因果依据、失效条件、参数搜索边界 | 退回 Quant/Strategy |
| G3 回测合格 | 扣费、滑点、样本外、交易数、PF、回撤 | 候选淘汰或修订 |
| G4 风险合格 | 过拟合、极端行情、流动性、仓位、稳定性 | Risk veto，不可由高胜率覆盖 |
| G5 QA 合格 | 未来泄漏、回归、安全不变量、可复现 | 退回 Code/Backtest |
| G6 研发人工审批 | 完整证据链和候选包 | 仅允许进入候选策略库 |
| G7 生产人工审批 | 现有发布人独立批准 | 才允许按现有流程发布 |

G6 与 G7 必须是两个不同的审批动作。Paperclip 不能自动执行 G7。

### 7.3 研究评价指标

每个 BacktestReport 至少包含：

- 信号数、正式闭环数、闭环率
- 扣费后胜率、平均盈利、平均亏损、盈亏比
- 扣费后净收益、盈利因子、最大回撤
- 每边 5bp 等压力滑点结果
- 正 T 与反 T 分开统计
- 不同时段、趋势/震荡/下跌市场环境统计
- 训练、验证、滚动样本外和最终留出集
- 参数敏感性和稳定区间
- 数据缺失日、L2 可用日和非 L2 日分别统计

不能以胜率单一指标决定晋级。

## 8. 制品与数据契约

所有制品使用版本化 JSON Schema，并写入不可变对象存储。Paperclip 保存 URI 和摘要，不复制大文件。

| 制品 | 必需字段摘要 |
| --- | --- |
| DatasetManifest | `datasetId`、symbol、时间范围、频率、来源、复权、时区、缺失率、L2 覆盖、schemaVersion、checksum、asOf |
| DataQualityReport | 延迟、重复、乱序、缺口、异常值、分钟/逐笔一致性、结论 |
| ResearchHypothesis | hypothesisId、指标、因果说明、方向、参数边界、失效条件、禁止条件 |
| StrategyCandidate | candidateId、baseVersion、symbolScope、entry/exit、成本门、风险门、配置 hash、状态 `research_only` |
| BacktestReport | datasetId、candidateId、engineVersion、费用、滑点、统计、样本切分、逐笔审计 URI、reproducibilityHash |
| RiskVerdict | verdict、风险项、veto、适用市场、仓位上限建议、证据 URI |
| QAReport | schema/API/策略/数据/回归结果、安全不变量、失败清单 |
| CodeChangeRequest | 允许文件、禁止文件、验收测试、基线 commit、候选制品引用 |
| ApprovalRecord | 审批人、时间、制品 hash、范围、决定、备注 |

关键规则：

- 没有 L2 的分钟值保留为 `null/missing`，绝不能填 `0`。
- `datasetId` 一经用于回测不得覆盖，只能创建新版本。
- 回测只读取 `asOf` 时刻及之前的数据。
- 每次结果必须记录代码 commit、引擎版本、配置 hash 和数据 checksum。

## 9. 内部 API 设计

所有写接口必须支持：

- `Authorization: Bearer <short-lived-token>`
- `Idempotency-Key`
- `X-Correlation-Id`
- `X-Paperclip-Run-Id`
- 服务间 HMAC 签名、时间戳和 nonce
- JSON Schema 版本

### 9.1 核心接口

| 接口 | 调用方 -> 被调用方 | 输入 | 输出 | Scope |
| --- | --- | --- | --- | --- |
| `POST /internal/paperclip/v1/research-jobs` | 产品后台 -> Bridge | symbol、目标、周期、基线、预算 | `202 jobId/correlationId` | `research_job:create` |
| `GET /internal/quant/v1/datasets/{datasetId}/manifest` | Data/Quant Agent -> Bridge | datasetId | DatasetManifest | `dataset:read` |
| `POST /internal/quant/v1/datasets/snapshots` | Data Agent -> Bridge | symbol、范围、频率、asOf | `202 datasetJobId` | `dataset:snapshot` |
| `POST /internal/quant/v1/hypotheses` | Quant Agent -> Bridge | ResearchHypothesis | artifactRef | `hypothesis:submit` |
| `POST /internal/quant/v1/backtests` | Backtest Agent -> Bridge | candidateId、datasetId、cost/slippage、split | `202 backtestJobId` | `backtest:run` |
| `GET /internal/quant/v1/backtests/{jobId}` | Agent/Paperclip -> Bridge | jobId | status、BacktestReport ref | `backtest:read` |
| `POST /internal/quant/v1/strategy-candidates` | Strategy Agent -> Bridge | StrategyCandidate | immutable candidate ref | `candidate:submit` |
| `POST /internal/quant/v1/risk-verdicts` | Risk Agent -> Bridge | RiskVerdict | artifactRef、gate status | `risk:submit` |
| `POST /internal/quant/v1/qa-reports` | QA Agent -> Bridge | QAReport | artifactRef、gate status | `qa:submit` |
| `POST /internal/quant/v1/code-change-requests` | 已批准的编排任务 -> Bridge | CodeChangeRequest | sandbox jobId | `code_sandbox:request` |
| `POST /internal/quant/v1/candidates/{id}/approval-requests` | Bridge -> Paperclip | 制品引用、证据链 | approvalId | `approval:request` |
| `POST /internal/paperclip/v1/webhooks/events` | Paperclip -> Bridge | run/issue/approval 事件 | `202 accepted` | HMAC webhook |

### 9.2 示例：启动回测

```json
{
  "schemaVersion": "1.0",
  "candidateId": "cand_601899_20260812_001",
  "datasetId": "ds_601899_1m_l2_20250102_20260811_v3",
  "asOf": "2026-08-11T15:00:00+08:00",
  "engine": "smart-t-causal",
  "splitPolicy": "rolling-out-of-sample",
  "costModel": {
    "commissionMode": "actual-minimum-aware",
    "stampTax": true,
    "transferFee": true,
    "slippageBpsPerSide": [0, 2, 5]
  },
  "permissions": {
    "liveTrading": false,
    "productionWrite": false
  }
}
```

返回：

```json
{
  "jobId": "bt_01J...",
  "status": "queued",
  "correlationId": "corr_01J...",
  "artifactPolicy": "immutable"
}
```

### 9.3 错误处理

- `400/422`：schema 或业务约束错误，不重试，回写 Issue。
- `401/403`：权限错误，立即停止 run 并记录安全事件。
- `409`：幂等键冲突，返回原任务引用。
- `408/429/5xx`：按指数退避重试，设置最大次数和总时限。
- 回测超时：Worker 标记 `timed_out`，保留日志和部分制品，不自动扩大资源。
- Webhook 重复：按事件 ID 去重，返回成功但不重复执行。
- 超过重试上限：进入持久失败队列，创建人工恢复 Issue。
- Agent 不得通过改参数或换接口绕过 Risk/QA veto。

## 10. 权限与安全设计

### 10.1 权限等级

| 等级 | 能力 | 允许对象 | 明确禁止 |
| --- | --- | --- | --- |
| L1 | 读取数据 | 版本化只读数据集和 manifest | 用户库、账户、实时交易凭证 |
| L2 | 策略研究 | 生成假设和研究制品 | 修改正式策略 |
| L3 | 运行回测 | 隔离 Worker、只读数据、临时计算空间 | 生产数据库写入 |
| L4 | 修改开发代码 | 临时 worktree/container、允许文件清单 | push、部署、生产目录 |
| L5 | 提交候选版本 | 不可变候选制品和审批请求 | 激活策略 |
| L6 | 人工生产批准 | 仅授权人员、现有发布流程 | 任何 Agent 自动批准 |

### 10.2 Agent scope 建议

- Data：`dataset:read`、`dataset:snapshot`、`quality:submit`
- Quant：`dataset:read`、`hypothesis:submit`
- Strategy：`artifact:read`、`candidate:submit`
- Backtest：`dataset:read`、`candidate:read`、`backtest:run/read`
- Risk：`artifact:read`、`risk:submit`
- QA：`artifact:read`、`sandbox:test`、`qa:submit`
- Code：`artifact:read`、`code_sandbox:write`，且受允许文件清单限制

不存在 `trade:*`、`account:*`、`production_db:*`、`deploy:*` 或 `git:push` scope。

### 10.3 网络隔离

建议分为四个网络区：

1. 产品区：现有 Web、control、L2 实时服务。
2. 研发控制区：Paperclip、Bridge、Paperclip PostgreSQL，仅内网/VPN 可达。
3. 研究执行区：短生命周期 Agent/回测容器，只能访问 Bridge 和只读制品存储。
4. 生产发布区：现有部署服务；研究执行区无路由、无凭证可达。

### 10.4 凭证和审计

- 使用 Paperclip Heartbeat 注入的短期 JWT，不给 Agent 长期共享密钥。
- Bridge 使用独立服务身份和短 TTL token。
- Paperclip secret strict mode 应启用，主密钥来自文件或密钥管理服务。
- 日志禁止记录 Authorization、Cookie、API Key、用户数据和完整原始行情 payload。
- 每个写操作记录 agentId、runId、issueId、correlationId、制品 hash 和结果。
- 审计日志追加写，保留策略按合规要求设置。

### 10.5 不可绕过的安全不变量

QA 必须自动验证：

- `liveTradingEnabled` 仍为 false。
- Bridge 路由表不存在交易和账户写接口。
- Agent 网络无法访问生产数据库和部署端口。
- Code Agent 的 diff 不包含禁止文件。
- Candidate 状态只能是 `research_only` 或 `pending_human_approval`。
- 没有 G6/G7 双审批不能产生正式策略版本。

## 11. 未来文件结构设计

Paperclip 本体保持独立部署。当前业务仓库在方案获批后只增加桥接和契约代码：

```text
services/
  paperclip-bridge/
    server.mjs
    auth.mjs
    scopes.mjs
    idempotency.mjs
    webhook.mjs
    artifact-store.mjs
    job-runner.mjs

lib/
  research-contracts/
    dataset-manifest.schema.json
    research-hypothesis.schema.json
    strategy-candidate.schema.json
    backtest-report.schema.json
    risk-verdict.schema.json
    qa-report.schema.json
    code-change-request.schema.json

app/api/
  research-jobs/
    route.ts

tests/
  paperclip-bridge.test.mjs
  research-contracts.test.mjs
  paperclip-security-invariants.test.mjs

deploy/                  # 推荐放独立基础设施仓库
  paperclip/
    compose.yml
    env.example
    reverse-proxy.conf
```

首期不修改：

- `lib/smart-t-engine.mjs`
- `lib/trading-adapter.ts`
- `server/control-store.mjs`
- 生产 SQLite schema
- 现有 L2 采集逻辑
- `compose.web.yml`
- 自动部署脚本

## 12. 预计文件修改清单

### 当前阶段

只新增：

- `PAPERCLIP_INTEGRATION_PLAN.md`

### 方案批准后的最小实现阶段

优先新增而非修改：

- `services/paperclip-bridge/*`
- `lib/research-contracts/*`
- `tests/paperclip-bridge.test.mjs`
- `tests/research-contracts.test.mjs`
- `tests/paperclip-security-invariants.test.mjs`
- 独立基础设施仓库中的 Paperclip Compose 和反向代理配置

可能需要的最小现有文件修改，必须在实施前再次确认：

- `package.json`：只增加 Bridge 启动/测试脚本及必要依赖。
- `app/api/research-jobs/route.ts`：新增管理员发起任务入口，不复用控制接口。
- 管理员研发页面：只显示 Paperclip 任务状态，不改变操盘台实时链路。

## 13. 环境变量设计

只列名称，不在仓库保存值。

### 13.1 Paperclip 独立服务

- `PORT`
- `PAPERCLIP_BIND`
- `PAPERCLIP_BIND_HOST`
- `PAPERCLIP_API_URL`
- `PAPERCLIP_HOME`
- `PAPERCLIP_INSTANCE_ID`
- `PAPERCLIP_DEPLOYMENT_MODE`
- `PAPERCLIP_DEPLOYMENT_EXPOSURE`
- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `PAPERCLIP_SECRETS_MASTER_KEY_FILE`
- `PAPERCLIP_SECRETS_STRICT_MODE`
- `PAPERCLIP_TOOL_ACTION_SIGNING_SECRET`

### 13.2 Bridge

- `PAPERCLIP_BASE_URL`
- `PAPERCLIP_COMPANY_ID`
- `PAPERCLIP_PROJECT_ID`
- `PAPERCLIP_BRIDGE_CREDENTIAL_FILE`
- `PAPERCLIP_WEBHOOK_HMAC_SECRET_FILE`
- `QUANT_INTERNAL_API_BASE_URL`
- `QUANT_JOB_DATABASE_URL`
- `QUANT_ARTIFACT_STORE_URI`
- `QUANT_DATASET_ROOT`
- `QUANT_CODE_SANDBOX_ROOT`
- `QUANT_MAX_BACKTEST_MINUTES`
- `QUANT_MAX_ARTIFACT_BYTES`
- `PRODUCTION_PROMOTION_ENABLED=false`
- `TRADING_CAPABILITY_ENABLED=false`

### 13.3 Agent 运行时

Paperclip 自动注入：

- `PAPERCLIP_AGENT_ID`
- `PAPERCLIP_COMPANY_ID`
- `PAPERCLIP_API_URL`
- `PAPERCLIP_API_KEY`
- `PAPERCLIP_RUN_ID`
- `PAPERCLIP_TASK_ID`
- `PAPERCLIP_WAKE_REASON`
- `PAPERCLIP_APPROVAL_ID`

Agent 不得继承现有生产 `.env`。只通过短期 token 访问 Bridge。

## 14. 部署方案

### 14.1 推荐部署拓扑

- Paperclip：独立容器/主机，固定审计过的版本。
- Paperclip PostgreSQL：独立数据库和备份，不与控制 SQLite 共用。
- Bridge：独立无状态服务；幂等和长任务状态放独立 PostgreSQL。
- Artifact Store：S3 兼容对象存储或只读挂载，启用版本和校验和。
- Agent Worker：按任务启动短生命周期容器。
- Code Sandbox：临时克隆和 worktree，任务完成后只保留 diff/测试制品。
- Paperclip UI：仅 VPN/内网访问，启用认证和 TLS。

### 14.2 资源和预算

- Paperclip 控制面与实时行情服务分开 CPU、内存和磁盘配额。
- 回测 Worker 单独限时、限内存、限并发。
- 原始 L2 数据只读挂载，不复制到容器层和 Paperclip 附件。
- 每 Agent 设置月度预算和单任务预算，达到上限自动暂停。
- Paperclip 或回测失败不得影响现有 Web、control、L2 和部署服务健康。

## 15. 分阶段开发步骤

### Phase 0：方案确认

- 确认本文的边界、Agent 职责、权限等级和双审批。
- 确认首个试点仅使用紫金矿业影子研究，不触碰正式策略。

### Phase 1：契约和只读 Bridge

- 建立 JSON Schema 和制品版本规则。
- 实现 Agent 身份、scope、幂等、HMAC、关联 ID 和审计。
- 只开放数据集 manifest 和已有研究制品读取。
- 加入禁止交易、禁止生产写入的自动测试。

### Phase 2：独立 Paperclip 控制面

- 固定 Paperclip commit/版本并独立部署。
- 建立 Company、Goal、Project 和七个 Agent。
- 配置预算、Heartbeat、Issue 模板和研发 Approval。
- 首期只启用 Data、Quant 和 Backtest 的只读/研究能力。

### Phase 3：回测和风险流水线

- 接入隔离回测 Worker。
- 生成不可变 BacktestReport、RiskVerdict 和 QAReport。
- 验证费用、滑点、未来泄漏和滚动样本外测试。

### Phase 4：Code Agent 沙箱

- 建立临时基线克隆和允许文件清单。
- Codex 只能生成候选 diff 和测试证据。
- 禁用 push、部署和生产网络。

### Phase 5：候选策略和双审批

- Paperclip 审批后只生成 `research_only` 候选包。
- 由现有策略管理流程进行第二次人工批准。
- 首批候选只进影子层，运行至少规定的交易日和闭环数。

### Phase 6：受控试点验收

- 用“优化紫金矿业做T策略”跑完整链路。
- 注入数据缺失、回测超时、预算耗尽、Webhook 重复和 Risk veto 故障。
- 确认关闭 Paperclip 后现有产品完全正常。

## 16. 验收标准

接入被认为可用，至少满足：

- Paperclip 故障不影响实时行情、操盘台、L2、用户和部署。
- 七个 Agent 均只能使用已声明 scope。
- 任一任务可由 correlationId 追踪到数据、代码、回测、风险、QA 和审批。
- 相同 Idempotency-Key 不产生重复回测或候选。
- 回测结果可由相同 commit、配置和 dataset checksum 重现。
- Risk veto 和 QA failure 无法被其他 Agent 覆盖。
- Code Agent 不能修改禁止文件、push 或部署。
- 无双审批无法进入正式策略库。
- 网络测试证明 Agent 无法访问交易接口和生产数据库。

## 17. 主要风险与缓解措施

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Agent 权限过宽 | 生产代码或数据被误改 | Bridge 白名单、短期 token、网络隔离、允许文件清单 |
| Paperclip CLI 无沙箱 | 主机文件暴露 | 仅在临时容器/worktree 运行，不挂生产目录 |
| 未来数据泄漏 | 回测虚高 | dataset `asOf`、因果引擎、QA 泄漏测试 |
| 数据集漂移 | 结果不可复现 | 不可变 datasetId、checksum、schemaVersion |
| 指标重复实现 | 实时与回测逻辑分叉 | 优先复用 Smart-T；新增指标先进入研究库 |
| 胜率导向过拟合 | 样本外亏损 | PF、净收益、回撤、滚动样本外、参数稳定性联合门槛 |
| Agent 循环和成本失控 | Token/算力浪费 | Issue 依赖、Heartbeat 事件唤醒、月度和单任务预算 |
| 大 L2 文件进入任务载荷 | 数据库/磁盘膨胀 | 只传 manifest/URI/checksum，原始数据只读挂载 |
| Paperclip 升级破坏兼容 | 编排不可用 | 固定版本、预发布环境验证、OpenAPI 契约测试 |
| Approval 被误当成发布 | 候选直接上线 | G6/G7 双审批、`research_only` 状态机、无 deploy scope |

## 18. 回滚方案

该架构是旁路接入，回滚不需要回滚交易核心：

1. 关闭产品中的 Paperclip 研发入口 feature flag。
2. 停止 Bridge 和 Agent Worker，撤销其短期/服务凭证。
3. 暂停 Paperclip Heartbeat，保留 PostgreSQL 和审计只读备份。
4. 将未完成 Issue 标记为暂停；不可变制品保留但不晋级。
5. 现有 Web、control、L2、Smart-T、回放和部署服务继续运行。
6. 若需恢复 Paperclip，先从独立数据库备份恢复，再重新签发 Bridge 凭证。

因为第一阶段不修改生产数据库、不替换正式策略、不进入实时路径，所以 Paperclip 可被整体移除而不影响 AI 做T神器现有功能。

## 19. 最终建议

批准后应从一个低风险纵向切片开始：

```text
紫金历史数据 manifest
  -> 单个 Quant 假设
  -> 单个 StrategyCandidate
  -> 因果回测
  -> Risk + QA
  -> 人工审批
  -> 影子候选
```

不要第一步就开放 Code Agent，也不要让 Paperclip 接管现有定时监控。先证明数据可复现、制品契约稳定、权限不可绕过和关闭后无业务影响，再逐步启用代码沙箱和更多 Agent。

本方案完成后停留在设计阶段，等待人工确认后再实施。
