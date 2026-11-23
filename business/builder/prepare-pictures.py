#!/usr/bin/env python3
"""Gets every product picture ready for the website. One command after adding a picture:

    python3 tools/prepare-pictures.py            # cut out anything new, then make the web versions
    python3 tools/prepare-pictures.py --sheet out.jpg   # also draw a contact sheet of every cut-out on its colour

1. Cut-outs. Each studio render in site/img/branded/<name>.jpg needs a cut-out with a transparent background in
   site/img/cut/<name>.png. Any render without one is cut with tools/cutout.swift (macOS subject lifting).
   Existing cut-outs are never redone: some were made by hand with a better tool because they hold several objects.
2. Web versions. Each cut-out becomes site/img/web/<name>-1280.webp and <name>-640.webp (WebP keeps the
   transparency and is a fraction of the PNG's size). Only redone when the cut-out is newer. A cut-out that touches
   the frame (the bubble wrap's sheet runs off the bottom) is faded out towards that edge so it shows no hard line.

The site build (site/build.mjs) uses the web versions, falls back to the cut-out PNG, then to the original JPG.
Needs Python Pillow with WebP (pip3 install --user pillow) and, for new cut-outs, macOS with Swift.
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "site" / "img"
BRANDED, CUT, WEB = IMG / "branded", IMG / "cut", IMG / "web"
WIDTHS = (1280, 640)
TARGET = 150_000  # bytes: the large version should come in under about this


def cut_new_renders():
    """Cut out any render that has no cut-out yet. Returns the names it made."""
    made = []
    for jpg in sorted(BRANDED.glob("*.jpg")):
        png = CUT / f"{jpg.stem}.png"
        if png.exists():
            continue
        print(f"cutting out {jpg.name} ...")
        r = subprocess.run(["swift", str(ROOT / "tools" / "cutout.swift"), str(jpg), str(png)], capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  could not cut out {jpg.name}: {r.stderr.strip() or r.returncode}. The site will use the JPG.")
        else:
            made.append(jpg.stem)
    return made


def feather_cropped_edges(im):
    """A render cropped by its frame (the bubble wrap's sheet runs off the bottom) would show a hard straight edge
    once it sits on a flat colour. Fade the object out over the last 14% towards any edge it touches."""
    a = im.getchannel("A")
    w, h = a.size
    touches = {
        "top": sum(a.getpixel((x, 0)) > 128 for x in range(0, w, 4)) > 3,
        "bottom": sum(a.getpixel((x, h - 1)) > 128 for x in range(0, w, 4)) > 3,
        "left": sum(a.getpixel((0, y)) > 128 for y in range(0, h, 4)) > 3,
        "right": sum(a.getpixel((w - 1, y)) > 128 for y in range(0, h, 4)) > 3,
    }
    if not any(touches.values()):
        return im
    ramp = Image.new("L", (w, h), 255)
    px = ramp.load()
    fy, fx = int(h * 0.14), int(w * 0.14)
    for y in range(h):
        for x in range(w):
            k = 1.0
            if touches["top"] and y < fy: k = min(k, y / fy)
            if touches["bottom"] and y > h - 1 - fy: k = min(k, (h - 1 - y) / fy)
            if touches["left"] and x < fx: k = min(k, x / fx)
            if touches["right"] and x > w - 1 - fx: k = min(k, (w - 1 - x) / fx)
            if k < 1: px[x, y] = round(255 * k * k * (3 - 2 * k))  # smoothstep: no visible band
    out = im.copy()
    out.putalpha(ImageChops.multiply(a, ramp))
    return out


def save_webp(im, out, width):
    """Resize to `width` and save as WebP with transparency, stepping quality down until it fits the target."""
    h = round(im.height * width / im.width)
    small = im.resize((width, h), Image.LANCZOS) if width != im.width else im
    limit = TARGET if width >= 1280 else TARGET // 3
    for q in (84, 78, 72, 66, 60):
        small.save(out, "WEBP", quality=q, alpha_quality=90, method=6)
        if out.stat().st_size <= limit:
            break
    return out.stat().st_size


def make_web_versions():
    WEB.mkdir(exist_ok=True)
    before = after = 0
    for png in sorted(CUT.glob("*.png")):
        before += png.stat().st_size
        im = None
        for w in WIDTHS:
            out = WEB / f"{png.stem}-{w}.webp"
            if not out.exists() or out.stat().st_mtime < png.stat().st_mtime:
                im = im or feather_cropped_edges(Image.open(png).convert("RGBA"))
                save_webp(im, out, w)
            after += out.stat().st_size
    n = len(list(CUT.glob("*.png")))
    print(f"{n} cut-outs: {before / 1e6:.1f} MB as PNG, {after / 1e6:.1f} MB as WebP (both sizes)")


def ground_of(name, grounds):
    """The page colour for a picture: grounds.json, else the average of the render's border."""
    if name in grounds:
        return grounds[name]
    jpg = BRANDED / f"{name}.jpg"
    if not jpg.exists():
        return "#E9E6E0"
    im = Image.open(jpg).convert("RGB").resize((40, 22))
    px = [im.getpixel((x, y)) for x in range(40) for y in (0, 21)] + [im.getpixel((x, y)) for y in range(22) for x in (0, 39)]
    return "#" + "".join(f"{round(sum(p[i] for p in px) / len(px)):02X}" for i in range(3))


def contact_sheet(path):
    """Every cut-out on its own colour, named, so a bad cut (missing parts, halos) is easy to spot."""
    import json
    gpath = BRANDED / "grounds.json"
    grounds = json.loads(gpath.read_text()) if gpath.exists() else {}
    pngs = sorted(CUT.glob("*.png"))
    cw, ch, cols = 480, 270, 5
    rows = (len(pngs) + cols - 1) // cols
    sheet = Image.new("RGB", (cw * cols, (ch + 24) * rows), "white")
    d = ImageDraw.Draw(sheet)
    for k, png in enumerate(pngs):
        x, y = (k % cols) * cw, (k // cols) * (ch + 24)
        tile = Image.new("RGBA", (cw, ch), ground_of(png.stem, grounds))
        tile.alpha_composite(Image.open(png).convert("RGBA").resize((cw, ch), Image.LANCZOS))
        sheet.paste(tile.convert("RGB"), (x, y))
        d.text((x + 6, y + ch + 5), png.stem, fill="black")
    sheet.save(path, quality=85)
    print(f"contact sheet: {path}")


if __name__ == "__main__":
    made = cut_new_renders()
    if made:
        print(f"new cut-outs: {', '.join(made)}. Look at them on the contact sheet before relying on them.")
    make_web_versions()
    if "--sheet" in sys.argv:
        contact_sheet(sys.argv[sys.argv.index("--sheet") + 1])
