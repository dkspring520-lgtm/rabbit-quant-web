import re
from urllib.request import Request,urlopen
from html import unescape

SOURCES={
 'FOMC':'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
 '美联储':'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
 '非农':'https://www.bls.gov/schedule/news_release/empsit.htm',
 '就业':'https://www.bls.gov/schedule/news_release/empsit.htm',
 '初请失业':'https://oui.doleta.gov/unemploy/claims.asp',
 'CPI':'https://www.bls.gov/schedule/news_release/cpi.htm',
}

def research_event(event):
    title=event.get('title',''); url=next((u for k,u in SOURCES.items() if k in title),None)
    if not url:return {'status':'缺少官方来源匹配','sources':[],'summary':'没有找到与该事件匹配的官方发布页面。'}
    try:
        raw=urlopen(Request(url,headers={'User-Agent':'GlobalMarketCalendar/1.0'}),timeout=10).read().decode('utf-8','ignore')
        text=re.sub(r'<[^>]+>',' ',unescape(raw)); text=re.sub(r'\s+',' ',text)
        return {'status':'已抓取官方页面','sources':[url],'summary':text[:2200]}
    except Exception as exc:return {'status':'官方页面抓取失败','sources':[url],'summary':type(exc).__name__}
