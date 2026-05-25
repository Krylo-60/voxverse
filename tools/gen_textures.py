"""
=============================================================
  Voxverse — Pixel Art Texture Sheet Generator
  tools/gen_textures.py
  ──────────────────────────────────────────────
  Generates PNG texture images for every block type using the
  Pillow library.  Outputs to  public/textures/

  Usage
  -----
      python tools/gen_textures.py           # generate all textures
      python tools/gen_textures.py --size 32 # 32×32 pixel textures
      python tools/gen_textures.py --list    # list available textures

  Requires
  --------
      pip install Pillow
=============================================================
"""

import argparse
import os
import random
import math
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False


# ─────────────────────────────────────────────────────────────
#  Texture Definitions
#  Each texture is defined as a lambda that receives:
#    (draw: ImageDraw, size: int, rng: random.Random)
#  and draws the texture onto the image.
# ─────────────────────────────────────────────────────────────

def _noise_fill(draw, size, base_color, variation=20, rng=None):
    """Fill with a noisy solid colour (like Minecraft pixel noise)."""
    r, g, b = base_color
    if rng is None:
        rng = random.Random(42)
    for py in range(size):
        for px in range(size):
            v = rng.randint(-variation, variation)
            cr = max(0, min(255, r + v))
            cg = max(0, min(255, g + v))
            cb = max(0, min(255, b + v))
            draw.point((px, py), fill=(cr, cg, cb))


def tex_grass_top(img, size, rng):
    draw = ImageDraw.Draw(img)
    _noise_fill(draw, size, (76, 153, 0), variation=18, rng=rng)
    # Random darker grass blades
    for _ in range(size * 2):
        x = rng.randint(0, size - 1)
        y = rng.randint(0, size - 1)
        draw.point((x, y), fill=(30, 100, 0))


