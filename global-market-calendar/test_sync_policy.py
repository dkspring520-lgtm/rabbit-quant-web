import unittest
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from urllib.error import HTTPError
from sync_policy import due, outcome, synchronize

NOW = datetime(2026, 9, 19, 12)
def event(day):
    return dict(date=day, time='20:30', title='测试', level=5)

class SyncTests(unittest.TestCase):
    def test_429_and_restart_cooldown(self):
        state=outcome({},HTTPError('x',429,'limited',{},None),NOW)
        self.assertFalse(due(state,NOW+timedelta(minutes=29)))
        self.assertTrue(due(state,NOW+timedelta(minutes=30)))
        again=outcome(state,HTTPError('x',429,'limited',{},None),NOW)
        self.assertEqual(datetime.fromisoformat(again['next_retry'])-NOW,timedelta(hours=1))
    def test_retry_after_seconds_and_date(self):
        for value in ['7200',format_datetime((NOW+timedelta(hours=2)).astimezone(timezone.utc),usegmt=True)]:
            state=outcome({},HTTPError('x',429,'limited',{'Retry-After':value},None),NOW)
            self.assertFalse(due(state,NOW+timedelta(minutes=119)))
    def test_failure_and_empty_keep_cache(self):
        writes=[]
        for fetch in [lambda _:[],lambda _: (_ for _ in ()).throw(HTTPError('x',429,'limited',{},None))]:
            ok,state=synchronize('x',{},fetch,lambda:[event('2026-09-21')],writes.append,NOW)
            self.assertFalse(ok)
        self.assertEqual(writes,[])
    def test_stale_cannot_erase_future(self):
        writes=[]
        ok,state=synchronize('x',{},lambda _:[event('2026-09-18')],lambda:[event('2026-09-21')],writes.append,NOW)
        self.assertTrue(ok)
        self.assertEqual(state['status'],'stale')
        self.assertEqual(writes,[])
        self.assertTrue(due(state,NOW+timedelta(hours=1)))
    def test_new_week_replaces_cache(self):
        writes=[]
        ok,state=synchronize('x',{'failures':3},lambda _:[event('2026-09-21')],lambda:[event('2026-09-18')],writes.append,NOW)
        self.assertTrue(ok)
        self.assertEqual(state['failures'],0)
        self.assertEqual(writes,[[event('2026-09-21')]])
    def test_bad_record_cannot_erase_cache(self):
        writes=[]
        ok,state=synchronize('x',{},lambda _:[dict(event('2026-09-21'),time='bad')],lambda:[],writes.append,NOW)
        self.assertFalse(ok)
        self.assertEqual(writes,[])

if __name__=='__main__': unittest.main()
