"""Pointer-safe Windows desktop parenting for Tk's outer HWND."""
import ctypes as c
from ctypes import wintypes as w

u = c.WinDLL('user32', use_last_error=True)
def api(name, result, *args):
    fn = getattr(u, name); fn.restype = result; fn.argtypes = args
    return fn
find = api('FindWindowExW', w.HWND, w.HWND, w.HWND, w.LPCWSTR, w.LPCWSTR)
parent = api('SetParent', w.HWND, w.HWND, w.HWND)
get_parent = api('GetParent', w.HWND, w.HWND)
ancestor = api('GetAncestor', w.HWND, w.HWND, w.UINT)
get_style = api('GetWindowLongPtrW', c.c_ssize_t, w.HWND, c.c_int)
set_style = api('SetWindowLongPtrW', c.c_ssize_t, w.HWND, c.c_int, c.c_ssize_t)
callback = c.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
enum = api('EnumWindows', w.BOOL, callback, w.LPARAM)
send = api('SendMessageTimeoutW', c.c_ssize_t, w.HWND, w.UINT, w.WPARAM, w.LPARAM, w.UINT, w.UINT, c.POINTER(c.c_size_t))
move = api('SetWindowPos', w.BOOL, w.HWND, w.HWND, c.c_int, c.c_int, c.c_int, c.c_int, w.UINT)

def attach(root):
    prog = find(None, None, 'Progman', None)
    result = c.c_size_t()
    send(prog, 0x052C, 0, 0, 2, 1000, c.byref(result))
    hosts = []
    @callback
    def visit(hwnd, unused):
        if find(hwnd, None, 'SHELLDLL_DefView', None):
            worker = find(None, hwnd, 'WorkerW', None)
            if worker: hosts.append(worker)
        return True
    enum(visit, 0)
    # Windows 11 may host the wallpaper WorkerW inside Progman.
    nested = find(prog, None, 'WorkerW', None)
    # The nested wallpaper surface can be occluded by DefView on Windows 11.
    # Host the interactive widget directly on Progman in that arrangement.
    if nested:
        view = find(prog, None, 'SHELLDLL_DefView', None)
        hosts = [view or prog]
    if not hosts: raise RuntimeError('Explorer 尚未提供 WorkerW 桌面层')
    hwnd = getattr(root, '_desktop_hwnd', None) or ancestor(root.winfo_id(), 2)
    root._desktop_hwnd = hwnd
    if not hasattr(root, '_desktop_style'): root._desktop_style = get_style(hwnd, -16)
    set_style(hwnd, -16, (root._desktop_style & ~0x80000000) | 0x40000000)
    parent(hwnd, hosts[0])
    if get_parent(hwnd) != hosts[0]: raise c.WinError(c.get_last_error())
    rect = w.RECT()
    client = api('GetClientRect', w.BOOL, w.HWND, c.POINTER(w.RECT))
    client(hosts[0], c.byref(rect))
    width = min(480, rect.right)
    height = min(900, max(400, rect.bottom-100))
    move(hwnd, None, max(0, rect.right-width-20), 40, width, height, 0x0060)
    gdi=c.WinDLL('gdi32',use_last_error=True)
    gdi.CreateRoundRectRgn.argtypes=[c.c_int]*6
    gdi.CreateRoundRectRgn.restype=w.HRGN
    region=gdi.CreateRoundRectRgn(0,0,width+1,height+1,80,80)
    api('SetWindowRgn',c.c_int,w.HWND,w.HRGN,w.BOOL)(hwnd,region,True)
    api('ShowWindow', w.BOOL, w.HWND, c.c_int)(hwnd, 5)
    return {'hwnd': hwnd, 'parent': int(get_parent(hwnd)), 'worker': int(hosts[0])}

def detach(root):
    hwnd = getattr(root, '_desktop_hwnd', None)
    if hwnd:
        parent(hwnd, None)
        api('SetWindowRgn',c.c_int,w.HWND,w.HRGN,w.BOOL)(hwnd,None,True)
        set_style(hwnd, -16, root._desktop_style)
        root._desktop_hwnd = None
