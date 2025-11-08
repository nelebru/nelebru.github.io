"""
Parse GPX files in a directory to extract course information and save it as JSON.
requires: gpxpy library (install via pip)
"""
import os
import json
import gpxpy
import requests
import time


def parse_args():
    import argparse
    parser = argparse.ArgumentParser(description="Parse GPX files to extract course information.")
    parser.add_argument("--gpx_dir", help="Directory containing GPX files")
    parser.add_argument("--output", help="Output JSON file", default="gpx_courses.json")
    parser.add_argument("--overwrite", help="Overwrite existing JSON file", action="store_true")
    return parser.parse_args()


def reverse_geocode_photon(lat, lon):
    """
    Reverse geocode using Photon API to get location name.
    Args:
        lat (float): Latitude
        lon (float): Longitude

    Returns:
        str: Location name (city or name) or "Unknown"
    """
    url = f"https://photon.komoot.io/reverse?lat={lat}&lon={lon}"
    resp = requests.get(url, timeout=10)
    if resp.ok:
        data = resp.json()
        if data["features"]:
            props = data["features"][0]["properties"]
            city = props.get("city") or props.get("name") or "Unknown"
            # city = city.replace("ü", "ue").replace("Ü", "Ue")
            return city
    return "Unknown"


def compute_elevation_gain(track):
    """Compute total elevation gain (sum of positive elevation changes) in meters."""
    total_gain = 0.0
    for segment in track.segments:
        points = segment.points
        for i in range(1, len(points)):
            diff = points[i].elevation - points[i - 1].elevation
            if diff > 0:
                total_gain += diff
    return round(total_gain, 1)


def main(args):

    gpx_dir = args.gpx_dir or "assets/gpx"
    output_json = args.output or "gpx_courses.json"

    # Load existing data if file exists
    if os.path.exists(output_json) and not args.overwrite:
        with open(output_json, "r", encoding="utf-8") as f:
            try:
                existing_data = json.load(f)
                print(f"Loaded {len(existing_data)} existing entries.")
            except json.JSONDecodeError:
                existing_data = []
    else:
        existing_data = []

    # Index existing files by filename
    existing_files = {os.path.basename(c["file"]): c for c in existing_data}
    courses = existing_data.copy()

    for filename in os.listdir(gpx_dir):
        if not filename.endswith(".gpx"):
            continue

        # Skip files already processed
        if filename in existing_files:
            print(f"Skipping existing: {filename}")
            continue

        gpx_path = os.path.join(gpx_dir, filename)
        print(f"Processing: {filename}")

        try:
            with open(gpx_path, "r", encoding="utf-8") as f:
                gpx = gpxpy.parse(f)

            track = gpx.tracks[0]
            segment = track.segments[0]
            first_point = segment.points[0]
            lat, lon = first_point.latitude, first_point.longitude

            # Compute distance (sum of segment lengths)
            distance_km = sum(seg.length_2d() for seg in track.segments) / 1000
            el_gain = compute_elevation_gain(track)
            location = reverse_geocode_photon(lat, lon)

            course = {
                "name": os.path.splitext(filename)[0].replace("-", " ").replace("_", " ").title(),
                "file": os.path.join(gpx_dir, filename),
                "location": location,
                "elevation_gain": el_gain,
                "distance": round(distance_km, 1)
            }
            courses.append(course)

            print(f"Added: {course['name']} ({course['distance']} km, {course['location']})")
            time.sleep(1)  # Be polite to Nominatim (max 1 request/sec)

        except Exception as e:
            print(f"Error processing {filename}: {e}")

    # Save updated list
    os.makedirs(os.path.dirname(output_json), exist_ok=True)
    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(courses, f, indent=2, ensure_ascii=False)

    print(f"\nDone. Total entries: {len(courses)}")

    with open(args.output, "w") as f:
        json.dump(courses, f, indent=2)

if __name__ == "__main__":
    args = parse_args()
    main(args)
