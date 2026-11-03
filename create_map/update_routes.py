"""World map ("visited streets") and yearly swim/bike/run stats from Garmin Connect.

Each run:
  1. fetches the full activity list from Garmin Connect (summaries only, cheap) and keeps it in
     DATA_DIR/activities.json,
  2. downloads the GPX files that are not in DATA_DIR/tmp_gpx yet (they are kept, so the map
     can always be rebuilt from scratch),
  3. rebuilds the map from all GPX files: tracks are walked in chronological order and only
     the parts that are not already on the map are added (lines, no buffers, so nothing
     grows from update to update),
  4. gives every new stretch a road surface from OpenStreetMap (create_map/osm_surfaces.py,
     cached in DATA_DIR/osm_ways.json),
  5. writes to assets/data/:
        all_routes.geojson    one MultiLineString per surface and sport (bike/run/swim/water/other)
        map_info.json         last update, number of activities, km per surface
        activity_stats.json   swim/bike/run per year and in total

Run from anywhere (paths are relative to this file):
    python create_map/update_routes.py              # Garmin + rebuild
    python create_map/update_routes.py --offline    # rebuild from the local cache only

.env (next to this file): GARMIN_EMAIL, GARMIN_PASS, DATA_DIR
"""
import argparse
import html
import io
import json
import logging
import math
import os
import random
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
from dotenv import load_dotenv
from requests.exceptions import HTTPError

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
sys.path.insert(0, str(REPO_ROOT / "read_gpx_py"))
from surfaces import smooth, to_runs  # noqa: E402  (same smoothing as the course surfaces)
from osm_surfaces import SurfaceMatcher, simplify_indices  # noqa: E402

# =========================
# CONFIG
# =========================
load_dotenv(HERE / ".env")

EMAIL = os.getenv("GARMIN_EMAIL")
PASSWORD = os.getenv("GARMIN_PASS")
DATA_DIR = Path(os.getenv("DATA_DIR", HERE / "data"))
OUT_DIR = REPO_ROOT / "assets" / "data"

GPX_DIR = DATA_DIR / "tmp_gpx"
TOKENSTORE = DATA_DIR / "garmin_tokens"
ACTIVITIES_FILE = DATA_DIR / "activities.json"
OSM_CACHE = DATA_DIR / "osm_ways.json"

ROUTES_FILE = OUT_DIR / "all_routes.geojson"
INFO_FILE = OUT_DIR / "map_info.json"
STATS_FILE = OUT_DIR / "activity_stats.json"
TRIPS_CONFIG = HERE / "trips.json"      # the trips to highlight on the map (edit by hand)
TRIPS_FILE = OUT_DIR / "trips.json"
TRIP_SIMPLIFY_M = 15                    # trips are drawn whole, so a little coarser

# activities without a track worth drawing (no GPS, or not outdoors)
NO_MAP = ("virtual", "indoor", "treadmill", "lap_swimming", "pool", "strength", "yoga",
          "pilates", "cardio", "hiit", "breathwork", "fitness_equipment", "elliptical",
          "stair", "floor_climbing", "meditation", "mobility")
# drawn as "water", without looking up road surfaces
WATER = ("swim", "paddl", "kayak", "canoe", "rowing", "kite", "surf", "sail", "boat")
KITE_MIN_KMH = 12
KITE_MIN_RATIO = 9
# hand-made corrections: activity id -> sport on the map
OVERRIDES_FILE = HERE / "activity_overrides.json"
# activity names (German or English) of water sports Garmin only knows as "other"
WATER_NAMES = r"kite|kiten|surf|sup|segel|segeln|sail|boot|boat|freiwasser"

CHUNK_SIZE = 100
MAX_ACTIVITIES = 10000
DOWNLOAD_DELAY_SECONDS = 1.0

