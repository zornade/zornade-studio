#!/usr/bin/env python3
"""adsb_etl.py - Estrai traiettorie ADS-B da adsb.lol/globe_history per area e finestra temporale.

Fonte dati: https://github.com/adsblol/globe_history_2026 (ODbL 1.0 + CC0)
Attribuzione obbligatoria negli embed: "© adsb.lol contributors (ODbL)"

Output: GeoJSON FeatureCollection (una LineString per aereo).
        Importabile in Zornade Studio come geometria custom (pipeline geo,
        percorso GeoDataset → linee sulla mappa).
        Ogni Feature include array paralleli __t/__alt/__track/__gs per il
        futuro renderer a particelle (alternativa B, canvas 2D).

Dipendenze: requests (incluso nel .venv tramite geopandas). Python 3.9+.

Esempi:
    # Italia, ieri, tutto il giorno (preset default)
    python3 scripts/adsb_etl.py

    # Italia, rush mattutino 06-10 UTC, solo civili
    python3 scripts/adsb_etl.py --bbox italy --from 06:00 --to 10:00 --no-military

    # Europa, data specifica, finestra 12-14 UTC
    python3 scripts/adsb_etl.py --date 2026-06-22 --bbox europe --from 12:00 --to 14:00

    # Bbox personalizzata (lat_min,lat_max,lon_min,lon_max), almeno 20 punti per aereo
    python3 scripts/adsb_etl.py --bbox 43,46,11,14 --min-points 20 -v

    # Senza array paralleli (file più piccolo, solo geometria statica)
    python3 scripts/adsb_etl.py --no-extras
"""
from __future__ import annotations

import argparse
import gzip
import io
import json
import sys
import tarfile
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

try:
    import requests
except ImportError:
    sys.exit(
        "Installa requests nel venv:\n  pip install requests\n"
        "(già incluso se hai geopandas installato)"
    )

# ── Preset bounding box (lat_min, lat_max, lon_min, lon_max) ──────────────────
BBOXES: dict[str, tuple[float, float, float, float]] = {
    "italy":         (36.0,  47.5,   6.0,  18.5),
    "europe":        (35.0,  72.0, -10.0,  35.0),
    "france":        (41.0,  51.5,  -5.5,   9.5),
    "germany":       (47.0,  55.5,   5.5,  15.5),
    "spain":         (35.5,  44.0,  -9.5,   4.5),
    "uk":            (49.5,  61.0,  -8.5,   2.5),
    "balkans":       (39.0,  47.5,  13.0,  28.0),
    "mediterranean": (30.0,  48.0,  -5.0,  37.0),
    "alps":          (43.5,  48.5,   5.0,  16.0),
    "sicily":        (36.5,  38.5,  12.0,  15.5),
}

# ── Colonne trace readsb (dalla spec README-json.md, verificato su dati reali) ─
# [dt_s, lat, lon, alt_ft|"ground"|null, gs, track, flags, vrate,
#  extra_obj|null, source, geom_alt, geom_vrate, ias, roll]
_I_DT, _I_LAT, _I_LON, _I_ALT, _I_GS, _I_TRACK, _I_FLAGS = 0, 1, 2, 3, 4, 5, 6
_I_VRATE, _I_EXTRA = 7, 8


# ── Streaming concatenato da più URL HTTP ─────────────────────────────────────
class _ChainedStream(io.RawIOBase):
    """RawIOBase che concatena N risposte HTTP in sequenza, senza salvarle su disco."""

    def __init__(self, urls: list[str], chunk: int = 131_072) -> None:
        super().__init__()
        self._queue = list(urls)
        self._chunk = chunk
        self._resp: Optional[requests.Response] = None
        self._iter = iter(())
        self._buf = b""
        self.bytes_read = 0
        self._advance()

    def _advance(self) -> None:
        if self._resp is not None:
            self._resp.close()
            self._resp = None
        if not self._queue:
            return
        url = self._queue.pop(0)
        label = url.split("/")[-1]
        print(f"  ↓ {label}", file=sys.stderr)
        self._resp = requests.get(url, stream=True, timeout=(15, 300))
        self._resp.raise_for_status()
        self._iter = self._resp.iter_content(self._chunk)

    def readable(self) -> bool:
        return True

    def readinto(self, b: bytearray) -> int:  # type: ignore[override]
        while True:
            if self._buf:
                n = min(len(b), len(self._buf))
                b[:n] = self._buf[:n]
                self._buf = self._buf[n:]
                self.bytes_read += n
                return n
            try:
                chunk = next(self._iter)
                self._buf = chunk
            except StopIteration:
                if not self._queue:
                    return 0
                self._advance()

    def close(self) -> None:
        if self._resp is not None:
            self._resp.close()
        super().close()


