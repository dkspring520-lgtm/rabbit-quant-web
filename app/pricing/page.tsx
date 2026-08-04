"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";

type BillingCycle = "monthly" | "yearly";
type UiTheme = "dark" | "light";

const readTheme = (): UiTheme => document.documentElement.dataset.theme === "light" ? "light" : "dark";
const subscribeTheme = (onChange: () => void) => {
  window.addEventListener("rabbit-theme-change", onChange);
  return () => window.removeEventListener("rabbit-theme-change", onChange);
};
const getServerTheme = (): UiTheme => "dark";

const memberFeatures = [
  "实时行情增强与秒级状态确认",
  "9:25 盘前预判与实时买卖关注区",
  "秒级候选—确认—失效状态机",
  "语音、弹窗与手机后台提醒",
  "提醒历史、因果回放与失败复盘",
  "近五年个人手动回放训练",
  "账户、监控清单与持仓跨设备同步",
];

const compareRows = [
  ["监控股票", "2 只", "5 只", "30 只", "5 只"],
  ["基础分时、VWAP 与量价观察", "支持", "支持", "支持", "支持"],
  ["普通候选观察点", "支持", "支持", "支持", "支持"],
  ["实时行情增强", "—", "支持", "支持", "支持"],
  ["9:25 盘前预判", "—", "支持", "支持", "支持"],
  ["秒级行情状态机", "—", "支持", "支持", "支持"],
  ["精确正T / 反T关注区", "—", "支持", "支持", "支持"],
  ["提醒历史与手机后台推送", "—", "支持", "支持", "支持"],
  ["个人回放训练", "—", "支持", "支持", "支持"],
  ["自动下单", "不支持", "不支持", "不支持", "不支持"],
];

const faqs = [
  ["会员会自动下单吗？", "不会。当前系统只做行情研究、提醒和复盘，券商下单接口保持关闭。"],
  ["实时行情增强是否覆盖所有股票？", "高级实时行情增强优先支持核心研究标的；其他股票继续使用公开行情与通用 Smart-T 逻辑。"],
  ["是否保证胜率或收益？", "不保证。会员购买的是数据整理、因果判断与研究工具，不是收益承诺。"],
  ["邀请奖励还能使用吗？", "可以。每位有效邀请增加 7 天会员权益，与付费获得的有效期顺延累计。"],
  ["激活码怎样使用？", "登录后打开账户中心，在“激活码兑换”输入并确认；未到期会员会在原到期日基础上自动顺延。"],
  ["如何获得客服支持？", "当前处于公开测试与人工激活码灰度阶段，账户、激活码和重置问题由站点管理员人工处理；固定客服渠道、退款规则与账户注销/导出流程完成公示后，才会开放正式收费。"],
  ["是否自动续费？", "当前使用一次性激活码开通，不自动续费，也不会产生静默扣款。"],
  ["体验票到期后会怎样？", "自动恢复免费版；监控清单和历史数据保留，会员功能停止更新。"],
];

