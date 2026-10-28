import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from zijin_l2_second_state import ForwardMinuteBuffer

class ForwardBufferContractTest(unittest.TestCase):
    def test_older_minute_cannot_close_or_replace_pending(self):
        buffer = ForwardMinuteBuffer()
        buffer.push({'exchangeMinute': '20261023-0931', 'lastPrice': 27})
        self.assertIsNone(buffer.push({'exchangeMinute': '20261023-0930', 'lastPrice': 26}))
        completed = buffer.push({'exchangeMinute': '20261023-0932'})
        self.assertEqual(completed['exchangeMinute'], '20261023-0931')
        self.assertEqual(completed['lastPrice'], 27)

    def test_previous_day_cannot_close_pending(self):
        buffer = ForwardMinuteBuffer()
        buffer.push({'exchangeMinute': '20261026-0930'})
        self.assertIsNone(buffer.push({'exchangeMinute': '20261023-1500'}))
        self.assertEqual(buffer.pending['exchangeMinute'], '20261026-0930')

    def test_pending_is_detached_from_mutable_input(self):
        buffer = ForwardMinuteBuffer()
        record = {'exchangeMinute': '20261023-0930', 'book': {'bidPrices': [26.75]}}
        buffer.push(record)
        record['book']['bidPrices'][0] = 99
        completed = buffer.push({'exchangeMinute': '20261023-0931'})
        self.assertEqual(completed['book']['bidPrices'], [26.75])

    def test_same_minute_replacement_is_also_detached(self):
        buffer = ForwardMinuteBuffer()
        buffer.push({'exchangeMinute': '20261023-0930'})
        replacement = {'exchangeMinute': '20261023-0930', 'flow': {'value': 1}}
        buffer.push(replacement)
        replacement['flow']['value'] = 2
        self.assertEqual(buffer.push({'exchangeMinute': '20261023-0931'})['flow']['value'], 1)

if __name__ == '__main__':
    unittest.main()
