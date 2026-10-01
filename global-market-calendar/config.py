from pathlib import Path
import os

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'GlobalMarketCalendar'
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "global_events.sqlite3"
WINDOW_TITLE = "Global Market Calendar · 全球金融事件日历"
EVENTS_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
