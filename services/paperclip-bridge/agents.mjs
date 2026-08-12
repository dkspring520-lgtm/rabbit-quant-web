export const PAPERCLIP_ORGANIZATION = Object.freeze({
  organizationId: "double-rabbit-quant-research",
  name: "双兔量化研究院",
  goal: "以可复现、可审计的离线研究提升做T因子质量，所有生产晋级必须人工批准。",
  project: "AI做T因子研究最小闭环",
});

const definitions = [
  {
    agentId: "quant-research",
    name: "探因兔",
    role: "Quant Research Agent",
    responsibilities: ["因子研究", "假设登记", "研究报告解释"],
    scopes: ["dataset:read", "factor:read", "hypothesis:submit", "artifact:read"],
  },
  {
    agentId: "data",
    name: "净源兔",
    role: "Data Agent",
    responsibilities: ["数据质量", "缺失与延迟审计", "数据集登记建议"],
    scopes: ["dataset:read", "dataset:quality:submit", "artifact:read"],
  },
  {
    agentId: "strategy",
    name: "组策兔",
    role: "Strategy Agent",
    responsibilities: ["多因子组合", "候选策略提交", "失效分析"],
    scopes: ["factor:read", "artifact:read", "candidate:submit"],
  },
  {
    agentId: "backtest",
    name: "验真兔",
    role: "Backtest Agent",
    responsibilities: ["离线回测", "样本外验证", "成本与滑点压力测试"],
    scopes: ["dataset:read", "factor:read", "candidate:read", "backtest:run", "artifact:read"],
  },
  {
    agentId: "risk",
    name: "守界兔",
    role: "Risk Agent",
    responsibilities: ["回撤审计", "过拟合检查", "生产晋级否决建议"],
    scopes: ["artifact:read", "risk:submit"],
  },
  {
    agentId: "code",
    name: "铸码兔",
    role: "Code Agent",
    responsibilities: ["开发沙箱代码候选", "研究工具维护"],
    scopes: ["artifact:read", "sandbox:code:write"],
    enabled: false,
  },
  {
    agentId: "qa",
    name: "质检兔",
    role: "QA Agent",
    responsibilities: ["研究契约测试", "数据与回测回归", "候选验收"],
    scopes: ["artifact:read", "sandbox:test", "qa:submit"],
  },
];

export const PAPERCLIP_AGENTS = Object.freeze(definitions.map((definition) => Object.freeze({
  enabled: true,
  ...definition,
  responsibilities: Object.freeze([...definition.responsibilities]),
  scopes: Object.freeze([...definition.scopes]),
})));

export function findAgent(agentId) {
  return PAPERCLIP_AGENTS.find(agent => agent.agentId === agentId) ?? null;
}
