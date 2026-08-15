"use client";

import { useMemo, useState } from "react";

export type ZijinFactorLifecycle = {
  schemaVersion:number;
  registryVersion:string;
  stock:{code:string;name:string};
  updatedAt:string;
  formalStrategy:{id:string;version:string;writeEnabled:boolean;factorWritesAllowed:boolean;note:string};
  scheduler:{enabled:boolean;mode:string;timezone:string;window:string;runCommand:string;shadowOnly:boolean};
  pools:{formal:string[];shadow:string[];observe:string[];rejected:string[];retired:string[]};
  factors:Array<{
    id:string;version:string;displayName:string;scope:string;pool:string;status:string;executionMode:string;
    enabled:boolean;affectsFormalStrategy:boolean;sendsAlerts:boolean;formula:string;
    evidence?:{source?:string;researchStatus?:string;costModelPct?:number;note?:string};
  }>;
  daily:{
    runId:string;marketDate:string|null;completedAt:string|null;status:string;mode:string;
    summary?:{total?:number;formal?:number;shadow?:number;observe?:number;rejected?:number;insufficient?:number;promoted?:number;shadowEvents?:number};
    factors?:Array<{id:string;decision:string;eligibleForFormal:boolean;shadowEvents:number;reason:string}>;
    scheduler?:{window?:string;timezone?:string;nextAction?:string};
  };
  shadow:{integrity:{eventCount:number}}|null;
  meta?:{servedAt:string;formalStrategyWriteEnabled:boolean;registrySource:string;dailySource:string;shadowSource:string|null;dailyStale:boolean;shadowStale:boolean};
};

type ZijinFactorGraphNode = {
  id:string;
  label:string;
  group:"source"|"engine"|"factor"|"shadow"|"formal";
  x:number;
  y:number;
  detail:string;
  factorId?:string;
};

type ZijinFactorGraphEdge = { from:string; to:string };

function buildZijinFactorGraph(lifecycle:ZijinFactorLifecycle) {
  const visibleFactors=lifecycle.factors.slice(0,4);
  const omittedFactors=Math.max(0,lifecycle.factors.length-visibleFactors.length);
  const factorNodes=[...visibleFactors,...(omittedFactors>0?[{
    id:"factor-more",
    displayName:`+ ${omittedFactors} more`,
    scope:"candidate pool",
    version:"",
    status:"collapsed",
  }]:[])];
  const factorStep=42;
  const factorStart=132-((factorNodes.length-1)*factorStep)/2;
  const nodes:ZijinFactorGraphNode[]=[
    {id:"market-data",label:"MARKET / L2",group:"source",x:82,y:132,detail:"1m quotes / L2 / historical replay"},
    {id:"basic-factors",label:"BASE FACTORS",group:"source",x:250,y:132,detail:"VWAP / volume / momentum / relative strength"},
    {id:"alpha-lab",label:"ALPHA LAB",group:"engine",x:420,y:132,detail:"candidate generation + rolling OOS validation"},
    ...factorNodes.map((factor,index)=>(
      {
        id:`factor-${factor.id}`,
        factorId:factor.id==="factor-more"?undefined:factor.id,
        label:factor.displayName.length>12?`${factor.displayName.slice(0,12)}...`:factor.displayName,
        group:"factor" as const,
        x:600,
        y:factorStart+index*factorStep,
        detail:`${factor.scope}${factor.version?` / v${factor.version}`:""} / ${factor.status}`,
      }
    )),
    {id:"shadow-pool",label:"SHADOW POOL",group:"shadow",x:760,y:132,detail:"observe only - no formal writes"},
    {id:"formal-v4",label:"FORMAL MODEL",group:"formal",x:880,y:132,detail:`formal factors: ${lifecycle.pools.formal.length}`},
  ];
  const edges:ZijinFactorGraphEdge[]=[
    {from:"market-data",to:"basic-factors"},
    {from:"basic-factors",to:"alpha-lab"},
    ...factorNodes.flatMap(factor=>[
      {from:"alpha-lab",to:`factor-${factor.id}`},
      {from:`factor-${factor.id}`,to:"shadow-pool"},
    ]),
    {from:"shadow-pool",to:"formal-v4"},
  ];
  return {nodes,edges};
}