# track geometry
SPACING_M = 8          # points are thinned out / filled in to about this spacing
GAP_M = 250            # a longer jump between two points breaks the line (pause, GPS glitch)
CELL_M = 12            # grid for "already on the map": within ~1-2 cells counts as visited
LAG_M = 60             # a track only blocks itself this far behind (out-and-back, loops)
MIN_NEW_M = 15         # shorter new bits are noise
MIN_COVER_M = 25       # a street counts once this much of it (or 60 % of a short one) was followed
TIE_END_M = 20         # covered parts this close to a way's end / to each other are joined
JOIN_M = 30            # new pieces reach this far into what is already drawn, so lines meet
OUT_SIMPLIFY_M = 3     # simplification of the published lines

DATA_DIR.mkdir(parents=True, exist_ok=True)
GPX_DIR.mkdir(parents=True, exist_ok=True)
OUT_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)


# =========================
# GARMIN
# =========================
def is_rate_limited(exc):
    msg = str(exc).lower()
    return "429" in msg or "too many requests" in msg or "rate limit" in msg


def retry_call(fn, *args, retries=5, base_sleep=5, **kwargs):
    """Retry only on rate-limit style failures."""
    for attempt in range(retries):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            if not is_rate_limited(e) or attempt == retries - 1:
                raise
            sleep_s = base_sleep * (2 ** attempt) + random.uniform(0, 2)
            logger.warning("Rate limited (%s), sleeping %.1f s", e, sleep_s)
            time.sleep(sleep_s)


def get_api():
    """Log in with the saved tokens; fall back to the credentials and save new tokens."""
    from garminconnect import Garmin, GarminConnectAuthenticationError
    try:
        from garth.exc import GarthHTTPError
    except Exception:
        GarthHTTPError = Exception

    if TOKENSTORE.exists():
        try:
            api = Garmin()
            api.login(str(TOKENSTORE))
            logger.info("Logged in with saved Garmin tokens.")
            return api
        except (FileNotFoundError, GarminConnectAuthenticationError, GarthHTTPError, HTTPError) as e:
            logger.warning("Saved token login failed: %s", e)

    if not EMAIL or not PASSWORD:
        raise RuntimeError("GARMIN_EMAIL or GARMIN_PASS missing in .env")
    api = Garmin(EMAIL, PASSWORD)
    retry_call(api.login, retries=3, base_sleep=15)
    try:
        api.garth.dump(str(TOKENSTORE))
        logger.info("Saved Garmin tokens to '%s'.", TOKENSTORE)
    except Exception as e:
        logger.warning("Login succeeded, but saving tokens failed: %s", e)
    return api


def summary_from_list(a):
    return {
        "type": a.get("activityType", {}).get("typeKey", "other"),
        "name": a.get("activityName") or "",
        "start": a.get("startTimeLocal"),
        "distance_m": a.get("distance") or 0,
        "duration_s": a.get("movingDuration") or a.get("duration") or 0,
        "elevation_m": a.get("elevationGain") or 0,
        "gps": a.get("hasPolyline", True),
        "parent": None,
        "children": [],
    }


def summary_from_details(d, parent_id):
    s = d.get("summaryDTO", {})
    return {
        "type": d.get("activityTypeDTO", {}).get("typeKey", "other"),
        "start": s.get("startTimeLocal"),
        "distance_m": s.get("distance") or 0,
        "duration_s": s.get("movingDuration") or s.get("duration") or 0,
        "elevation_m": s.get("elevationGain") or 0,
        "gps": False,  # the parent's GPX has the whole track
        "parent": parent_id,
        "children": [],
    }