# ── Lookup URL tar da PREFERRED_RELEASES.txt ──────────────────────────────────
def _preferred_releases_url(year: str) -> str:
    return (
        f"https://raw.githubusercontent.com/adsblol/globe_history_{year}"
        "/main/PREFERRED_RELEASES.txt"
    )


def resolve_tar_urls(target_date: str) -> list[str]:
    """
    Restituisce le URL tar (aa, ab, …) per target_date (YYYY-MM-DD).
    Legge PREFERRED_RELEASES.txt del repo corretto per anno.
    """
    year = target_date[:4]
    tag_date = target_date.replace("-", ".")   # 2026-06-24 → 2026.06.24
    url = _preferred_releases_url(year)
    print(f"  Recupero release list per {year} …", file=sys.stderr)
    resp = requests.get(url, timeout=30)
    if resp.status_code == 404:
        raise ValueError(
            f"Repository globe_history_{year} non trovato. "
            "Controlla che l'anno sia corretto."
        )
    resp.raise_for_status()
    for line in resp.text.splitlines():
        if tag_date in line:
            parts = [u.strip() for u in line.split(",") if u.strip()]
            return parts
    raise ValueError(
        f"Nessuna release trovata per {target_date}.\n"
        "Il dato potrebbe non essere ancora disponibile "
        "(di solito pronto ~3 ore dopo la mezzanotte UTC del giorno successivo)."
    )


# ── Filtro geografico ─────────────────────────────────────────────────────────
def _in_bbox(
    lat: float, lon: float, bbox: tuple[float, float, float, float]
) -> bool:
    lat_min, lat_max, lon_min, lon_max = bbox
    return lat_min <= lat <= lat_max and lon_min <= lon <= lon_max


# ── Parser singola traccia ────────────────────────────────────────────────────
def parse_trace(
    raw_bytes: bytes,
    bbox: tuple[float, float, float, float],
    t_from: float,
    t_to: float,
    min_points: int,
    no_military: bool,
    include_extras: bool,
) -> Optional[dict]:
    """
    Decomprime (gzip), filtra per finestra temporale + bbox e restituisce
    un GeoJSON Feature (LineString) oppure None se l'aereo non passa i filtri.

    Formato trace array (spec readsb README-json.md):
      [dt_s, lat, lon, alt_ft|"ground"|null, gs, track, flags, vrate,
       extra_obj|null, source, geom_alt, geom_vrate, ias, roll]
    """
    try:
        data = gzip.decompress(raw_bytes)
        obj: dict = json.loads(data)
    except Exception:
        return None

    icao: str = obj.get("icao", "")
    r_reg: str = obj.get("r", "") or ""
    t_type: str = obj.get("t", "") or ""
    db_flags: int = int(obj.get("dbFlags", 0) or 0)
    ts_base: float = float(obj.get("timestamp", 0.0) or 0.0)
    trace: list = obj.get("trace") or []

    if not trace:
        return None

    is_military = bool(db_flags & 1)
    if no_military and is_military:
        return None

    # Callsign dal primo entry con extra {flight: ...}
    flight = ""
    for entry in trace:
        extra = entry[_I_EXTRA] if len(entry) > _I_EXTRA else None
        if isinstance(extra, dict):
            f = extra.get("flight", "")
            if f:
                flight = f.strip()
                break

    # Filtra per finestra temporale + bbox; accumula dati per output
    coords: list[list[float]] = []
    timestamps: list[float] = []
    alts: list[Optional[float]] = []
    tracks: list[Optional[float]] = []
    gs_vals: list[Optional[float]] = []
    has_emergency = False

    for entry in trace:
        if len(entry) < 3:
            continue
        dt_s: float = float(entry[_I_DT])
        lat = entry[_I_LAT]
        lon = entry[_I_LON]
        if lat is None or lon is None:
            continue

        t_abs = ts_base + dt_s
        if not (t_from <= t_abs <= t_to):
            continue
        if not _in_bbox(float(lat), float(lon), bbox):
            continue

        alt_raw = entry[_I_ALT] if len(entry) > _I_ALT else None
        if alt_raw == "ground":
            alt: Optional[float] = 0.0
        elif isinstance(alt_raw, (int, float)):
            alt = float(alt_raw)
        else:
            alt = None

        gs_raw = entry[_I_GS] if len(entry) > _I_GS else None
        gs: Optional[float] = float(gs_raw) if isinstance(gs_raw, (int, float)) else None

        track_raw = entry[_I_TRACK] if len(entry) > _I_TRACK else None
        track: Optional[float] = float(track_raw) if isinstance(track_raw, (int, float)) else None

        # Controlla emergenza nel campo extra
        if not has_emergency:
            extra = entry[_I_EXTRA] if len(entry) > _I_EXTRA else None
            if isinstance(extra, dict):
                emerg = extra.get("emergency", "none") or "none"
                if emerg not in ("none", ""):
                    has_emergency = True

        coords.append([round(float(lon), 5), round(float(lat), 5)])
        timestamps.append(round(t_abs, 1))
        alts.append(round(alt, 0) if alt is not None else None)
        tracks.append(round(track, 1) if track is not None else None)
        gs_vals.append(round(gs, 1) if gs is not None else None)

    if len(coords) < min_points:
        return None

    # Statistiche aggregate
    alt_nums = [a for a in alts if a is not None]
    gs_nums = [g for g in gs_vals if g is not None]
    duration_s = round(timestamps[-1] - timestamps[0]) if len(timestamps) > 1 else 0

    props: dict = {
        "icao": icao,
        "r": r_reg,
        "t": t_type,
        "flight": flight,
        "dbFlags": db_flags,
        "is_military": is_military,
        "is_emergency": has_emergency,
        "n_points": len(coords),
        "duration_s": duration_s,
        "t_start": round(timestamps[0]),
        "t_end": round(timestamps[-1]),
        "alt_min_ft": int(min(alt_nums)) if alt_nums else None,
        "alt_max_ft": int(max(alt_nums)) if alt_nums else None,
        "gs_avg_kts": int(sum(gs_nums) / len(gs_nums)) if gs_nums else None,
    }

    # Array paralleli per il renderer a particelle (futuro TrajectoryDataset)
    if include_extras:
        props["__t"] = timestamps
        props["__alt"] = alts
        props["__track"] = tracks
        props["__gs"] = gs_vals

    return {
        "type": "Feature",
        "properties": props,
        "geometry": {"type": "LineString", "coordinates": coords},
    }