export default function PricingPage() {
  const [cycle, setCycle] = useState<BillingCycle>("yearly");
  const theme = useSyncExternalStore(subscribeTheme, readTheme, getServerTheme);

  useEffect(() => {
    const saved = localStorage.getItem("rabbit-ui-theme") === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = saved;
    window.dispatchEvent(new Event("rabbit-theme-change"));
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("rabbit-ui-theme", next);
    window.dispatchEvent(new Event("rabbit-theme-change"));
  };

  const memberPrice = cycle === "yearly" ? "298" : "99";
  const memberUnit = cycle === "yearly" ? "年" : "月";

  return <main className="pricing-page">
    <header className="pricing-nav">
      <Link href="/" className="pricing-brand">
        <Image src="/rabbit-logo-compact.png" alt="做T神器" width={46} height={46} priority/>
        <span><b>做T神器</b><small>RABBIT QUANT</small></span>
      </Link>
      <nav aria-label="会员页导航">
        <a href="#plans">会员方案</a>
        <a href="#compare">权益对比</a>
        <a href="#faq">常见问题</a>
      </nav>
      <div>
        <button className="pricing-theme" onClick={toggleTheme} aria-label={theme === "dark" ? "切换白天模式" : "切换黑夜模式"}>
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <Link className="pricing-login" href="/?view=membership">登录 / 查看权益</Link>
      </div>
    </header>

    <section className="pricing-hero">
      <span>RABBIT QUANT MEMBERSHIP</span>
      <h1>先免费验证，<br/><strong>需要更快、更深时再升级。</strong></h1>
      <p>基础行情与候选观察永久免费。会员增加实时行情增强、秒级状态确认、盘前预判、提醒历史和个人训练。</p>
      <div className="pricing-trust"><span>不自动续费</span><span>不连接券商下单</span><span>不承诺收益</span></div>
    </section>

    <section className="pricing-plans" id="plans">
      <div className="billing-toggle" aria-label="计费周期">
        <button className={cycle === "monthly" ? "active" : ""} onClick={() => setCycle("monthly")}>按月</button>
        <button className={cycle === "yearly" ? "active" : ""} onClick={() => setCycle("yearly")}>按年 <em>省 75%</em></button>
      </div>

      <div className="pricing-grid">
        <article className="pricing-card">
          <span>免费体验</span><h2>基础版</h2>
          <div className="pricing-value"><b>¥0</b><small>长期使用</small></div>
          <p>适合先体验分时、候选点、模拟回放与基础风控。</p>
          <ul><li>2 只自选监控</li><li>基础分时、VWAP 与成交量</li><li>候选观察点与模拟回放</li><li>公开行情试用</li></ul>
          <Link href="/">免费进入</Link>
        </article>

        <article className="pricing-card featured">
          <div className="pricing-badge">推荐</div>
          <span>完整研究能力</span><h2>Smart-T 会员</h2>
          <div className="pricing-value"><b>¥{memberPrice}</b><small>/{memberUnit}</small></div>
          <p>{cycle === "yearly" ? "折合约 ¥0.82/天，适合持续盯盘、复盘和积累个人样本。当前仍按人工激活码灰度开通。" : "按月开通，适合先完整体验实时监控与复盘；当前仍按人工激活码灰度开通。"}</p>
          <ul>{[cycle === "yearly" ? "30 只自选监控" : "5 只自选监控", ...memberFeatures].map(feature => <li key={feature}>{feature}</li>)}</ul>
          <Link href="/?view=membership">登录后兑换激活码</Link>
        </article>

        <article className="pricing-card day-pass">
          <span>短期体验</span><h2>24 小时体验票</h2>
          <div className="pricing-value"><b>¥4.9</b><small>/24小时</small></div>
          <p>适合完整测试一个交易日，不自动转成月费。</p>
          <ul><li>5 只自选监控</li><li>24 小时会员研究能力</li><li>实时行情增强与秒级候选确认</li><li>提醒历史和回放复盘</li><li>到期自动恢复免费版</li></ul>
          <Link href="/?view=membership">登录后兑换天卡</Link>
        </article>
      </div>

      <div className="pricing-opening-note"><b>当前开通方式</b><span>目前仅接受管理员人工确认的测试激活码，登录后可自行兑换；不提供面向公众的自助支付、自动扣款或自动续费。固定客服渠道、退款规则、账户注销与数据导出流程完成公示前，不开放正式收费。</span></div>
    </section>

    <section className="pricing-compare" id="compare">
      <header><span>FEATURE COMPARISON</span><h2>权益对比</h2><p>只为真实已实现的能力收费；自动下单不在任何套餐内。</p></header>
      <div className="pricing-table" role="table" aria-label="会员权益对比">
        <div className="pricing-row pricing-row-head" role="row"><b>功能</b><b>免费版</b><b>月卡</b><b>年 V 会员</b><b>体验票</b></div>
        {compareRows.map(row => <div className="pricing-row" role="row" key={row[0]}>
          {row.map((cell, index) => <span key={`${cell}-${index}`} className={cell === "支持" ? "yes" : cell === "—" || cell === "不支持" ? "no" : ""}>{cell}</span>)}
        </div>)}
      </div>
    </section>

    <section className="pricing-faq" id="faq">
      <header><span>FAQ</span><h2>开通前先说清楚</h2></header>
      <div>{faqs.map(([title, answer]) => <article key={title}><h3>{title}</h3><p>{answer}</p></article>)}</div>
    </section>

    <section className="pricing-cta">
      <div><span>先看懂，再决定</span><h2>免费版足够验证界面与基础逻辑。</h2><p>确认实时行情增强、提醒和个人训练确实适合你，再申请测试激活码自行兑换。</p></div>
      <div><Link href="/">进入免费版</Link><Link href="/?view=membership">登录查看权益</Link></div>
    </section>

    <footer className="pricing-footer">
      <span>© 2026 Rabbit Quant · 做T神器</span>
      <nav><Link href="/terms">用户协议</Link><Link href="/privacy">隐私政策</Link><Link href="/">返回首页</Link></nav>
    </footer>
  </main>;
}
