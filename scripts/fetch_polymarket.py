# -*- coding: utf-8 -*-
"""Polymarket 政策预期抓取（在 GitHub Actions 运行——沙箱/国内网络到不了 polymarket）。
产物：data/polymarket.json"""
import json, datetime, sys
import requests

UA = {"User-Agent": "Mozilla/5.0"}
GAMMA = "https://gamma-api.polymarket.com"
TOPICS = ["US recession", "Fed rate decision", "government shutdown", "Senate 2026", "House 2026",
          "Trump approval rating", "tariff", "China trade", "Iran", "Fed chair Powell", "midterm elections"]
KEYWORDS = ["recession", "fed", "fomc", "rate cut", "rate decision", "senate", "congress",
            "approval", "tariff", "shutdown", "debt ceiling", "powell", "midterm", "house"]

def get(url, **kw):
    r = requests.get(url, headers=UA, timeout=30, **kw)
    r.raise_for_status()
    return r.json()

def pick_from_events(events, picks, seen, cap):
    for ev in events:
        title = (ev.get("title") or "")
        for m in (ev.get("markets") or [])[:1]:
            q = m.get("question") or title
            if q in seen:
                continue
            try:
                outs = json.loads(m.get("outcomes") or "[]")
                prcs = json.loads(m.get("outcomePrices") or "[]")
            except Exception:
                continue
            if not outs or not prcs or len(outs) != len(prcs):
                continue
            seen.add(q)
            picks.append({"question": q,
                          "outcomes": [{"name": o, "price": round(float(p), 4)} for o, p in zip(outs, prcs)],
                          "vol24": round(float(m.get("volume24hr") or ev.get("volume24hr") or 0)),
                          "end": (m.get("endDate") or ev.get("endDate") or "")[:10],
                          "slug": ev.get("slug") or m.get("slug") or ""})
        if len(picks) >= cap:
            break
    return picks

def main():
    picks, seen = [], set()
    # 1) 定向主题搜索
    for topic in TOPICS:
        try:
            res = get(f"{GAMMA}/public-search", params={"q": topic, "limit_per_type": 4})
            pick_from_events(res.get("events") or [], picks, seen, 12)
        except Exception as e:
            print("search fail:", topic, str(e)[:80])
    # 2) 高成交量榜补充（带关键词过滤）
    try:
        top = get(f"{GAMMA}/events", params={"limit": 200, "active": "true", "closed": "false",
                                             "order": "volume24hr", "ascending": "false"})
        us = [ev for ev in top if any(k in ((ev.get("title") or "") + " " + (ev.get("description") or "")).lower()
                                      for k in KEYWORDS)]
        pick_from_events(us, picks, seen, 12)
    except Exception as e:
        print("top fail:", str(e)[:80])
    out = {"source": "Polymarket Gamma API（GitHub Actions每日快照）",
           "fetched_at": datetime.datetime.utcnow().isoformat() + "Z",
           "markets": picks}
    with open("data/polymarket.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"polymarket.json: {len(picks)} 个市场")
    for p in picks:
        print(" -", p["question"][:70], "|", ", ".join(f"{o['name']} {o['price']*100:.0f}%" for o in p["outcomes"]))

if __name__ == "__main__":
    main()
