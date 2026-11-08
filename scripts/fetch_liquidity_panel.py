# -*- coding: utf-8 -*-
r"""
美元流动性监测面板快照抓取
来源: https://gsy1005.github.io/l-/ （美元流动性监测面板 · 每小时自动更新）
产出: data/liquidity_panel.js  →  window.LIQ_PANEL = {...}
日报页 macro_daily.html 「美元流动性监测」分区读取该快照渲染。
"""
import datetime
import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = Path(__file__).resolve().parents[1]
TARGET = BASE / "data" / "liquidity_panel.json"
URL = "https://gsy1005.github.io/l-/"
LIVE_JS = URL + "live.js"

STATUS_ZH = {"confirmed": "已确认", "partial": "部分触发", "quiet": "平静",
             "normal": "正常", "watch": "关注", "elevated": "偏高",
             "stress": "压力", "context": "参考"}


def clean(s):
    return " ".join((s or "").split())


def fetch(url):
    r = requests.get(url, timeout=45, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    return r.text


def main():
    html = fetch(URL)
    soup = BeautifulSoup(html, "html.parser")
    out = {"source": URL, "fetchedAt": datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d %H:%M UTC")}

    # 页面头部更新时间
    m = re.search(r"更新于[:：]\s*([0-9\-: ]+UTC)", clean(soup.get_text(" ", strip=True)))
    if m:
        out["updated"] = m.group(1)

    # 实时快线
    try:
        live_raw = fetch(LIVE_JS)
        live = json.loads(live_raw[live_raw.index("{"):].rstrip(";\n "))
        out["liveUpdated"] = live.get("updated")
        out["live"] = [{"k": it.get("k"), "label": it.get("label"), "unit": it.get("unit"),
                        "date": it.get("date"), "value": it.get("value"), "prev": it.get("prev")}
                       for it in live.get("items", [])]
    except Exception as e:
        print("WARN live.js:", e)

    # 传导链
    cb = soup.select_one('[data-testid="chain-level"]')
    if cb:
        lvl = cb.select_one(".cb-lvl b")
        st = next((c for c in (cb.get("class") or []) if c.startswith("st-")), None)
        out["chain"] = {
            "level": clean(lvl.get_text()) if lvl else None,
            "levelKey": (st[3:] if st else None),
            "stance": clean(cb.select_one(".cb-why").get_text()) if cb.select_one(".cb-why") else None,
            "next": clean(cb.select_one(".cb-next").get_text()) if cb.select_one(".cb-next") else None,
        }

    # 五个阶段
    stages = []
    for el in soup.select('[data-testid^="stage-"]'):
        badge = el.select_one(".mc-badge")
        inds = [{"name": clean(li.select_one("span").get_text()) if li.select_one("span") else "",
                 "value": clean(li.select_one("b").get_text()) if li.select_one("b") else "",
                 "on": "on" in (li.get("class") or [])} for li in el.select("ul.stage-inds li")]
        stages.append({
            "key": el.get("data-testid").replace("stage-", ""),
            "name": clean(el.select_one(".zh").get_text()) if el.select_one(".zh") else "",
            "status": el.get("data-status"),
            "statusZh": STATUS_ZH.get(el.get("data-status"), el.get("data-status")),
            "badge": clean(badge.get_text()) if badge else "",
            "inds": inds,
        })
    if stages:
        out["stages"] = stages

    # FSI 资金压力指数
    fsi = soup.select_one('[data-testid="fsi"]')
    if fsi:
        v = fsi.select_one(".fsi-val b")
        b = fsi.select_one(".fsi-val .mc-badge")
        s = fsi.select_one(".fsi-sub")
        out["fsi"] = {"value": clean(v.get_text()) if v else None,
                      "status": clean(b.get_text()) if b else None,
                      "sub": clean(s.get_text()) if s else None}

    # LPI 流动性压力指数
    lpi = soup.select_one("#sec-lpi")
    if lpi:
        txt = clean(lpi.get_text(" ", strip=True))
        mv = re.search(r"(\d+(?:\.\d+)?)\s*/\s*100", txt)
        regime = re.search(r"(High|Low|Rising|Falling|Stable)[·\s]*([A-Za-z]+)?", txt)
        out["lpi"] = {"value": mv.group(1) if mv else None,
                      "regime": clean(" ".join(x for x in (regime.groups() if regime else []) if x)) or None}

    # 资金压力三支柱 & 压力位置
    fp = soup.select_one("#sec-funding")
    if fp:
        badge = fp.select_one(".mc-badge")
        trig = re.search(r"(\d\s*/\s*3)", clean(fp.get_text(" ", strip=True)))
        out["funding"] = {"triggered": trig.group(1) if trig else None,
                          "status": clean(badge.get_text()) if badge else None}
    wv = soup.select_one('[data-testid="where-verdict"]')
    if wv:
        verdict = wv.get_text(" ", strip=True)
        sp = wv.select_one("span")
        if sp:  # 面板内 span 重复一遍结论，去掉重复
            dup = clean(sp.get_text())
            if dup and verdict.endswith(dup):
                verdict = clean(verdict[: -len(dup)])
        out["where"] = {"verdict": verdict,
                        "why": clean(soup.select_one(".where-why").get_text()) if soup.select_one(".where-why") else None}

    # SOFR / EFFR − IORB hero
    hero = soup.select_one("#sofr-hero")
    if hero:
        t = clean(hero.get_text(" ", strip=True))
        mv = re.search(r"SOFR 5日中位数\s*([+\-\d.]+)\s*bp", t)
        ev = re.search(r"EFFR\s*−\s*IORB\s*([+\-\d.]+)\s*bp", t)
        obs = re.search(r"观测日\s*(\d{4}-\d{2}-\d{2})", t)
        out["sofr"] = {"med5d": mv.group(1) if mv else None,
                       "effr": ev.group(1) if ev else None,
                       "obs": obs.group(1) if obs else None}

    # 分区状态徽标（资金/信用/利率/拥挤度/放大器/修复）
    secs = {}
    for sid, key in [("sec-funding", "fundingSec"), ("sec-credit", "credit"), ("sec-rates", "rates"),
                     ("sec-crowding", "crowding"), ("sec-amplifiers", "amplifiers"), ("sec-recovery", "repair")]:
        sec = soup.select_one("#" + sid)
        if sec:
            badge = sec.select_one(".sec-badge")
            secs[key] = clean(badge.get_text()) if badge else None
    if secs:
        out["sections"] = secs

    # 关键结论 + 本周变化
    tk = soup.select_one(".takeaway")
    if tk:
        body = tk.select_one(".takeaway-body")
        pts = []
        if body:
            pts = [clean(x.get_text(" ", strip=True)) for x in body.select("li,div")]
            if not pts:
                pts = [clean(body.get_text(" ", strip=True))]
        stance = tk.select_one(".takeaway-stance")
        ts = tk.select_one(".takeaway-ts")
        out["takeaway"] = {"stance": clean(stance.get_text(" ", strip=True)) if stance else None,
                           "generated": clean(ts.get_text()) if ts else None,
                           "points": [p for p in pts if p]}
    wc = soup.select_one('[data-testid="what-changed"]')
    if wc:
        out["weeklyChanges"] = [clean(li.get_text(" ", strip=True)) for li in wc.select("ul li")]

    # 修复信号 VIX 期限结构
    sig = soup.select_one("#sec-recovery")
    if sig:
        vix = None
        for card in sig.select(".signal-card"):
            if "VIX" in clean(card.get_text())[:40]:
                val = card.select_one(".signal-value")
                sub = card.select_one(".signal-sub")
                vix = {"value": clean(val.get_text()) if val else None,
                       "curve": clean(sub.get_text()) if sub else None}
        out["repair"] = {"count": secs.get("repair"), "vixTerm": vix}

    # 近月每日状态历史（内嵌 JSON）
    hist = None
    for sc in soup.find_all("script"):
        s = (sc.string or sc.get_text() or "").strip()
        if s.startswith('{"v":1') and '"days"' in s[:40]:
            try:
                hist = json.loads(s)
            except Exception:
                pass
    if hist and hist.get("days"):
        days = sorted(hist["days"].items())
        out["history"] = [{"date": d, **{k: {"s": v.get("s"), "t": v.get("t")}
                                         for k, v in vals.items() if isinstance(v, dict)}}
                          for d, vals in days]

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n",
                      encoding="utf-8")
    print("OK liquidity_panel.json", len(json.dumps(out)), "bytes",
          "| chain:", (out.get("chain") or {}).get("level"),
          "| FSI:", (out.get("fsi") or {}).get("value"),
          "| LPI:", (out.get("lpi") or {}).get("value"))


if __name__ == "__main__":
    main()