function ZijinFactorGraph({lifecycle}:{lifecycle:ZijinFactorLifecycle}) {
  const graph=useMemo(()=>buildZijinFactorGraph(lifecycle),[lifecycle]);
  const [selectedId,setSelectedId]=useState("alpha-lab");
  const selectedNode=graph.nodes.find(node=>node.id===selectedId)??graph.nodes[2]??graph.nodes[0];
  const selectNode=(id:string)=>setSelectedId(id);
  return <div className="zijin-factor-graph" aria-label="Rabbit Alpha Lab factor knowledge graph">
    <header><span>FACTOR KNOWLEDGE GRAPH</span><em>click a node to inspect</em></header>
    <div className="zijin-factor-graph-shell">
      <svg viewBox="0 0 920 250" role="img" aria-label="Factor flow from market data to the formal model">
        <g className="zijin-factor-graph-stages" aria-hidden="true">
          <text x="82" y="28" textAnchor="middle">DATA</text>
          <text x="250" y="28" textAnchor="middle">BASE</text>
          <text x="420" y="28" textAnchor="middle">RESEARCH</text>
          <text x="600" y="28" textAnchor="middle">CANDIDATE</text>
          <text x="820" y="28" textAnchor="middle">ROLLOUT</text>
        </g>
        {graph.edges.map(edge=>{
          const from=graph.nodes.find(node=>node.id===edge.from);
          const to=graph.nodes.find(node=>node.id===edge.to);
          if(!from||!to)return null;
          const active=selectedNode?.id===from.id||selectedNode?.id===to.id;
          return <line key={`${edge.from}-${edge.to}`} className={`zijin-factor-graph-edge${active?" active":""}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y}/>;
        })}
        {graph.nodes.map(node=><g
          key={node.id}
          className={`zijin-factor-graph-node ${node.group}${selectedNode?.id===node.id?" is-selected":""}`}
          role="button"
          tabIndex={0}
          aria-label={`${node.label}: ${node.detail}`}
          onClick={()=>selectNode(node.id)}
          onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();selectNode(node.id);}}}
        >
          <circle cx={node.x} cy={node.y} r={node.group==="engine"?20:node.group==="factor"?15:17}/>
          <text x={node.x} y={node.y+33} textAnchor="middle">{node.label}</text>
          <text className="sub" x={node.x} y={node.y+46} textAnchor="middle">{node.group}</text>
        </g>)}
      </svg>
    </div>
    {selectedNode&&<p className="zijin-factor-graph-detail"><strong>{selectedNode.label}</strong><span>{selectedNode.detail}</span></p>}
    <div className="zijin-factor-graph-legend" aria-label="Graph legend">
      <span><i className="source"/>data</span><span><i className="engine"/>research</span><span><i className="factor"/>candidate</span><span><i className="shadow"/>shadow</span><span><i className="formal"/>formal</span>
    </div>
  </div>;
}

export function ZijinFactorLifecyclePanel({lifecycle,connection}:{lifecycle:ZijinFactorLifecycle|null;connection:"loading"|"ok"|"error"}) {
  if(!lifecycle)return <section className="zijin-factor-lifecycle unavailable"><header><div><span>RABBIT ALPHA LAB</span><h3>因子生命周期</h3><p>{connection==="error"?"主站暂时无法读取注册表；不会伪造因子状态。":"正在读取正式注册表和每日影子记录…"}</p></div><em>{connection==="error"?"接口异常":"读取中"}</em></header></section>;
  const summary=lifecycle.daily.summary??{};
  const statusLabel=(status:string)=>status==="shadow"?"影子运行":status==="observe"?"继续观察":status==="formal"?"正式池":status==="rejected"?"淘汰":"样本不足";
  const dailyDate=lifecycle.daily.marketDate??"尚未运行";
  return <section className="zijin-factor-lifecycle" aria-label="紫金矿业因子生命周期">
    <header>
      <div><span>RABBIT ALPHA LAB · FACTOR REGISTRY</span><h3>因子生命周期</h3><p>注册表已接入四兔训练；每日收盘后记录评估，候选只进入影子池。</p></div>
      <em>正式写入关闭</em>
    </header>
    <div className="zijin-factor-summary">
      <p><span>正式池</span><b>{lifecycle.pools.formal.length}</b><small>当前 V4 不改写</small></p>
      <p><span>影子池</span><b>{lifecycle.pools.shadow.length}</b><small>观察 {summary.observe??0}</small></p>
      <p><span>今日调度</span><b>{dailyDate}</b><small>{lifecycle.daily.status==="completed"?"已完成":"等待日任务"}</small></p>
      <p><span>影子事件</span><b>{summary.shadowEvents??lifecycle.shadow?.integrity.eventCount??0}</b><small>只追加记录</small></p>
    </div>
    <ZijinFactorGraph lifecycle={lifecycle}/>
    <div className="zijin-factor-cards">
      {lifecycle.factors.map(factor=>{
        const daily=lifecycle.daily.factors?.find(item=>item.id===factor.id);
        return <article key={factor.id} className={factor.pool==="formal"?"formal":"shadow"}>
          <div><span>{factor.displayName}</span><em>{statusLabel(factor.status)} · v{factor.version}</em></div>
          <p><span>{factor.scope==="zijin"?"紫金专属":"A股通用"}</span><b>{factor.executionMode==="observe-only"?"只观察":"影子成交"}</b></p>
          <p><span>研究结论</span><b>{factor.evidence?.researchStatus==="negative-after-cost"?"扣费后未晋级":"等待样本"}</b></p>
          <small>{daily?.reason??factor.evidence?.note??"尚未形成正式晋级证据。"}</small>
        </article>;
      })}
    </div>
    <footer><span>版本 {lifecycle.registryVersion} · 调度 {lifecycle.scheduler.window} · {lifecycle.meta?.dailySource==="runtime"?"服务器每日记录":"内置审计快照"}</span><b>下一步：连续影子运行后人工评审，不自动进入 V4</b></footer>
  </section>;
}
