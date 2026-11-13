"""World map ("visited streets") and yearly swim/bike/run stats from Garmin Connect.

Each run:
  1. fetches the new part of the activity list from Garmin Connect (newest first, until a
     whole page is already known; --full: the whole list) into DATA_DIR/activities.json,
  2. downloads the GPX files that are not in DATA_DIR/tmp_gpx yet (they are kept, so the map
     can always be rebuilt from scratch),
  3. adds the new activities to the map: tracks are walked in chronological order and only
     the parts that are not already on the map are added (lines, no buffers, so nothing
     grows from update to update). The state of the map is kept in DATA_DIR/map_state.pkl,
     so only new GPX files are read. The map is rebuilt from all files with --full, and
     automatically when the map code changed or an activity already on the map changed
     (new GPX, other name/type, override, deleted),
  4. gives every new stretch a road surface from OpenStreetMap (create_map/osm_surfaces.py,
     cached in DATA_DIR/osm_ways.json),
  5. writes to assets/data/:
        all_routes.geojson    one MultiLineString per surface and sport (bike/run/swim/water/other)
        map_info.json         last update, number of activities, km per surface
        activity_stats.json   swim/bike/run per year and in total

Run from anywhere (paths are relative to this file):
    python create_map/update_routes.py              # Garmin + add new activities
    python create_map/update_routes.py --full       # whole Garmin list + map from scratch
    python create_map/update_routes.py --offline    # update from the local cache only

.env (next to this file): GARMIN_EMAIL, GARMIN_PASS, DATA_DIR
"""
import argparse
import hashlib
import html
import inspect
import io
import json
import logging
import math
import os
import pickle
import random
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import shapely
from dotenv import load_dotenv
from requests.exceptions import HTTPError

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
sys.path.insert(0, str(REPO_ROOT / "read_gpx_py"))
from surfaces import smooth, to_runs  # noqa: E402  (same smoothing as the course surfaces)
from osm_surfaces import SurfaceMatcher, run_key, simplify_indices  # noqa: E402

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
MAP_STATE = DATA_DIR / "map_state.pkl"  # the map so far, to only add new activities
MAP_STATE_FORMAT = 1                    # raise when the layout of the state changes

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
BRIDGE_M = 80          # street lines ending this close to a junction on the map / a dead end
                       # are drawn on to it, gaps this short along a street are closed
END_STUB_M = 100       # shorter bits off the streets at a track's start / end are left out
CONNECT_M = 30         # a land line ending this close to another line is drawn on to it
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


def sync_activities(api, full=False):
    """Activity list -> ACTIVITIES_FILE (id -> summary). Returns the dict.
    The list comes newest first; without `full` it is read until a whole page is already
    known (changes to older activities and deletions only show up with `full`)."""
    old = json.loads(ACTIVITIES_FILE.read_text(encoding="utf-8")) if ACTIVITIES_FILE.exists() else {}
    acts = {} if full or not old else dict(old)
    offset, n_new = 0, 0
    while offset <= MAX_ACTIVITIES:
        chunk = retry_call(api.get_activities, offset, CHUNK_SIZE)
        if not chunk:
            break
        known = 0
        for a in chunk:
            aid = str(a["activityId"])
            known += aid in old
            n_new += aid not in old
            acts[aid] = summary_from_list(a)
        logger.info("Activity list: %d read, %d new", offset + len(chunk), n_new)
        offset += CHUNK_SIZE
        if not full and old and known == len(chunk):
            break
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
            # short bits off the streets where a track starts or ends (GPS still settling,
            # yard, house) would mark the start point: left out
            if (start == 0 or k >= len(dists) - 1) and b - a < END_STUB_M:
                continue
            off_network.append((pts[max(0, start - 1):k + 2], sport))
        else:
            pos = matcher.positions(way, points[start:k + 1])
            cover.setdefault((way, sport), []).append((float(pos.min()), float(pos.max())))


def covered_intervals(way, intervals, matcher, open_ends=(False, False)):
    """Merged covered intervals [a, b] of one way (merc units along it). Line ends up to
    BRIDGE_M from a way end in `open_ends` (where the map goes on, or a dead end) are drawn
    on to it, and gaps up to BRIDGE_M are closed, so routes that start or end there don't
    leave loose ends."""
    total, scale = matcher.length(way)
    min_len = min(MIN_COVER_M, 0.6 * total * scale) / scale
    tie = TIE_END_M / scale
    bridge = BRIDGE_M / scale
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
        if keep and a - keep[-1][1] < bridge:
            keep[-1][1] = max(keep[-1][1], b)
        else:
            keep.append([a, b])
    if keep and open_ends[0] and keep[0][0] < bridge:
        keep[0][0] = 0.0
    if keep and open_ends[1] and total - keep[-1][1] < bridge:
        keep[-1][1] = total
    return keep


