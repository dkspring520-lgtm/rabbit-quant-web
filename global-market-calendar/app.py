import calendar
from widget_style import RoundedCard, PhoneShell, SURFACE, CARD
from datetime import date, datetime, timedelta
import tkinter as tk
from tkinter import ttk
import os
import threading
import ctypes
import sys
from config import WINDOW_TITLE, EVENTS_URL, DATA_DIR
import json
import queue
from events import EVENTS
from database import seed, all_events, replace_events, repair_cached_titles
from fetcher import fetch_all_events
from sync_policy import due, status_text, synchronize
from analyzer import analyze_event, asset_outlook, outlook_explanation
from ai_analyzer import pre_event_outlook
from commodity_news import load_cache, refresh as refresh_commodity_news
import webbrowser
_instance_mutex = None
if os.name == 'nt':
    _kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    _kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
    _kernel.CreateMutexW.restype = ctypes.c_void_p
    _kernel.GetLastError.restype = ctypes.c_ulong
    _instance_mutex = _kernel.CreateMutexW(None, False, 'Local\\GlobalMarketCalendarDesktop.SingleInstance')
    if _kernel.GetLastError() == 183:
        sys.exit(0)
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(1)
except Exception:
    pass

BG, PANEL, TEXT, MUTED, LINE = SURFACE, CARD, "#273444", "#536477", "#b9c4d1"
CELL, CELL_ALT = "#ffffff", "#fafafa"
ACCENT = "#4f86c6"
RISK = {5:("重大", "#c85b78"), 4:("重要", "#c48a32"), 3:("一般", "#4f86a8"), 2:("较低", "#4f86a8"), 1:("低", "#7f8790")}

