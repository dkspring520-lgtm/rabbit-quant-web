import unittest
from unittest.mock import patch
import sqlite3, tempfile
from pathlib import Path
from event_language import chinese_title
import database

class TitleTests(unittest.TestCase):
    def test_known(self):
        self.assertEqual(chinese_title('FOMC Member Goolsbee Speaks'),'美联储官员古尔斯比讲话')
        self.assertEqual(chinese_title('French Flash Services PMI'),'法国服务业采购经理指数初值')
        self.assertEqual(chinese_title('Core Durable Goods Orders m/m'),'核心耐用品订单（月率）')
    def test_unknown_identity(self):
        self.assertEqual(chinese_title('New Economic Survey'),'New Economic Survey')
        self.assertNotEqual(chinese_title('New A'),chinese_title('New B'))
    def test_migration_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(database,'DB_PATH',Path(tmp)/'test.db'):
            database.replace_events([dict(date='2026-09-21',time='20:00',title='待核译经济事件',level=5,assets=[],description='原文核对标识：Flash Services PMI')])
            self.assertEqual(database.repair_cached_titles(),1)
            self.assertEqual(database.repair_cached_titles(),0)
            self.assertEqual(len(database.all_events()),1)
            self.assertEqual(database.all_events()[0]['title'],'服务业采购经理指数初值')

if __name__=='__main__': unittest.main()
