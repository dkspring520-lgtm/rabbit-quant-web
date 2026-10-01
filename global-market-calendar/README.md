# Global Market Calendar

Windows 桌面版全球金融重大事件日历 MVP。

## 运行

需要 Python 3.11+：

```powershell
cd global-market-calendar
python app.py
```

## 桌面挂件模式

运行后按 `Alt+D` 切换右侧桌面挂件模式，再按一次恢复完整日历。挂件模式支持鼠标拖动；按 `Ctrl+↑` 或 `Ctrl+↓` 调整透明度。

也可以直接双击 `run-calendar.bat` 启动。

## 接入 JSON 数据源

设置 `GMC_EVENTS_URL` 环境变量，接口返回与 `events.py` 相同字段的 JSON 数组，然后点击“更新事件”。更新失败会保留本地数据库。

## 打包 EXE

在 PowerShell 执行 `./build-exe.ps1`，生成 `dist/GlobalMarketCalendar.exe`。程序不依赖网站项目。

程序首次启动会在目录中创建 `global_events.sqlite3`，并写入示例事件。事件数据在 `events.py`，修改后删除数据库或更换事件主键即可重新导入。

## 当前功能

- 月历与事件风险标记：S/A/B/C
- 今日、本周、未来 7 天、未来 30 天筛选入口
- 点击日期查看事件详情
- 前值、预期、实际值、影响资产与说明
- 基于实际值/预期/前值的基础超预期分析
- SQLite 本地存储

当前使用内置模拟数据，时间和数字仅用于演示，不作为投资建议。下一步可接入各国央行、统计局和经济日历 API，并保存数据来源与更新时间。
