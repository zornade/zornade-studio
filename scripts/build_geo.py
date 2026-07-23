#!/usr/bin/env python3
"""
Build the join-ready GeoJSON layers shipped under public/geo/.

Sources (verified 2026-07-08):
- Nations: Natural Earth 1:50m Admin 0 countries - PUBLIC DOMAIN.
  https://github.com/nvkelso/natural-earth-vector
- Italian provinces + comuni: ISTAT "Confini delle unita' amministrative a
  fini statistici", versione GENERALIZZATA, anno di riferimento ISTAT_YEAR
  (1 gennaio) - dato ufficiale, CC-BY, licenza SISTAN standard.
  https://www.istat.it/it/archivio/222527
  Sostituisce openpolis/geojson-italy (mirror comunitario, fermo a giugno
  2023, quindi non aggiornato con le variazioni amministrative recenti) usato
  fino al 2026-07-08. Vedi /memories/repo per il confronto topologico che ha
  motivato il cambio: openpolis + simplify per-feature creava micro-gap/slivers
  tra comuni/province confinanti; il prodotto ISTAT "generalizzata" e' invece
  topologicamente pulito by design (verificato: overlap totale nazionale = 0,
  Torino-Moncalieri si toccano esattamente).

Semplificazione: topology-PRESERVING (libreria `topojson`, non il naive
GeoSeries.simplify() di shapely/geopandas usato in precedenza). Il naive
simplify tratta ogni poligono in isolamento: due comuni confinanti, simplificati
indipendentemente, finiscono quasi sempre con vertici leggermente diversi sul
bordo condiviso -> micro-gap o sovrapposizioni visibili a zoom elevato.
`topojson` costruisce prima la topologia (identifica gli archi CONDIVISI tra
poligoni vicini), semplifica gli archi una sola volta, poi ricostruisce i
poligoni: i vicini condividono sempre esattamente lo stesso bordo, per
costruzione. Verificato sui dati reali (vedi memoria): distanza Torino-Moncalieri
rimane 0.0 anche dopo la semplificazione.

Output schema INVARIATO (drop-in, nessuna modifica altrove nell'app):
- paesi.geojson  : { name, name_en, iso_a2, iso_a3 }
- province.geojson: { prov_name, prov_acr, prov_istat_code, prov_istat_code_num, reg_name }
- comuni.geojson : { com_name, com_istat_code, com_istat_code_num, prov_acr, reg_name }

Setup (una tantum, i pacchetti NON sono nel resto del progetto Node):
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r scripts/requirements.txt

Run (con .venv attivo):
    python3 scripts/build_geo.py
"""
from __future__ import annotations

import glob
import json
import os
import urllib.request
import zipfile

import geopandas as gpd
import topojson as tp
from shapely.errors import GEOSException
from shapely.validation import make_valid

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "public", "geo"))

NE_COUNTRIES = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_50m_admin_0_countries.geojson"
)

# ISTAT pubblica un nuovo anno di riferimento (1 gennaio) ogni anno; aggiornare
# questa costante quando serve rigenerare con l'anno piu' recente disponibile
# su https://www.istat.it/it/archivio/222527
ISTAT_YEAR = 2026
ISTAT_ZIP_URL = (
    "https://www.istat.it/storage/cartografia/confini_amministrativi/"
    f"generalizzati/{ISTAT_YEAR}/Limiti0101{ISTAT_YEAR}_g.zip"
)

# Tolleranza di semplificazione topology-preserving (gradi, dati in EPSG:4326).
# Scelta empiricamente: bilancia dimensione file e dettaglio visibile a zoom
# regionale/comunale. Vedi memoria per il confronto dimensione/qualita' a vari
# valori (comuni: 0.01 -> 4.7MB/0.92MB gzip, solo 2/7896 comuni degenerano in
# geometrie quasi-puntiformi, entrambi gia' tra i piu' piccoli d'Italia).
EPS_PROVINCE = 0.003
EPS_COMUNI = 0.01
# CAP zones mix whole-comune polygons (identical scale to comuni) with much
# smaller sub-comunale splits inside large cities (e.g. ~120 zones in Roma) -
# a lower tolerance than EPS_COMUNI keeps those fine splits legible.
EPS_CAP = 0.004

