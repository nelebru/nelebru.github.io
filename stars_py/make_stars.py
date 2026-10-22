"""Generates the star tiles for the Milky Way navbar in dark mode (see my_css.css).

The stars are scattered at random within each tile, so unlike CSS gradient dots they
don't line up in rows. Tiles of different, odd sizes are layered on top of each other,
which pushes the visible repeat far out. A fixed seed keeps the output stable.

Run from the repository root:  python stars_py/make_stars.py
"""

import random
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets" / "stars"

# half white, half faintly bluish, warm or violet (the tints of the earlier CSS stars)
COLOURS = [
    ((255, 255, 255), 7),
    ((220, 225, 255), 2),
    ((225, 230, 255), 1),
    ((255, 240, 225), 2),
    ((255, 245, 235), 1),
    ((235, 225, 255), 1),
    ((240, 230, 255), 1),
]

# a few stars are smaller and dimmer: their colour is mixed towards the navbar background
# (so they stay opaque) and their radius shrinks
DIM_SHARE = 0.15
DIM_MIX = 0.5
DIM_SIZE = 0.6
BACKGROUND = (22, 21, 27)

# name: (width, height, number of stars, smallest radius, largest radius)
TILES = {
    "field-a": (701, 229, 170, 0.35, 1.25),
    "field-b": (523, 181, 90, 0.35, 1.1),
    "cluster": (307, 101, 380, 0.3, 0.75),
    "twinkle-a": (887, 233, 8, 1.1, 1.6),
    "twinkle-b": (761, 211, 7, 1.1, 1.5),
    # many tiny stars across the whole navbar
    "field-c": (613, 199, 420, 0.3, 0.6),
}

MARGIN = 2  # keep stars off the tile edges so none is cut in half


def hex_colour(rgb):
    return "#" + "".join(f"{c:02x}" for c in rgb)


def dimmed(rgb):
    return tuple(round(c + (b - c) * DIM_MIX) for c, b in zip(rgb, BACKGROUND))


def gradient(gid, rgb):
    # solid core with a soft rim, like the radial-gradient dots the stars used to be
    c = hex_colour(rgb)
    return (
        f'<radialGradient id="{gid}"><stop offset="0" stop-color="{c}"/>'
        f'<stop offset="0.5" stop-color="{c}"/>'
        f'<stop offset="1" stop-color="{c}" stop-opacity="0"/></radialGradient>'
    )


def tile(rng, width, height, count, r_min, r_max):
    colours, weights = zip(*COLOURS)
    used, circles = {}, []
    for _ in range(count):
        x = rng.uniform(MARGIN, width - MARGIN)
        y = rng.uniform(MARGIN, height - MARGIN)
        # cubed: most stars small, a few bright ones
        r = r_min + (r_max - r_min) * rng.random() ** 3
        rgb = rng.choices(colours, weights)[0]
        if rng.random() < DIM_SHARE:
            rgb, r = dimmed(rgb), r * DIM_SIZE
        gid = used.setdefault(rgb, f"s{len(used)}")
        # the soft rim takes up the outer half, so draw the circle a bit larger
        circles.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r * 1.5:.2f}" fill="url(#{gid})"/>')
    defs = "".join(gradient(gid, rgb) for rgb, gid in used.items())
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}"><defs>{defs}</defs>' + "".join(circles) + "</svg>\n"
    )


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, spec in TILES.items():
        # a seed per tile, so changing one tile leaves the others as they are
        rng = random.Random(f"1987-{name}")
        (OUT / f"{name}.svg").write_text(tile(rng, *spec), encoding="utf-8")
        print(f"wrote {name}.svg")


if __name__ == "__main__":
    main()