def sync_activities(api):
    """Full activity list -> ACTIVITIES_FILE (id -> summary). Returns the dict."""
    old = json.loads(ACTIVITIES_FILE.read_text(encoding="utf-8")) if ACTIVITIES_FILE.exists() else {}
    acts = {}
    offset = 0
    while offset <= MAX_ACTIVITIES:
        chunk = retry_call(api.get_activities, offset, CHUNK_SIZE)
        if not chunk:
            break
        for a in chunk:
            acts[str(a["activityId"])] = summary_from_list(a)
        logger.info("Activity list: %d", len(acts))
        offset += CHUNK_SIZE
        time.sleep(0.5)

    # multisport (triathlon): the legs count for swim/bike/run. The list has neither them nor
    # their ids, so these come from the activity details (reusing what was fetched before)
    for pid, a in list(acts.items()):
        if a["type"] != "multi_sport":
            continue
        if old.get(pid, {}).get("children"):
            a["children"] = old[pid]["children"]
        else:
            try:
                details = retry_call(api.get_activity, pid)
                a["children"] = details.get("metadataDTO", {}).get("childIds") or []
                time.sleep(0.5)
            except Exception as e:
                logger.warning("Could not fetch multisport %s: %s", pid, e)
        for cid in map(str, a["children"]):
            if cid in acts:
                acts[cid]["parent"] = pid
                continue
            if cid in old:
                acts[cid] = old[cid]
                continue
            try:
                acts[cid] = summary_from_details(retry_call(api.get_activity, cid), pid)
                logger.info("Fetched multisport leg %s (%s)", cid, acts[cid]["type"])
                time.sleep(0.5)
            except Exception as e:
                logger.warning("Could not fetch multisport leg %s: %s", cid, e)

    ACTIVITIES_FILE.write_text(json.dumps(acts, indent=1), encoding="utf-8")
    return acts


def gpx_files_by_id():
    files = {}
    for f in GPX_DIR.glob("*.gpx"):
        files[f.stem.rsplit("_", 1)[-1]] = f
    return files


def wants_map(act_type):
    return not any(s in act_type for s in NO_MAP)


def has_track(path):
    with open(path, "rb") as f:
        return b"<trkpt" in f.read(1 << 16)


def tcx_to_gpx(tcx: bytes, name: str) -> bytes:
    """Track points of a TCX file as a minimal GPX."""
    pts = []
    for _, el in ET.iterparse(io.BytesIO(tcx), events=("end",)):
        if el.tag.rsplit("}", 1)[-1] == "Position":
            vals = {c.tag.rsplit("}", 1)[-1]: c.text for c in el}
            if "LatitudeDegrees" in vals and "LongitudeDegrees" in vals:
                pts.append(f'<trkpt lat="{vals["LatitudeDegrees"]}" lon="{vals["LongitudeDegrees"]}"/>')
            el.clear()
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<gpx version="1.1" creator="update_routes.py (from Garmin TCX)" '
             'xmlns="http://www.topografix.com/GPX/1/1">',
             f'<trk><name>{name}</name><trkseg>',
             *pts,
             '</trkseg></trk></gpx>']
    return ("\n".join(lines) + "\n").encode()


def download_missing_gpx(api, acts):
    # files whose track came out empty count as missing: Garmin's GPX export sometimes
    # leaves the track out (seen on long rides); the TCX export then still has it
    have = {aid for aid, f in gpx_files_by_id().items() if has_track(f)}
    todo = [(aid, a) for aid, a in acts.items()
            if aid not in have and a["gps"] and not a["parent"] and wants_map(a["type"])]
    logger.info("GPX files to download: %d", len(todo))
    for i, (aid, a) in enumerate(todo, 1):
        name = f"{(a['start'] or '')[:10]}_{a['type']}_{aid}.gpx"
        logger.info("[%d/%d] %s", i, len(todo), name)
        try:
            data = retry_call(api.download_activity, aid,
                              dl_fmt=api.ActivityDownloadFormat.GPX)
            if b"<trkpt" not in data:
                logger.info("  GPX without track points, taking the TCX export instead")
                tcx = retry_call(api.download_activity, aid,
                                 dl_fmt=api.ActivityDownloadFormat.TCX)
                data = tcx_to_gpx(tcx, name)
            for old in GPX_DIR.glob(f"*_{aid}.gpx"):
                old.unlink()
            (GPX_DIR / name).write_bytes(data)
            time.sleep(DOWNLOAD_DELAY_SECONDS)
        except Exception as e:
            logger.warning("Failed to download %s: %s", aid, e)


# =========================
# STATS
# =========================
def discipline(act_type):
    if "swim" in act_type:
        return "swim"
    if act_type.startswith("e_") or "e_bike" in act_type:
        return None
    if any(s in act_type for s in ("cycling", "biking", "ride", "cyclocross")):
        return "bike"
    if "running" in act_type:
        return "run"
    return None


