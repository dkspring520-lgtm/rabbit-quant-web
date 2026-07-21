"use client";

import Link from "next/link";

type PublicLandingProps = {
  onDemo: () => void;
  onAccount: () => void;
};

const productFeatures = [
  { number:"01", title:"盘中实时判断", copy:"按已出现的 1 分钟行情逐点计算，候选、正式信号和风控拦截均保留理由。" },
  { number:"02", title:"底仓闭环管理", copy:"分别记录计划底仓、开盘持仓与昨日可卖，避免把做 T 做成意外加仓。" },
  { number:"03", title:"完整日内盲测", copy:"从开盘推进至收盘，不读取未来高低点；扣除佣金、印花税与滑点后再评价。" },
  { number:"04", title:"多股事件雷达", copy:"监控列表与消息雷达联动；过期、重复或无法确认的消息不直接改变正式信号。" },
];

export default function PublicLanding({onDemo,onAccount}:PublicLandingProps) {
  const openZijinExperiment=()=>{
    window.history.replaceState({},"","/?view=zijin-lab");
    onDemo();
  };
  return <main className="public-site">
    <header className="public-nav">
      <a className="public-brand" href="#top" aria-label="双兔助手 做T神器首页"><img className="brand-primary-logo" src="/double-rabbit-assistant-brand.png" alt="双兔助手双兔无限线品牌标志"/><span><b>双兔助手</b><small>做T神器 · SMART-T SYSTEM</small></span></a>
      <nav aria-label="产品导航"><a href="#features">核心功能</a><a href="#workflow">使用流程</a><a href="#safety">安全边界</a><Link href="/?view=zijin-lab" onClick={event=>{event.preventDefault();openZijinExperiment()}}>紫金实验进度</Link></nav>
      <button onClick={onAccount}>登录 / 注册</button>
    </header>

    <section className="public-hero" id="top">
      <div className="public-hero-copy"><span className="public-kicker"><i/>A 股日内策略研究终端 · 公开测试</span><h1>把复杂盘面，<br/>变成<strong>有依据的提醒。</strong></h1><p>围绕单只股票的日内走势、VWAP、量价、底仓与风险做因果判断。系统只提示，不连接券商，不替用户下单。</p><div className="public-cta"><button onClick={onDemo}>免注册进入演示 <span>→</span></button><button onClick={openZijinExperiment}>查看紫金实验进度</button><button onClick={onAccount}>创建服务器测试账户</button></div><small>演示无需密码 · 公开行情非交易级 · 不构成投资建议</small></div>
      <div className="public-terminal" aria-label="操盘台产品预览">
        <header><span><i/>实时监控结构预览</span><em>下单接口关闭</em></header>
        <div className="public-quote"><span><small>601899</small><b>紫金矿业</b></span><strong>--<small>等待行情</small></strong></div>
        <svg viewBox="0 0 640 250" role="img" aria-label="示意分时走势，不代表真实行情"><defs><linearGradient id="landingFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#28d7c4" stopOpacity=".22"/><stop offset="1" stopColor="#28d7c4" stopOpacity="0"/></linearGradient></defs><path className="public-grid" d="M0 50H640M0 100H640M0 150H640M0 200H640"/><path className="public-vwap" d="M0 174 C120 165 190 145 290 152 S470 118 640 124"/><path className="public-price-fill" d="M0 202 C45 190 70 120 110 150 S180 105 225 128 S300 82 345 115 S410 62 455 88 S520 53 565 80 S610 48 640 62 L640 250 L0 250Z"/><path className="public-price" d="M0 202 C45 190 70 120 110 150 S180 105 225 128 S300 82 345 115 S410 62 455 88 S520 53 565 80 S610 48 640 62"/></svg>
        <div className="public-signal"><span><i>候</i><b>候选观察</b><small>趋势、量价、成本和风控仍需确认</small></span><em>不等于执行</em></div>
      </div>
    </section>

    <section className="public-proof"><div><span>行情模式</span><b>前台实时刷新</b><small>服务器后台持续扫描，页面隐藏时减少前端请求</small></div><div><span>决策方式</span><b>逐分钟因果判断</b><small>不回填峰谷，不读取未来</small></div><div><span>交易边界</span><b>提醒，不下单</b><small>券商与自动交易接口关闭</small></div><div><span>产品阶段</span><b>公开测试版</b><small>暂未开放收费</small></div></section>

    <section className="public-section" id="features"><div className="public-section-head"><span>CORE CAPABILITIES</span><h2>一屏看清：机会、理由与风险</h2><p>不堆砌无法解释的指标；正式信号必须能说明为何触发、为何拦截。</p></div><div className="public-feature-grid">{productFeatures.map(item=><article key={item.number}><span>{item.number}</span><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div></section>

    <section className="public-workflow" id="workflow"><div><span>DAILY WORKFLOW</span><h2>每天只走四步</h2><p>先设置股票与底仓，再看候选，等待正式过滤，最后复盘扣费结果。</p></div><ol><li><b>01</b><span><strong>设置监控</strong><small>股票与底仓独立保存</small></span></li><li><b>02</b><span><strong>观察候选</strong><small>候选不是买卖指令</small></span></li><li><b>03</b><span><strong>确认闭环</strong><small>费用与风控同时通过</small></span></li><li><b>04</b><span><strong>盘后复盘</strong><small>记录净收益与失败原因</small></span></li></ol></section>

    <section className="public-safety" id="safety"><div><span>COMMERCIAL READINESS</span><h2>当前是公开测试，不伪装成正式券商终端</h2></div><div><p><b>已经上线</b><span>服务器账户、跨设备监控清单、持仓参数同步和管理员密码重置已经开放测试。</span></p><p><b>安全边界</b><span>行情来源与时效非交易级；信号只用于研究和提醒；演示结果与真实账户严格区分。</span></p><p><b>尚未开放</b><span>收费套餐、券商下单、自动交易与收益承诺均未开放；运营主体与客服信息将在收费前公示。</span></p></div></section>

    <footer className="public-footer"><div><b>双兔助手 · 做T神器</b><span>Rabbit Quant · A 股日内策略研究工具</span></div><nav><a href="/terms">用户协议</a><a href="/privacy">隐私政策</a><button onClick={onAccount}>登录 / 注册</button></nav><small>© 2026 Rabbit Quant · 公开测试版 · 不构成投资建议</small></footer>
  </main>;
}