def tex_dirt(img, size, rng):
    draw = ImageDraw.Draw(img)
    _noise_fill(draw, size, (134, 96, 67), variation=22, rng=rng)
    # Dark pebble speckles
    for _ in range(size // 2):
        x = rng.randint(1, size - 2)
        y = rng.randint(1, size - 2)
        draw.rectangle([x, y, x+1, y+1], fill=(80, 55, 35))


def tex_stone(img, size, rng):
    draw = ImageDraw.Draw(img)
    _noise_fill(draw, size, (128, 128, 128), variation=15, rng=rng)
    # Crack lines
    for _ in range(3):
        x1, y1 = rng.randint(0, size-1), rng.randint(0, size-1)
        x2, y2 = x1 + rng.randint(-8, 8), y1 + rng.randint(-8, 8)
        draw.line([x1, y1, x2, y2], fill=(80, 80, 80), width=1)


def tex_wood(img, size, rng):
    draw = ImageDraw.Draw(img)
    # Bark base colour
    _noise_fill(draw, size, (105, 75, 45), variation=12, rng=rng)
    # Vertical grain lines
    for x in range(0, size, rng.randint(3, 5)):
        darkness = rng.randint(15, 30)
        for y in range(size):
            px = img.getpixel((x, y))
            draw.point((x, y), fill=tuple(max(0, c - darkness) for c in px))


def tex_leaves(img, size, rng):
    draw = ImageDraw.Draw(img)
    _noise_fill(draw, size, (40, 130, 30), variation=25, rng=rng)
    # Leaf patches (lighter)
    for _ in range(size):
        x, y = rng.randint(0, size - 3), rng.randint(0, size - 3)
        c = (60 + rng.randint(0, 40), 170 + rng.randint(0, 30), 40)
        draw.rectangle([x, y, x+2, y+2], fill=c)


def tex_water(img, size, rng):
    draw = ImageDraw.Draw(img)
    _noise_fill(draw, size, (30, 100, 200), variation=20, rng=rng)
    # Ripple highlights
    for i in range(size // 4):
        y = rng.randint(0, size - 1)
        x = rng.randint(0, size - 5)
        draw.line([x, y, x + rng.randint(3, 8), y], fill=(100, 180, 255), width=1)


def tex_sand(img, size, rng):
    draw = ImageDraw.Draw(img)
    _noise_fill(draw, size, (220, 200, 130), variation=18, rng=rng)
    # Fine grain dots
    for _ in range(size * 3):
        x, y = rng.randint(0, size-1), rng.randint(0, size-1)
        draw.point((x, y), fill=(180, 160, 100))


def tex_crystal(img, size, rng):
    draw = ImageDraw.Draw(img)
    _noise_fill(draw, size, (150, 0, 200), variation=30, rng=rng)
    # Bright facets
    for _ in range(size // 2):
        x, y = rng.randint(0, size-3), rng.randint(0, size-3)
        draw.rectangle([x, y, x+2, y+2], fill=(220, 100, 255))
    # Glint lines
    for _ in range(4):
        cx, cy = rng.randint(4, size-4), rng.randint(4, size-4)
        draw.line([cx-3, cy, cx+3, cy], fill=(255, 220, 255), width=1)
        draw.line([cx, cy-3, cx, cy+3], fill=(255, 220, 255), width=1)


def tex_torch(img, size, rng):
    draw = ImageDraw.Draw(img)
    _noise_fill(draw, size, (80, 50, 20), variation=10, rng=rng)
    # Flame top area
    for py in range(size // 3):
        for px in range(size // 3, 2 * size // 3):
            t  = 1.0 - py / (size / 3)
            r  = int(255 * t)
            g  = int(160 * t)
            draw.point((px, py), fill=(r, g, 0))


def tex_coal(img, size, rng):
    draw = ImageDraw.Draw(img)
    _noise_fill(draw, size, (50, 50, 55), variation=12, rng=rng)
    # Dark coal ore patches
    for _ in range(size // 3):
        x, y = rng.randint(1, size-3), rng.randint(1, size-3)
        w, h = rng.randint(2, 4), rng.randint(2, 4)
        draw.rectangle([x, y, x+w, y+h], fill=(15, 15, 20))


def tex_iron(img, size, rng):
    draw = ImageDraw.Draw(img)
    _noise_fill(draw, size, (140, 130, 120), variation=15, rng=rng)
    # Iron ore veins
    for _ in range(size // 4):
        x, y = rng.randint(1, size-3), rng.randint(1, size-3)
        draw.rectangle([x, y, x+2, y+2], fill=(190, 170, 140))
    # Metallic sheen
    for px in range(0, size, 6):
        draw.line([px, 0, px+2, size], fill=(170, 160, 155), width=1)


TEXTURE_DEFS = {
    "grass_top": tex_grass_top,
    "dirt":      tex_dirt,
    "stone":     tex_stone,
    "wood":      tex_wood,
    "leaves":    tex_leaves,
    "water":     tex_water,
    "sand":      tex_sand,
    "crystal":   tex_crystal,
    "torch":     tex_torch,
    "coal":      tex_coal,
    "iron":      tex_iron,
}


# ─────────────────────────────────────────────────────────────
#  Generator
# ─────────────────────────────────────────────────────────────

def generate_texture(name: str, size: int = 64, seed: int = 42) -> "Image":
    """Generate a single block texture and return a PIL Image."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 255))
    rng = random.Random(seed + hash(name))
    TEXTURE_DEFS[name](img, size, rng)
    return img


def generate_all(out_dir: str = "public/textures", size: int = 64):
    """Generate all textures and save them to disk."""
    if not PIL_AVAILABLE:
        print("❌  Pillow is not installed.  Run:  pip install Pillow")
        return

    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    print(f"🎨 Generating {len(TEXTURE_DEFS)} textures ({size}×{size}px)  → {out_dir}/")
    for name, fn in TEXTURE_DEFS.items():
        img      = generate_texture(name, size)
        filename = out_path / f"{name}.png"
        img.save(filename)
        print(f"   ✓  {name}.png  ({filename.stat().st_size} bytes)")

    # Also generate a texture atlas (all in one row)
    atlas_w = size * len(TEXTURE_DEFS)
    atlas   = Image.new("RGBA", (atlas_w, size), (0, 0, 0, 0))
    for i, name in enumerate(TEXTURE_DEFS):
        img = generate_texture(name, size)
        atlas.paste(img, (i * size, 0))
    atlas_path = out_path / "atlas.png"
    atlas.save(atlas_path)
    print(f"\n   📦 Atlas: atlas.png  ({atlas_w}×{size})")

    print(f"\n✅ All textures saved to  {out_dir}/")


# ─────────────────────────────────────────────────────────────
#  CLI
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Voxverse texture generator")
    parser.add_argument("--size",   type=int, default=64,
                        help="Texture size in pixels (e.g. 16, 32, 64)")
    parser.add_argument("--output", type=str, default="public/textures",
                        help="Output directory for PNG files")
    parser.add_argument("--list",   action="store_true",
                        help="List available textures and exit")
    args = parser.parse_args()

    if args.list:
        print("Available textures:")
        for n in TEXTURE_DEFS:
            print(f"  • {n}")
    else:
        generate_all(out_dir=args.output, size=args.size)