def sport_of(a):
    """swim/bike/run for an activity summary, or None. (Garmin's "other" is mostly
    kitesurfing, see is_water; it stays out of the swim/bike/run stats.)"""
    return discipline(a["type"])


def is_water(act_type, name=""):
    """Water sports: by type, or by name for the ones typed "other" (kitesurfing, sailing)."""
    return (any(s in act_type for s in WATER)
            or bool(re.search(WATER_NAMES, name or "", re.IGNORECASE)))


def looks_like_kiting(a, pts):
    """Untyped ("other") sessions that zig-zag fast within a small area: kiting. Their
    distance is many times the size of the area (named kite sessions: 6-80, median 28),
    while rides and runs go somewhere (about 1-3)."""
    if not a or a["type"] != "other" or not a["duration_s"] or len(pts) < 10:
        return False
    lats, lons = [p[0] for p in pts], [p[1] for p in pts]
    size_km = haversine((min(lats), min(lons)), (max(lats), max(lons))) / 1000
    kmh = a["distance_m"] / a["duration_s"] * 3.6
    return kmh >= KITE_MIN_KMH and a["distance_m"] / 1000 / max(size_km, 0.05) >= KITE_MIN_RATIO


def build_stats(acts):
    def empty():
        return {d: {"count": 0, "km": 0.0, "hours": 0.0, "elevation_m": 0.0}
                for d in ("swim", "bike", "run")}

    years, total = {}, empty()
    for a in acts.values():
        d = sport_of(a)
        if not d or not a.get("start"):
            continue
        year = a["start"][:4]
        for bucket in (years.setdefault(year, empty())[d], total[d]):
            bucket["count"] += 1
            bucket["km"] += a["distance_m"] / 1000
            bucket["hours"] += a["duration_s"] / 3600
            bucket["elevation_m"] += a["elevation_m"]

    def rounded(block):
        return {d: {"count": v["count"], "km": round(v["km"], 1), "hours": round(v["hours"], 1),
                    "elevation_m": round(v["elevation_m"])} for d, v in block.items()}

    return {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "years": {y: rounded(years[y]) for y in sorted(years, reverse=True)},
        "total": rounded(total),
    }


