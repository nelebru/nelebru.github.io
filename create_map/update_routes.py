import os
import json
import gpxpy
import geopandas as gpd
import pandas as pd
from shapely.geometry import LineString
from garminconnect import Garmin
from pathlib import Path
from datetime import datetime, date
from dotenv import load_dotenv, find_dotenv

# === CONFIG ===
load_dotenv("path/to/create_map/.env")
print(find_dotenv())

EMAIL = os.getenv("GARMIN_EMAIL")
PASSWORD = os.getenv("GARMIN_PASS")
DATA_DIR = Path(os.getenv("DATA_DIR"))  # for temporry files (can get large)
SAVE_DIR = Path(os.getenv("SAVE_DIR"))

EXISTING = SAVE_DIR / "all_routes.geojson"
INFO_FILE = SAVE_DIR / "map_info.json"
TMP_DIR = DATA_DIR / "tmp_gpx"

HIST_DIR = DATA_DIR / "tmp_gpx"

EXCLUDE_ACTIVITIES = ["virtual_ride", "lap_swimming", "treadmill_running",
                      "indoor_cycling", "strength_training", "yoga"]

DATA_DIR.mkdir(exist_ok=True)
TMP_DIR.mkdir(exist_ok=True)
SAVE_DIR.mkdir(exist_ok=True)

# === HELPERS ===
def get_last_update():
    if INFO_FILE.exists():
        with open(INFO_FILE) as f:
            info = json.load(f)
            return datetime.fromisoformat(info["last_update"])
    return datetime(2017, 1, 1)

def gpx_to_lines(gpx_file):
    with open(gpx_file, "r", encoding="utf-8") as f:
        gpx = gpxpy.parse(f)
    lines = []
    for track in gpx.tracks:
        for segment in track.segments:
            coords = [(p.longitude, p.latitude) for p in segment.points]
            if len(coords) > 1:
                lines.append(LineString(coords))
    return lines

# one-time historical download function
def import_historical_gpx(historical_dir):
    """
    Import all GPX files in HIST_DIR into the unified GeoJSON.
    """
    if not historical_dir.exists():
        print("No historical folder found.")
        return

    gpx_files = list(historical_dir.glob("*.gpx"))
    gpx_files = [f for f in gpx_files if not any(act in f.name for act in EXCLUDE_ACTIVITIES)]
    print(f"Found {len(gpx_files)} historical GPX files.")

    if EXISTING.exists():
        gdf = gpd.read_file(EXISTING)
    else:
        gdf = gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    new_lines = []
    for gpx in gpx_files:
        new_lines.extend(gpx_to_lines(gpx))

    print(f"Extracted {len(new_lines)} lines from historical GPX files.")

    new_gdf = gpd.GeoDataFrame(geometry=new_lines, crs="EPSG:4326")
    combined = pd.concat([gdf, new_gdf], ignore_index=True)
    all_routes = gpd.GeoDataFrame(geometry=combined["geometry"], crs="EPSG:4326")

    # merge overlapping lines
    merged_geom = all_routes.buffer(0.00005).unary_union
    merged_gdf = gpd.GeoDataFrame(geometry=[merged_geom], crs="EPSG:4326")
    merged_gdf["geometry"] = merged_gdf["geometry"].apply(
        lambda geom: geom.simplify(0.00005, preserve_topology=True)
    )

    merged_gdf = merged_gdf.round(5)
    merged_gdf.to_file(EXISTING, driver="GeoJSON")

    INFO_FILE.write_text(json.dumps({
        "last_update": datetime.now().isoformat(),
        "routes_added": len(new_lines),
        "historical_import_done": True
    }, indent=2))

    print("✓ Historical data successfully imported.")