class CalendarApp(tk.Tk):
    def __init__(self):
        super().__init__(); self.title(WINDOW_TITLE); self.geometry("1100x700"); self.minsize(940,600); self.configure(bg=BG); self.tk.call('tk','scaling',1.333333)
        self._drag_origin = None
        self.bind('<Alt-d>', lambda e: self.toggle_widget_mode())
        self.bind('<ButtonPress-1>', self._drag_start); self.bind('<B1-Motion>', self._drag_move)
        self.bind('<Control-Up>', lambda e: self._opacity(0.05)); self.bind('<Control-Down>', lambda e: self._opacity(-0.05))
        self.option_add("*Font", ("Microsoft YaHei UI", 11)); self.option_add("*TButton.Font", ("Microsoft YaHei UI", 11))
        style=ttk.Style(self); style.theme_use("clam"); style.configure("TCombobox",fieldbackground="#172334",background="#172334",foreground=TEXT,bordercolor=LINE,arrowcolor=MUTED); style.map("TCombobox",fieldbackground=[("readonly", "#172334")],foreground=[("readonly",TEXT)])
        self.sync_file = DATA_DIR / 'sync.json'
        try: self.sync_state = json.loads(self.sync_file.read_text(encoding='utf-8'))
        except (OSError, ValueError): self.sync_state = {}
        self.sync_queue = queue.Queue()
        self.sync_busy = False
        self.sync_message = status_text(self.sync_state)
        self.news_file = DATA_DIR / 'commodity_news.json'
        self.news_cache = load_cache(self.news_file)
        self.news_busy = False
        self.after(1500, self.daily_check)
        self.after(2200, self.refresh_commodity_news)
        self.after(300, self.poll_sync)
        repair_cached_titles()
        self.events = all_events(); self.current = date.today().replace(day=1); self.selected = date.today().isoformat(); self.build(); self.draw_calendar(); self.after(400, self.toggle_widget_mode)
    def toggle_widget_mode(self):
        compact = not getattr(self, '_widget_mode', False); self._widget_mode = compact
        if compact:
            self.minsize(320,400)
            self.normal_detail=self.detail
            self.body_panel.pack_forget()
            self.phone=PhoneShell(self); self.phone.pack(fill='both',expand=True)
            self.detail=self.phone.screen
            self.top_panel.pack_forget(); self.rail_panel.pack_forget()
            self.overrideredirect(True); self.attributes('-topmost', False); self.calendar_panel.pack_forget(); w,h=390,620; x=self.winfo_screenwidth()-w-16; y=(self.winfo_screenheight()-h)//2; self.geometry(f'{w}x{h}+{x}+{y}'); self.after(100,self.embed_desktop)
            upcoming=sorted((e for e in self.events if e['date']>=date.today().isoformat()),key=lambda e:(e['date'],e['time']))
            self.show_widget_events(upcoming)
        else:
            from desktop_host import detach
            detach(self)
            self.phone.destroy(); self.detail=self.normal_detail
            self.body_panel.pack(fill='both',expand=True,padx=8,pady=8)
            self.top_panel.pack(side='top',fill='x',before=self.top_panel.master.winfo_children()[1])
            self.rail_panel.pack(side='left',fill='y')
            self.minsize(940,600)
            self.overrideredirect(False); self.attributes('-topmost', False); self.overview_panel.pack(side='left',fill='y',padx=(0,8)); self.calendar_panel.pack(side='right',fill='both',expand=True); self.geometry('1100x700')
    def embed_desktop(self):
        if os.name != 'nt' or not getattr(self, '_widget_mode', False): return
        import json
        from pathlib import Path
        from desktop_host import attach
        log = Path(os.environ.get('LOCALAPPDATA', '.')) / 'GlobalMarketCalendar-desktop.json'
        try:
            self.update_idletasks()
            result = attach(self)
            log.write_text(json.dumps(result), encoding='utf-8')
        except Exception as exc:
            log.write_text(json.dumps({'error': str(exc)}, ensure_ascii=False), encoding='utf-8')
            self.after(3000, self.embed_desktop)
    def _drag_start(self, event):
        if getattr(self, '_widget_mode', False): self._drag_origin=(event.x_root-self.winfo_x(), event.y_root-self.winfo_y())
    def _drag_move(self, event):
        if self._drag_origin:
            ox,oy=self._drag_origin; self.geometry(f'+{event.x_root-ox}+{event.y_root-oy}')
    def _opacity(self, delta):
        self.attributes('-alpha', max(0.55,min(1.0,float(self.attributes('-alpha'))+delta)))
    def show_widget_events(self, events=None):
        for w in self.detail.winfo_children(): w.destroy()
        self.overview_panel.configure(width=460,bg=SURFACE,highlightthickness=0)
        self.detail.configure(bg=SURFACE)
        for w in self.overview_panel.winfo_children():
            if isinstance(w, tk.Label): w.pack_forget()
        header_card=RoundedCard(self.detail); header_card.pack(fill='x',pady=(12,12))
        header=header_card.body
        tk.Label(header,text="全球事件日历",font=("Microsoft YaHei UI",-22,"bold"),fg=TEXT,bg=PANEL).pack(side='left')
        tk.Button(header,text="刷新",command=self.refresh_events,bg=CARD,fg="#334155",relief="flat",font=("Microsoft YaHei UI",-15)).pack(side='right')
        source="财经日历 · 北京时间" if self.sync_state.get('last_success') else "等待首次同步真实日历"
        status=self.sync_message or ("上次更新 "+self.sync_state['last_success'] if self.sync_state.get('last_success') else "启动同步，每日自动更新")
        tk.Label(self.detail,text=source,bg=PANEL,fg="#64748b",font=("Microsoft YaHei UI",-15),anchor='w').pack(fill='x')
        if self.events and self.sync_state.get('last_success'):
            dates=[e['date'] for e in self.events]
            tk.Label(self.detail,text=f"来源周历覆盖：{min(dates)} — {max(dates)}",bg=PANEL,fg=MUTED,font=('Microsoft YaHei UI',-13),anchor='w').pack(fill='x')
        tk.Label(self.detail,text=status,bg=PANEL,fg="#64748b",font=("Microsoft YaHei UI",-14),wraplength=420,justify='left',anchor='w').pack(fill='x',pady=(4,12))
        tk.Label(self.detail,text="未来 7 天 · 美国全部 / 其他仅重大",bg=SURFACE,fg=TEXT,font=("Microsoft YaHei UI",-15,"bold"),anchor='w').pack(fill='x',pady=(0,8))
        area=tk.Frame(self.detail,bg=SURFACE); area.pack(fill='both',expand=True)
        canvas=tk.Canvas(area,bg=SURFACE,highlightthickness=0)
        style=ttk.Style(self)
        style.layout('Quiet.Vertical.TScrollbar', [('Vertical.Scrollbar.trough', {'sticky':'ns', 'children':[('Vertical.Scrollbar.thumb', {'expand':'1','sticky':'nswe'})]})])
        style.configure('Quiet.Vertical.TScrollbar',width=6,arrowsize=0,background='#dce2e8',troughcolor=PANEL,borderwidth=0,relief='flat',bordercolor=PANEL,lightcolor='#dce2e8',darkcolor='#dce2e8')
        style.map('Quiet.Vertical.TScrollbar',background=[('active','#aab6c4')])
        bar=ttk.Scrollbar(area,orient='vertical',command=canvas.yview,style='Quiet.Vertical.TScrollbar')
        bar.pack(side='right',fill='y'); canvas.pack(side='left',fill='both',expand=True)
        canvas.configure(yscrollcommand=bar.set)
        content=tk.Frame(canvas,bg=SURFACE)
        item=canvas.create_window((0,0),window=content,anchor='nw')
        content.bind('<Configure>',lambda e:canvas.configure(scrollregion=canvas.bbox('all')))
        canvas.bind('<Configure>',lambda e:canvas.itemconfigure(item,width=e.width))
        def wheel(e): canvas.yview_scroll(-1 if e.delta>0 else 1,'units'); return 'break'
        now=datetime.now()
        end=now.date()+timedelta(days=7)
        events=[e for e in self.events if (e['country']=='美国' or e['level']==5) and datetime.strptime(e['date']+' '+e['time'],'%Y-%m-%d %H:%M') > now and e['date'] < end.isoformat()]
        for e in sorted(events,key=lambda x:(x['date'],x['time'])):
            tag,color=RISK.get(e['level'],RISK[1])
            track=tk.Frame(content,bg=SURFACE); track.pack(fill='x',pady=(0,10))
            marker=tk.Canvas(track,width=16,height=90,bg=SURFACE,highlightthickness=0); marker.pack(side='left',fill='y')
            marker.create_line(7,0,7,1000,fill='#dce1e7')
            marker.create_oval(3,16,11,24,fill=SURFACE,outline='#c4cbd5')
            card=RoundedCard(track); card.pack(side='left',fill='x',expand=True)
            row=card.body
            line=tk.Frame(row,bg=PANEL); line.pack(fill='x')
            tk.Label(line,text=e['date'][5:]+"  "+e['time']+"  ·  "+e['country'],bg=PANEL,fg="#64748b",font=("Microsoft YaHei UI",-16)).pack(side='left')
            tk.Label(line,text=tag,bg={5:"#ffe4e6",4:"#ffedd5"}.get(e['level'],"#dbeafe"),fg=color,font=("Microsoft YaHei UI",-14,"bold"),padx=6).pack(side='right')
            title=tk.Label(row,text=e['title'],bg=PANEL,fg=TEXT,font=("Microsoft YaHei UI",-20,"bold"),anchor='w',justify='left',wraplength=390)
            title.pack(fill='x',pady=(7,6))
            tk.Label(row,text=asset_outlook(e),bg=PANEL,fg=MUTED,font=('Microsoft YaHei UI',-13),wraplength=390,justify='left',anchor='w').pack(fill='x',pady=(0,10))
            title.bind('<Configure>',lambda ev:ev.widget.configure(wraplength=max(100,ev.width-8)))

            def bind_event(widget, event):
                widget.configure(cursor='hand2')
                widget.bind('<ButtonPress-1>', lambda click: 'break')
                widget.bind('<ButtonRelease-1>', lambda click, data=event: self.open_event(data))
                for child in widget.winfo_children(): bind_event(child, event)
            bind_event(row, e)
        news = self.news_cache.get('items', [])[:8]
        news_title = tk.Label(content, text='商品重大新闻 · 72小时', bg=SURFACE, fg=TEXT,
                              font=("Microsoft YaHei UI", -15, "bold"), anchor='w')
        news_title.pack(fill='x', pady=(8, 6))
        for item_news in news:
            card = RoundedCard(content); card.pack(fill='x', pady=(0, 8))
            row = card.body
            products = ' · '.join(item_news.get('products', []))
            tk.Label(row, text=products, bg=PANEL, fg='#527ba8',
                     font=("Microsoft YaHei UI", -12, "bold"), anchor='w').pack(fill='x')
            btn = tk.Button(row, text=item_news.get('title', '未命名新闻'), bg=PANEL, fg=TEXT,
                            relief='flat', anchor='w', justify='left', wraplength=385,
                            font=("Microsoft YaHei UI", -13, "bold"),
                            command=lambda n=item_news: self.open_news(n))
            btn.pack(fill='x', pady=(3, 2))
            tk.Label(row, text=f"{item_news.get('source', '来源未标注')} · 发布前资料待核对",
                     bg=PANEL, fg=MUTED, font=("Microsoft YaHei UI", -11), anchor='w').pack(fill='x')
        if not news:
            tk.Label(content, text='商品新闻正在首次同步，暂时保留空列表。', bg=PANEL,
                     fg=MUTED, font=("Microsoft YaHei UI", -12), anchor='w').pack(fill='x', pady=(0, 12))
        if not events:
            empty = tk.Frame(content, bg=PANEL)
            empty.pack(fill='x', pady=24)
            tk.Label(empty, text="当前暂无符合条件的未来事件。", bg=PANEL, fg=TEXT,
                     font=("Microsoft YaHei UI", -16, "bold")).pack(anchor='w')
            tk.Label(empty, text="数据正在等待下一次同步，或本周没有符合筛选条件的事件。",
                     bg=PANEL, fg=MUTED, font=("Microsoft YaHei UI", -13),
                     wraplength=390, justify='left').pack(anchor='w', pady=(6, 12))
            tk.Button(empty, text="打开完整月历（Alt+D）", command=self.toggle_widget_mode,
                      relief='flat', bg='#e8eef5', fg='#315b87',
                      font=("Microsoft YaHei UI", -13), padx=10, pady=5).pack(anchor='w')
        def bind_scroll(w):
            w.bind('<MouseWheel>',wheel)
            for child in w.winfo_children(): bind_scroll(child)
        bind_scroll(content)
        canvas.bind('<MouseWheel>',wheel)
    def open_news(self, item):
        dialog = tk.Toplevel(self)
        dialog.title('商品新闻详情')
        dialog.geometry('560x360')
        dialog.configure(bg=PANEL)
        tk.Label(dialog, text=item.get('title', ''), bg=PANEL, fg=TEXT,
                 font=('Microsoft YaHei UI', -18, 'bold'), wraplength=510,
                 justify='left').pack(anchor='w', padx=20, pady=(20, 12))
        products = '、'.join(item.get('products', []))
        body = (f"关联品种：{products}\n\n来源：{item.get('source', '未标注')}\n"
                f"发布时间：{item.get('published', '')}\n\n"
                f"{item.get('assessment', '待研判')}\n\n"
                "新闻只作为研究资料，不构成交易信号。请打开原文核对完整上下文。")
        tk.Label(dialog, text=body, bg=PANEL, fg=MUTED, font=('Microsoft YaHei UI', -13),
                 wraplength=510, justify='left', anchor='w').pack(fill='x', padx=20)
        tk.Button(dialog, text='打开新闻原文', command=lambda: webbrowser.open(item.get('url', '')),
                  relief='flat', bg='#e8eef5', fg='#315b87',
                  font=('Microsoft YaHei UI', -13), padx=12, pady=6).pack(anchor='w', padx=20, pady=14)
        tk.Button(dialog, text='关闭', command=dialog.destroy, relief='flat', bg='#f1f5f9',
                  font=('Microsoft YaHei UI', -13), padx=16, pady=5).pack(anchor='e', padx=20)
    def refresh_commodity_news(self):
        if self.news_busy:
            return
        self.news_busy = True
        def work():
            try:
                cache = refresh_commodity_news(self.news_file)
            except Exception as exc:
                cache = dict(self.news_cache, status='新闻更新失败：' + type(exc).__name__)
            self.after(0, lambda: self._news_ready(cache))
        threading.Thread(target=work, daemon=True).start()
    def _news_ready(self, cache):
        self.news_busy = False
        self.news_cache = cache
        if getattr(self, '_widget_mode', False):
            self.show_widget_events()
        self.after(3600000, self.refresh_commodity_news)
    def open_event(self, event):
        self._drag_origin=None
        old=getattr(self,'event_dialog',None)
        if old is not None and old.winfo_exists(): old.destroy()
        dialog=tk.Toplevel(self); self.event_dialog=dialog
        dialog.title('事件详情'); dialog.geometry('560x520'); dialog.minsize(420,350)
        dialog.configure(bg=PANEL)
        tk.Label(dialog,text=event['title'],bg=PANEL,fg=TEXT,font=('Microsoft YaHei UI',-22,'bold'),wraplength=510,justify='left').pack(anchor='w',padx=22,pady=(20,12))
        from tkinter.scrolledtext import ScrolledText
        text=ScrolledText(dialog,wrap='word',font=('Microsoft YaHei UI',-17),relief='flat',bg=PANEL,fg=TEXT,padx=12,pady=10)
        text.pack(fill='both',expand=True,padx=12)
        fields=[('日期时间',event['date']+' '+event['time']),('国家',event.get('country','')),('风险等级',RISK.get(event['level'],RISK[1])[0]),('前值',event.get('previous') or '暂无'),('预期',event.get('forecast') or '暂无'),('实际',event.get('actual') or '待公布'),('资产预判',asset_outlook(event)),('预判依据',outlook_explanation(event)),('事件说明',(event.get('description') or '暂无详细说明').split('原文核对标识：')[0])]
        content='\n\n'.join(key+'：'+value for key,value in fields)
        content+='\n\n'+('示例数据，仅用于界面展示。' if not self.sync_state.get('last_success') else '数据来自已配置的事件接口。')
        content+='\n日历来源：https://www.forexfactory.com/calendar\n经济日历不等于新闻全文。'
        text.insert('1.0',content); text.configure(state='disabled')
        ai_frame=tk.Frame(dialog,bg=PANEL); ai_frame.pack(fill='x',padx=20,pady=4)
        tk.Label(ai_frame,text='AI 发布前预判',bg=PANEL,fg=TEXT,font=('Microsoft YaHei UI',-16,'bold')).pack(anchor='w')
        outlook=tk.Label(ai_frame,text='分析中…',bg=PANEL,fg='#2563eb',font=('Microsoft YaHei UI',-15),justify='left',anchor='w',wraplength=500); outlook.pack(fill='x')
        def run_ai():
            result=pre_event_outlook(event)
            self.after(0,lambda:outlook.config(text=result))
        threading.Thread(target=run_ai,daemon=True).start()
        import webbrowser
        original=event.get('description','')+' '+event['title']
        official=None
        if event.get('country')=='美国':
            if any(term in original for term in ('FOMC','Federal Funds Rate','美联储')):
                official='https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'
            elif any(term in original for term in ('Non-Farm','非农')):
                official='https://www.bls.gov/schedule/news_release/empsit.htm'
            elif any(term in original for term in ('Unemployment Claims','初请失业')):
                official='https://www.dol.gov/ui/data.pdf'
        if official:
            tk.Button(dialog,text='打开官方发布页面',command=lambda:webbrowser.open(official),relief='flat',fg='#2563eb',bg=PANEL,font=('Microsoft YaHei UI',-16)).pack(anchor='w',padx=20,pady=6)
        tk.Button(dialog,text='关闭',command=dialog.destroy,relief='flat',bg='#f1f5f9',font=('Microsoft YaHei UI',-16),padx=20,pady=6).pack(anchor='e',padx=20,pady=12)
        dialog.bind('<Escape>',lambda e:dialog.destroy())
        dialog.lift(); dialog.focus_force()
        return 'break'
    def save_sync_state(self):
        try:
            temp = self.sync_file.with_suffix('.tmp')
            temp.write_text(json.dumps(self.sync_state, ensure_ascii=False), encoding='utf-8')
            temp.replace(self.sync_file)
        except OSError:
            self.sync_message += ' · 同步状态保存失败'

    def daily_check(self):
        if due(self.sync_state):
            self.refresh_events()
        elif getattr(self, '_widget_mode', False):
            # Expire events on a clock tick, independently of network success.
            self.show_widget_events()
        self.after(60000, self.daily_check)

    def poll_sync(self):
        try:
            success, state = self.sync_queue.get_nowait()
        except queue.Empty:
            pass
        else:
            self.sync_busy = False
            self.sync_state = state
            self.sync_message = status_text(state)
            self.save_sync_state()
            if success:
                self.events = all_events()
            self.refresh_button.config(state='normal', text='↻ 更新事件')
            self.status_label.config(text=self.sync_message)
            if getattr(self, '_widget_mode', False): self.show_widget_events()
            else: self.draw_calendar()
        self.after(300, self.poll_sync)
    def build(self):
        top=tk.Frame(self,bg=PANEL,height=48); self.top_panel=top; top.pack(fill="x"); top.pack_propagate(False)
        tk.Label(top,text="◇  全球金融事件日历",font=("Microsoft YaHei",12,"bold"),fg=TEXT,bg=PANEL).pack(side="left",padx=18)
        self.month_label=tk.Label(top,font=("Microsoft YaHei",14,"bold"),fg=TEXT,bg=PANEL); self.month_label.pack(side="left",padx=28)
        for label,cmd in [("‹",lambda:self.move(-1)),("今天",self.today),("›",lambda:self.move(1))]: tk.Button(top,text=label,command=cmd,bg=PANEL,fg=TEXT,relief="flat",font=("Microsoft YaHei",11),padx=10).pack(side="left")
        self.refresh_button=tk.Button(top,text="↻ 更新事件",command=self.refresh_events,bg="#17334a",fg=ACCENT,relief="flat",font=("Microsoft YaHei",10),padx=10); self.refresh_button.pack(side="left",padx=12)
        self.status_label=tk.Label(top,text=self.sync_message or "等待同步真实日历",font=("Microsoft YaHei",10),fg=MUTED,bg=PANEL); self.status_label.pack(side="left")
        self.risk_label=tk.Label(top,text="全球事件关注度",font=("Microsoft YaHei",10,"bold"),fg=MUTED,bg=PANEL); self.risk_label.pack(side="right",padx=24)
        body=tk.Frame(self,bg=BG); self.body_panel=body; body.pack(fill="both",expand=True,padx=8,pady=8)
        rail=tk.Frame(body,bg=PANEL,width=42,highlightbackground=LINE,highlightthickness=1); self.rail_panel=rail; rail.pack(side="left",fill="y",padx=(0,8)); rail.pack_propagate(False)
        for icon in ("⌂","＋","≡","⚙"):
            tk.Label(rail,text=icon,font=("Microsoft YaHei Symbol",15),fg=MUTED,bg=PANEL,pady=12).pack(fill="x")
        left=tk.Frame(body,bg=PANEL,highlightbackground=LINE,highlightthickness=1); self.calendar_panel=left; left.pack(side="right",fill="both",expand=True)
        filters=tk.Frame(left,bg=PANEL); filters.pack(fill="x",padx=12,pady=10)
        self.filter=tk.StringVar(value="本月"); ttk.Combobox(filters,textvariable=self.filter,values=["本月","今日","本周","未来7天","未来30天"],state="readonly",width=12).pack(side="left"); tk.Button(filters,text="应用",command=self.draw_calendar,relief="flat",bg="#17334a",fg=ACCENT).pack(side="left",padx=6)
        self.search=tk.StringVar(); search_box=tk.Entry(filters,textvariable=self.search,width=22,relief="solid",bd=1,bg=CARD,fg=TEXT,insertbackground=ACCENT); search_box.pack(side="right",ipady=4); search_box.insert(0,"搜索事件 / 国家"); search_box.bind("<FocusIn>",lambda e: search_box.delete(0,"end") if search_box.get()=="搜索事件 / 国家" else None); search_box.bind("<Return>",lambda e:self.draw_calendar())
        self.cal=tk.Frame(left,bg=PANEL); self.cal.pack(fill="both",expand=True,padx=10,pady=(0,10))
        right=tk.Frame(body,bg=PANEL,width=360,highlightbackground=LINE,highlightthickness=1); self.overview_panel=right; right.pack(side="left",fill="y",padx=(0,8)); right.pack_propagate(False)
        tk.Label(right,text=f"{self.current.year}年{self.current.month}月 事件概览",font=("Microsoft YaHei",13,"bold"),fg=TEXT,bg=PANEL).pack(anchor="w",padx=14,pady=(14,6)); self.detail=tk.Frame(right,bg=PANEL); self.detail.pack(fill="both",expand=True,padx=14)
    def move(self,n): self.current=(self.current.replace(day=28)+timedelta(days=4)).replace(day=1) if n>0 else (self.current-timedelta(days=1)).replace(day=1); self.draw_calendar()
    def today(self): self.current=date.today().replace(day=1); self.selected=date.today().isoformat(); self.draw_calendar()
    def refresh_events(self):
        if self.sync_busy: return
        if not due(self.sync_state):
            self.sync_message = status_text(self.sync_state)
            self.status_label.config(text=self.sync_message)
            if getattr(self, '_widget_mode', False): self.show_widget_events()
            return
        url = os.environ.get('GMC_EVENTS_URL', EVENTS_URL).strip()
        if not url:
            self.sync_message = '未配置数据源，保留本地缓存'
            if getattr(self, '_widget_mode', False): self.show_widget_events()
            return
        self.sync_busy = True
        self.sync_message = '正在同步…'
        self.refresh_button.config(state='disabled', text='更新中…')
        # Persist a short in-flight cooldown so restarting cannot flood the server.
        self.sync_state['next_retry'] = (datetime.now()+timedelta(minutes=5)).isoformat(timespec='seconds')
        self.save_sync_state()
        state = dict(self.sync_state)
        def work():
            self.sync_queue.put(synchronize(url, state, fetch_all_events, all_events, replace_events))
        threading.Thread(target=work, daemon=True).start()
        if getattr(self, '_widget_mode', False): self.show_widget_events()
    def events_for(self,day): return [e for e in self.events if e["date"]==day]
    def filtered_events(self):
        today = date.today(); mode = self.filter.get()
        keyword=self.search.get().strip()
        events=[e for e in self.events if not keyword or keyword=="搜索事件 / 国家" or keyword.lower() in f"{e['title']} {e['country']} {e['category']}".lower()]
        if mode == "本月": return events
        if mode == "今日": return [e for e in events if e["date"] == today.isoformat()]
        end = today + timedelta(days=7 if mode == "未来7天" else 30)
        if mode == "本周": end = today + timedelta(days=6-today.weekday())
        return [e for e in events if today.isoformat() <= e["date"] <= end.isoformat()]
    def draw_calendar(self):
        for w in self.cal.winfo_children(): w.destroy()
        self.month_label.config(text=f"{self.current.year}年{self.current.month}月")
        shown=self.filtered_events(); risk=sum(e["level"]*4 for e in shown if e["date"]>=date.today().isoformat()); self.risk_label.config(text=f"全球事件关注度  {min(100,risk)}/100")
        for i,name in enumerate(["一","二","三","四","五","六","日"]): tk.Label(self.cal,text=name,fg=MUTED,bg=PANEL,font=("Microsoft YaHei",10,"bold")).grid(row=0,column=i,sticky="nsew",pady=8)
        weeks=calendar.monthcalendar(self.current.year,self.current.month)
        for r,week in enumerate(weeks,1):
            self.cal.rowconfigure(r,weight=1)
            for c,day in enumerate(week):
                cell=tk.Frame(self.cal,bg=CELL if day else PANEL,highlightbackground=LINE,highlightthickness=1); cell.grid(row=r,column=c,sticky="nsew",padx=2,pady=2); self.cal.columnconfigure(c,weight=1,uniform="days")
                if not day: continue
                iso=f"{self.current.year:04d}-{self.current.month:02d}-{day:02d}"; ev=[e for e in self.events_for(iso) if e in shown]; tk.Button(cell,text=str(day),command=lambda d=iso:self.show_day(d),relief="flat",anchor="w",bg=cell["bg"],fg=TEXT,font=("Microsoft YaHei UI",12,"bold")).pack(fill="x")
                for e in sorted(ev,key=lambda x:-x["level"])[:3]:
                    tag,color=RISK.get(e["level"],RISK[1]); row=tk.Frame(cell,bg="#f8fafc"); row.pack(fill="x",padx=4,pady=3)
                    tk.Label(row,text=tag,bg={5:"#ffe4e6",4:"#ffedd5",3:"#dbeafe",2:"#dbeafe"}.get(e["level"],"#eef2f7"),fg=color,font=("Microsoft YaHei",8,"bold"),padx=5).pack(side="left",padx=(3,5),pady=3)
                    short_title=e['title'] if len(e['title'])<=18 else e['title'][:17]+'…'
                    tk.Button(row,text=f"{e['time']} {short_title}",command=lambda d=iso:self.show_day(d),relief="flat",anchor="w",bg="#f8fafc",fg=TEXT,font=("Microsoft YaHei UI",-15),wraplength=105).pack(side="left",fill="x",expand=True,pady=2)
        self.show_day(self.selected if self.events_for(self.selected) else (next((e["date"] for e in shown), self.current.isoformat())))
    def show_day(self,iso):
        self.selected=iso
        for w in self.detail.winfo_children(): w.destroy()
        events=self.events_for(iso); tk.Label(self.detail,text=datetime.strptime(iso,"%Y-%m-%d").strftime("%Y年%m月%d日"),font=("Microsoft YaHei",12,"bold"),fg=TEXT,bg=PANEL).pack(anchor="w",pady=(4,10))
        if not events: tk.Label(self.detail,text="当天没有已录入的重大事件",fg=MUTED,bg=PANEL).pack(anchor="w"); return
        for e in events:
            tag,color=RISK.get(e["level"],RISK[1]); surprise,reason=analyze_event(e); box=tk.Frame(self.detail,bg=CELL,highlightbackground=LINE,highlightthickness=1); box.pack(fill="x",pady=5)
            event_dt=datetime.strptime(f"{e['date']} {e['time']}", "%Y-%m-%d %H:%M"); delta=event_dt-datetime.now(); countdown="已公布/已发生" if delta.total_seconds() < 0 else (f"还有 {delta.days} 天 {delta.seconds//3600} 小时" if delta.days else f"还有 {delta.seconds//3600} 小时 {(delta.seconds%3600)//60} 分钟")
            tk.Label(box,text=f"{e['flag']}  {e['title']}",font=("Microsoft YaHei",12,"bold"),fg=TEXT,bg=box["bg"]).pack(anchor="w",padx=10,pady=(9,2)); tk.Label(box,text=f"{e['time']}  ·  {e['country']}  ·  {tag}  ·  {countdown}",fg=color,bg=box["bg"],font=("Microsoft YaHei",10,"bold")).pack(anchor="w",padx=10)
            tk.Label(box,text=f"前值 {e['previous']}   预期 {e['forecast']}   实际 {e['actual'] or '待公布'}",fg=MUTED,bg=box["bg"],font=("Microsoft YaHei",10)).pack(anchor="w",padx=10,pady=5); tk.Label(box,text="影响资产："+" · ".join(e["assets"]),fg=TEXT,bg=box["bg"],wraplength=290,justify="left",font=("Microsoft YaHei",10)).pack(anchor="w",padx=10); tk.Label(box,text=e["description"],fg=MUTED,bg=box["bg"],wraplength=290,justify="left",font=("Microsoft YaHei",10)).pack(anchor="w",padx=10,pady=5); tk.Label(box,text=f"{surprise} · {reason}",fg="#2467ce",bg=box["bg"],wraplength=290,justify="left",font=("Microsoft YaHei",9,"bold")).pack(anchor="w",padx=10,pady=(0,9))

if __name__ == "__main__": CalendarApp().mainloop()


