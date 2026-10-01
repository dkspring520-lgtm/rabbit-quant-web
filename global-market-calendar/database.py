import sqlite3
from contextlib import contextmanager
from config import DB_PATH

@contextmanager
def connect():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("CREATE TABLE IF NOT EXISTS events (date TEXT,time TEXT,country TEXT,flag TEXT,title TEXT,category TEXT,level INTEGER,previous TEXT,forecast TEXT,actual TEXT,assets TEXT,description TEXT,PRIMARY KEY(date,time,title))")
    try:
        with db:
            yield db
    finally:
        db.close()

def seed(events):
    with connect() as db:
        for event in events:
            db.execute("INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (*[event.get(k) for k in ("date","time","country","flag","title","category","level","previous","forecast","actual")], ",".join(event["assets"]), event["description"]))

def all_events():
    with connect() as db:
        rows = db.execute("SELECT * FROM events ORDER BY date,time").fetchall()
    return [dict(row) | {"assets": row["assets"].split(",")} for row in rows]

def replace_events(events):
    with connect() as db:
        db.execute('DELETE FROM events')
        for event in events:
            db.execute("INSERT OR REPLACE INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (*[event.get(k) for k in ("date","time","country","flag","title","category","level","previous","forecast","actual")], ",".join(event.get("assets", [])), event.get("description", "")))


def repair_cached_titles():
    """Retranslate from saved source names without downloading or dropping rows."""
    from event_language import chinese_title
    changed = 0
    with connect() as db:
        rows = db.execute('SELECT rowid, date, time, title, description FROM events').fetchall()
        for row in rows:
            marker = '原文核对标识：'
            if marker not in (row['description'] or ''):
                continue
            original = row['description'].split(marker, 1)[1].strip()
            title = chinese_title(original)
            if title and title != row['title']:
                collision = db.execute('SELECT 1 FROM events WHERE date=? AND time=? AND title=? AND rowid!=?',
                    (row['date'], row['time'], title, row['rowid'])).fetchone()
                if collision:
                    title += '（' + original + '）'
                db.execute('UPDATE events SET title=? WHERE rowid=?', (title, row['rowid']))
                changed += 1
    return changed
