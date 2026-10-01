"""Persistent refresh policy, independent of Tk and network for testing."""
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError


def due(state, now=None):
    now = now or datetime.now()
    try:
        return now >= datetime.fromisoformat(state['next_retry'])
    except (KeyError, ValueError, TypeError):
        return True


def outcome(state, error=None, now=None, stale=False):
    now = now or datetime.now()
    result = dict(state)
    if error is not None:
        failures = min(int(state.get('failures', 0)) + 1, 12)
        limited = isinstance(error, HTTPError) and error.code == 429
        seconds = min((1800 if limited else 300) * 2 ** (failures - 1), 21600)
        if isinstance(error, HTTPError) and error.headers:
            value = error.headers.get('Retry-After', '')
            try:
                seconds = max(seconds, int(value))
            except (ValueError, TypeError):
                try:
                    target = parsedate_to_datetime(value)
                    if target.tzinfo is None:
                        target = target.replace(tzinfo=timezone.utc)
                    seconds = max(seconds, (target - now.astimezone(timezone.utc)).total_seconds())
                except (ValueError, TypeError, OverflowError):
                    pass
        message = '数据源限流，保留缓存' if limited else '更新失败，保留缓存'
        result.update(failures=failures, status='limited' if limited else 'error')
    else:
        seconds = 3600 if stale else 21600
        message = '源日历暂无未来事件，等待更新' if stale else '日历同步成功'
        result.update(failures=0, status='stale' if stale else 'ok', last_success=now.strftime('%Y-%m-%d %H:%M'))
    result.update(next_retry=(now + timedelta(seconds=seconds)).isoformat(timespec='seconds'), message=message)
    return result


def status_text(state):
    message = state.get('message', '')
    retry = state.get('next_retry', '')
    return message + (' · 下次检查 ' + retry[5:16].replace('T', ' ') if retry else '')


def validate_events(events):
    if not isinstance(events, list) or not events:
        raise ValueError('接口没有返回有效事件')
    for event in events:
        datetime.strptime(event['date'] + ' ' + event['time'], '%Y-%m-%d %H:%M')
        if not event.get('title') or not isinstance(event.get('level'), int) or not 1 <= event['level'] <= 5:
            raise ValueError('事件格式不正确')


def synchronize(url, state, fetch, read, replace, now=None):
    now = now or datetime.now()
    try:
        events = fetch(url)
        validate_events(events)
        future = lambda e: datetime.strptime(e['date']+' '+e['time'], '%Y-%m-%d %H:%M') > now
        stale = not any(future(e) for e in events)
        # A stale response must not replace a cache that already contains future dates.
        if not stale or not any(future(e) for e in read()):
            replace(events)
        result = outcome(state, now=now, stale=stale)
        result.update(source=url, coverage_end=max(e['date'] for e in events))
        return True, result
    except Exception as exc:
        return False, outcome(state, error=exc, now=now)