# ── Entry point ───────────────────────────────────────────────────────────────
def main() -> None:
    yesterday = (date.today() - timedelta(days=1)).strftime("%Y-%m-%d")

    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "--date",
        default=yesterday,
        metavar="YYYY-MM-DD",
        help=f"Giorno UTC da processare (default: ieri = {yesterday})",
    )
    ap.add_argument(
        "--bbox",
        default="italy",
        metavar="PRESET|lat_min,lat_max,lon_min,lon_max",
        help=(
            f"Area: preset ({'/'.join(BBOXES)}) "
            "oppure 'lat_min,lat_max,lon_min,lon_max' (default: italy)"
        ),
    )
    ap.add_argument(
        "--from",
        dest="time_from",
        default="00:00",
        metavar="HH:MM",
        help="Inizio finestra temporale UTC (default: 00:00)",
    )
    ap.add_argument(
        "--to",
        dest="time_to",
        default="23:59",
        metavar="HH:MM",
        help="Fine finestra temporale UTC (default: 23:59 = tutto il giorno)",
    )
    ap.add_argument(
        "--min-points",
        type=int,
        default=5,
        metavar="N",
        help="Punti minimi in area+finestra per includere un aereo (default: 5)",
    )
    ap.add_argument(
        "--no-military",
        action="store_true",
        help="Escludi aerei militari (dbFlags & 1)",
    )
    ap.add_argument(
        "--no-extras",
        action="store_true",
        help=(
            "Ometti array paralleli __t/__alt/__track/__gs "
            "(file più piccolo, solo geometria statica)"
        ),
    )
    ap.add_argument(
        "--output",
        metavar="PATH",
        help="Percorso file GeoJSON di output (default: auto-generato)",
    )
    ap.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Mostra ogni aereo accettato",
    )
    args = ap.parse_args()

    # Risolvi bbox
    if args.bbox in BBOXES:
        bbox = BBOXES[args.bbox]
        bbox_name = args.bbox
    else:
        try:
            parts = [float(x) for x in args.bbox.split(",")]
            if len(parts) != 4:
                raise ValueError()
            bbox = (parts[0], parts[1], parts[2], parts[3])
            bbox_name = "custom"
        except ValueError:
            ap.error(
                f"--bbox deve essere un preset ({', '.join(BBOXES)}) "
                "oppure 'lat_min,lat_max,lon_min,lon_max'"
            )

    # Risolvi finestra temporale come Unix epoch float
    d_utc = datetime.strptime(args.date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    hm_from = args.time_from.split(":")
    hm_to = args.time_to.split(":")
    t_from = d_utc.replace(
        hour=int(hm_from[0]), minute=int(hm_from[1]), second=0
    ).timestamp()
    t_to = d_utc.replace(
        hour=int(hm_to[0]), minute=int(hm_to[1]), second=59
    ).timestamp()

    # Output path
    if args.output:
        out_path = Path(args.output)
    else:
        tf = args.time_from.replace(":", "")
        tt = args.time_to.replace(":", "")
        stem = f"adsb-{bbox_name}-{args.date}-{tf}-{tt}"
        out_path = Path(__file__).parent.parent / "public" / "adsb" / f"{stem}.geojson"

    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Recupera URL tar
    try:
        urls = resolve_tar_urls(args.date)
    except ValueError as e:
        sys.exit(f"Errore: {e}")

    n_parts = len(urls)
    print(f"\n→ Data:     {args.date}", file=sys.stderr)
    print(f"→ Area:     {bbox_name} {bbox}", file=sys.stderr)
    print(f"→ Finestra: {args.time_from}–{args.time_to} UTC", file=sys.stderr)
    print(f"→ Parti:    {n_parts} file tar", file=sys.stderr)
    print(f"→ Output:   {out_path}\n", file=sys.stderr)

    # Stream + filtra
    features: list[dict] = []
    n_files = 0
    t_wall0 = time.time()

    stream = _ChainedStream(urls)
    buffered = io.BufferedReader(stream, buffer_size=262_144)

    try:
        with tarfile.open(fileobj=buffered, mode="r|") as tar:
            for member in tar:
                if not member.isfile():
                    continue
                if "trace_full_" not in member.name:
                    continue

                n_files += 1
                if n_files % 500 == 0:
                    elapsed = time.time() - t_wall0
                    mb = stream.bytes_read / 1_000_000
                    rate = mb / elapsed if elapsed > 0 else 0
                    print(
                        f"  {n_files:>6} file letti  "
                        f"{len(features):>4} accettati  "
                        f"{mb:>7.0f} MB  {rate:.1f} MB/s    ",
                        end="\r",
                        file=sys.stderr,
                    )

                fobj = tar.extractfile(member)
                if fobj is None:
                    continue
                raw_bytes = fobj.read()

                feat = parse_trace(
                    raw_bytes,
                    bbox=bbox,
                    t_from=t_from,
                    t_to=t_to,
                    min_points=args.min_points,
                    no_military=args.no_military,
                    include_extras=not args.no_extras,
                )
                if feat is None:
                    continue

                features.append(feat)
                if args.verbose:
                    p = feat["properties"]
                    mil = " [MIL]" if p["is_military"] else ""
                    sos = " [SOS]" if p["is_emergency"] else ""
                    print(
                        f"  ✓ {p['icao']} {p['r']:8} {p['t']:4} "
                        f"{p['flight']:8} "
                        f"pts={p['n_points']:4} "
                        f"dur={p['duration_s']//60:3}min"
                        f"{mil}{sos}",
                        file=sys.stderr,
                    )

    except KeyboardInterrupt:
        print(
            f"\n  Interrotto dopo {n_files} file. "
            f"Risultati parziali ({len(features)} aerei) scritti ugualmente.",
            file=sys.stderr,
        )

    elapsed = time.time() - t_wall0
    mb_total = stream.bytes_read / 1_000_000
    print(
        f"\n\n  ✓ {n_files} file in {elapsed:.0f}s  "
        f"({mb_total:.0f} MB a {mb_total/elapsed:.1f} MB/s)  "
        f"→ {len(features)} aerei accettati",
        file=sys.stderr,
    )

    # Scrivi GeoJSON
    fc = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "adsb.lol/globe_history",
            "license": "ODbL 1.0",
            "attribution": (
                "© adsb.lol contributors (ODbL) - "
                "opendatacommons.org/licenses/odbl/1.0/"
            ),
            "date": args.date,
            "bbox": list(bbox),
            "bbox_name": bbox_name,
            "time_from_utc": args.time_from,
            "time_to_utc": args.time_to,
            "military_excluded": args.no_military,
            "extras_included": not args.no_extras,
            "aircraft_count": len(features),
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "features": features,
    }

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"), ensure_ascii=False)

    size_kb = out_path.stat().st_size // 1024
    size_str = f"{size_kb // 1024} MB" if size_kb > 1024 else f"{size_kb} KB"
    print(f"  Scritto: {out_path}  ({size_str})", file=sys.stderr)
    print(
        f"\n  Importa in Zornade Studio trascinando il file GeoJSON "
        f"(pipeline geo → linee sulla mappa).",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
