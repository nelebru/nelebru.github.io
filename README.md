# Neles Website

Jekyll-based website. 
Contains bio, publications, vita as well as my favourite recipes and cycling routes.
---

## Parsing GPX files to the courses section
I wrote a small script to geo reverse code GPX files to get location names, 
to get total distance and elevation gain, and to convert them to JSON format.

You can find it in the `./read_gpx_py` folder. 

Put your GPX files in './assets/gpx_files' folder and run:

```
python parse.py --gpx_dir /path/to/files --output output_file.json
```
Put the output JSON file in the `./assets/data` folder to make them 
appear on the website.

### Road surfaces
`surfaces.py` (same folder) matches each course to OpenStreetMap with the public
[Valhalla](https://valhalla1.openstreetmap.de) server and stores which stretches are
road, cycle path, cobbles, gravel or unpaved. It writes a separate file,
`./assets/data/gpx_surfaces.json`, and only processes courses that are not in it yet:

```
python read_gpx_py/surfaces.py                  # new courses only
python read_gpx_py/surfaces.py --only Mausrunde # recompute single courses
python read_gpx_py/surfaces.py --overwrite      # recompute everything
```

---

## Visited street map 

`create_map/update_routes.py` builds the world map and the swim/bike/run stats from **Garmin Connect**:
- syncs the activity list (incl. triathlon legs) and downloads GPX files that are not cached yet; the GPX cache in `DATA_DIR/tmp_gpx` is kept, so the map is always rebuilt from scratch
- snaps the tracks to OpenStreetMap streets (`create_map/osm_surfaces.py`, Overpass API, cached in `DATA_DIR/osm_ways.json`) and draws the parts of the streets that were followed, coloured by surface; off-street and water activities are drawn from the raw GPS
- writes `assets/data/all_routes.geojson`, `map_info.json` (km per surface) and `activity_stats.json` (per year and total)

```
python create_map/update_routes.py             # Garmin + rebuild
python create_map/update_routes.py --offline   # rebuild from the local cache only
```
Specify `GARMIN_EMAIL`, `GARMIN_PASS` and `DATA_DIR` in `create_map/.env`.

---


### External Libraries
- Framework: [Jekyll](http://jekyllrb.com/)
- CSS
  - [Skeleton](getskeleton.com)
  - Tabs: [Skeleton Tabs](https://github.com/nathancahill/skeleton-tabs)
  - Experience: [Timeline](https://codepen.io/NilsWe/pen/FemfK)
  - Icons: [Font Awesome](http://fontawesome.io/)
- JS
  - [Jquery (3.1.1)](https://jquery.com/)


## Updates guide
Change files `_data`, unless you are changing the look of the website.
Test changes with:

```
jekyll serve
```
Push to the ML web directory:
```
rm -rf public_html
mkdir public_html
```
```
./__deploy.sh
```