"""Public Chinese news feeds, bounded cache and deterministic relevance filtering."""
import json
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

PRODUCTS = {'黄金': ('黄金', '金价'), '白银': ('白银', '银价'),
            '铜': ('铜价', '沪铜', '伦铜', '铜矿', '电解铜'),
            '原油': ('原油', '油价', '石油', 'OPEC', '欧佩克')}
DRIVERS = ('央行', '利率', '美联储', '通胀', '就业', '库存', '减产', '增产',
           '停产', '罢工', '制裁', '战争', '冲突', '供应', '供给', '需求', '关税',
           '出口', '进口', '产量', '会议', '决议', 'EIA', 'API', 'OPEC', '欧佩克')

def products_for(text):
    return [p for p, terms in PRODUCTS.items() if any(t.lower() in text.lower() for t in terms)]

def future_commodity(event):
    text = event.get('title', '') + event.get('description', '')
    return any(t.lower() in text.lower() for t in
               ('Crude Oil Inventories', 'API Weekly', 'OPEC', '原油库存', '石油', '铜矿', '欧佩克'))

def recent(items, now=None):
    now = now or datetime.now(timezone.utc)
    result, seen = [], set()
    for item in sorted(items, key=lambda x: x.get('published', ''), reverse=True):
        try:
            stamp = datetime.fromisoformat(item['published'])
            if stamp < now - timedelta(hours=72) or stamp > now:
                continue
            key = re.sub(r'[^\w]', '', item['title']).lower()
            if key in seen or urlparse(item['url']).scheme not in ('http', 'https'):
                continue
            seen.add(key)
            result.append(item)
        except (KeyError, TypeError, ValueError):
            continue
    return result[:60]

def parse_feed(payload, now=None):
    items = []
    for node in ET.fromstring(payload).findall('./channel/item'):
        title = node.findtext('title', '').strip()
        source = node.findtext('source', '').strip()
        if source and title.endswith(' - ' + source):
            title = title[:-len(source)-3]
        products = products_for(title)
        if not products or not any(t.lower() in title.lower() for t in DRIVERS):
            continue
        try:
            stamp = parsedate_to_datetime(node.findtext('pubDate', '')).astimezone(timezone.utc)
        except (ValueError, TypeError):
            continue
        items.append(dict(title=title, source=source or '来源未标注',
                          url=node.findtext('link', ''), published=stamp.isoformat(),
                          products=products, summary='摘要尚未取得，请打开来源阅读全文。',
                          assessment='待研判：尚未核对全文及市场预期，不据标题判断利好或利空。'))
    return recent(items, now)

def load_cache(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'items': [], 'checked': '', 'status': '等待首次同步商品新闻'}

def refresh(path):
    cache = load_cache(path)
    items, failures = list(cache.get('items', [])), []
    for product in PRODUCTS:
        query = {'q': product + ' (库存 OR 供应 OR 需求 OR 央行 OR 制裁 OR 减产 OR 利率) when:3d',
                 'hl': 'zh-CN', 'gl': 'CN', 'ceid': 'CN:zh-Hans'}
        try:
            req = Request('https://news.google.com/rss/search?' + urlencode(query),
                          headers={'User-Agent': 'GlobalMarketCalendar/1.0'})
            with urlopen(req, timeout=12) as response:
                items.extend(parse_feed(response.read(2_000_000)))
        except Exception as exc:
            failures.append(product + ':' + type(exc).__name__)
    cache = {'items': recent(items), 'checked': datetime.now(timezone.utc).isoformat(),
             'status': '部分来源失败，保留近期缓存：' + ' / '.join(failures) if failures else '新闻更新完成 · 每小时自动检查'}
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(cache, ensure_ascii=False), encoding='utf-8')
    tmp.replace(path)
    return cache
