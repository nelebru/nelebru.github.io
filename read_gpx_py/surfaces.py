"""
Infer the road surface along each GPX course by map-matching it to OpenStreetMap
with Valhalla's trace_attributes API, and save the result as JSON.

The output is a separate file (default: assets/data/gpx_surfaces.json) keyed by
course id (the GPX file name without extension, as on the website); the general
course information in gpx_courses.json is not touched.

requires: gpxpy, requests (install via pip)
"""
import argparse
import json
import math
import os
import time

import gpxpy
import requests

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Public Valhalla server of the OpenStreetMap community (FOSSGIS); meant for light use.
VALHALLA_URL = "https://valhalla1.openstreetmap.de/trace_attributes"
USER_AGENT = "nelebru.github.io course surface script (https://github.com/nelebru)"

MIN_SPACING_M = 10        # drop points closer than this to the previous one
CHUNK_POINTS = 2000       # max points per request
CHUNK_DISTANCE_M = 40000  # max length per request
MIN_RUN_M = 40            # shorter surface changes are treated as matching noise
REQUEST_PAUSE_S = 1.5     # be polite to the public server

# Surface categories (the website colours them; keep the names in sync with gpx.html):
#   road        smooth paved road (asphalt, concrete, paving stones)
#   cycle_path  smooth paved cycleway, path or footway
#   cobbles     cobblestone, sett and other rough paving
#   gravel      gravel, fine gravel, compacted
#   unpaved     dirt, ground, grass, sand and other unpaved paths
#   unknown     points Valhalla could not match to the road network
PAVED = {"paved_smooth", "paved"}
GRAVEL = {"compacted", "gravel"}
UNPAVED = {"dirt", "path", "impassable"}
CYCLE_PATH_USES = {"cycleway", "path", "footway", "pedestrian", "sidewalk", "mountain_bike"}


def parse_args():
    parser = argparse.ArgumentParser(description="Infer road surfaces along GPX courses with Valhalla.")
    parser.add_argument("--gpx_dir", default=os.path.join(REPO_ROOT, "assets", "gpx"),
                        help="Directory containing GPX files")
    parser.add_argument("--output", default=os.path.join(REPO_ROOT, "assets", "data", "gpx_surfaces.json"),
                        help="Output JSON file")
    parser.add_argument("--overwrite", action="store_true",
                        help="Recompute courses that are already in the output file")
    parser.add_argument("--only", nargs="+", metavar="COURSE_ID",
                        help="Only process these courses (file names without .gpx); implies recomputing them")
    return parser.parse_args()


def category(surface, use):
    if surface in PAVED:
        return "cycle_path" if use in CYCLE_PATH_USES else "road"
    if surface == "paved_rough":
        return "cobbles"
    if surface in GRAVEL:
        return "gravel"
    if surface in UNPAVED:
        return "unpaved"
    return "unknown"


def haversine(a, b):
    """Distance in metres; same spherical earth radius as Leaflet's distanceTo."""
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * 6371000 * math.asin(math.sqrt(min(1.0, h)))


def read_points(gpx_path):
    """All track and route points in drawing order (as the website's map draws them)."""
    with open(gpx_path, "r", encoding="utf-8") as f:
        gpx = gpxpy.parse(f)
    points = [(p.latitude, p.longitude)
              for track in gpx.tracks for seg in track.segments for p in seg.points]
    points += [(p.latitude, p.longitude) for route in gpx.routes for p in route.points]
    return points


def downsample(points):
    """Points at least MIN_SPACING_M apart, with their distance (m) from the start."""
    kept, dists = [points[0]], [0.0]
    total = 0.0
    for prev, p in zip(points, points[1:]):
        total += haversine(prev, p)
        if total - dists[-1] >= MIN_SPACING_M:
            kept.append(p)
            dists.append(total)
    if dists[-1] < total:
        kept.append(points[-1])
        dists.append(total)
    return kept, dists


def chunks(n_points, dists):
    """Index ranges [start, end] (inclusive) for the requests; neighbours share one point."""
    start = 0
    while start < n_points - 1:
        # let the last chunk run up to 25% over the limits rather than leave a tiny
        # tail, which is more likely to fail matching
        if (n_points - start <= CHUNK_POINTS * 1.25
                and dists[-1] - dists[start] <= CHUNK_DISTANCE_M * 1.25):
            yield start, n_points - 1
            return
        end = start + 1
        while (end < n_points - 1 and end - start + 1 < CHUNK_POINTS
               and dists[end + 1] - dists[start] <= CHUNK_DISTANCE_M):
            end += 1
        yield start, end
        start = end


