# -*- coding: utf-8 -*-
"""过程事件日志：追加写到本项目下的 events.log。"""
import threading, time
from pathlib import Path
from typing import Optional

_LOCK = threading.Lock()
_throttle = {}
LOG_NAME = "events.log"
BASE = Path(__file__).resolve().parent.parent


def log(kind: str, msg: str, throttle: float = 0, key: str = "", project_dir: Optional[Path] = None):
    try:
        d = Path(project_dir) if project_dir else BASE
        now = time.time()
        if throttle:
            k = (str(d), key or kind)
            if now - _throttle.get(k, 0) < throttle:
                return
            _throttle[k] = now
        line = f"{time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(now))} | {kind} | {msg}\n"
        with _LOCK:
            with open(d / LOG_NAME, "a", encoding="utf-8") as f:
                f.write(line)
    except Exception:
        pass
