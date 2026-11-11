#!/usr/bin/env python3
"""
Gera app/src/main/assets/www/data/stations.json a partir de um extrato do
OpenStreetMap (.osm.pbf), pegando todos os pontos amenity=charging_station.

Uso:
    pip install osmium
    curl -O https://download.openstreetmap.fr/extracts/south-america/brazil-latest.osm.pbf
    python3 tools/build_data.py brazil-latest.osm.pbf app/src/main/assets/www/data/stations.json

Dados © colaboradores do OpenStreetMap, licença ODbL.
"""
import json
import re
import sys
from datetime import date

import osmium

# tipo de tomada no OSM -> código curto usado no app
SOCKETS = {
    "type2_combo": "ccs2",
    "type1_combo": "ccs1",
    "chademo": "chademo",
    "type2": "type2",
    "type2_cable": "type2",
    "type1": "type1",
    "tesla_supercharger": "tesla",
    "tesla_destination": "tesla",
    "nacs": "tesla",
    "gb_dc": "gbt_dc",
    "gb_ac": "gbt_ac",
    "schuko": "tomada",
    "typee": "tomada",
    "nema_5_15": "tomada",
    "nema_5_20": "tomada",
    "nema_14_50": "tomada",
    "BR": "tomada",
    "br_10a": "tomada",
    "br_20a": "tomada",
}
DC = {"ccs2", "ccs1", "chademo", "tesla", "gbt_dc"}

NUM = re.compile(r"(\d+(?:[.,]\d+)?)\s*(kw|kva|w)?", re.I)


def parse_kw(v):
    """'22 kW' / '7.4' / '50kW;150kW' / '22000 W' -> maior valor em kW."""
    if not v:
        return None
    best = None
    for m in NUM.finditer(v):
        n = float(m.group(1).replace(",", "."))
        unit = (m.group(2) or "").lower()
        if unit == "w" or (not unit and n > 1000):
            n /= 1000
        if 0 < n <= 1000:
            best = n if best is None else max(best, n)
    return best


def parse_int(v):
    try:
        return max(0, int(re.match(r"\s*(\d+)", v).group(1)))
    except Exception:
        return None


def station(osm_id, lat, lon, t):
    s = {"i": osm_id, "a": round(lat, 6), "o": round(lon, 6)}

    name = t.get("name") or t.get("brand") or ""
    op = t.get("network") or t.get("operator") or t.get("brand") or ""
    if name:
        s["n"] = name
    if op:
        s["op"] = op

    conns = {}
    kw_by = {}
    for key, code in SOCKETS.items():
        base = f"socket:{key}"
        if base not in t and f"{base}:output" not in t:
            continue
        cnt = parse_int(t.get(base, "")) if t.get(base, "").strip() not in ("yes", "") else 1
        if t.get(base) == "no" or cnt == 0:
            continue
        conns[code] = conns.get(code, 0) + (cnt or 1)
        kw = parse_kw(t.get(f"{base}:output"))
        if kw:
            kw_by[code] = max(kw_by.get(code, 0), kw)
    if conns:
        s["c"] = conns
    if kw_by:
        s["k"] = {k: round(v, 1) for k, v in kw_by.items()}

    pmax = max(kw_by.values(), default=None)
    for k in ("charging_station:output", "maxpower", "output"):
        v = parse_kw(t.get(k))
        if v:
            pmax = max(pmax or 0, v)
    if pmax:
        s["p"] = round(pmax, 1)

    # classe de potência: 0 = AC lenta, 1 = DC rápida, 2 = ultra (>=100 kW), 3 = desconhecida
    has_dc = any(c in DC for c in conns)
    if pmax:
        cls = 2 if pmax >= 100 else 1 if (pmax > 22 or has_dc and pmax >= 20) else 0
    elif has_dc:
        cls = 1
    elif conns:
        cls = 0
    else:
        cls = 3
    s["x"] = cls

    cap = parse_int(t.get("capacity", ""))
    if cap:
        s["q"] = cap

    fee = t.get("fee")
    if fee in ("no", "free"):
        s["f"] = 0
    elif fee in ("yes",):
        s["f"] = 1
    if t.get("charge"):
        s["pr"] = t["charge"][:80]

    if t.get("opening_hours"):
        s["h"] = t["opening_hours"][:80]
    acc = t.get("access")
    if acc in ("private", "customers", "no", "permissive", "destination"):
        s["ac"] = acc

    street = t.get("addr:street")
    addr = ", ".join(
        p for p in [
            (street + (" " + t["addr:housenumber"] if t.get("addr:housenumber") else "")) if street else None,
            t.get("addr:suburb") or t.get("addr:district"),
            t.get("addr:city"),
            t.get("addr:state"),
        ] if p
    )
    if addr:
        s["ad"] = addr
    if t.get("addr:city"):
        s["ci"] = t["addr:city"]
    if t.get("description"):
        s["d"] = t["description"][:200]
    for k in ("website", "contact:website", "url"):
        if t.get(k):
            s["w"] = t[k][:200]
            break
    for k in ("phone", "contact:phone"):
        if t.get(k):
            s["ph"] = t[k][:40]
            break
    return s


def main(pbf, out):
    stations = []
    ways = {}  # way id -> (tags, node refs)

    # 1ª passada: nós com a tag e vias (estacionamentos/prédios marcados como estação)
    fp = osmium.FileProcessor(pbf, osmium.osm.NODE | osmium.osm.WAY)
    for obj in fp.with_filter(osmium.filter.TagFilter(("amenity", "charging_station"))):
        tags = dict(obj.tags)
        if obj.is_node():
            if obj.location.valid():
                stations.append(station(f"n{obj.id}", obj.location.lat, obj.location.lon, tags))
        elif obj.is_way():
            ways[obj.id] = (tags, [n.ref for n in obj.nodes])

    # 2ª passada: coordenadas dos nós das vias -> centro aproximado
    need = {r for _, refs in ways.values() for r in refs}
    coords = {}
    if need:
        fp = osmium.FileProcessor(pbf, osmium.osm.NODE).with_filter(osmium.filter.IdFilter(need))
        for obj in fp:
            coords[obj.id] = (obj.location.lat, obj.location.lon)
    for wid, (tags, refs) in ways.items():
        pts = [coords[r] for r in refs if r in coords]
        if pts:
            lat = sum(p[0] for p in pts) / len(pts)
            lon = sum(p[1] for p in pts) / len(pts)
            stations.append(station(f"w{wid}", lat, lon, tags))

    stations.sort(key=lambda s: s["i"])
    payload = {
        "generated": date.today().isoformat(),
        "source": "© colaboradores do OpenStreetMap (ODbL)",
        "stations": stations,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(stations)} estações -> {out}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
