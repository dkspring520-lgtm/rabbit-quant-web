import app
root=app.CalendarApp()
root.update()
if not getattr(root,'_widget_mode',False):root.toggle_widget_mode()
root.update_idletasks()
labels=[]
def walk(w):
    if isinstance(w,app.tk.Label):labels.append(w.cget('text'))
    for child in w.winfo_children():walk(child)
walk(root.detail)
assert not any('待核' in t for t in labels)
assert any('古尔斯比' in t for t in labels)
print('PASS: desktop widget renders translated event names')
root.destroy()
