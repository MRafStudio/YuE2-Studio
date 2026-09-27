#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Уведомления агента для YuE2 Studio: тост в окне + вечный журнал.

Зачем: тост студии живёт ~2-3 секунды и исчезает сам, истории в UI нет - можно пропустить.
Этот хелпер делает то же самое, но дополнительно пишет журнал и рисует HTML-страницу,
которую можно открыть в любой момент и увидеть все сообщения агента с временем.

Использование:
    python notify.py "текст сообщения" [info|success|error] [--quiet]
    python notify.py --render          # только перерисовать страницу из журнала

Файлы:
    <studio>/data/agent-notifications.jsonl   - журнал (одно сообщение на строку)
    <studio>/data/agent-notifications.html    - читаемая страница журнала

ВАЖНО про цвета: страница открывается и в предпросмотре внутри приложения, и в обычном браузере.
Переменные темы (--foreground и прочие) приходят НЕ всегда, поэтому каждый цвет берётся как
var(--переменная, <фолбэк>), а фолбэк выбирается по prefers-color-scheme. Без этого текст
получается чёрным на чёрном - проверено на практике.
"""
import json
import os
import sys
import time
import urllib.request

BASE = os.environ.get("YUE_MCP", "http://127.0.0.1:8791")
# The studio folder (the one holding data/) is passed in, never hard-coded: it
# can sit anywhere on any machine.
STUDIO = os.environ.get("YUE_STUDIO", "")
if not STUDIO:
    raise SystemExit(
        "Set YUE_STUDIO to the studio folder (the one holding data/), for example:\n"
        "  YUE_STUDIO=<studio> python notify.py \"text\""
    )
DATA = os.path.join(STUDIO, "data")
LOG = os.path.join(DATA, "agent-notifications.jsonl")
HTML = os.path.join(DATA, "agent-notifications.html")
HDRS = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}

TONES = {"info": ("#7c3aed", "i"), "success": ("#22c55e", "+"), "error": ("#ef4444", "!")}

PAGE_CSS = """
:root {
  /* фолбэки для тёмной темы (у пользователя Windows в тёмной теме) */
  --ad-fg: #e9eaf0;
  --ad-muted: #9aa1ad;
  --ad-line: #2b2d35;
}
@media (prefers-color-scheme: light) {
  :root { --ad-fg: #15171c; --ad-muted: #5c6270; --ad-line: #e2e4ea; }
}
body { margin: 0; padding: 14px 16px; background: transparent;
       color: var(--foreground, var(--ad-fg)); }
.ad-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
.ad-head b { font-size: 15px; }
.ad-count { color: var(--muted-foreground, var(--ad-muted)); font-size: 12px; }
.ad-list { list-style: none; margin: 0; padding: 0; max-width: 660px; }
.ad-item { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0;
           border-bottom: 1px solid var(--border, var(--ad-line)); }
.ad-ico { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; color: #fff;
          font-size: 12px; line-height: 20px; text-align: center; font-weight: 700; }
.ad-text { display: block; color: var(--foreground, var(--ad-fg)); }
.ad-time { display: block; color: var(--muted-foreground, var(--ad-muted));
           font-size: 12px; margin-top: 2px; }
.ad-empty { color: var(--muted-foreground, var(--ad-muted)); padding: 10px 0; }
"""


def rpc(method, params=None, timeout=120):
    body = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params is not None:
        body["params"] = params
    req = urllib.request.Request(
        BASE + "/mcp", data=json.dumps(body).encode(), headers=HDRS, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode()
    if raw.startswith("data: ") or "\ndata: " in raw:
        for line in raw.splitlines():
            if line.startswith("data: "):
                return json.loads(line[6:])
    return json.loads(raw)


def call(name, args=None):
    r = rpc("tools/call", {"name": name, "arguments": args or {}})
    res = r.get("result", r)
    if isinstance(res, dict) and "content" in res:
        return "".join(c.get("text", "") for c in res["content"])
    return json.dumps(res, ensure_ascii=False)


def load_log():
    if not os.path.exists(LOG):
        return []
    out = []
    with open(LOG, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def render_html(items):
    rows = []
    for it in reversed(items[-300:]):
        color, icon = TONES.get(it.get("tone", "info"), TONES["info"])
        rows.append(
            '<li class="ad-item">'
            f'<span class="ad-ico" style="background:{color}">{icon}</span>'
            f'<span><span class="ad-text">{esc(it.get("text", ""))}</span>'
            f'<span class="ad-time">{esc(it.get("time", ""))}</span></span>'
            "</li>"
        )
    html = (
        '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
        '<meta name="color-scheme" content="dark light">'
        "<title>Уведомления агента - YuE2 Studio</title>"
        f"<style>{PAGE_CSS}</style></head><body>"
        '<div class="ad-head"><b>Уведомления агента</b>'
        f'<span class="ad-count">{len(items)} всего · студия YuE2</span></div>'
        '<ul class="ad-list">'
        + ("".join(rows) or '<li class="ad-empty">пока пусто</li>')
        + "</ul></body></html>"
    )
    with open(HTML, "w", encoding="utf-8") as f:
        f.write(html)
    return HTML


def notify(text, tone="info", toast=True):
    entry = {"time": time.strftime("%d.%m.%Y %H:%M:%S"), "tone": tone, "text": text}
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    items = load_log()
    render_html(items)
    shown = None
    if toast:
        try:
            shown = call("ui_notify", {"text": text, "tone": tone})
        except Exception as e:  # студия может быть закрыта - журнал всё равно пишем
            shown = "no toast: %s" % e
    return entry, shown, HTML


if __name__ == "__main__":
    if "--render" in sys.argv:
        print("перерисовано:", render_html(load_log()))
        sys.exit(0)
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    quiet = "--quiet" in sys.argv
    if not args:
        print(__doc__)
        sys.exit(1)
    text = args[0]
    tone = args[1] if len(args) > 1 else "info"
    entry, shown, path = notify(text, tone, toast=not quiet)
    print("журнал:", path)
    print("тост:", (shown or "").strip()[:80])
