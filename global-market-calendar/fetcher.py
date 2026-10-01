"""Optional event refresh hook. The MVP remains usable without network access."""
import json
from event_language import chinese_title, chinese_value, exposure
from datetime import datetime, timezone, timedelta
from urllib.request import Request, urlopen

def fetch_json_events(url, timeout=8):
    request = Request(url, headers={"User-Agent": "GlobalMarketCalendar/0.1"})
    with urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, list):
        raise ValueError("事件接口必须返回数组")
    return payload

def fetch_all_events(url=None):
    data = fetch_json_events(url) if url else []
    if not data or 'impact' not in data[0]: return data
    countries={'USD':'美国','EUR':'欧元区','GBP':'英国','JPY':'日本','CNY':'中国','CAD':'加拿大','AUD':'澳大利亚','NZD':'新西兰','CHF':'瑞士','All':'全球'}
    translations={'CPI':'消费者物价指数 CPI','Core CPI':'核心 CPI','PPI':'生产者物价指数 PPI','Core PPI':'核心 PPI','Retail Sales':'零售销售','Core Retail Sales':'核心零售销售','Unemployment Claims':'初请失业金人数','Unemployment Rate':'失业率','Non-Farm Employment Change':'非农就业人数变化','Federal Funds Rate':'美联储利率决议','FOMC Statement':'美联储声明','FOMC Press Conference':'美联储新闻发布会','GDP':'国内生产总值 GDP','Industrial Production':'工业产出','BOJ Policy Rate':'日本央行政策利率','Monetary Policy Statement':'货币政策声明'}
    events=[]
    for row in data:
        dt=datetime.fromisoformat(row['date'])
        if dt.tzinfo is None: raise ValueError('日历时间缺少时区')
        dt=dt.astimezone(timezone(timedelta(hours=8)))
        original=row['title']; title=chinese_title(original)
        currency=row['country']
        level={'High':5,'Medium':4,'Low':3,'Holiday':1}.get(row['impact'],2)
        assets,reason=exposure(currency,original,row['impact'])
        impact_cn={'High':'高','Medium':'中','Low':'低','Holiday':'休市'}.get(row['impact'],'未分级')
        events.append(dict(date=dt.strftime('%Y-%m-%d'),time=dt.strftime('%H:%M'),country=countries.get(currency,currency),flag=countries.get(currency,'其他'),title=title,category='经济日历',level=level,previous=chinese_value(row.get('previous','')),forecast=chinese_value(row.get('forecast','')),actual=chinese_value(row.get('actual','')),assets=assets,description=f"来源：外汇工厂公开经济周历。源影响等级：{impact_cn}。{reason} 时间为北京时间；实际值缺失表示数据源未提供，不推测。原文核对标识：{original}"))
    return events
