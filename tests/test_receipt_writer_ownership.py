import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from zijin_l2_receipt_writer import ReceiptWriter
import zijin_l2_receipt_writer as module

class OwnershipTests(unittest.TestCase):
    def test_second_process_is_denied_and_crash_releases_os_lock(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'rows.jsonl'
            code="import sys,time;sys.path.insert(0,sys.argv[1]);from zijin_l2_receipt_writer import ReceiptWriter;w=ReceiptWriter(sys.argv[2]);print('locked',flush=True);time.sleep(20)"
            child=subprocess.Popen([sys.executable,'-u','-c',code,str(ROOT/'scripts'),str(path)],stdout=subprocess.PIPE,text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(),'locked')
                with self.assertRaises(OSError):ReceiptWriter(path)
            finally:
                child.terminate();child.wait(timeout=5);child.stdout.close()
            with ReceiptWriter(path) as writer:
                writer.append({'exchangeMinute':'one'})

    def test_incremental_validation_and_external_change_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'rows.jsonl'
            path.write_text(''.join(json.dumps({'exchangeMinute':str(i)})+'\n' for i in range(100)))
            with ReceiptWriter(path) as writer:
                starts=[];original=module.complete_lines
                def counted(path,sync,*,start=0):
                    starts.append((str(path),start))
                    return original(path,sync,start=start)
                size=path.stat().st_size
                with patch.object(module,'complete_lines',side_effect=counted):
                    writer.append({'exchangeMinute':'new'})
                    writer.append({'exchangeMinute':'new'})
                self.assertTrue(all(start>=size for name,start in starts if name==str(path)))
                with path.open('a') as handle:handle.write('{}\n')
                with self.assertRaisesRegex(ValueError,'outside owning writer'):
                    writer.append({'exchangeMinute':'next'})
                with self.assertRaisesRegex(ValueError,'outside owning writer'):
                    writer.append({'exchangeMinute':'next'})

if __name__=='__main__':unittest.main()