def match_chunk(points):
    """Surface category for each point, from Valhalla's map matching."""
    body = {
        "shape": [{"lat": lat, "lon": lon} for lat, lon in points],
        "costing": "bicycle",
        "shape_match": "map_snap",
        "filters": {
            "attributes": ["edge.surface", "edge.use", "matched.type", "matched.edge_index"],
            "action": "include",
        },
    }
    for attempt in range(4):
        resp = requests.post(VALHALLA_URL, json=body, timeout=120, headers={"User-Agent": USER_AGENT})
        if resp.status_code in (429, 500, 502, 503, 504) and attempt < 3:
            wait = 10 * (attempt + 1)
            print(f"    server busy ({resp.status_code}), retrying in {wait} s")
            time.sleep(wait)
            continue
        break
    if not resp.ok:
        raise RuntimeError(f"Valhalla error {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    edges = data.get("edges", [])
    cats = []
    for mp in data.get("matched_points", []):
        i = mp.get("edge_index")
        if mp.get("type") == "unmatched" or i is None or not 0 <= i < len(edges):
            cats.append("unknown")
        else:
            cats.append(category(edges[i].get("surface"), edges[i].get("use")))
    if len(cats) != len(points):
        raise RuntimeError(f"Valhalla returned {len(cats)} matched points for {len(points)} sent")
    return cats


def to_runs(cats, dists):
    """[from_m, to_m, category] runs; point i's category covers the stretch to point i+1."""
    runs = []
    for i in range(len(dists) - 1):
        if runs and runs[-1][2] == cats[i]:
            runs[-1][1] = dists[i + 1]
        else:
            runs.append([dists[i], dists[i + 1], cats[i]])
    return runs


def merge_equal(runs):
    merged = []
    for r in runs:
        if merged and merged[-1][2] == r[2]:
            merged[-1][1] = r[1]
        else:
            merged.append(list(r))
    return merged


def smooth(runs):
    """Fold runs shorter than MIN_RUN_M into a neighbour (junction mismatches)."""
    runs = merge_equal(runs)
    changed = True
    while changed and len(runs) > 1:
        changed = False
        for i, r in enumerate(runs):
            if r[1] - r[0] >= MIN_RUN_M:
                continue
            # give it to the longer neighbour
            prev_len = runs[i - 1][1] - runs[i - 1][0] if i > 0 else -1
            next_len = runs[i + 1][1] - runs[i + 1][0] if i < len(runs) - 1 else -1
            if prev_len >= next_len:
                runs[i - 1][1] = r[1]
            else:
                runs[i + 1][0] = r[0]
            del runs[i]
            runs = merge_equal(runs)
            changed = True
            break
    return runs


def process(gpx_path):
    points = read_points(gpx_path)
    if len(points) < 2:
        raise RuntimeError("fewer than two points")
    kept, dists = downsample(points)

    cats = [None] * len(kept)
    for start, end in chunks(len(kept), dists):
        print(f"    km {dists[start] / 1000:.1f}-{dists[end] / 1000:.1f} ({end - start + 1} points)")
        try:
            chunk_cats = match_chunk(kept[start:end + 1])
        except Exception as e:
            print(f"    could not match this part, marking it unknown: {e}")
            chunk_cats = ["unknown"] * (end - start + 1)
        # a point's category covers the stretch after it, so for the point shared
        # with the previous chunk this chunk's match is the one that counts
        cats[start:end + 1] = chunk_cats
        time.sleep(REQUEST_PAUSE_S)

    runs = smooth(to_runs(cats, dists))
    summary = {}
    for a, b, c in runs:
        summary[c] = summary.get(c, 0) + (b - a) / 1000

    return {
        "distance_km": round(dists[-1] / 1000, 3),
        "summary_km": {c: round(km, 2) for c, km in sorted(summary.items(), key=lambda kv: -kv[1])},
        # [from_km, to_km, category], in the direction of the GPX file
        "runs": [[round(a / 1000, 3), round(b / 1000, 3), c] for a, b, c in runs],
    }


def save(output, results):
    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    with open(output, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(results.items())), f, ensure_ascii=False, indent=1)


def main(args):
    results = {}
    if os.path.exists(args.output):
        with open(args.output, "r", encoding="utf-8") as f:
            try:
                results = json.load(f)
                print(f"Loaded {len(results)} existing entries from {args.output}")
            except json.JSONDecodeError:
                print(f"Could not read {args.output}, starting fresh")

    files = sorted(f for f in os.listdir(args.gpx_dir) if f.lower().endswith(".gpx"))
    for filename in files:
        course_id = os.path.splitext(filename)[0]
        if args.only and course_id not in args.only:
            continue
        if course_id in results and not (args.overwrite or args.only):
            print(f"Skipping existing: {course_id}")
            continue

        print(f"Processing: {course_id}")
        try:
            results[course_id] = process(os.path.join(args.gpx_dir, filename))
        except Exception as e:
            print(f"  Error: {e}")
            continue
        summary = ", ".join(f"{c} {km:.1f} km" for c, km in results[course_id]["summary_km"].items())
        print(f"  {summary}")
        save(args.output, results)  # after every course, so an interrupted run keeps its progress

    print(f"\nDone. {len(results)} courses in {args.output}")


if __name__ == "__main__":
    main(parse_args())
