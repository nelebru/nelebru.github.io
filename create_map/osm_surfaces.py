"""OpenStreetMap streets for the world map (create_map/update_routes.py).

The OSM ways within QUERY_RADIUS_M of each new stretch of track are fetched once from the
Overpass API and kept in a local cache file, so rebuilding the map later needs no network
for stretches that were already looked up. Track points are snapped to the nearest way;
the map then draws the parts of the ways that were followed, in the way's surface category.

The categories are the same as in read_gpx_py/surfaces.py (and SURFACES in gpx.html):
    road, cycle_path, cobbles, gravel, unpaved, unknown
"""
import hashlib
import json
import logging
import math
import os
import time
from pathlib import Path

import numpy as np
import requests
import shapely
from pyproj import Transformer

logger = logging.getLogger(__name__)

# public servers of the FOSSGIS (Germany), tried in turn when one is overloaded;
# OVERPASS_URLS in create_map/.env (space-separated) replaces them
OVERPASS_URLS = [
    "https://z.overpass-api.de/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]
USER_AGENT = "nelebru.github.io world map script (https://github.com/nelebru)"
QUERY_RADIUS_M = 50       # ways fetched around the (deduplicated) track
SNAP_DISTANCE_M = 20      # a point further from any way stays "unknown"
QUERY_SIMPLIFY_M = 8      # the track sent to Overpass is thinned out this much
QUERY_MAX_COORDS = 800    # coordinates per Overpass request
REQUEST_PAUSE_S = 2.0     # be polite to the public server

# --- OSM tags -> category ------------------------------------------------------------
SMOOTH = {"asphalt", "concrete", "concrete:plates", "concrete:lanes", "paved", "paving_stones",
          "paving_stones:lanes", "chipseal", "metal", "wood", "rubber", "tartan", "acrylic",
          "metal_grid", "bricks", "clay"}
COBBLES = {"sett", "cobblestone", "unhewn_cobblestone", "cobblestone:flattened", "grass_paver",
           "stepping_stones"}
GRAVEL = {"gravel", "fine_gravel", "compacted", "pebblestone", "shells", "crushed_limestone"}
UNPAVED = {"unpaved", "dirt", "ground", "earth", "grass", "sand", "mud", "woodchips", "rock",
           "soil", "snow", "ice", "salt"}
PATH_HIGHWAYS = {"cycleway", "path", "footway", "pedestrian", "steps", "bridleway", "corridor"}
ROAD_HIGHWAYS = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified",
                 "residential", "living_street", "service", "road", "busway",
                 "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}


def osm_category(tags):
    highway = tags.get("highway", "")
    surface = tags.get("surface", "").split(";")[0].strip()
    paved_kind = "cycle_path" if highway in PATH_HIGHWAYS else "road"
    if surface in SMOOTH:
        return paved_kind
    if surface in COBBLES:
        return "cobbles"
    if surface in GRAVEL:
        return "gravel"
    if surface in UNPAVED:
        return "unpaved"
    # no (known) surface tag: guess from the kind of way, like routers do
    if highway in ROAD_HIGHWAYS:
        return "road"
    if highway in ("cycleway", "footway", "pedestrian", "steps"):
        return "cycle_path"
    if highway == "track":
        grade = tags.get("tracktype", "")
        if grade == "grade1":
            return "road"
        if grade == "grade2":
            return "gravel"
        if grade in ("grade3", "grade4", "grade5"):
            return "unpaved"
        return "gravel"
    if highway in ("path", "bridleway"):
        return "unpaved"
    return "unknown"


# --- geometry helpers ----------------------------------------------------------------
def local_xy(points):
    """(lat, lon) -> metres on a flat projection around the points (fine for distances)."""
    lat0 = math.radians(sum(p[0] for p in points) / len(points))
    return [(lon * 111320 * math.cos(lat0), lat * 110574) for lat, lon in points]


def simplify_indices(points, tol_m):
    """Douglas-Peucker; indices of the points to keep."""
    if len(points) < 3:
        return list(range(len(points)))
    xy = local_xy(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy)
        far, far_d = None, tol_m
        for i in range(a + 1, b):
            px, py = xy[i]
            d = (abs(dy * (px - ax) - dx * (py - ay)) / length if length
                 else math.hypot(px - ax, py - ay))
            if d > far_d:
                far, far_d = i, d
        if far is not None:
            keep[far] = True
            stack += [(a, far), (far, b)]
    return [i for i, k in enumerate(keep) if k]


def run_key(points):
    raw = ";".join(f"{lat:.5f},{lon:.5f}" for lat, lon in points)
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


# --- Overpass ------------------------------------------------------------------------
def overpass_healthy():
    """A tiny query with a known answer (streets around Lübeck town hall)."""
    try:
        return bool(overpass("[out:json][timeout:60];way[highway](around:50,53.8665,10.6855);out ids;",
                             attempts=3))
    except Exception:
        return False


def overpass(query, attempts=8):
    """Elements of a query. An overloaded server may answer with an error page, a
    runtime remark or (seen in practice, from all FOSSGIS servers at once) an empty
    result. Hundreds of track points without a single street nearby don't really happen,
    so an empty answer counts as a failure; the stretches are asked again next run."""
    urls = os.getenv("OVERPASS_URLS", "").split() or OVERPASS_URLS
    for attempt in range(attempts):
        url = urls[attempt % len(urls)]
        host = url.split("/")[2]
        try:
            resp = requests.post(url, data={"data": query}, timeout=400,
                                 headers={"User-Agent": USER_AGENT})
            if resp.status_code != 200:
                raise RuntimeError(f"status {resp.status_code}")
            data = resp.json()
            if "osm3s" not in data or data.get("remark"):
                raise RuntimeError(f"incomplete answer: {data.get('remark', 'no osm3s')}"[:200])
        except Exception as e:
            wait = 15 * (attempt + 1)
            logger.info("  %s: %s; next try in %d s", host, e, wait)
            time.sleep(wait)
            continue
        elements = data.get("elements", [])
        if elements:
            return elements
        wait = 15 * (attempt + 1)
        logger.info("  %s: empty answer (overloaded?); next try in %d s", host, wait)
        time.sleep(wait)
    raise RuntimeError("no usable answer from the Overpass servers")


# --- the cache and the lookups -------------------------------------------------------
class SurfaceMatcher:
    def __init__(self, cache_file: Path, online=True):
        self.cache_file = cache_file
        self.online = online
        self.ways = {}       # id -> [category, [[lat, lon], ...]]
        self.queried = set()  # run keys already looked up
        if cache_file.exists():
            data = json.loads(cache_file.read_text(encoding="utf-8"))
            self.ways = data.get("ways", {})
            self.queried = set(data.get("queried", []))
            logger.info("OSM cache: %d ways, %d stretches", len(self.ways), len(self.queried))
        self.to_merc = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
        self.tree = None

    def save(self):
        self.cache_file.write_text(json.dumps(
            {"ways": self.ways, "queried": sorted(self.queried)}, separators=(",", ":")),
            encoding="utf-8")

    # 1) make sure the ways around all runs are in the cache
    def fetch(self, runs):
        """runs: lists of (lat, lon). Looks up the ones not in the cache yet."""
        todo = []
        for pts in runs:
            key = run_key(pts)
            if key in self.queried:
                continue
            thin = [pts[i] for i in simplify_indices(pts, QUERY_SIMPLIFY_M)]
            todo.append((key, thin))
        if not todo:
            return
        if not self.online:
            logger.warning("%d stretches have no OSM data yet (offline); they stay 'unknown'",
                           len(todo))
            return

        # pack the stretches into requests of at most QUERY_MAX_COORDS coordinates
        batches, batch, size = [], [], 0
        for key, thin in todo:
            # long stretches are split into overlapping pieces
            pieces = [thin[i:i + 500] for i in range(0, max(len(thin) - 1, 1), 499)]
            for piece in pieces:
                if size + len(piece) > QUERY_MAX_COORDS and batch:
                    batches.append(batch)
                    batch, size = [], 0
                batch.append((key, piece))
                size += len(piece)
        if batch:
            batches.append(batch)

        if not overpass_healthy():
            logger.warning("Overpass servers aren't answering properly right now; the %d stretches "
                           "stay 'unknown' until the next run", len(todo))
            return

        logger.info("Fetching OSM ways for %d stretches in %d requests ...", len(todo), len(batches))
        done_keys = {}
        failures = 0
        for n, batch in enumerate(batches, 1):
            if failures >= 3:
                logger.warning("3 requests in a row failed; stopping, the rest follows next run")
                break
            for key, _ in batch:
                done_keys[key] = done_keys.get(key, 0) + 1
            parts = []
            for _, piece in batch:
                coords = ",".join(f"{lat:.5f},{lon:.5f}" for lat, lon in piece)
                if len(piece) == 1:
                    coords += "," + coords  # around needs a line or a point; a line works
                parts.append(f"way(around:{QUERY_RADIUS_M},{coords})[highway];")
            query = f"[out:json][timeout:300];({''.join(parts)});out tags geom;"
            try:
                elements = self._overpass(query)
            except Exception as e:
                logger.warning("  request %d/%d failed, these stretches stay 'unknown' for now: %s",
                               n, len(batches), e)
                for key, _ in batch:
                    done_keys[key] = -10 ** 9  # never mark as queried
                failures += 1
                continue
            failures = 0
            for el in elements:
                geom = el.get("geometry")
                if el.get("type") != "way" or not geom:
                    continue
                self.ways[str(el["id"])] = [osm_category(el.get("tags", {})),
                                            [[round(g["lat"], 6), round(g["lon"], 6)] for g in geom]]
            # a stretch counts as looked up once all of its requests went through
            for key, _ in batch:
                done_keys[key] -= 1
                if done_keys[key] == 0:
                    self.queried.add(key)
            logger.info("  request %d/%d: %d ways (cache: %d)", n, len(batches), len(elements),
                        len(self.ways))
            if n % 3 == 0:
                self.save()  # an interrupted run continues from here
            time.sleep(REQUEST_PAUSE_S)
        self.save()
        self.tree = None

    def _overpass(self, query):
        return overpass(query)


    # 2) snap points to the cached ways. Ways are kept in Web Mercator; its units are metres
    #    times 1/cos(lat), so true lengths are merc lengths times `scale`.
    def _build_tree(self):
        self.cats, lines = [], []
        for cat, coords in self.ways.values():
            if len(coords) < 2:
                continue
            xs, ys = self.to_merc.transform([c[1] for c in coords], [c[0] for c in coords])
            lines.append(shapely.linestrings(np.column_stack([xs, ys])))
            self.cats.append(cat)
        self.lines = np.array(lines, dtype=object)
        self.scales = np.array([math.cos(math.radians(c[0][0])) for _, c in self.ways.values()
                                if len(c) >= 2])
        self.tree = shapely.STRtree(self.lines) if lines else None
        self.from_merc = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)

    def snap(self, pts):
        """pts: array (n, 2) of lat, lon. Returns (way index or -1 for each point, merc points)."""
        if self.tree is None:
            self._build_tree()
        xs, ys = self.to_merc.transform(pts[:, 1], pts[:, 0])
        points = shapely.points(np.column_stack([xs, ys]))
        idx = np.full(len(pts), -1)
        if self.tree is None:
            return idx, points
        # search generously in merc units, then check the true distance
        scale = np.cos(np.radians(pts[:, 0]))
        (src, dst), dist = self.tree.query_nearest(
            points, max_distance=SNAP_DISTANCE_M / max(scale.min(), 0.2),
            return_distance=True, all_matches=False)
        ok = dist * scale[src] <= SNAP_DISTANCE_M
        idx[src[ok]] = dst[ok]
        return idx, points

    def positions(self, way, points):
        """Positions (merc units from the way's start) of points projected onto the way."""
        return shapely.line_locate_point(self.lines[way], points)

    def length(self, way):
        """(merc length, true metres per merc unit)"""
        return self.lines[way].length, self.scales[way]

    def substring(self, way, a, b):
        """The way between positions a and b, as a list of (lat, lon)."""
        from shapely.ops import substring
        part = substring(self.lines[way], a, b)
        coords = np.asarray(part.coords)
        if len(coords) < 2:
            return []
        lons, lats = self.from_merc.transform(coords[:, 0], coords[:, 1])
        return list(zip(lats, lons))