# =========================
# MAP
# =========================
def haversine(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * 6371000 * math.asin(math.sqrt(min(1.0, h)))


def gpx_name(path):
    """The activity name Garmin writes into the GPX (e.g. "Fanø Kitesurfing")."""
    with open(path, "rb") as f:
        m = re.search(rb"<name>(.*?)</name>", f.read(4096))
    return html.unescape(m.group(1).decode("utf-8", "replace")) if m else ""


def read_tracks(path):
    """Track segments as lists of (lat, lon); any namespace."""
    segments = []
    for _, el in ET.iterparse(path, events=("end",)):
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "trkseg":
            pts = [(float(p.get("lat")), float(p.get("lon")))
                   for p in el if p.tag.rsplit("}", 1)[-1] == "trkpt"]
            if len(pts) > 1:
                segments.append(pts)
            el.clear()
    return segments


def even_spacing(seg):
    """Split at big jumps, then thin out / fill in to about SPACING_M between points."""
    pieces, cur = [], [seg[0]]
    for p in seg[1:]:
        d = haversine(cur[-1], p)
        if d > GAP_M:
            pieces.append(cur)
            cur = [p]
        elif d >= SPACING_M:
            n = int(d // SPACING_M)
            last = cur[-1]
            for k in range(1, n):
                t = k / n
                cur.append((last[0] + (p[0] - last[0]) * t, last[1] + (p[1] - last[1]) * t))
            cur.append(p)
    pieces.append(cur)
    return [p for p in pieces if len(p) > 1]


def cell(p):
    y = p[0] * 110574 / CELL_M
    x = p[1] * 111320 * math.cos(math.radians(p[0])) / CELL_M
    return int(math.floor(y)), int(math.floor(x))


NEIGHBOURS = [(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]


def new_stretches(pts, visited):
    """Parts of a track not near anything in `visited` (grid cells); marks the track as visited."""
    cells = [cell(p) for p in pts]
    is_new = []
    # cells are marked with a lag, so a track doesn't block itself right behind the current
    # point, but does block the way home of an out-and-back
    lag = int(LAG_M // SPACING_M)
    for i, (cy, cx) in enumerate(cells):
        if i >= lag:
            visited.add(cells[i - lag])
        is_new.append(not any((cy + dy, cx + dx) in visited for dy, dx in NEIGHBOURS))
    visited.update(cells[max(0, len(cells) - lag):])

    stretches, i = [], 0
    while i < len(pts):
        if not is_new[i]:
            i += 1
            continue
        j = i
        while j + 1 < len(pts) and is_new[j + 1]:
            j += 1
        # the new stretch is "new" only once it is clear of the drawn lines (grid tolerance),
        # so it reaches back into them to meet them at junctions instead of stopping short
        if (j - i + 1) * SPACING_M < MIN_NEW_M:
            i = j + 1
            continue
        join = int(JOIN_M // SPACING_M)
        a, b = max(0, i - join), min(len(pts) - 1, j + join)
        stretches.append(pts[a:b + 1])
        i = j + 1
    return stretches


def cumulative_m(pts):
    lat = np.radians(pts[:, 0])
    dy = np.diff(pts[:, 0]) * 110574
    dx = np.diff(pts[:, 1]) * 111320 * np.cos((lat[1:] + lat[:-1]) / 2)
    return np.concatenate([[0.0], np.cumsum(np.hypot(dx, dy))])


def snap_track(pts, sport, matcher, cover, off_network):
    """Which stretches of which OSM ways the track followed (-> cover), and the parts off
    the street network (-> off_network, as raw GPS)."""
    idx, points = matcher.snap(pts)
    dists = cumulative_m(pts)
    # short flips between neighbouring ways (road vs. sidewalk, junctions, GPS noise) are
    # folded into the way before or after
    runs = smooth(to_runs(idx.tolist(), dists.tolist()))
    k = 0
    for a, b, way in runs:
        while k < len(dists) - 1 and dists[k + 1] <= a:
            k += 1
        start = k
        while k < len(dists) - 1 and dists[k] < b:
            k += 1
        if k <= start:
            continue
        if way < 0:
            off_network.append((pts[max(0, start - 1):k + 2], sport))
        else:
            pos = matcher.positions(way, points[start:k + 1])
            cover.setdefault((way, sport), []).append((float(pos.min()), float(pos.max())))


def covered_parts(way, intervals, matcher):
    """Merged covered intervals of one way, as (lat, lon) lists."""
    total, scale = matcher.length(way)
    min_len = min(MIN_COVER_M, 0.6 * total * scale) / scale
    tie = TIE_END_M / scale
    keep = []
    for a, b in sorted(intervals):
        if b - a < min_len:
            continue
        # snap to the way's ends, so streets meet at junctions
        # a little past the projected ends, so streets meet at junctions in mid-way, and
        # right to the way's ends when close to them
        a = max(0.0, a - JOIN_M / 3 / scale)
        b = min(total, b + JOIN_M / 3 / scale)
        a = 0.0 if a < tie else a
        b = total if total - b < tie else b
        if keep and a - keep[-1][1] < tie:
            keep[-1][1] = max(keep[-1][1], b)
        else:
            keep.append([a, b])
    return [p for a, b in keep if (p := matcher.substring(way, a, b))]


def build_map(acts, online):
    files = gpx_files_by_id()
    if acts:
        ids = [aid for aid in files if aid in acts and wants_map(acts[aid]["type"])]
        types = {aid: acts[aid]["type"] for aid in ids}
        starts = {aid: acts[aid]["start"] or "" for aid in ids}
    else:  # no activity list yet: everything in the folder, type from the file name
        ids = [aid for aid, f in files.items()
               if wants_map(f.stem.split("_", 1)[1].rsplit("_", 1)[0])]
        types = {aid: files[aid].stem.split("_", 1)[1].rsplit("_", 1)[0] for aid in ids}
        starts = {aid: files[aid].stem[:10] for aid in ids}
    ids.sort(key=lambda aid: (starts[aid], int(aid)))
    logger.info("Building the map from %d activities ...", len(ids))

    overrides = {}
    if OVERRIDES_FILE.exists():
        overrides = {k: v for k, v in json.loads(OVERRIDES_FILE.read_text(encoding="utf-8")).items()
                     if not k.startswith("_")}

    # 1) read all tracks; the deduplicated land tracks tell where OSM ways are needed
    land, water, query_areas = [], [], []
    visited = set()
    for n, aid in enumerate(ids, 1):
        try:
            segments = read_tracks(files[aid])
        except Exception as e:
            logger.warning("Skipping unreadable GPX %s: %s", files[aid].name, e)
            continue
        sport = (sport_of(acts[aid]) if acts else discipline(types[aid])) or "other"
        name = (acts.get(aid) or {}).get("name") or gpx_name(files[aid])
        water_sport = (is_water(types[aid], name)
                       or looks_like_kiting(acts.get(aid), [p for seg in segments for p in seg]))
        if water_sport and sport != "swim":
            sport = "water"  # SUP, kiting, sailing: their own category on the map
        if aid in overrides:
            sport = overrides[aid]
            water_sport = sport in ("water", "swim")
        for seg in segments:
            for piece in even_spacing(seg):
                if water_sport:
                    water.append((piece, sport))
                else:
                    land.append((np.array(piece), sport))
                    query_areas += new_stretches(piece, visited)
        if n % 200 == 0:
            logger.info("  read %d/%d activities", n, len(ids))

    matcher = SurfaceMatcher(OSM_CACHE, online=online)
    matcher.fetch(query_areas)

    # 2) streets: the parts of OSM ways the tracks followed, per sport, in the way's surface
    cover, off_network = {}, []
    for n, (pts, sport) in enumerate(land, 1):
        snap_track(pts, sport, matcher, cover, off_network)
        if n % 1000 == 0:
            logger.info("  snapped %d/%d track pieces", n, len(land))
    lines = {}  # (surface, sport) -> list of point lists
    for (way, sport), intervals in cover.items():
        lines.setdefault((matcher.cats[way], sport), []).extend(
            covered_parts(way, intervals, matcher))

    # 3) off the street network and on the water: raw GPS, without repeats (per sport)
    seen = {}
    for cat, pieces in (("unknown", off_network), ("water", water)):
        for piece, sport in pieces:
            piece = [tuple(p) for p in piece]
            lines.setdefault((cat, sport), []).extend(
                new_stretches(piece, seen.setdefault((cat, sport), set())))

    features, km_sport = [], {}
    for (cat, sport), parts in sorted(lines.items()):
        if not parts:
            continue
        km_sport[sport] = km_sport.get(sport, 0) + track_km(parts)
        coords = []
        for pts in parts:
            thin = [pts[i] for i in simplify_indices(pts, OUT_SIMPLIFY_M)]
            coords.append([[round(lon, 5), round(lat, 5)] for lat, lon in thin])
        features.append({"type": "Feature", "properties": {"surface": cat, "sport": sport},
                         "geometry": {"type": "MultiLineString", "coordinates": coords}})

    # distinct km per surface, whatever the sport (streets done on foot and by bike once)
    km_surface = {}
    per_way = {}
    for (way, _), intervals in cover.items():
        per_way.setdefault(way, []).extend(intervals)
    for way, intervals in per_way.items():
        cat = matcher.cats[way]
        km_surface[cat] = km_surface.get(cat, 0) + track_km(covered_parts(way, intervals, matcher))
    for cat, pieces in (("unknown", off_network), ("water", water)):
        seen_all = set()
        for piece, _ in pieces:
            km_surface[cat] = km_surface.get(cat, 0) + track_km(
                new_stretches([tuple(p) for p in piece], seen_all))

    ROUTES_FILE.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                                      separators=(",", ":")), encoding="utf-8")

    def tidy(km):
        return {k: round(v, 1) for k, v in sorted(km.items(), key=lambda kv: -kv[1]) if v}

    km_surface, km_sport = tidy(km_surface), tidy(km_sport)
    logger.info("Wrote %s (%.1f MB)", ROUTES_FILE, ROUTES_FILE.stat().st_size / 1e6)
    logger.info("  surfaces: %s", ", ".join(f"{c} {v:.0f} km" for c, v in km_surface.items()))
    logger.info("  sports:   %s", ", ".join(f"{c} {v:.0f} km" for c, v in km_sport.items()))
    return len(ids), km_surface, km_sport


def track_km(parts):
    return sum(haversine(p, q) for pts in parts for p, q in zip(pts, pts[1:])) / 1000


# =========================
# MAIN
# =========================
def build_trips(acts):
    """Trips from TRIPS_CONFIG: their activities (by date and sport), totals and lines."""
    if not TRIPS_CONFIG.exists():
        return
    files = gpx_files_by_id()
    trips = []
    for t in json.loads(TRIPS_CONFIG.read_text(encoding="utf-8")):
        # by Garmin activity type ("types", e.g. stand_up_paddleboarding) or by sport
        types = t.get("types")
        sports = set(t.get("sports") or ["bike"])

        def belongs(a):
            if types:
                return any(x in a["type"] for x in types)
            return (sport_of(a) or "other") in sports

        chosen = sorted((a["start"], aid) for aid, a in acts.items()
                        if a.get("start") and t["from"] <= a["start"][:10] <= t["to"]
                        and not a["parent"] and belongs(a))
        lines = []
        for _, aid in chosen:
            if aid not in files:
                continue
            for seg in read_tracks(files[aid]):
                for piece in even_spacing(seg):
                    thin = [piece[i] for i in simplify_indices(piece, TRIP_SIMPLIFY_M)]
                    lines.append([[round(lat, 5), round(lon, 5)] for lat, lon in thin])
        picked = [acts[aid] for _, aid in chosen]
        start, end = date.fromisoformat(t["from"]), date.fromisoformat(t["to"])
        trips.append({
            **{k: t[k] for k in ("id", "name", "subtitle", "text", "image", "from", "to") if t.get(k)},
            "days": (end - start).days + 1,
            "activities": len(picked),
            "km": round(sum(a["distance_m"] for a in picked) / 1000),
            "elevation_m": round(sum(a["elevation_m"] for a in picked)),
            "hours": round(sum(a["duration_s"] for a in picked) / 3600, 1),
            "lines": lines,  # [[lat, lon], ...] per track piece
        })
        logger.info("Trip %s: %d activities, %d km", t["name"], len(picked), trips[-1]["km"])
    TRIPS_FILE.write_text(json.dumps(trips, ensure_ascii=False, separators=(",", ":")),
                          encoding="utf-8")
    logger.info("Wrote %s", TRIPS_FILE)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--no-osm", action="store_true",
                        help="Sync Garmin, but don't look up new streets on OpenStreetMap")
    parser.add_argument("--offline", action="store_true",
                        help="Don't contact Garmin or OpenStreetMap; rebuild from the local cache")
    parser.add_argument("--trips-only", action="store_true",
                        help="Only rebuild the trips (after editing create_map/trips.json)")
    args = parser.parse_args()

    acts = {}
    if ACTIVITIES_FILE.exists():
        acts = json.loads(ACTIVITIES_FILE.read_text(encoding="utf-8"))
    if args.trips_only:
        build_trips(acts)
        return
    if not args.offline:
        api = get_api()
        acts = sync_activities(api)
        download_missing_gpx(api, acts)

    if acts:
        STATS_FILE.write_text(json.dumps(build_stats(acts), indent=1), encoding="utf-8")
        logger.info("Wrote %s", STATS_FILE)
    else:
        logger.warning("No activity list yet (run once without --offline); stats not written.")

    build_trips(acts)
    n_acts, km_surface, km_sport = build_map(acts, online=not (args.offline or args.no_osm))
    INFO_FILE.write_text(json.dumps({
        "last_update": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "activities": n_acts,
        "km": km_surface,         # distinct streets per surface
        "km_by_sport": km_sport,  # per sport (a street run and cycled counts for both)
    }, indent=2), encoding="utf-8")
    logger.info("Done.")


if __name__ == "__main__":
    main()
