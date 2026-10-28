"""Explicit synthetic benchmark, never part of ordinary unit-test discovery."""
import json
import os
import platform
import statistics
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import zijin_l2_receipt_writer as module

with tempfile.TemporaryDirectory(prefix='rabbit-synthetic-receipt-') as folder:
    path=Path(folder)/'synthetic.jsonl'
    size=count=0
    with path.open('wb') as handle:
        while size<78*1024*1024:
            raw=(json.dumps({'exchangeMinute':str(count),'padding':'x'*2000})+'\n').encode()
            handle.write(raw);size+=len(raw);count+=1
    started=time.perf_counter()
    with module.ReceiptWriter(path) as writer:
        startup=time.perf_counter()-started
        reads=[];original=module.complete_lines
        def counted(path,sync,*,start=0):
            rows=original(path,sync,start=start)
            reads.append(sum(len(raw) for _,raw,_ in rows))
            return rows
        timings=[]
        with patch.object(module,'complete_lines',side_effect=counted):
            for i in range(20):
                started=time.perf_counter()
                writer.append({'exchangeMinute':f'new-{i}'})
                timings.append((time.perf_counter()-started)*1000)
        print(json.dumps({'os':platform.system(),'architecture':platform.machine(),'python':platform.python_version(),
            'logicalCpus':os.cpu_count(),'syntheticBytes':size,'rows':count,'startupSeconds':startup,
            'appends':20,'appendMedianMs':statistics.median(timings),'appendMaxMs':max(timings),
            'historicalBytesReparsedDuringAppends':sum(reads),'productionBenchmark':False}))
