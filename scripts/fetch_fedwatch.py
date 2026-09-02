#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_fedwatch.py — 抓取 CME FedWatch（cmegroup.cn 官方中文版）各会议
EASE / NO CHANGE / HIKE 概率与中间价，落盘 data/fedwatch.json。

数据在 quikstrike iframe 内且有 referrer 校验，静态 curl 拿不到，
故用 playwright + 系统 chromium 无头渲染，逐个点击会议页签提取。
"""
import json, re, sys, datetime, shutil
from pathlib import Path

URL = "https://www.cmegroup.cn/fed-watch/"
OUT = Path(__file__).resolve().parent.parent / "data" / "fedwatch.json"
TAB_RE = re.compile(r"^\d{1,2}\s*[A-Za-z]{3}\s*\d{2}$")

def find_chromium():
    for p in ("/usr/bin/chromium", "/usr/bin/chromium-browser",
              "/usr/lib/chromium/chromium", "/opt/chromium/chromium"):
        if Path(p).exists():
            return p
    return shutil.which("chromium") or shutil.which("chromium-browser")

def parse_table(fr):
    """解析当前页签下的概率表 -> (ease, no_change, hike, mid)"""
    rows = fr.evaluate(
        """() => Array.from(document.querySelectorAll('tr'))
             .map(tr => Array.from(tr.querySelectorAll('th,td'))
             .map(c => c.innerText.trim()).filter(x => x !== ''))""")
    probs, mid = None, None
    for r in rows:
        joined = " ".join(r)
        nums = re.findall(r"(\d+(?:\.\d+)?)\s*%", joined)
        if len(nums) >= 3 and any(k in joined.upper() for k in ("EASE", "CHANGE", "HIKE", "PROB")) is False:
            # 纯数据行：三个百分比
            vals = [float(x) for x in nums[:3]]
            if abs(sum(vals) - 100) < 1.5:
                probs = vals
        m = re.search(r"(\d{2}\.\d{3,4})", joined)
        if m and mid is None:
            mid = float(m.group(1))
    return probs, mid

def main():
    from playwright.sync_api import sync_playwright
    exe = find_chromium()  # 找不到则用 playwright 自带 chromium（GitHub runner 情形）
    launch_kw = {"headless": True,
                 "args": ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]}
    if exe:
        launch_kw["executable_path"] = exe

    meetings = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(**launch_kw)
        page = browser.new_page(
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/126.0 Safari/537.36"),
            viewport={"width": 1400, "height": 2000})
        page.goto(URL, wait_until="load", timeout=60000)
        page.wait_for_timeout(12000)

        fr = next((f for f in page.frames if "quikstrike" in (f.url or "")), None)
        if fr is None:
            print("[fedwatch] quikstrike iframe not found", file=sys.stderr); sys.exit(3)

        tabs = fr.evaluate(
            """() => Array.from(document.querySelectorAll('li a'))
                 .map(a => (a.innerText || '').trim())
                 .filter(t => /^\\d{1,2}\\s*[A-Za-z]{3}\\s*\\d{2}$/.test(t))""")
        tabs = list(dict.fromkeys(tabs))

        for tab in tabs:
            try:
                fr.evaluate(
                    """(t) => { const a = Array.from(document.querySelectorAll('li a'))
                          .find(x => (x.innerText||'').trim() === t); if (a) a.click(); }""", tab)
                page.wait_for_timeout(2500)
                probs, mid = parse_table(fr)
                if probs:
                    meetings.append({"meeting": tab, "ease": probs[0],
                                     "no_change": probs[1], "hike": probs[2],
                                     "mid": mid})
            except Exception as e:
                print(f"[fedwatch] tab {tab} failed: {e}", file=sys.stderr)
        browser.close()

    if not meetings:
        print("[fedwatch] parse failed, no meetings", file=sys.stderr); sys.exit(4)

    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
    doc = {
        "asof": now.strftime("%Y-%m-%d %H:%M BJT"),
        "source": "CME FedWatch（cmegroup.cn 官方）",
        "contract": "30天联邦基金期货（ZQ）",
        "meetings": meetings,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[fedwatch] ok: {len(meetings)} meetings -> {OUT}")
    for mt in meetings:
        print(" ", mt)

if __name__ == "__main__":
    main()