# The national CAP-zone geometry ("cap_subcomunali", ~9.2k polygons: one per
# CAP code, sub-comunale splits for the ~41 multi-CAP cities and one
# whole-comune polygon for every other comune) is a proprietary Zornade
# dataset - it lives only in the Zornade Postgres DB (table `cap_subcomunali`,
# same DB queried by app/scripts/generate_cap_city_gis.py), not on a public
# URL, so it can't be re-downloaded like the ISTAT/Natural Earth sources
# above. To (re)generate cap.geojson, export that table to a local GeoPackage
# (never committed - it's ~200MB) and point CAP_GPKG_PATH at it, e.g.:
#   ogr2ogr -f GPKG /tmp/cap_subcomunali.gpkg "PG:host=... dbname=postgres \
#     user=... password=..." cap_subcomunali
#   CAP_GPKG_PATH=/tmp/cap_subcomunali.gpkg python3 scripts/build_geo.py
# If the env var is unset or the file is missing, build_cap() is skipped and
# the other layers still build normally (cap.geojson is optional).
CAP_GPKG_ENV = "CAP_GPKG_PATH"
CAP_LAYER = "cap_subcomunali"


def _download(url: str, dest: str) -> str:
    if not os.path.exists(dest):
        print(f"  download {url}")
        urllib.request.urlretrieve(url, dest)
    return dest


def _download_istat(tmp: str) -> str:
    """Download + extract the ISTAT admin boundaries zip, return its extraction dir."""
    dest_zip = os.path.join(tmp, f"istat_limiti_{ISTAT_YEAR}_g.zip")
    _download(ISTAT_ZIP_URL, dest_zip)
    extract_dir = os.path.join(tmp, f"istat_limiti_{ISTAT_YEAR}_g")
    if not os.path.exists(extract_dir):
        with zipfile.ZipFile(dest_zip) as zf:
            zf.extractall(extract_dir)
    return extract_dir


def _find_shp(extract_dir: str, folder_prefix: str) -> str:
    matches = glob.glob(os.path.join(extract_dir, f"{folder_prefix}*", "*.shp"))
    if not matches:
        raise FileNotFoundError(
            f"No .shp found for prefix {folder_prefix!r} in {extract_dir} "
            "(ISTAT may have changed its folder naming - inspect the zip)."
        )
    return matches[0]


def _to_polygonal(geom):
    """make_valid() can turn a self-intersecting Polygon into a GeometryCollection
    mixing a Polygon/MultiPolygon with degenerate zero-area LineString/Point
    artifacts (observed on ~50 comuni after simplification, incl. big cities
    like Torino/Modena/Taranto - NOT just tiny/degenerate ones). GeoJSON's
    "coordinates" key doesn't exist on GeometryCollection (it uses
    "geometries" instead), which crashes _round_coords/export. Keep only the
    polygonal part(s), which is the only thing that matters for an
    administrative-boundary area layer. Returns None if there is no
    polygonal part at all (caller must handle - see _toposimplify fallback)."""
    from shapely.geometry import MultiPolygon

    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    if geom.geom_type == "GeometryCollection":
        flat = []
        for g in geom.geoms:
            if g.geom_type == "Polygon":
                flat.append(g)
            elif g.geom_type == "MultiPolygon":
                flat.extend(g.geoms)
        if not flat:
            return None
        return flat[0] if len(flat) == 1 else MultiPolygon(flat)
    return None  # LineString/Point only - fully degenerate, no area left


