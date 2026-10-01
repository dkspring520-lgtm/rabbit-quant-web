def analyze_event(event):
    actual, forecast, previous = event.get("actual"), event.get("forecast"), event.get("previous")
    if actual in (None, ''):
        return "等待公布", "公布值与预期的偏差将决定短线方向"
    try:
        a, f, p = float(str(actual).replace('%','')), float(str(forecast).replace('%','')), float(str(previous).replace('%',''))
    except (TypeError, ValueError):
        return "已公布", "请结合实际值、预期和前值判断"
    gap = a - f
    surprise = "大幅超预期" if gap > abs(f) * .02 else "小幅超预期" if gap > 0 else "大幅低于预期" if gap < -abs(f) * .02 else "小幅低于预期" if gap < 0 else "符合预期"
    return surprise, f"实际值 {actual} · 预期 {forecast} · 前值 {previous}"

def asset_outlook(event):
    title=str(event.get('title','')); country=str(event.get('country',''))
    if any(x in title for x in ('利率','美联储','FOMC','消费者物价','就业','非农','CPI')):
        return '黄金：无 · 美债：无\n美股：无 · A股：无'
    inflation=any(x in title for x in ('CPI','PPI','通胀','物价'))
    jobs=any(x in title for x in ('就业','非农','失业','薪资','Payroll'))
    rate=any(x in title for x in ('利率','央行','FOMC','货币政策','再融资'))
    growth=any(x in title for x in ('GDP','零售','制造','工业','PMI','销售','消费'))
    if country in ('美国','USD') and (inflation or jobs or rate or growth):
        if inflation or jobs: return '黄金：预判跌 · 美债：预判跌 · 美股：预判跌 · A股：影响有限'
        if rate: return '黄金：预判涨 · 美债：预判涨 · 美股：预判涨 · A股：影响有限'
        return '黄金：影响有限 · 美债：影响有限 · 美股：预判涨 · A股：预判涨'
    if country in ('中国','CNY'):
        if rate: return '黄金：影响有限 · 美债：影响有限 · 美股：影响有限 · A股：预判涨'
        if growth: return '黄金：影响有限 · 美债：影响有限 · 美股：预判涨 · A股：预判涨'
    if rate or inflation or jobs: return '黄金：预判涨 · 美债：预判跌 · 美股：影响有限 · A股：影响有限'
    return '黄金：影响有限 · 美债：影响有限 · 美股：影响有限 · A股：影响有限'

def outlook_explanation(event):
    return ('这是发布前的规则化宏观预判，依据事件类别、国家和常见利率/通胀传导关系生成；'
            '不代表确定涨跌。美债方向指债券价格，而非收益率。')
