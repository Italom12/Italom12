#!/usr/bin/env python3
"""
Junta o export do Open Charge Map (github.com/openchargemap/ocm-export, pasta data/BR)
ao stations.json do app, removendo duplicatas com o OpenStreetMap (pontos a < ~80 m).

Uso:
    git clone --depth 1 --filter=blob:none --sparse https://github.com/openchargemap/ocm-export
    (cd ocm-export && git sparse-checkout set --no-cone /data/BR/ /data/referencedata.json)
    python3 tools/merge_ocm.py ocm-export/data app/src/main/assets/www/data/stations.json

Licenças: POIs do OCM são CC BY 4.0 (colaboradores OCM) ou CC0 (importações), conforme
o provedor de dados em referencedata.json.
"""
import glob
import json
import math
import os
import re
import sys
from datetime import date

DC = {"ccs2", "ccs1", "chademo", "tesla", "gbt_dc"}


def conn_code(title, current):
    t = (title or "").lower()
    dc = current == 30
    if "ccs" in t or "combo" in t:
        return "ccs1" if ("type 1" in t or "sae" in t) else "ccs2"
    if "chademo" in t:
        return "chademo"
    if "gb-t" in t or "gb/t" in t or "gbt" in t:
        return "gbt_dc" if (dc or "dc" in t) else "gbt_ac"
    if "tesla" in t or "nacs" in t:
        return "tesla"
    if "type 2" in t or "mennekes" in t or "62196-2" in t:
        return "type2"
    if "type 1" in t or "j1772" in t:
        return "type1"
    return "tomada"


def classify(p, conns):
    has_dc = any(c in DC for c in conns)
    if p:
        return 2 if p >= 100 else 1 if (p > 22 or (has_dc and p >= 20)) else 0
    if has_dc:
        return 1
    return 0 if conns else 3


def clean_op(t):
    if not t or re.search(r"unknown|business owner", t, re.I):
        return None
    t = re.sub(r"\s*\((BR|Brasil|Brazil)\)\s*$", "", t)
    return {"Tupinambá": "Tupi", "Tupinamba": "Tupi"}.get(t, t)


def main(data_dir, out):
    ref = json.load(open(os.path.join(data_dir, "referencedata.json"), encoding="utf-8"))
    ctypes = {c["ID"]: c["Title"] for c in ref["ConnectionTypes"]}
    ops = {o["ID"]: o["Title"] for o in ref["Operators"]}
    usage = {u["ID"]: u for u in ref["UsageTypes"]}
    status = {s["ID"]: s for s in ref["StatusTypes"]}

    ocm = []
    for f in glob.glob(os.path.join(data_dir, "BR", "*.json")):
        p = json.load(open(f, encoding="utf-8"))
        A = p.get("AddressInfo") or {}
        if A.get("Latitude") is None:
            continue
        st = status.get(p.get("StatusTypeID")) or {}
        if st.get("IsOperational") is False:
            continue
        s = {"i": f"c{p['ID']}", "a": round(A["Latitude"], 6), "o": round(A["Longitude"], 6)}
        if A.get("Title"):
            s["n"] = A["Title"].strip()
        op = clean_op(ops.get(p.get("OperatorID")))
        if op:
            s["op"] = op
        c, k = {}, {}
        for cn in p.get("Connections") or []:
            code = conn_code(ctypes.get(cn.get("ConnectionTypeID")), cn.get("CurrentTypeID"))
            c[code] = c.get(code, 0) + (cn.get("Quantity") or 1)
            if cn.get("PowerKW"):
                k[code] = max(k.get(code, 0), round(cn["PowerKW"], 1))
        if c:
            s["c"] = c
        if k:
            s["k"] = k
            s["p"] = max(k.values())
        s["x"] = classify(s.get("p"), c)
        if p.get("NumberOfPoints"):
            s["q"] = p["NumberOfPoints"]
        cost = (p.get("UsageCost") or "").strip()
        if cost:
            if re.fullmatch(r"(free|gr[aá]tis|gratuito|0)", cost, re.I):
                s["f"] = 0
            else:
                s["pr"] = cost[:80]
        u = usage.get(p.get("UsageTypeID")) or {}
        if p.get("UsageTypeID") == 2 or "private" in (u.get("Title") or "").lower():
            s["ac"] = "private"
        elif u.get("IsMembershipRequired") or p.get("UsageTypeID") in (4, 7):
            s["ac"] = "customers"
        ad = ", ".join(x for x in [A.get("AddressLine1"), A.get("Town"), A.get("StateOrProvince")] if x)
        if ad:
            s["ad"] = ad
        if A.get("Town"):
            s["ci"] = A["Town"]
        if A.get("AccessComments"):
            s["d"] = A["AccessComments"][:200]
        if A.get("ContactTelephone1"):
            s["ph"] = A["ContactTelephone1"][:40]
        if A.get("RelatedURL"):
            s["w"] = A["RelatedURL"][:200]
        ocm.append(s)

    base = json.load(open(out, encoding="utf-8"))
    osm = [s for s in base["stations"] if s["i"][0] in "nw"]

    # remove duplicatas: ponto do OSM a menos de ~80 m de um do OCM -> completa o do OCM e descarta
    grid = {}
    for s in ocm:
        grid.setdefault((round(s["a"] * 100), round(s["o"] * 100)), []).append(s)

    def near(s):
        ga, go = round(s["a"] * 100), round(s["o"] * 100)
        best = None
        for da in (-1, 0, 1):
            for do in (-1, 0, 1):
                for t in grid.get((ga + da, go + do), []):
                    d = math.hypot((s["a"] - t["a"]) * 111000, (s["o"] - t["o"]) * 111000 * math.cos(math.radians(s["a"])))
                    if d < 80 and (best is None or d < best[0]):
                        best = (d, t)
        return best[1] if best else None

    kept, dup = [], 0
    for s in osm:
        t = near(s)
        if t is None:
            kept.append(s)
            continue
        dup += 1
        for key in ("h", "w", "ph", "ad", "ci", "op", "n", "f", "pr"):
            if key in s and key not in t:
                t[key] = s[key]
        if "c" not in t and "c" in s:
            t["c"], t["x"] = s["c"], s["x"]
            if "k" in s:
                t["k"] = s["k"]
            if "p" in s and "p" not in t:
                t["p"] = s["p"]
        t.setdefault("osm", s["i"])

    stations = sorted(kept + ocm, key=lambda s: s["i"])
    base.update({
        "generated": date.today().isoformat(),
        "source": "© colaboradores do OpenStreetMap (ODbL) · Open Charge Map (CC BY 4.0 / CC0)",
        "stations": stations,
    })
    json.dump(base, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"OCM {len(ocm)} + OSM {len(kept)} (duplicatas removidas: {dup}) = {len(stations)} -> {out}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
