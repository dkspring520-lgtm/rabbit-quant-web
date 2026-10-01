from database import repair_cached_titles,all_events
from config import DB_PATH
import sqlite3
backup=DB_PATH.with_name('before-title-repair.sqlite3')
with sqlite3.connect(DB_PATH) as src, sqlite3.connect(backup) as dest: src.backup(dest)
print('repaired:',repair_cached_titles())
rows=all_events()
print('remaining placeholders:',sum('待核' in e['title'] for e in rows))
print('untranslated originals:',[e['title'] for e in rows if e['title'].isascii()])
