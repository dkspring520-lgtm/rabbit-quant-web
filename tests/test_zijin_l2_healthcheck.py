"""SSE clock/calendar and liveness counterexamples; synthetic payloads only."""
import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "scripts/zijin_l2_healthcheck.py"
spec = importlib.util.spec_from_file_location("l2_healthcheck", SOURCE)
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


def local(clock, date="2026-10-19"):
    return datetime.fromisoformat(date + "T" + clock + "+08:00")


def state(now, age=1):
    received = now - timedelta(seconds=age)
    return {"updatedAt": (now-timedelta(seconds=.1)).isoformat(),
            "lastMessageAt": received.isoformat(),
            "lastExchangeTime": received.astimezone(health.SHANGHAI).strftime("%Y%m%d-%H%M%S%f"),
            "status": {"connected": True, "authorized": True, "stale": False, "ageSeconds": age}}


class HealthTests(unittest.TestCase):
    def test_session_boundaries_including_auctions(self):
        for clock, phase in [("09:14:59", "closed-hours"), ("09:15:00", "opening-auction"),
                             ("09:24:59", "opening-auction"), ("09:25:00", "opening-pause"),
                             ("09:29:59", "opening-pause"), ("09:30:00", "morning"),
                             ("11:29:59", "morning"), ("11:30:00", "lunch"),
                             ("12:59:59", "lunch"), ("13:00:00", "afternoon"),
                             ("14:56:59", "afternoon"), ("14:57:00", "closing-auction"),
                             ("14:59:59", "closing-auction"), ("15:00:00", "closed-hours")]:
            with self.subTest(clock=clock):
                self.assertEqual(health.market_phase(local(clock)), phase)

    def test_morning_open_requires_fresh_feed(self):
        now = local("09:30:00")
        self.assertTrue(health.evaluate_health(state(now, 0), now)["healthy"])
        x = state(now);x["status"]["stale"] = True
        self.assertFalse(health.evaluate_health(x, now)["healthy"])

    def test_lunch_accepts_end_of_morning_without_claiming_freshness(self):
        now = local("12:30:00");x=state(local("11:29:59"))
        x["updatedAt"]=(now-timedelta(seconds=.2)).isoformat()
        x["status"].update(stale=True, ageSeconds=3602)
        result=health.evaluate_health(x, now)
        self.assertTrue(result["healthy"])
        self.assertFalse(result["feedFreshnessRequired"])
        self.assertEqual(result["reason"], "heartbeat-and-connection-only")

    def test_lunch_new_reader_may_not_yet_have_received_market_data(self):
        now=local("12:30:00");x=state(now)
        x.update(lastMessageAt=None,lastExchangeTime=None)
        x["status"].update(stale=True,ageSeconds=None)
        self.assertTrue(health.evaluate_health(x,now)["healthy"])

    def test_lunch_does_not_accept_dead_or_future_heartbeat(self):
        now=local("12:30:00")
        for age in [15, 30, -1]:
            with self.subTest(age=age):
                x=state(now);x["updatedAt"]=(now-timedelta(seconds=age)).isoformat()
                self.assertFalse(health.evaluate_health(x,now)["healthy"])

    def test_disconnect_and_authorization_failure_fail_even_at_lunch_or_close(self):
        for clock in ["10:00:00","12:00:00","15:00:00"]:
            for flag in ["connected","authorized"]:
                with self.subTest(clock=clock,flag=flag):
                    now=local(clock);x=state(now);x["status"][flag]=False
                    self.assertFalse(health.evaluate_health(x,now)["healthy"])

    def test_exact_13_00_requires_new_afternoon_data(self):
        now=local("13:00:00");x=state(local("11:29:59"));x["updatedAt"]=now.isoformat()
        self.assertFalse(health.evaluate_health(x,now)["healthy"])
        x=state(now,0)
        self.assertTrue(health.evaluate_health(x,now)["healthy"])

    def test_no_grace_for_packets_before_the_open_or_reopen_boundary(self):
        for clock in ["09:30:00", "13:00:00", "14:57:00"]:
            now=local(clock)
            self.assertFalse(health.evaluate_health(state(now,.01),now)["healthy"])

    def test_just_received_morning_replay_is_rejected_at_reopen(self):
        now=local("13:00:01");x=state(now)
        x["lastExchangeTime"]="20261019-112959000"
        self.assertFalse(health.evaluate_health(x,now)["healthy"])

    def test_previous_business_day_and_future_exchange_time_are_rejected(self):
        now=local("13:05:00")
        for stamp in ["20261016-130459000", "20261019-130501000"]:
            x=state(now);x["lastExchangeTime"]=stamp
            self.assertFalse(health.evaluate_health(x,now)["healthy"])

    def test_close_does_not_relax_closing_auction(self):
        for clock, expected in [("14:59:59",False),("15:00:00",True)]:
            now=local(clock);x=state(now,60);x["status"]["stale"]=True
            self.assertEqual(health.evaluate_health(x,now)["healthy"],expected)

    def test_timezone_conversion_is_independent_of_host_timezone(self):
        now=local("13:00:00").astimezone(timezone.utc)
        self.assertEqual(health.market_phase(now),"afternoon")
        self.assertTrue(health.evaluate_health(state(now,0),now)["healthy"])

    def test_exchange_holidays_and_weekends_are_not_makeup_workdays(self):
        for day in ["2026-01-01","2026-02-23","2026-04-06","2026-05-05","2026-06-19","2026-09-25","2026-10-07","2026-10-10","2026-10-18"]:
            with self.subTest(day=day):
                self.assertEqual(health.market_phase(local("10:00:00",day)),"closed-day")
        self.assertEqual(health.market_phase(local("10:00:00","2026-10-08")),"morning")
        self.assertEqual(health.market_phase(local("10:00:00","2026-10-19")),"morning")

    def test_unconfigured_year_cannot_silently_relax_freshness(self):
        now=local("12:00:00","2027-10-19")
        self.assertEqual(health.evaluate_health(state(now),now)["reason"],"calendar-year-not-configured")

    def test_bad_heartbeat_timestamps_fail(self):
        now=local("12:00:00")
        for value in [None,"invalid","2026-10-19T04:00:00"]:
            x=state(now);x["updatedAt"]=value
            self.assertFalse(health.evaluate_health(x,now)["healthy"])

    def test_live_data_requires_real_receipt_time_not_cached_age(self):
        now=local("10:00:00")
        for value in [None,(now-timedelta(seconds=30)).isoformat(),(now+timedelta(seconds=1)).isoformat()]:
            x=state(now);x["lastMessageAt"]=value
            self.assertFalse(health.evaluate_health(x,now)["healthy"])

    def test_live_stale_flag_and_invalid_age_fail(self):
        now=local("10:00:00")
        for value in [None,True,float("nan"),float("inf"),-1,15.01]:
            x=state(now);x["status"]["ageSeconds"]=value
            self.assertFalse(health.evaluate_health(x,now)["healthy"])

    def test_cli_missing_or_invalid_state_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            f=Path(folder)/"state.json"
            for body in [None,"{broken"]:
                if body is not None:f.write_text(body)
                r=subprocess.run([sys.executable,str(SOURCE),"--state",str(f)],capture_output=True,text=True,timeout=5)
                self.assertEqual(r.returncode,1)
                self.assertFalse(json.loads(r.stdout)["healthy"])


if __name__ == "__main__":
    unittest.main()
