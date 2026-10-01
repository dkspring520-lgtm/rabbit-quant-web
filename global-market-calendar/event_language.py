"""Chinese calendar labels and explanatory asset exposure (not trade signals)."""
import re

NAMES = {
'ADP Weekly Employment Change':'私营部门每周就业人数变化','API Weekly Statistical Bulletin':'美国石油协会周度统计公报',
'Average Earnings Index':'平均薪资指数','BOC Summary of Deliberations':'加拿大央行议息讨论摘要','BOJ Press Conference':'日本央行新闻发布会','BRICS Summit':'金砖国家峰会',
'Building Permits':'建筑许可','Business Inventories':'商业库存','BusinessNZ Services Index':'新西兰商业服务业指数','CB Leading Index':'世界大型企业联合会领先指标','Capacity Utilization Rate':'产能利用率','Claimant Count Change':'失业救济申请人数变化',
'Common CPI':'共同消费者物价指数','Core Machinery Orders':'核心机械订单','Crude Oil Inventories':'原油库存','Current Account':'经常账户','Empire State Manufacturing Index':'纽约州制造业指数',
'FOMC Economic Projections':'美联储经济预测','FOMC Member Bowman Speaks':'美联储理事鲍曼讲话','FPI':'食品价格指数','Final CPI':'消费者物价指数终值','Final Core CPI':'核心消费者物价指数终值','Fixed Asset Investment':'固定资产投资','Foreign Direct Investment':'外商直接投资','Foreign Securities Purchases':'外国证券购买额',
'French Final CPI':'法国消费者物价指数终值','GDT Price Index':'全球乳制品贸易价格指数','German 30-y Bond Auction':'德国三十年期国债拍卖','German PPI':'德国生产者物价指数','German WPI':'德国批发物价指数','German ZEW Economic Sentiment':'德国经济景气指数','GfK Consumer Confidence':'消费者信心指数',
'HPI':'房价指数','Housing Starts':'新屋开工','IPPI':'工业产品价格指数','Import Prices':'进口价格','Italian Trade Balance':'意大利贸易差额','M2 Money Supply':'广义货币供应量','MI Leading Index':'墨尔本研究院领先指标','MPC Official Bank Rate Votes':'英国央行利率投票分布','Manufacturing Sales':'制造业销售','Median CPI':'消费者物价指数中位数','Monetary Policy Summary':'货币政策摘要','NAHB Housing Market Index':'美国住房建筑商信心指数','NBS Press Conference':'中国国家统计局新闻发布会','National Core CPI':'全国核心消费者物价指数','Natural Gas Storage':'天然气库存','New Home Prices':'新建住宅价格','New Loans':'新增贷款','Official Bank Rate':'英国央行基准利率','Pending Home Sales':'成屋签约销售','Philly Fed Manufacturing Index':'费城联储制造业指数',
'RBA Assist Gov Hunter Speaks':'澳大利亚央行助理行长亨特讲话','RBA Gov Bullock Speaks':'澳大利亚央行行长布洛克讲话','RMPI':'原材料价格指数','RPI':'零售物价指数','Revised Industrial Production':'工业产出修正值','SECO Economic Forecasts':'瑞士经济预测','Spanish 10-y Bond Auction':'西班牙十年期国债拍卖','TIC Long-Term Purchases':'国际资本长期净流入','Tertiary Industry Activity':'第三产业活动指数','Trade Balance':'贸易差额','Trimmed CPI':'截尾均值消费者物价指数','Visitor Arrivals':'入境旅客人数','Westpac Consumer Sentiment':'西太平洋银行消费者信心指数','Wholesale Sales':'批发销售','ZEW Economic Sentiment':'经济景气指数',
'Core CPI':'核心消费者物价指数','CPI':'消费者物价指数','Core PPI':'核心生产者物价指数','PPI Input':'投入端生产者物价指数','PPI Output':'产出端生产者物价指数','PPI':'生产者物价指数','Core Retail Sales':'核心零售销售','Retail Sales':'零售销售','Unemployment Claims':'初请失业金人数','Unemployment Rate':'失业率','Non-Farm Employment Change':'非农就业人数变化','Federal Funds Rate':'美联储利率决议','FOMC Statement':'美联储政策声明','FOMC Press Conference':'美联储新闻发布会','GDP':'国内生产总值','Industrial Production':'工业产出','BOJ Policy Rate':'日本央行政策利率','Monetary Policy Statement':'货币政策声明',
'Core PCE Price Index':'核心个人消费支出价格指数','PCE Price Index':'个人消费支出价格指数','ISM Manufacturing PMI':'美国供应管理协会制造业采购经理指数','ISM Services PMI':'美国供应管理协会服务业采购经理指数','Bank Holiday':'银行假日','Employment Change':'就业人数变化','Cash Rate':'现金利率','ECB Press Conference':'欧洲央行新闻发布会','Main Refinancing Rate':'欧洲央行主要再融资利率','Consumer Confidence':'消费者信心','Loan Prime Rate':'贷款市场报价利率'}
SUFFIX={'m/m':'月率','y/y':'年率','q/q':'季率','ytd/y':'年初至今年率','3m/y':'三个月同比','q/q (Annualized)':'年化季率'}

NAMES.update({
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


def chinese_value(value):
    value=str(value or '')
    return re.sub(r'(?<=\d)[TBMK]',lambda m:{'T':'万亿','B':'十亿','M':'百万','K':'千'}[m[0]],value).replace('N/A','暂无')

def exposure(currency,title,impact):
    macro=any(word in title for word in ('Rate','FOMC','CPI','PPI','GDP','Employment','Claims','Payroll','Retail','Monetary','Inflation','Bond Auction'))
    if currency=='USD':
        assets=['黄金','美债','美股','A股（间接）']
        reason='美国数据可能改变美联储利率预期、美元与美债收益率，影响黄金和美股；并通过人民币汇率、跨境资金及全球风险偏好间接影响A股。'
    elif currency=='CNY':
        assets=['A股','黄金（间接）','美股（间接）','美债（间接）']
        reason='中国政策及经济数据影响国内盈利、流动性和A股；全球需求、商品价格与风险偏好可间接传导至黄金、美股和美债。'
    elif currency=='All' or macro or impact=='High':
        assets=['黄金（间接）','美债（间接）','美股（间接）','A股（间接）']
        reason='国际政策、增长或通胀变化可能通过美元交叉汇率、国际利差及风险偏好，间接影响黄金、美债、美股与A股。'
    else:
        assets=['黄金（间接、较弱）','美债（间接、较弱）','美股（间接、较弱）','A股（间接、较弱）']
        reason='主要影响本国市场；对关注资产的影响通常较弱，需结合是否显著超出预期及全球市场反应判断。'
    return assets,reason+' 此为关联路径说明，不代表确定涨跌或必然发生的影响。'
