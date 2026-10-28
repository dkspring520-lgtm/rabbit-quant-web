import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import zijin_l2_second_state as module
class ForwardClockContractTest(unittest.TestCase):
 def test_mixed_clock_keeps_provenance_but_cannot_claim_minute_high(self):
  state={'updatedAt':'2026-10-23T01:31:02Z','book':{'exchangeTime':'20261023-093059','receivedAt':1,'bidPrices':[26.75]},'streams':{'snapshot':{'exchangeTime':'20261023-093059'}},'session':{'exchangeTime':'20261023-093059'},'volatility':{'currentBar':{'minute':'20261023-0931','high':27}},'dataQuality':{'continuityCertified':False}}
  row=module.annotate_forward_record({'exchangeMinute':'20261023-0930','minuteHigh':27,'minuteLow':26},state)
  self.assertIsNone(row['minuteHigh']); self.assertIsNone(row['minuteLow'])
  self.assertFalse(row['causal']); self.assertFalse(row['quality']['verified'])
  self.assertEqual(row['timeContract']['observedAt'],state['updatedAt'])
  self.assertEqual(row['fieldSources']['book']['exchangeTime'],'20261023-093059')
  self.assertEqual(row['streams'],state['streams'])
 def test_missing_sources_are_unknown(self):
  row=module.annotate_forward_record({'exchangeMinute':'20261023-0930'}, {})
  self.assertIsNone(row['fieldSources']['book']['exchangeTime'])
  self.assertFalse(row['quality']['verified'])
import ast, json, tempfile
from types import SimpleNamespace
SOURCE = Path(__file__).resolve().parents[1]/'scripts/zijin_l2_collector.py'
class RestartContractTest(unittest.TestCase):
 def test_forward_restart_preserves_unknown_amount_and_provenance(self):
  tree=ast.parse(SOURCE.read_text(encoding='utf-8'))
  methods={node.name:node for node in ast.walk(tree) if isinstance(node,ast.FunctionDef)}
  env={'Path':Path,'json':json,'is_a_share_cash_session':lambda x:True}
  for name in ['load_intraday_flow_forward_fallback','recent_minute_payload']:
   exec(compile(ast.Module(body=[methods[name]],type_ignores=[]),str(SOURCE),'exec'),env)
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'forward.jsonl'
   row={'exchangeMinute':'20261023-0930','lastPrice':27,'flow':{'activeBuyNotional60s':100},'fieldSources':{'book':{'exchangeTime':'20261023-093059'}},'timeContract':{'semantics':'mixed-stream-as-observed'}}
   path.write_text(json.dumps(row)+'\n',encoding='utf-8')
   state=SimpleNamespace(forward_path=str(path),minute_flows={},restored_minute_rows={},minute_bars=[],current_minute_bar=None,last_exchange_time='',minute_flow_payload=lambda m:{})
   env['load_intraday_flow_forward_fallback'](state)
   result=env['recent_minute_payload'](state)[0]
   self.assertIsNone(result['amount']);self.assertIsNone(result['volume']);self.assertFalse(result['quality']['verified'])
   self.assertEqual(result['fieldSources'],row['fieldSources'])
   self.assertEqual(result['timeContract'],row['timeContract'])

if __name__=='__main__': unittest.main()
