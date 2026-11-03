"""Simplified course lines for the overview map on the GPX page (libs/custom/gpx_overview.js).

The full GPX files add up to megabytes; the overview only needs the rough shape of each course,
so the tracks are thinned out (Douglas-Peucker) and written to one small JSON file:
    {"<course id>": [[lat, lon], ...], ...}
with the course id as in gpx.html (file name without folder and extension).

Run from the repository root after adding or changing courses:
    python create_map/gpx_overview.py
"""
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path

COURSES = Path("assets/data/gpx_courses.json")
OUT = Path("assets/data/gpx_overview.json")
TOLERANCE_M = 20  # how far the thinned line may stray from the real one


def course_id(file):
    return Path(file.replace("\\", "/")).stem


def read_points(path):
    # any namespace, tracks and routes alike
    root = ET.parse(path).getroot()
    return [(float(p.get("lat")), float(p.get("lon")))
            for p in root.iter() if p.tag.split("}")[-1] in ("trkpt", "rtept")]


def simplify(points, tol):
    if len(points) < 3:
        return points
    # flat projection around the course, in metres
    lat0 = math.radians(sum(p[0] for p in points) / len(points))
    xy = [(lon * 111320 * math.cos(lat0), lat * 110540) for lat, lon in points]

    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy)
        far, far_d = None, tol
        for i in range(a + 1, b):
            px, py = xy[i]
            # distance to the segment (to the point a for loops that end where they start)
            d = abs(dy * (px - ax) - dx * (py - ay)) / length if length else math.hypot(px - ax, py - ay)
            if d > far_d:
                far, far_d = i, d
        if far is not None:
            keep[far] = True
            stack += [(a, far), (far, b)]
    return [p for p, k in zip(points, keep) if k]


def main():
    courses = json.loads(COURSES.read_text(encoding="utf-8"))
    out = {}
    for c in courses:
        path = Path(c["file"].replace("\\", "/"))
        points = simplify(read_points(path), TOLERANCE_M)
        out[course_id(c["file"])] = [[round(lat, 5), round(lon, 5)] for lat, lon in points]
        print(f"{c['name']}: {len(points)} points")
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