def covered_parts(way, intervals, matcher, open_ends=(False, False)):
    """Merged covered intervals of one way, as (lat, lon) lists."""
    return [p for a, b in covered_intervals(way, intervals, matcher, open_ends)
            if (p := matcher.substring(way, a, b))]


def open_way_ends(per_way, matcher):
    """way -> (start open, end open): the way's end is a dead end, or a junction with a
    way that is on the map there."""
    nodes = {}  # OSM node position -> ways through it
    for way, way_id in enumerate(matcher.ids):
        for c in matcher.ways[way_id][1]:
            nodes.setdefault((c[0], c[1]), []).append(way)
    drawn = {way: covered_intervals(way, iv, matcher) for way, iv in per_way.items()}

    def is_open(way, end):
        c = matcher.ways[matcher.ids[way]][1][end]
        others = [w for w in nodes[(c[0], c[1])] if w != way]
        if not others:
            return True  # dead end
        point = shapely.get_point(matcher.lines[way], end)
        for w in others:
            if w not in drawn:
                continue
            pos = matcher.positions(w, point)
            tie = TIE_END_M / matcher.length(w)[1]
            if any(a - tie <= pos <= b + tie for a, b in drawn[w]):
                return True
        return False

    return {way: (is_open(way, 0), is_open(way, -1)) for way in per_way}


def map_code_version():
    """Hash of the code and settings that decide what goes into the saved state; a change
    there draws the map from scratch. Settings only used for drawing (BRIDGE_M, TIE_END_M,
    MIN_COVER_M, OUT_SIMPLIFY_M, covered_intervals, ...) apply on the next run as they are."""
    h = hashlib.sha1(str(MAP_STATE_FORMAT).encode())
    for fn in (wants_map, discipline, sport_of, is_water, looks_like_kiting, haversine,
               gpx_name, read_tracks, even_spacing, cell, new_stretches, cumulative_m,
               snap_track, track_km, add_activities):
        h.update(inspect.getsource(fn).encode())
    h.update(repr((NO_MAP, WATER, WATER_NAMES, KITE_MIN_KMH, KITE_MIN_RATIO, SPACING_M, GAP_M,
                   CELL_M, LAG_M, MIN_NEW_M, JOIN_M, END_STUB_M)).encode())
    for f in (HERE / "osm_surfaces.py", REPO_ROOT / "read_gpx_py" / "surfaces.py"):
        h.update(f.read_bytes().replace(b"\r\n", b"\n"))
    return h.hexdigest()


def empty_map_state():
    return {
        "version": map_code_version(),
        "done": {},        # activity id -> fingerprint of what was drawn
        "visited": set(),  # grid cells of all land tracks (what needed an OSM lookup)
        "cover": {},       # (OSM way id, sport) -> covered intervals along the way
        "raw": {},         # ("unknown" | "water", sport) -> raw GPS lines without repeats
        "seen": {},        # ("unknown" | "water", sport) -> grid cells of these lines
        "seen_all": {},    # "unknown" | "water" -> grid cells, whatever the sport
        "km_raw": {},      # "unknown" | "water" -> distinct km
        "osm_missing": [], # stretches drawn without OSM data (lookup failed / offline)
    }


def load_map_state(fingerprints):
    """The saved map, or None if it has to be rebuilt from scratch."""
    if not MAP_STATE.exists():
        logger.info("No saved map yet: drawing it from all activities")
        return None
    try:
        with open(MAP_STATE, "rb") as f:
            state = pickle.load(f)
    except Exception as e:
        logger.warning("Saved map unreadable (%s): drawing it from all activities", e)
        return None
    if state.get("version") != map_code_version():
        logger.info("The map code changed: drawing the map from all activities")
        return None
    changed = [aid for aid, fp in state["done"].items() if fingerprints.get(aid) != fp]
    if changed:
        logger.info("%d activities on the map changed or are gone (e.g. %s): drawing the map "
                    "from all activities", len(changed), changed[0])
        return None
    return state


def save_map_state(state):
    tmp = MAP_STATE.with_suffix(".tmp")
    with open(tmp, "wb") as f:
        pickle.dump(state, f, protocol=pickle.HIGHEST_PROTOCOL)
    tmp.replace(MAP_STATE)
    logger.info("Saved the map state (%.1f MB)", MAP_STATE.stat().st_size / 1e6)


