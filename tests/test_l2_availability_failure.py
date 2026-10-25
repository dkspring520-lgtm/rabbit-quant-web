import sys, unittest, ast, json, tempfile, os
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from zijin_l2_forward_labels import build_labels
class AvailabilityFailureTest(unittest.TestCase):
 def test_legacy_minute_chain_cannot_be_promoted(self):
  rows=[{'symbol':'601899','exchangeMinute':f'20261023-093{i}','lastPrice':27+i*.01,'observedAt':f'2026-10-23T01:3{i}:59Z'} for i in range(6)]
  self.assertEqual(build_labels(rows,set()),[])
 def test_fsync_failure_does_not_publish_memory_success(self):
  source=Path(__file__).resolve().parents[1]/'scripts/zijin_l2_collector.py'
  tree=ast.parse(source.read_text(encoding='utf-8'))
  method=next(x for x in ast.walk(tree) if isinstance(x,ast.FunctionDef) and x.name=='write_forward_record')
  def fail(_): raise OSError('synthetic fsync failure')
  env={'Path':Path,'json':json,'os':os,'append_with_receipt':lambda path,row: fail(None)}
  exec(compile(ast.Module(body=[method],type_ignores=[]),str(source),'exec'),env)
  with tempfile.TemporaryDirectory() as folder:
   seen=[]
   state=SimpleNamespace(forward_path=str(Path(folder)/'rows.jsonl'),forward_minutes=set(),forward_days=set(),last_forward_minute=None,reverse_shadow=SimpleNamespace(observe=seen.append))
   row={'exchangeMinute':'20261023-0930','quality':{'verified':False},'timeContract':{'persistedAt':None}}
   with self.assertRaises(OSError):env['write_forward_record'](state,row)
   self.assertFalse(state.forward_minutes);self.assertEqual(seen,[]);self.assertIsNone(row['timeContract']['persistedAt'])
 def test_future_durable_receipt_and_late_anchor_block_labels(self):
  rows=[]
  for i in range(6):
   at=f"2026-10-23T01:3{i}:59Z"
   rows.append({'symbol':'601899','exchangeMinute':f'20261023-093{i}','lastPrice':27+i*.01,
                'quality':{'verified':True,'minuteFinality':'verified'},'timeContract':{'observedAt':at,'persistedAt':at}})
  self.assertEqual(build_labels(rows,set(),labeled_at='2026-10-23T01:34:59Z'),[])
  self.assertEqual(len(build_labels(rows,set(),labeled_at='2026-10-23T01:36:00Z')),1)
  rows[0]['timeContract']['persistedAt']='2026-10-23T01:34:59Z'
  self.assertEqual(build_labels(rows,set(),labeled_at='2026-10-23T01:36:00Z'),[])
 def test_existing_uncertified_labels_do_not_count_toward_readiness(self):
  from zijin_l2_forward_labels import summarize, EXPERIMENT_ID
  summary=summarize([], [{'experimentId':EXPERIMENT_ID,'observationId':'old','featureExchangeMinute':'20261023-0930'}],1,1,1)
  self.assertEqual(summary['coverage']['labeledObservations'],0)

 def test_corrupt_label_input_is_not_silently_dropped(self):
  from zijin_l2_forward_labels import read_jsonl
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder)/'bad.jsonl';p.write_text('{bad',encoding='utf-8')
   with self.assertRaises(json.JSONDecodeError):read_jsonl(p)

if __name__=='__main__':unittest.main()
