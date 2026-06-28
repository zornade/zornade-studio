#!/usr/bin/env python3
"""
Build the join-ready GeoJSON layers shipped under public/geo/.

Sources (verified 2026-06-28):
- Nations: Natural Earth 1:50m Admin 0 countries — PUBLIC DOMAIN.
  https://github.com/nvkelso/natural-earth-vector
- Italian provinces: openpolis/geojson-italy — CC-BY-4.0 (data © ISTAT).
  https://github.com/openpolis/geojson-italy

Output schema matches the existing public/geo/regioni.geojson so the same
choropleth join (code OR name OR alias) works across all levels:
- paesi.geojson  : { name, name_en, iso_a2, iso_a3 }
- province.geojson: { prov_name, prov_acr, prov_istat_code, prov_istat_code_num, reg_name }
- comuni.geojson : { com_name, com_istat_code, com_istat_code_num, prov_acr, reg_name }

Run from the studio/ folder (with the project .venv active):
    python3 scripts/build_geo.py
"""
from __future__ import annotations

import json
import os
import urllib.request

import geopandas as gpd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "public", "geo"))

NE_COUNTRIES = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_50m_admin_0_countries.geojson"
)
OP_PROVINCES = (
    "https://raw.githubusercontent.com/openpolis/geojson-italy/"
    "master/geojson/limits_IT_provinces.geojson"
)
OP_MUNICIPALITIES = (
    "https://raw.githubusercontent.com/openpolis/geojson-italy/"
    "master/geojson/limits_IT_municipalities.geojson"
)


def _download(url: str, dest: str) -> str:
    if not os.path.exists(dest):
        print(f"  download {url}")
        urllib.request.urlretrieve(url, dest)
    return dest


def _round_coords(geojson: dict, ndigits: int = 5) -> dict:
    """Round coordinates to ~1 m precision to shrink the file without visible loss."""

    def r(x):
        if isinstance(x, float):
            return round(x, ndigits)
        if isinstance(x, list):
            return [r(v) for v in x]
        return x

    for feat in geojson["features"]:
        feat["geometry"]["coordinates"] = r(feat["geometry"]["coordinates"])
    return geojson


def build_nations(tmp: str) -> None:
    src = _download(NE_COUNTRIES, os.path.join(tmp, "ne_countries.geojson"))
    gdf = gpd.read_file(src)

    def iso3(row):
        v = row.get("ISO_A3_EH")
        if v in (None, "-99", -99):
            v = row.get("ISO_A3")
        return "" if v in (None, "-99", -99) else str(v)

    def iso2(row):
        v = row.get("ISO_A2_EH")
        if v in (None, "-99", -99):
            v = row.get("ISO_A2")
        return "" if v in (None, "-99", -99) else str(v)

    out = gpd.GeoDataFrame(
        {
            "name": gdf.apply(
                lambda r: r.get("NAME_IT") or r.get("NAME") or "", axis=1
            ),
            "name_en": gdf.apply(lambda r: r.get("NAME") or "", axis=1),
            "iso_a2": gdf.apply(iso2, axis=1),
            "iso_a3": gdf.apply(iso3, axis=1),
            "geometry": gdf.geometry,
        },
        crs=gdf.crs,
    )
    _write(out, "paesi.geojson")


def build_provinces(tmp: str) -> None:
    src = _download(OP_PROVINCES, os.path.join(tmp, "op_provinces.geojson"))
    gdf = gpd.read_file(src)
    # Topology-naive simplify is acceptable for a v1 choropleth; ~500 m tolerance
    # cuts the file size by an order of magnitude with no visible difference at
    # national zoom. (Topology-aware simplification is a build-pipeline item.)
    gdf["geometry"] = gdf.geometry.simplify(0.005, preserve_topology=True)
    out = gpd.GeoDataFrame(
        {
            "prov_name": gdf["prov_name"],
            "prov_acr": gdf["prov_acr"],
            "prov_istat_code": gdf["prov_istat_code"],
            "prov_istat_code_num": gdf["prov_istat_code_num"],
            "reg_name": gdf["reg_name"],
            "geometry": gdf.geometry,
        },
        crs=gdf.crs,
    )
    _write(out, "province.geojson")


def build_municipalities(tmp: str) -> None:
    src = _download(OP_MUNICIPALITIES, os.path.join(tmp, "op_municipalities.geojson"))
    gdf = gpd.read_file(src)
    # ~7.900 comuni: the source is ~40 MB. Simplify hard (~1 km tolerance) to a
    # web-friendly size; comune boundaries stay recognisable at regional zoom.
    gdf["geometry"] = gdf.geometry.simplify(0.01, preserve_topology=True)
    out = gpd.GeoDataFrame(
        {
            "com_name": gdf["name"],
            "com_istat_code": gdf["com_istat_code"],
            "com_istat_code_num": gdf["com_istat_code_num"],
            "prov_acr": gdf["prov_acr"],
            "reg_name": gdf["reg_name"],
            "geometry": gdf.geometry,
        },
        crs=gdf.crs,
    )
    _write(out, "comuni.geojson")


# Join-key fields per level — MUST mirror GEO_LEVELS in src/lib/choropleth.ts
# (joinField, nameField, aliasFields). Used to build the keys index.
LEVEL_KEY_FIELDS = {
    "paesi": ["iso_a3", "name", "iso_a2", "name_en"],
    "regioni": ["reg_istat_code", "reg_name"],
    "province": ["prov_acr", "prov_name", "prov_istat_code"],
    "comuni": ["com_istat_code", "com_name", "com_istat_code_num"],
}


def _normalise_key(raw) -> str:
    """Mirror of normaliseKey() in src/lib/choropleth.ts — keep in sync."""
    import re
    import unicodedata

    if raw is None:
        return ""
    s = str(raw).strip().lower()
    if re.fullmatch(r"\d", s):  # zero-pad single-digit ISTAT codes ("1"->"01")
        s = "0" + s
    s = s.split("/")[0].strip()  # drop bilingual variants
    s = "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )
    return s


def build_keys_index() -> None:
    """
    Emit public/geo/keys.json: { level: [normalised join keys] } for every level
    whose geometry exists. Powers value-based geo-level resolution in the app
    (lib/choropleth.ts resolveGeoJoin) — far smaller than loading geometries.
    """
    index: dict[str, list[str]] = {}
    for level, fields in LEVEL_KEY_FIELDS.items():
        path = os.path.join(OUT_DIR, f"{level}.geojson")
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        keys: set[str] = set()
        for feat in data["features"]:
            props = feat.get("properties") or {}
            for field in fields:
                k = _normalise_key(props.get(field))
                if k:
                    keys.add(k)
        index[level] = sorted(keys)
    dest = os.path.join(OUT_DIR, "keys.json")
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(dest) // 1024
    counts = ", ".join(f"{lvl} {len(v)}" for lvl, v in index.items())
    print(f"  wrote keys.json: {kb} KB ({counts})")


def _write(gdf: gpd.GeoDataFrame, filename: str) -> None:
    dest = os.path.join(OUT_DIR, filename)
    geojson = json.loads(gdf.to_json())
    _round_coords(geojson, 5)
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(geojson, fh, ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(dest) // 1024
    print(f"  wrote {filename}: {len(geojson['features'])} features, {kb} KB")


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    tmp = "/tmp"
    print("Building paesi.geojson …")
    build_nations(tmp)
    print("Building province.geojson …")
    build_provinces(tmp)
    print("Building comuni.geojson …")
    build_municipalities(tmp)
    print("Building keys.json …")
    build_keys_index()
    print("Done.")


if __name__ == "__main__":
    main()
