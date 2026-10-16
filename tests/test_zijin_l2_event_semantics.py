"""Real dtype/callback regression, independent of unavailable NATS runtime."""
import ast,asyncio,collections,datetime,importlib.util,json,time,unittest
from types import SimpleNamespace
from pathlib import Path
import numpy as np
S=Path(__file__).resolve().parents[1]/'scripts'
spec=importlib.util.spec_from_file_location('event_stream',S/'zijin_l2_stream_state.py');stream=importlib.util.module_from_spec(spec);spec.loader.exec_module(stream)
tree=ast.parse((S/'zijin_l2_collector.py').read_text(encoding='utf-8'))
nodes=[n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Collector' or isinstance(n,ast.FunctionDef) and n.name in ('decoded','exchange_minute','is_a_share_cash_session') or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('SNAPSHOT','TRANSACTION','ORDER') for t in n.targets)]
env=dict(np=np,StreamState=stream.StreamState,time=time,datetime=datetime.datetime,deque=collections.deque)
exec(compile(ast.Module(body=nodes,type_ignores=[]),str(S/'zijin_l2_collector.py'),'exec'),env)
state_fn=next(n for n in next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Collector').body if isinstance(n,ast.FunctionDef) and n.name=='state')
state_dict=next(n.value for n in state_fn.body if isinstance(n,ast.Return) and isinstance(n.value,ast.Dict))
latest_expr=next(v for k,v in zip(state_dict.keys,state_dict.values) if isinstance(k,ast.Constant) and k.value=='latestTrade')
latest_code=compile(ast.Expression(body=latest_expr),str(S/'zijin_l2_collector.py'),'eval')
T0=datetime.datetime(2026,10,16,2,0,tzinfo=datetime.timezone.utc).timestamp()
def published_latest(s,now,connected=True,authorized=True):
    return eval(latest_code,dict(self=SimpleNamespace(stream_state=s,stale_seconds=8,authorization_error=not authorized),now=now,streams=s.public(now,connected,8)))
def collector():
    c=env['Collector'].__new__(env['Collector']);c.transactions=collections.deque();c.orders=collections.deque();c.message_counts=dict(snapshot=0,transaction=0,order=0);c.parse_errors=0;c.stream_state=stream.StreamState();c.current_minute_bar=None;c.minute_bars=collections.deque(maxlen=260);c.minute_flows={};c.restored_minute_rows={};c.big_order=200000;c.last_message_at=None
    return c
def row(**changes):
    return dict(symbol='000001',market=0,date=20261016,time=100000000,index=1,channel=1007,price=300000,volume=100,turnover=3000,buy_id=1,sell_id=2,bs_flag='B',function_code='',order_kind='',**{})|changes
def feed(c,stream_name='transaction',**changes):
    dtype=env['TRANSACTION' if stream_name=='transaction' else 'ORDER'];a=np.zeros(1,dtype=dtype)
    for k,v in row(**changes).items():
        if k in dtype.names:a[k]=v.encode() if isinstance(v,str) else v
    asyncio.run(getattr(c,'on_'+stream_name)(type('Message',(),{'data':a.tobytes()})()))
class Tests(unittest.TestCase):
    def test_positive_cancel_preserves_type_without_trade_pollution(self):
        c=collector();feed(c);before=dict(c.current_minute_bar);feed(c,index=2,time=100000500,bs_flag='C',price=310000,volume=200,turnover=0)
        self.assertEqual(c.current_minute_bar,before);self.assertEqual(c.stream_state.latest_trade['price'],30);self.assertEqual(len(c.transactions),1);self.assertEqual(len(c.stream_state.events),1)
        e=c.stream_state.transaction_events[-1];self.assertEqual((e['eventKind'],e['bs_flag'],e['price'],e['amount']),('cancel','C',31,0));self.assertEqual(e['buy_id'],1);self.assertEqual(e['sell_id'],2)
    def test_zero_cancel_does_not_replace_latest(self):
        c=collector();feed(c);feed(c,index=2,time=100000500,bs_flag='C',price=0,turnover=0);self.assertEqual(c.stream_state.latest_trade['price'],30);self.assertEqual(c.current_minute_bar['tradeCount'],1);self.assertEqual(c.stream_state.transaction_events[-1]['eventKind'],'cancel')
    def test_legal_sell_still_updates_price_and_volume(self):
        c=collector();feed(c);feed(c,index=2,time=100000500,bs_flag='S',price=310000,volume=200,turnover=6200);self.assertEqual(c.current_minute_bar['close'],31);self.assertEqual(c.current_minute_bar['observedTradeVolume'],300);self.assertEqual(c.minute_flows['20261016-1000']['activeSellVolume'],200)
    def test_unknown_direction_is_retained_unknown(self):
        c=collector();feed(c);feed(c,index=2,time=100000500,bs_flag='X',price=310000);self.assertEqual(c.current_minute_bar['close'],30);self.assertEqual(c.stream_state.transaction_events[-1]['eventKind'],'unknown')
    def test_missing_symbol_cannot_invent_market(self):
        s=stream.StreamState();r=row();del r['symbol'];s.accept('transaction',r,1);self.assertIsNone(s.latest_trade);self.assertEqual(s.transaction_events[-1]['exchange'],'UNKNOWN')
    def test_missing_flag_cannot_invent_trade(self):
        s=stream.StreamState();r=row();del r['bs_flag'];s.accept('transaction',r,1);self.assertIsNone(s.latest_trade);self.assertEqual(s.transaction_events[-1]['eventKind'],'unknown')
    def test_shanghai_c_does_not_inherit_shenzhen_cancel_enum(self):
        c=collector();feed(c,symbol='601899',bs_flag='C');self.assertIsNone(c.stream_state.latest_trade);self.assertIsNone(c.current_minute_bar);e=c.stream_state.transaction_events[-1];self.assertEqual(e['exchange'],'SH');self.assertEqual(e['eventKind'],'unknown')
    def test_shanghai_missing_execution_marker_fails_closed(self):
        c=collector();feed(c,symbol='601899',bs_flag='B',function_code='0');self.assertIsNone(c.current_minute_bar);self.assertEqual(c.stream_state.transaction_events[-1]['function_code'],'0');self.assertEqual(c.stream_state.transaction_events[-1]['classificationBasis'],'UNKNOWN_SH_ORDER_KIND')
    def test_actual_shanghai_t_callback_updates_trade_ohlc(self):
        c=collector();feed(c,symbol='601899',order_kind='T',function_code='0');self.assertEqual(c.stream_state.latest_trade['classificationBasis'],'VENDOR_SH_ORDER_KIND_T');self.assertEqual(c.current_minute_bar['close'],30);self.assertEqual(c.current_minute_bar['tradeCount'],1)
    def test_shanghai_t_unknown_direction_is_not_unknown_execution(self):
        c=collector();feed(c,symbol='601899',order_kind='T',bs_flag='X',function_code='?');self.assertEqual(c.stream_state.latest_trade['eventKind'],'trade');self.assertEqual(c.current_minute_bar['tradeCount'],1);self.assertEqual(c.minute_flows,{})
    def test_shanghai_t_does_not_require_invented_function_enum(self):
        r=row(symbol='601899',order_kind='T');del r['function_code'];del r['bs_flag'];self.assertEqual(stream.event_fields(r)['eventKind'],'trade')
    def test_shanghai_t_cancel_flag_conflict_is_unknown_not_cancel(self):
        c=collector();feed(c,symbol='601899',order_kind='T',bs_flag='C');self.assertIsNone(c.current_minute_bar);self.assertEqual(c.stream_state.transaction_events[-1]['eventKind'],'unknown');self.assertEqual(c.stream_state.transaction_events[-1]['classificationBasis'],'CONFLICTING_SH_T_AND_C_FLAG')
    def test_order_stream_t_does_not_become_transaction_trade(self):
        c=collector();feed(c,'order',symbol='601899',order_kind='T');self.assertIsNone(c.stream_state.latest_trade);self.assertEqual(c.stream_state.order_events[-1]['eventKind'],'unknown')
    def test_undocumented_lowercase_markers_are_not_promoted(self):
        self.assertEqual(stream.event_fields(row(symbol='601899',order_kind='t'))['eventKind'],'unknown');self.assertEqual(stream.event_fields(row(bs_flag='b'))['eventKind'],'unknown')
    def test_own_trade_age_and_cancel_unknown_refresh(self):
        for flag in ('S','C','X'):
            with self.subTest(flag=flag):
                s=stream.StreamState();s.accept('transaction',row(),T0);s.accept('transaction',row(index=2,time=100029000,bs_flag=flag),T0+29)
                p=published_latest(s,T0+30);self.assertEqual(p['available'],flag=='S');self.assertEqual(p['receiptAgeSeconds'],1 if flag=='S' else 30)
    def test_missing_naive_future_trade_receipt_is_unavailable(self):
        for received in (None,'2026-10-16T02:00:00','2026-10-16T02:01:00Z','bad'):
            with self.subTest(received=received):
                s=stream.StreamState();s.accept('transaction',row(),T0);s.latest_trade['receivedAt']=received;self.assertFalse(published_latest(s,T0+1)['available'])
    def test_collector_keeps_eight_second_boundary(self):
        s=stream.StreamState();s.accept('transaction',row(),T0);self.assertTrue(published_latest(s,T0+8)['available']);self.assertFalse(published_latest(s,T0+8.001)['available'])
    def test_old_business_date_and_generation_trade_are_unavailable(self):
        s=stream.StreamState();s.accept('transaction',row(),T0);s.latest_trade['exchangeTime']='20261015-100000000';self.assertFalse(published_latest(s,T0+1)['available']);s.latest_trade['exchangeTime']='20261016-100000000';s.latest_trade['generation']=-1;self.assertFalse(published_latest(s,T0+1)['available'])
    def test_silent_and_disconnected_trade_are_unavailable(self):
        s=stream.StreamState();s.accept('transaction',row(),T0);self.assertFalse(published_latest(s,T0+30)['available']);self.assertFalse(published_latest(s,T0+1,False)['available'])
    def test_authorization_error_cannot_publish_trade_available(self):
        s=stream.StreamState();s.accept('transaction',row(),T0);self.assertFalse(published_latest(s,T0+1,authorized=False)['available'])
    def test_nonpositive_trade_price_is_unknown(self):
        c=collector();feed(c,price=0);self.assertIsNone(c.current_minute_bar);self.assertIsNone(c.stream_state.latest_trade)
    def test_missing_quantity_is_not_fabricated_as_execution(self):
        s=stream.StreamState();r=row();del r['volume'];self.assertTrue(s.accept('transaction',r,1));self.assertIsNone(s.latest_trade);self.assertIsNone(s.transaction_events[-1]['volume']);self.assertEqual(s.transaction_events[-1]['eventKind'],'unknown')
    def test_unknown_symbol_market_stays_unknown(self):
        s=stream.StreamState();s.accept('transaction',row(symbol='123456'),1);self.assertIsNone(s.latest_trade);self.assertEqual(s.transaction_events[-1]['exchange'],'UNKNOWN')
    def test_missing_source_date_is_rejected(self):
        s=stream.StreamState();r=row();del r['date'];self.assertFalse(s.accept('transaction',r,1));self.assertEqual(s.streams['transaction']['invalidTimeCount'],1)
    def test_cross_channel_interleave_retained_without_rewind(self):
        c=collector();feed(c,channel=1008);feed(c,channel=1007,index=100,time=100001000,price=310000);feed(c,channel=1008,index=2,time=100000500,price=290000)
        s=c.stream_state;self.assertEqual(s.streams['transaction']['acceptedCount'],3);self.assertEqual(s.streams['transaction']['outOfOrderCount'],0);self.assertEqual(len(s.events),3);self.assertEqual(s.latest_trade['price'],31);self.assertEqual(c.current_minute_bar['close'],31);self.assertEqual(s.transaction_events[-1]['aggregationDisposition'],'ledger-only-late-trade')
    def test_cross_channel_same_index_not_duplicate(self):
        s=stream.StreamState();s.accept('transaction',row(),1);self.assertTrue(s.accept('transaction',row(channel=1008,time=100000500),2));self.assertEqual(len(s.events),2)
    def test_same_channel_duplicate_still_rejected(self):
        s=stream.StreamState();s.accept('transaction',row(),1);self.assertFalse(s.accept('transaction',row(),2));self.assertEqual(s.streams['transaction']['duplicateCount'],1)
    def test_same_channel_time_backward_still_rejected(self):
        s=stream.StreamState();s.accept('transaction',row(time=100001000),1);self.assertFalse(s.accept('transaction',row(time=100000500,index=2),2))
    def test_same_channel_index_backward_still_rejected(self):
        s=stream.StreamState();s.accept('transaction',row(index=2),1);self.assertFalse(s.accept('transaction',row(index=1,time=100000500),2))
    def test_same_source_time_cross_channel_does_not_replace_display(self):
        s=stream.StreamState();s.accept('transaction',row(price=300000),1);self.assertTrue(s.accept('transaction',row(channel=1008,price=310000),2));self.assertEqual(s.latest_trade['price'],30);self.assertEqual(len(s.events),2)
    def test_date_reset_accepts_new_sequence_and_clears_old_cache(self):
        s=stream.StreamState();s.accept('transaction',row(index=99),1);self.assertTrue(s.accept('transaction',row(date=20261019,index=1),2));self.assertEqual(len(s.events),1);self.assertTrue(s.latest_trade['exchangeTime'].startswith('20261019'))
    def test_previous_day_other_channel_rejected(self):
        s=stream.StreamState();s.accept('transaction',row(date=20261019),1);self.assertFalse(s.accept('transaction',row(channel=1008,date=20261016,index=99),2))
    def test_new_day_in_other_stream_invalidates_old_trade(self):
        s=stream.StreamState();s.accept('transaction',row(),1);s.accept('snapshot',dict(date=20261019,time=100000000),2);self.assertIsNone(s.latest_trade);self.assertFalse(s.public(2,True,15)['transaction']['available'])
    def test_reconnect_clears_ledgers_and_retains_dedup(self):
        s=stream.StreamState();s.accept('transaction',row(),1);s.reconnect();self.assertEqual(len(s.events),0);self.assertEqual(len(s.transaction_events),0);self.assertFalse(s.accept('transaction',row(),2));self.assertFalse(s.public(2,True,15)['transaction']['available'])
    def test_missing_sequence_ambiguous_record_not_reclassified(self):
        s=stream.StreamState();r=row();del r['index'];s.accept('transaction',r,1);self.assertFalse(s.accept('transaction',r|dict(price=310000),2));self.assertEqual(s.streams['transaction']['ambiguousTimeCount'],1)
    def test_typed_cache_bounded_and_serializable(self):
        s=stream.StreamState()
        for i in range(140):s.accept('transaction',row(index=i+1,time=100000000+i,bs_flag='C'),i)
        self.assertEqual(len(s.transaction_events),128);self.assertEqual(len(s.events),0);self.assertEqual(s.classification_counts['cancel'],140);json.dumps(list(s.transaction_events))
    def test_order_raw_classification_and_channel_retained(self):
        c=collector();feed(c,'order',order_no=8,order_kind='D',function_code='C');e=c.stream_state.order_events[-1];self.assertEqual((e['order_no'],e['order_kind'],e['function_code'],e['channel']),(8,'D','C',1007));self.assertEqual(e['eventKind'],'unknown');self.assertIsNone(c.stream_state.latest_trade)
if __name__=='__main__':unittest.main()
