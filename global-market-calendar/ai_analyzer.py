import json, os
from pathlib import Path
from research import research_event
from urllib.request import Request, urlopen

def load_key():
    p=Path.home()/'Desktop'/'key.txt'
    if not p.exists(): return None
    vals={}
    for line in p.read_text(encoding='utf-8').splitlines():
        if '=' in line:
            k,v=line.split('=',1); vals[k.strip()]=v.strip()
    return vals if vals.get('AI_API_KEY') and vals.get('AI_BASE_URL') else None

def pre_event_outlook(event):
    cfg=load_key()
    if not cfg: return '未配置 AI 预判接口。'
    high=any(x in str(event.get('title','')) for x in ('利率','美联储','FOMC','消费者物价','就业','非农','CPI'))
    context=event.get('market_context') or '未提供利率期货概率、市场共识、官方声明或实时价格反应。'
    research=research_event(event)
    prompt=('你是宏观市场分析师，只做事件发布前预判。请用简体中文回答四行：黄金、美债价格、美股、A股；'
            '每行只能写“利好/利空/影响有限”之一，并补一句极短依据。禁止声称确定，必须说明判断基于何种市场预期假设；'
            '如果缺少关键市场上下文，必须写“无”，不得猜测；高影响事件尤其不能只看标题。'
            '美债指债券价格，不是收益率。事件：'+json.dumps(event,ensure_ascii=False)+'\n市场上下文：'+context+'\n官方检索状态：'+research['status']+'\n检索摘要：'+research['summary']+'\n来源：'+','.join(research['sources']))
    body=json.dumps({'model':cfg.get('AI_MODEL','gpt-6-astra'),'messages':[{'role':'user','content':prompt}],'temperature':0.2}).encode()
    req=Request(cfg['AI_BASE_URL'].rstrip('/')+'/chat/completions',data=body,headers={'Authorization':'Bearer '+cfg['AI_API_KEY'],'Content-Type':'application/json'})
    try:
        with urlopen(req,timeout=15) as r: return json.loads(r.read().decode())['choices'][0]['message']['content'].strip()
    except Exception as exc: return 'AI 预判暂不可用（已保留规则预判）：'+type(exc).__name__
