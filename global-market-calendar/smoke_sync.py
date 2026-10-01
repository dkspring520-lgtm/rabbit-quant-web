import app
root=app.CalendarApp()
root.update()
if not getattr(root,'_widget_mode',False): root.toggle_widget_mode()
root.update_idletasks()
root.refresh_events()
assert not root.sync_busy
labels=[]
def walk(w):
    if isinstance(w,app.tk.Label): labels.append(w.cget('text'))
    for child in w.winfo_children(): walk(child)
walk(root.detail)
assert any('限流' in t for t in labels)
assert any('无需反复刷新' in t for t in labels)
print('PASS: Tk widget displays rate limit and empty state; refresh blocked; cache count',len(root.events))
root.destroy()