# === MAIN FUNTCIONS ===
def download_new_gpx():
    """Login and download new activities as GPX files with proper pagination."""
    try:
        api = Garmin(EMAIL, PASSWORD)
        api.login()
        print("Logged in successfully")
    except Exception as e:
        print("Login failed:", e)
        return []

    last_update = get_last_update()
    print(f"Fetching activities since {last_update.date()}")

    CHUNK_SIZE = 100
    all_activities = []
    offset = 0
    reached_target_date = False

    # Fetch in chunks until we reach activities older than last_update
    while not reached_target_date:
        print(f"Fetching activities {offset}–{offset + CHUNK_SIZE} ...")

        try:
            chunk = api.get_activities(offset, CHUNK_SIZE)
        except Exception as e:
            print(f"Error fetching chunk at offset {offset}: {e}")
            break

        if not chunk:
            print("No more activities returned by API")
            break

        print(f"  Retrieved {len(chunk)} activities")

        # Check the date of the oldest activity in this chunk
        oldest_in_chunk = datetime.fromisoformat(
            chunk[-1]["startTimeLocal"].replace("Z", "")
        )
        print(f"  Oldest activity in chunk: {oldest_in_chunk.date()}")

        all_activities.extend(chunk)

        # Stop if gone past target date
        if oldest_in_chunk <= last_update:
            print(f"Reached target date {last_update.date()}")
            reached_target_date = True
            break

        offset += CHUNK_SIZE

        # Safety valve
        if offset > 10000:
            print("Safety limit reached (10,000 activities)")
            break

    print(f"Total activities fetched: {len(all_activities)}")

    # Filter to only activities newer than last update
    new_acts = []
    for a in all_activities:
        act_date = datetime.fromisoformat(a["startTimeLocal"].replace("Z", ""))
        if act_date > last_update:
            new_acts.append(a)

    print(f"Activities after last update ({last_update.date()}): {len(new_acts)}")

    # Download GPX for activities that pass filters
    new_files = []
    download_count = 0

    for i, a in enumerate(new_acts, 1):
        act_type = a["activityType"]["typeKey"]

        if act_type in EXCLUDE_ACTIVITIES:
            continue

        act_id = a["activityId"]
        act_date = a["startTimeLocal"][:10]
        filename = f"{act_date}_{act_type}_{act_id}.gpx"
        gpx_path = TMP_DIR / filename

        if not gpx_path.exists():
            print(f"⬇ [{i}/{len(new_acts)}] Downloading {act_type} on {act_date}")
            try:
                gpx_data = api.download_activity(
                    act_id,
                    dl_fmt=api.ActivityDownloadFormat.GPX
                )
                with open(gpx_path, "wb") as f:
                    f.write(gpx_data)
                new_files.append(gpx_path)
                download_count += 1
            except Exception as e:
                print(f"  ⚠ Failed to download {act_id}: {e}")
                continue

    print(f"\n✓ Downloaded {download_count} new activities.")
    return new_files

def merge_routes(gpx_files):
    """Merge all new GPX routes into one GeoJSON"""
    if EXISTING.exists():
        gdf = gpd.read_file(EXISTING)
    else:
        gdf = gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    new_lines = []
    for gpx in gpx_files:
        new_lines.extend(gpx_to_lines(gpx))
        gpx.unlink()  # delete after processing

    if not new_lines:
        print("No new GPX routes to merge.")
        return 0

    new_gdf = gpd.GeoDataFrame(geometry=new_lines, crs="EPSG:4326")
    combined = pd.concat([gdf, new_gdf], ignore_index=True)
    all_routes = gpd.GeoDataFrame(geometry=combined["geometry"], crs="EPSG:4326")

    # merge overlapping lines (buffer + dissolve)
    merged_geom = all_routes.buffer(0.00005).unary_union
    merged_gdf = gpd.GeoDataFrame(geometry=[merged_geom], crs="EPSG:4326")
    merged_gdf["geometry"] = merged_gdf["geometry"].apply(
        lambda geom: geom.simplify(0.00005, preserve_topology=True)
    )

    def round_coords(geom, ndigits=5):
        if geom.is_empty:
            return geom
        return shapely.geometry.mapping(geom)

    merged_gdf = merged_gdf.round(5)
    merged_gdf.to_file(
        EXISTING,
        driver="GeoJSON"
    )

    INFO_FILE.write_text(json.dumps({
        "last_update": datetime.now().isoformat(),
        "routes_added": len(new_lines)
    }, indent=2))

    print(f"🗺 Map updated with {len(new_lines)} new lines.")
    return len(new_lines)

def full_update():
    gpx_files = download_new_gpx()
    return merge_routes(gpx_files)

if __name__ == "__main__":
    # Uncomment line to do a one-time historical import
    # import_historical_gpx(HIST_DIR)

    full_update()
