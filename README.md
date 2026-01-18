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

---

## Visited street map 

This script downloads activity routes from **Garmin Connect**, converts them to geospatial line data, and merges them into a **single GeoJSON file** for mapping or visualization.
- Authenticates with Garmin Connect using environment variables
- Supports incremental updates (only new activities since last run) or one-time historical GPX imports
- Filtering of indoor/virtual activities
- Downloads GPX files for supported outdoor activities
- Converts GPX tracks into `LineString` geometries
- Tracks last update time to avoid duplicate processing

```
python update_routes.py
```
Specify parameters in .env. 

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