def add_activities(state, todo, files, acts, types, overrides, fingerprints, matcher):
    """Adds the activities in `todo` to the state, in chronological order."""
    # 1) read the new tracks; their parts not on the map yet tell where OSM ways are needed
    land, water, query_areas = [], [], []
    for n, aid in enumerate(todo, 1):
        state["done"][aid] = fingerprints[aid]
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
                    query_areas += new_stretches(piece, state["visited"])
        if n % 200 == 0:
            logger.info("  read %d/%d activities", n, len(todo))

    matcher.fetch(query_areas)
    # stretches without OSM data stay "unknown" for now; they are remembered, and the map is
    # drawn again once OSM has them
    state["osm_missing"] = [q for q in state["osm_missing"] + query_areas
                            if run_key(q) not in matcher.queried]
    matcher.ensure_tree()

    # 2) streets: the parts of OSM ways the tracks followed, per sport, in the way's surface
    cover, off_network = {}, []
    for n, (pts, sport) in enumerate(land, 1):
        snap_track(pts, sport, matcher, cover, off_network)
        if n % 1000 == 0:
            logger.info("  snapped %d/%d track pieces", n, len(land))
    for (way, sport), intervals in cover.items():  # tree index -> OSM id (stays the same)
        state["cover"].setdefault((matcher.ids[way], sport), []).extend(intervals)

    # 3) off the street network and on the water: raw GPS, without repeats (per sport)
    for cat, pieces in (("unknown", off_network), ("water", water)):
        seen_all = state["seen_all"].setdefault(cat, set())
        for piece, sport in pieces:
            piece = [tuple(p) for p in piece]
            state["raw"].setdefault((cat, sport), []).extend(
                new_stretches(piece, state["seen"].setdefault((cat, sport), set())))
            # distinct km per surface, whatever the sport
            state["km_raw"][cat] = state["km_raw"].get(cat, 0) + track_km(
                new_stretches(piece, seen_all))


def build_map(acts, online, full=False):
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

    overrides = {}
    if OVERRIDES_FILE.exists():
        overrides = {k: v for k, v in json.loads(OVERRIDES_FILE.read_text(encoding="utf-8")).items()
                     if not k.startswith("_")}

    # everything an activity's lines depend on; if one of them changes, the map is redrawn
    def fingerprint(aid):
        st = files[aid].stat()
        a = acts.get(aid) or {}
        return (types[aid], a.get("name", ""), a.get("distance_m"), a.get("duration_s"),
                overrides.get(aid), files[aid].name, st.st_size, st.st_mtime_ns)

    fingerprints = {aid: fingerprint(aid) for aid in ids}
    matcher = SurfaceMatcher(OSM_CACHE, online=online)
    state = None if full else load_map_state(fingerprints)
    if state is not None and state["osm_missing"]:
        # stretches drawn without streets: once OSM has them, everything is drawn again
        before = len(state["osm_missing"])
        matcher.fetch(state["osm_missing"])
        if matcher.missing(state["osm_missing"]) < before:
            logger.info("OSM streets arrived for stretches drawn without them: drawing the map "
                        "from all activities")
            state = None
    rebuilt = state is None
    if state is None:
        state = empty_map_state()
    todo = [aid for aid in ids if aid not in state["done"]]
    logger.info("Map: %d activities already drawn, %d to add", len(state["done"]), len(todo))

    add_activities(state, todo, files, acts, types, overrides, fingerprints, matcher)

    # the whole map from the state (drawing only: nothing here goes into the state)
    lines = {}  # (surface, sport) -> list of point lists
    per_way = {}
    for (way_id, _), intervals in state["cover"].items():
        if (way := matcher.index.get(way_id)) is not None:
            per_way.setdefault(way, []).extend(intervals)
    open_ends = open_way_ends(per_way, matcher)
    for (way_id, sport), intervals in state["cover"].items():
        way = matcher.index.get(way_id)
        if way is None:
            continue
        lines.setdefault((matcher.cats[way], sport), []).extend(
            covered_parts(way, intervals, matcher, open_ends[way]))
    for key, parts in state["raw"].items():
        lines.setdefault(key, []).extend(list(map(list, parts)))
    # km per sport before the connectors below, which are drawn but weren't done
    km_sport = {}
    for (_, sport), parts in lines.items():
        km_sport[sport] = km_sport.get(sport, 0) + track_km(parts)
    # loose ends just short of another land line (streets and off-street, any sport) are
    # drawn on to it; water lines start and end anywhere and stay as they are
    connect_loose_ends([pts for (cat, _), parts in lines.items() if cat != "water"
                        for pts in parts])

    features = []
    for (cat, sport), parts in sorted(lines.items()):
        if not parts:
            continue
        coords = []
        for pts in parts:
            thin = [pts[i] for i in simplify_indices(pts, OUT_SIMPLIFY_M)]
            coords.append([[round(lon, 5), round(lat, 5)] for lat, lon in thin])
        features.append({"type": "Feature", "properties": {"surface": cat, "sport": sport},
                         "geometry": {"type": "MultiLineString", "coordinates": coords}})

    # distinct km per surface, whatever the sport (streets done on foot and by bike once)
    km_surface = dict(state["km_raw"])
    for way, intervals in per_way.items():
        cat = matcher.cats[way]
        km_surface[cat] = km_surface.get(cat, 0) + track_km(
            covered_parts(way, intervals, matcher, open_ends[way]))

    ROUTES_FILE.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                                      separators=(",", ":")), encoding="utf-8")
    if state["osm_missing"]:
        logger.warning("%d stretches have no OSM data yet; they are looked up again next run",
                       len(state["osm_missing"]))
    if todo or rebuilt:
        save_map_state(state)

    def tidy(km):
        return {k: round(v, 1) for k, v in sorted(km.items(), key=lambda kv: -kv[1]) if v}

    km_surface, km_sport = tidy(km_surface), tidy(km_sport)
    logger.info("Wrote %s (%.1f MB)", ROUTES_FILE, ROUTES_FILE.stat().st_size / 1e6)
    logger.info("  surfaces: %s", ", ".join(f"{c} {v:.0f} km" for c, v in km_surface.items()))
    logger.info("  sports:   %s", ", ".join(f"{c} {v:.0f} km" for c, v in km_sport.items()))
    return len(ids), km_surface, km_sport


