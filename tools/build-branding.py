"""Derive web assets from the supplied official raster; never redraw the logo.

Usage: python tools/build-branding.py path/to/logo-edunitynow.png
Requires Pillow. Original colored pixels are preserved before size reduction.
"""
from pathlib import Path
import argparse
import hashlib
import json
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
VERSION = "20261022-official-branding-v1"


def transparent_art(source):
    art = source.convert("RGBA")
    pixels = []
    for r, g, b, a in art.getdata():
        # Remove only the neutral near-white canvas, not blue/violet artwork.
        pixels.append((r, g, b, 0 if min(r, g, b) > 230 and max(r, g, b) - min(r, g, b) < 30 else a))
    art.putdata(pixels)
    return art


def square(art, size):
    # A small optical safety margin keeps the actual mark large at 16/32 px.
    canvas = Image.new("RGBA", (size, size))
    mark = art.copy()
    mark.thumbnail((round(size * .94), round(size * .94)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return canvas


def clean_symbol_edge(mark):
    # Undo the white matte only on the original 1px silhouette boundary. This
    # avoids a white fringe on dark tabs without recoloring interior gradients.
    alpha = mark.getchannel("A")
    inside = alpha.filter(ImageFilter.MinFilter(3))
    pixels = []
    for (r, g, b, a), core in zip(mark.getdata(), inside.getdata()):
        if a and not core and min(r, g, b):
            opacity = (255 - min(r, g, b)) / 255
            pixels.append(tuple(round((c - 255 * (1-opacity)) / opacity) for c in (r,g,b)) + (round(255 * opacity),))
        else:
            pixels.append((r,g,b,a))
    mark.putdata(pixels)
    return mark


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    original = Image.open(args.source).convert("RGB")
    if original.size != (1254, 1254):
        raise ValueError("Expected the approved 1254 x 1254 official source")
    source_dir = ROOT / "assets" / "branding"
    source_dir.mkdir(parents=True, exist_ok=True)
    # Keep the approved master, so all derivatives remain reproducible.
    original.save(source_dir / "edunity-official-source.png", optimize=True)
    art = transparent_art(original)
    logo = art.crop(art.getbbox())
    logo.save(ROOT / "assets" / "ac-edunity-logo.png", optimize=True)

    # Approved source coordinates: the symbol and wordmark are separate artwork.
    # The letter d and dot of i start before the symbol's lowest central corner;
    # remove those text-only regions rather than clipping that corner.
    mark = art.copy()
    alpha = mark.getchannel("A")
    draw = ImageDraw.Draw(alpha)
    draw.rectangle((0, 949, 1254, 1254), fill=0)
    draw.rectangle((0, 927, 589, 1254), fill=0)
    draw.rectangle((670, 927, 1254, 1254), fill=0)
    mark.putalpha(alpha)
    mark = clean_symbol_edge(mark.crop(mark.getbbox()))
    icon = square(mark, 512)
    icon.save(ROOT / "favicon.png", optimize=True)
    for size in (16, 32, 48, 192):
        square(mark, size).save(ROOT / f"favicon-{size}.png", optimize=True)
    square(mark, 180).save(ROOT / "apple-touch-icon.png", optimize=True)
    icon.save(ROOT / "favicon.ico", sizes=[(16,16), (32,32), (48,48), (64,64), (128,128), (256,256)])

    # The old social preview was not a decodable WebP. Keep its established URL,
    # 1200x630 dimensions and brand palette, with the new approved artwork.
    preview = Image.new("RGB", (1200, 630))
    pixels = preview.load()
    for y in range(630):
        for x in range(1200):
            t = x / 1199
            glow = max(0, 1 - (((x-1010)/720)**2 + ((y-90)/700)**2))
            pixels[x,y] = (round(14+25*t+14*glow), round(22+12*(1-t)+15*glow), round(57+41*t+36*glow))
    d = ImageDraw.Draw(preview)
    d.rounded_rectangle((68, 110, 374, 520), radius=28, fill="white")
    lockup = logo.copy()
    lockup.thumbnail((254, 354), Image.Resampling.LANCZOS)
    preview.paste(lockup, (221-lockup.width//2, 315-lockup.height//2), lockup)
    font_dir = Path("C:/Windows/Fonts")
    bold = ImageFont.truetype(str(font_dir / "arialbd.ttf"), 66)
    normal = ImageFont.truetype(str(font_dir / "arial.ttf"), 31)
    small = ImageFont.truetype(str(font_dir / "arial.ttf"), 27)
    d.text((435, 190), "AC Edunity", font=bold, fill="#ffffff")
    d.text((439, 292), "Plataforma educativa", font=normal, fill="#e3e8ff")
    d.text((439, 336), "inteligente", font=normal, fill="#e3e8ff")
    d.text((439, 444), "edunity.me", font=small, fill="#8ddcfa")
    preview.save(ROOT / "assets" / "og-image.webp", quality=92, method=6)
    print(json.dumps({"version":VERSION,"source_sha256":hashlib.sha256(args.source.read_bytes()).hexdigest(),
                      "logo_size":logo.size,"symbol_size":mark.size,"favicon":512,"social":[1200,630]}, indent=2))


if __name__ == "__main__":
    main()
