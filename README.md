# Neles Website

Jekyll-based website. 
Contains bio, publications, vita, recipes and my favourite cycling routes.

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


## Parsing GPX files
I wrote a small script to geo reverse code GPX files to get location names, 
to get total distance and elevation gain, and to convert them to JSON format.

You can find it in the `./read_gpx_py` folder. 

Put your GPX files in './assets/gpx_files' folder and run:

```
python parse.py --gpx_dir /path/to/files --output output_file.json
```
Put the output JSON file in the `./assets/data` folder to make them 
appear on the website.


## External Libraries
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
