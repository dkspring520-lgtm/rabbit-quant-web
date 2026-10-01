import tkinter as tk

SURFACE = '#cbd3dd'
CARD = '#dce2e9'

class PhoneShell(tk.Canvas):
    def __init__(self, master):
        super().__init__(master,bg='#b9bec5',highlightthickness=0)
        self.screen=tk.Frame(self,bg=SURFACE)
        self.slot=self.create_window(24,65,window=self.screen,anchor='nw')
        self.bind('<Configure>',self.paint)
    def paint(self,event=None):
        w,h=self.winfo_width(),self.winfo_height()
        self.delete('shell')
        def rounded(x,y,x2,y2,r,fill,outline):
            self.create_polygon([x+r,y,x2-r,y,x2,y,x2,y+r,x2,y2-r,x2,y2,x2-r,y2,x+r,y2,x,y2,x,y2-r,x,y+r,x,y],smooth=True,splinesteps=32,fill=fill,outline=outline,width=2,tags='shell')
        rounded(2,2,w-2,h-2,48,'#d4d8de','#969ca4')
        rounded(7,7,w-7,h-7,44,'#c5ced8','#d5dce4')
        rounded(13,13,w-13,h-13,39,SURFACE,'#e0e4e9')
        rounded(w/2-39,23,w/2+28,30,5,'#828991','#828991')
        self.create_oval(w/2+36,22,w/2+44,30,fill='#536273',outline='#8996a6',tags='shell')
        rounded(w/2-55,h-27,w/2+55,h-22,4,'#636b75','#636b75')
        self.tag_lower('shell')
        self.itemconfigure(self.slot,width=max(100,w-48),height=max(100,h-115))

class RoundedCard(tk.Canvas):
    """A resizeable rounded surface containing normal accessible Tk controls."""
    def __init__(self, master, background=SURFACE, **kwargs):
        super().__init__(master, bg=background, highlightthickness=0, bd=0, **kwargs)
        self.body=tk.Frame(self,bg=CARD)
        self.slot=self.create_window(14,12,window=self.body,anchor='nw')
        self.bind('<Configure>',self.redraw)
        self.body.bind('<Configure>',self.resize)
    def resize(self,event=None):
        height=self.body.winfo_reqheight()+24
        if self.winfo_reqheight()!=height: self.configure(height=height)
    def redraw(self,event=None):
        width=max(40,self.winfo_width()); height=max(32,self.winfo_height()); r=14
        self.delete('surface')
        points=[r,1,width-r,1,width-1,1,width-1,r,width-1,height-r,width-1,height-1,width-r,height-1,r,height-1,1,height-1,1,height-r,1,r,1,1]
        self.create_polygon(points,smooth=True,splinesteps=24,fill=CARD,outline='#bfc9d5',tags='surface')
        self.tag_lower('surface')
        self.itemconfigure(self.slot,width=width-28)
