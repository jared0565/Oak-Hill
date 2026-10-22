"""Derive the small images from the generated photographs.

The photographs are 1024px JPEGs. The pages draw them at 380-580 CSS pixels,
so shipping the full-size JPEG costs every visitor three to four times the
pixels they can see, and the menu draws 1024px images into 120px squares.

This tool writes two kinds of derived file:

  * the square menu thumbnails -- the source cropped to its largest centred
    square (what CSS object-fit: cover does) and resized to 240x240;
  * the WebP renditions -- the SAME pixels at a smaller size, no re-crop, so
    a page can pick one with srcset.

    python tools/build-image-variants.py

Both this tool and tools/build-image-manifest.mjs read the same declaration in
tools/brand/photos.json, so the files on disk and the manifest cannot drift.
The JPEG originals are kept: they are the fallback for a browser without WebP,
and the 1024px rendition is still the right choice on a 3x display.
"""

import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - the tool cannot run without Pillow
    sys.exit("Pillow is required: pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
SPEC_PATH = ROOT / "tools" / "brand" / "photos.json"
OUT_DIR = ROOT / "public" / "assets" / "images" / "generated"

RESAMPLE = Image.Resampling.LANCZOS


def centre_square(im):
    """The crop CSS object-fit: cover makes in a square box."""
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return im.crop((left, top, left + side, top + side))


def as_rgb(im):
    # Nothing here needs an alpha channel, and WebP would carry one.
    return im.convert("RGB") if im.mode in ("RGBA", "LA", "P") else im


def build_thumbnails(spec) -> int:
    thumbs = spec.get("thumbnails")
    if not thumbs or not thumbs.get("files"):
        return 0
    jpeg = thumbs.get("jpeg", {})
    webp = thumbs.get("webp", {})

    # The 1x size, and the 2x size beside it for a high-density display. The
    # 2x file name is the 1x name with the width in it, so the two are
    # obviously a pair: menu-x-thumb.jpg and menu-x-thumb-480.jpg.
    sizes = [(thumbs.get("width", 240), thumbs.get("height", 240))]
    if thumbs.get("width2x"):
        sizes.append((thumbs["width2x"], thumbs.get("height2x", thumbs["width2x"])))

    written = 0
    for entry in thumbs["files"]:
        source = OUT_DIR / entry["source"]
        if not source.exists():
            sys.exit(f"photos.json lists {entry['source']}, but it is not in {OUT_DIR}")
        for width, height in sizes:
            with Image.open(source) as original:
                original.load()
                thumb = as_rgb(centre_square(original).resize((width, height), RESAMPLE))
            if width == sizes[0][0]:
                name = entry["file"]
            else:
                stem, _, ext = entry["file"].rpartition(".")
                name = f"{stem}-{width}.{ext}"
            target = OUT_DIR / name
            if entry["format"] == "jpeg":
                thumb.save(target, "JPEG", **jpeg)
            else:
                thumb.save(target, "WEBP", **webp)
            written += 1
    return written


def build_webp_variants(spec) -> int:
    variants = spec.get("webpVariants")
    if not variants:
        return 0
    quality = variants.get("quality", 80)
    method = variants.get("method", 6)
    widths = variants.get("widths", [])

    written = 0
    for source_name in variants.get("sources", []):
        source = OUT_DIR / source_name
        if not source.exists():
            sys.exit(f"photos.json lists {source_name}, but it is not in {OUT_DIR}")

        with Image.open(source) as original:
            original.load()
            src_w, src_h = original.size
            for width in widths:
                if width > src_w:
                    continue
                height = round(src_h * width / src_w)
                resized = as_rgb(original.resize((width, height), RESAMPLE))
                name = f"{source.stem}-{width}.webp"
                resized.save(OUT_DIR / name, "WEBP", quality=quality, method=method)
                written += 1
    return written


def main() -> int:
    spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    thumbs = build_thumbnails(spec)
    variants = build_webp_variants(spec)
    print(f"✓ {thumbs} thumbnails, {variants} WebP renditions in {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