def to_merc(pts):
    """(lat, lon) points -> Web Mercator x, y (true metres = merc units * cos(lat))."""
    a = np.asarray(pts, dtype=float)
    lat = np.radians(np.clip(a[:, 0], -85, 85))
    return np.column_stack([6378137 * np.radians(a[:, 1]),
                            6378137 * np.log(np.tan(np.pi / 4 + lat / 2))])


def from_merc(xy):
    lon = np.degrees(xy[:, 0] / 6378137)
    lat = np.degrees(2 * np.arctan(np.exp(xy[:, 1] / 6378137)) - np.pi / 2)
    return list(zip(lat.tolist(), lon.tolist()))


def connect_loose_ends(parts):
    """Line ends that stop just short of another line (a switch between a road and the
    cycleway next to it, matching that starts a few metres late) are drawn on to the nearest
    point of that line, up to CONNECT_M. `parts`: lists of (lat, lon), extended in place."""
    parts = [p for p in parts if len(p) >= 2]
    if len(parts) < 2:
        return
    geoms = np.empty(len(parts), dtype=object)
    geoms[:] = [shapely.linestrings(to_merc(p)) for p in parts]
    tree = shapely.STRtree(geoms)
    ends = [(i, k) for i in range(len(parts)) for k in (0, -1)]
    end_pts = to_merc([parts[i][k] for i, k in ends])
    scale = np.cos(np.radians([parts[i][k][0] for i, k in ends]))
    points = shapely.points(end_pts)
    src, dst = tree.query(points, predicate="dwithin", distance=CONNECT_M / scale)
    owner = np.array([i for i, _ in ends])
    keep = owner[src] != dst  # not the line itself
    src, dst = src[keep], dst[keep]
    dist = shapely.distance(points[src], geoms[dst]) * scale[src]
    best = {}
    for s_, d_, m_ in zip(src.tolist(), dst.tolist(), dist.tolist()):
        if m_ < best.get(s_, (None, np.inf))[1]:
            best[s_] = (d_, m_)
    for s_, (d_, m_) in best.items():
        if m_ < 2:  # touches already
            continue
        target = shapely.line_interpolate_point(
            geoms[d_], shapely.line_locate_point(geoms[d_], points[s_]))
        (lat, lon), = from_merc(np.array([[target.x, target.y]]))
        i, k = ends[s_]
        if k == 0:
            parts[i].insert(0, (lat, lon))
        else:
            parts[i].append((lat, lon))


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
    parser.add_argument("--full", action="store_true",
                        help="Read the whole Garmin activity list and draw the map from scratch")
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
        acts = sync_activities(api, full=args.full)
        download_missing_gpx(api, acts)

    if acts:
        STATS_FILE.write_text(json.dumps(build_stats(acts), indent=1), encoding="utf-8")
        logger.info("Wrote %s", STATS_FILE)
    else:
        logger.warning("No activity list yet (run once without --offline); stats not written.")

    build_trips(acts)
    n_acts, km_surface, km_sport = build_map(acts, online=not (args.offline or args.no_osm),
                                             full=args.full)
    INFO_FILE.write_text(json.dumps({
        "last_update": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "activities": n_acts,
        "km": km_surface,         # distinct streets per surface
        "km_by_sport": km_sport,  # per sport (a street run and cycled counts for both)
    }, indent=2), encoding="utf-8")
    logger.info("Done.")


if __name__ == "__main__":
    main()