def _fix_geometry(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Repair self-intersections etc. Rows that fully degenerate (no polygonal
    part left at all - see _to_polygonal) are dropped by the caller via NaN,
    NOT here, so callers with a fallback source (_toposimplify) can restore
    the pre-simplification geometry instead of losing the feature."""
    invalid = ~gdf.geometry.is_valid
    if invalid.any():
        gdf.loc[invalid, "geometry"] = gdf.loc[invalid, "geometry"].apply(
            lambda g: _to_polygonal(make_valid(g))
        )
    return gdf


def _load_istat_layers(tmp: str) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame, gpd.GeoDataFrame]:
    extract_dir = _download_istat(tmp)
    com = gpd.read_file(_find_shp(extract_dir, f"Com0101{ISTAT_YEAR}_g"), encoding="utf-8")
    prov = gpd.read_file(_find_shp(extract_dir, f"ProvCM0101{ISTAT_YEAR}_g"), encoding="utf-8")
    reg = gpd.read_file(_find_shp(extract_dir, f"Reg0101{ISTAT_YEAR}_g"), encoding="utf-8")
    com = _fix_geometry(com).to_crs(4326)
    prov = _fix_geometry(prov).to_crs(4326)
    reg = _fix_geometry(reg).to_crs(4326)
    return com, prov, reg


def _toposimplify(gdf: gpd.GeoDataFrame, eps: float, id_field: str) -> gpd.GeoDataFrame:
    """Topology-preserving simplify: shared borders between neighbouring
    features stay perfectly coincident (no gaps/overlaps), unlike a naive
    per-feature GeoSeries.simplify(). See module docstring for why this
    matters for adjacent administrative boundaries.

    A tiny minority of features (very small/thin shapes, e.g. Solza or Casola
    di Napoli among Italy's smallest comuni) can fully degenerate to a
    LineString/Point at this tolerance, with no polygonal area left even
    after make_valid(). For those (and only those) rows, fall back to the
    ORIGINAL (pre-simplification, but validity-fixed) geometry via `id_field`
    so the feature never silently vanishes from the output - it just stays
    more detailed than its neighbours, which is an acceptable trade-off for a
    handful of already-tiny municipalities.
    """
    original = gdf.set_index(id_field)["geometry"]
    topo = tp.Topology(gdf, prequantize=False, presimplify=False)
    out = topo.toposimplify(eps).to_gdf()

    invalid = ~out.geometry.is_valid
    if invalid.any():
        out.loc[invalid, "geometry"] = out.loc[invalid, "geometry"].apply(
            lambda g: _to_polygonal(make_valid(g))
        )

    degenerate = out["geometry"].isna()
    if degenerate.any():
        ids = out.loc[degenerate, id_field]
        print(
            f"  [fallback] {degenerate.sum()} feature(s) fully degenerated at eps={eps}, "
            f"restoring original geometry for: {list(ids)}"
        )
        out.loc[degenerate, "geometry"] = ids.map(original)
    return out


def _assert_no_overlaps(gdf: gpd.GeoDataFrame, label: str, crs_metric: int = 32632) -> None:
    """Sanity check: sum of individual feature areas must equal the union area
    (within floating-point tolerance). A meaningful gap between the two would
    indicate overlapping polygons re-introduced by simplification.

    `grid_size` snaps inputs to a 1cm fixed-precision grid before the unary
    union: some source datasets (e.g. the proprietary cap_subcomunali export,
    unlike the ISTAT layers) contain vertices that are technically valid
    (`is_valid` true) but numerically too close together for GEOS's exact
    unary union, raising a `TopologyException: side location conflict`. This
    is purely a diagnostic aggregate (not the shipped geometry), so on that
    error we retry with a coarser grid - a few times, each 10x coarser - before
    giving up; a 1cm-10m snap is far below anything that could hide a real
    overlap at this scale.
    """
    metric = gdf.to_crs(crs_metric)
    sum_area = metric.geometry.area.sum()
    union_area = None
    last_err: Exception | None = None
    for grid_size in (0.01, 0.1, 1.0, 10.0):
        try:
            union_area = metric.geometry.union_all(grid_size=grid_size).area
            last_err = None
            break
        except GEOSException as exc:
            last_err = exc
            continue
    if last_err is not None:
        raise RuntimeError(
            f"{label}: union_all kept failing with a GEOS topology error even at a "
            "10m grid snap - investigate the source geometry before shipping."
        ) from last_err
    diff_pct = 100 * abs(sum_area - union_area) / sum_area if sum_area else 0.0
    print(f"  [topology check] {label}: overlap = {diff_pct:.4f}% (should be ~0)")
    if diff_pct > 0.05:
        raise RuntimeError(
            f"{label}: overlap {diff_pct:.4f}% exceeds tolerance - simplification "
            "broke topology, investigate before shipping."
        )


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


def build_provinces_and_municipalities(tmp: str) -> None:
    """Both levels share the same ISTAT download + region/province lookups,
    so they are built together (avoids downloading/parsing the zip twice)."""
    com, prov, reg = _load_istat_layers(tmp)

    reg_lookup = dict(zip(reg["COD_REG"], reg["DEN_REG"]))
    # COD_PROV is the traditional 1-107 province numbering, populated for BOTH
    # "Provincia" and "Città metropolitana" rows (COD_CM is the newer,
    # metropolitan-only code) - this is the code openpolis' prov_istat_code
    # matched, so we mirror it here to keep every downstream join stable.
    acr_lookup = dict(zip(prov["COD_PROV"], prov["SIGLA"]))

    print("  simplifying province (topology-preserving)…")
    prov_out = gpd.GeoDataFrame(
        {
            "prov_name": prov.apply(
                lambda r: r["DEN_PROV"] if r["DEN_PROV"] != "-" else r["DEN_CM"], axis=1
            ),
            "prov_acr": prov["SIGLA"],
            "prov_istat_code": prov["COD_PROV"].apply(lambda v: f"{v:03d}"),
            "prov_istat_code_num": prov["COD_PROV"],
            "reg_name": prov["COD_REG"].map(reg_lookup),
            "geometry": prov.geometry,
        },
        crs=prov.crs,
    )
    prov_out = _toposimplify(prov_out, EPS_PROVINCE, id_field="prov_istat_code_num")
    _assert_no_overlaps(prov_out, "province")
    _write(prov_out, "province.geojson")

    print("  simplifying comuni (topology-preserving, ~7.900 features)…")
    com_out = gpd.GeoDataFrame(
        {
            "com_name": com["COMUNE"],
            "com_istat_code": com["PRO_COM_T"],
            "com_istat_code_num": com["PRO_COM"],
            "prov_acr": com["COD_PROV"].map(acr_lookup),
            "reg_name": com["COD_REG"].map(reg_lookup),
            "geometry": com.geometry,
        },
        crs=com.crs,
    )
    com_out = _toposimplify(com_out, EPS_COMUNI, id_field="com_istat_code_num")
    _assert_no_overlaps(com_out, "comuni")
    _write(com_out, "comuni.geojson")


def build_cap() -> None:
    """Build cap.geojson from the proprietary `cap_subcomunali` export (see
    CAP_GPKG_ENV above). Skipped (with a message) if the source isn't available
    locally - cap.geojson is optional, unlike the other public-source layers.

    Kept fields: `cap` (5-digit postal code, the join key - NOT unique
    nationally, e.g. several small neighbouring comuni can legitimately share
    one CAP, each as its own polygon) and, for context/tooltip only, `comune`,
    `prov_acr`, `reg_name`. The MEF income aggregates and internal metadata
    columns of the source table are dropped: irrelevant to the spatial join
    and they would needlessly bloat the bundled file.
    """
    gpkg_path = os.environ.get(CAP_GPKG_ENV)
    if not gpkg_path or not os.path.exists(gpkg_path):
        print(
            f"  [skip] cap.geojson: set {CAP_GPKG_ENV} to a local export of the "
            f"'{CAP_LAYER}' table to (re)generate it (see comment above EPS_CAP)"
        )
        return

    cap = gpd.read_file(gpkg_path, layer=CAP_LAYER)
    cap = _fix_geometry(cap).to_crs(4326)
    cap_out = gpd.GeoDataFrame(
        {
            "cap": cap["cap"].astype(str).str.zfill(5),
            "comune": cap["comune"],
            "prov_acr": cap["provincia_"],
            "reg_name": cap["regione"],
            "geometry": cap.geometry,
        },
        crs=cap.crs,
    )
    # `cap` isn't a unique row id (see docstring), so use a synthetic one for
    # _toposimplify's degenerate-feature fallback (it needs a 1:1 id -> original
    # geometry mapping, which a duplicated `cap` value cannot provide).
    cap_out["_row_id"] = range(len(cap_out))
    print(f"  simplifying cap (topology-preserving, {len(cap_out)} features)…")
    cap_out = _toposimplify(cap_out, EPS_CAP, id_field="_row_id")
    cap_out = cap_out.drop(columns=["_row_id"])
    _assert_no_overlaps(cap_out, "cap")
    _write(cap_out, "cap.geojson")


# Join-key fields per level - MUST mirror GEO_LEVELS in src/lib/choropleth.ts
# (joinField, nameField, aliasFields). Used to build the keys index.
# `cap` intentionally lists ONLY the code, not `comune`: comune names repeat
# across many CAP zones (e.g. dozens of Roma sub-zones), so including it would
# let comuni-level name data falsely score as a cap-level match.
LEVEL_KEY_FIELDS = {
    "paesi": ["iso_a3", "name", "iso_a2", "name_en"],
    "regioni": ["reg_istat_code", "reg_name"],
    "province": ["prov_acr", "prov_name", "prov_istat_code"],
    "comuni": ["com_istat_code", "com_name", "com_istat_code_num"],
    "cap": ["cap"],
}


def _normalise_key(raw) -> str:
    """Mirror of normaliseKey() in src/lib/choropleth.ts - keep in sync."""
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
    (lib/choropleth.ts resolveGeoJoin) - far smaller than loading geometries.
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
    print("Building province.geojson + comuni.geojson (ISTAT) …")
    build_provinces_and_municipalities(tmp)
    print("Building cap.geojson …")
    build_cap()
    print("Building keys.json …")
    build_keys_index()
    print("Done.")


if __name__ == "__main__":
    main()
