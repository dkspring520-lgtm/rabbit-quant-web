from pathlib import Path
p=Path('event_language.py');s=p.read_text(encoding='utf-8')
a=s.index('def chinese_title(');b=s.index('\ndef chinese_value',a)
s=s[:a]+'''NAMES.update({
    'Rightmove HPI':'英国房产网站房屋要价指数',
    'Credit Card Spending':'信用卡支出', 'German Buba Monthly Report':'德国央行月度报告',
    'ECB President Lagarde Speaks':'欧洲央行行长拉加德讲话',
    'BOC Gov Macklem Speaks':'加拿大央行行长麦克勒姆讲话',
    'Public Sector Net Borrowing':'公共部门净借款',
    'German Buba President Nagel Speaks':'德国央行行长纳格尔讲话',
    'CBI Industrial Order Expectations':'英国工业联合会工业订单预期',
    'Richmond Manufacturing Index':'里士满联储制造业指数',
    'Flash Services PMI':'服务业采购经理指数初值',
    'Flash Manufacturing PMI':'制造业采购经理指数初值',
    'NAB Quarterly Business Confidence':'澳大利亚国民银行季度商业信心指数',
    'SNB Policy Rate':'瑞士央行政策利率',
    'German ifo Business Climate':'德国伊弗经济研究所商业景气指数',
    'MPC Member Dhingra Speaks':'英国央行货币政策委员丁格拉讲话',
    'MPC Member Breeden Speaks':'英国央行货币政策委员布里登讲话',
    'CBI Realized Sales':'英国工业联合会零售销售差值',
    'Belgian NBB Business Climate':'比利时央行商业景气指数',
    'New Home Sales':'新屋销售', 'Existing Home Sales':'成屋销售',
    'German GfK Consumer Climate':'德国消费者信心指数',
    'Private Loans':'私人部门贷款',
    'Durable Goods Orders':'耐用品订单', 'Core Durable Goods Orders':'核心耐用品订单',
    'Revised UoM Inflation Expectations':'密歇根大学通胀预期修正值',
    'Revised UoM Consumer Sentiment':'密歇根大学消费者信心指数修正值',
    'Prelim UoM Inflation Expectations':'密歇根大学通胀预期初值',
    'Prelim UoM Consumer Sentiment':'密歇根大学消费者信心指数初值',
    'Daylight Saving Time Shift':'夏令时切换',
})
FED_SPEAKERS = {'Goolsbee':'古尔斯比','Williams':'威廉姆斯',
    'Jefferson':'杰斐逊','Barkin':'巴尔金','Barr':'巴尔',
    'Hammack':'哈马克','Paulson':'保尔森','Bowman':'鲍曼',
    'Waller':'沃勒','Daly':'戴利','Bostic':'博斯蒂克','Kashkari':'卡什卡利'}
COUNTRY_PREFIX = {'French':'法国','German':'德国','Italian':'意大利',
                  'Spanish':'西班牙','Final':'终值：','Prelim':'初值：'}


def chinese_title(title):
    title = ' '.join(str(title).split())
    if title in NAMES:
        return NAMES[title]
    for suffix in sorted(SUFFIX, key=len, reverse=True):
        if title.endswith(' ' + suffix):
            base = title[:-len(suffix)].strip()
            translated = chinese_title(base)
            if translated != base:
                return translated + '（' + SUFFIX[suffix] + '）'
    match = re.fullmatch(r'FOMC Member (.+) Speaks', title)
    if match:
        name = match.group(1)
        return '美联储官员' + FED_SPEAKERS.get(name, name) + '讲话'
    for prefix, translated in COUNTRY_PREFIX.items():
        if title.startswith(prefix + ' '):
            base = title[len(prefix)+1:]
            result = chinese_title(base)
            if result != base:
                return translated + result
    # Preserve identity for unseen titles; never collapse different events.
    return title

''' +s[b:];p.write_text(s,encoding='utf-8')
p=Path('database.py');s=p.read_text(encoding='utf-8');s+='''

def repair_cached_titles():
    """Retranslate from saved source names without downloading or dropping rows."""
    from event_language import chinese_title
    changed = 0
    with connect() as db:
        rows = db.execute('SELECT rowid, date, time, title, description FROM events').fetchall()
        for row in rows:
            marker = '原文核对标识：'
            if marker not in (row['description'] or ''):
                continue
            original = row['description'].split(marker, 1)[1].strip()
            title = chinese_title(original)
            if title and title != row['title']:
                collision = db.execute('SELECT 1 FROM events WHERE date=? AND time=? AND title=? AND rowid!=?',
                    (row['date'], row['time'], title, row['rowid'])).fetchone()
                if collision:
                    title += '（' + original + '）'
                db.execute('UPDATE events SET title=? WHERE rowid=?', (title, row['rowid']))
                changed += 1
    return changed
''';p.write_text(s,encoding='utf-8')
p=Path('app.py');s=p.read_text(encoding='utf-8').replace('from database import seed, all_events, replace_events','from database import seed, all_events, replace_events, repair_cached_titles').replace('        self.events = all_events();','        repair_cached_titles()\n        self.events = all_events();');p.write_text(s,encoding='utf-8')
