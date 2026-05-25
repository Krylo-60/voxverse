"""
=============================================================
  Voxverse — Procedural Terrain / Map Seed Exporter
  tools/gen_map.py
  ─────────────────────────────────────────────────
  Generates a JSON world-seed file that the frontend can load
  for reproducible terrain.  Uses pure-math simplex noise —
  no external noise libraries required.

  Usage
  -----
      python tools/gen_map.py                          # default seed 4242
      python tools/gen_map.py --seed 9999 --size 64   # custom
      python tools/gen_map.py --output public/map.json

  Output format
  -------------
  {
    "seed": 4242,
    "size": 32,
    "heightmap": [[h00, h01, ...], [h10, ...], ...],
    "biomes":    [["forest", ...], ...],
    "structures": [ {"type": "tree", "x": 5, "z": 8}, ... ]
  }
=============================================================
"""

import json
import math
import random
import argparse
import os

# ─────────────────────────────────────────────────────────────
#  Minimal pure-Python 2D Simplex Noise
# ─────────────────────────────────────────────────────────────

def _setup_simplex(seed: int):
    """Build a permutation table from a seed."""
    rng = random.Random(seed)
    perm = list(range(256))
    rng.shuffle(perm)
    return perm + perm   # doubled for easy index wrapping


_GRAD2 = [
    (1, 1), (-1, 1), (1, -1), (-1, -1),
    (1, 0), (-1, 0), (1,  0), (-1,  0),
    (0, 1), ( 0,-1), (0,  1), ( 0, -1),
]

def _dot2(g, x, y):
    return g[0]*x + g[1]*y

def simplex2(perm: list, x: float, y: float) -> float:
    """2D simplex noise in [-1, 1]."""
    F2 = 0.5 * (math.sqrt(3.0) - 1.0)
    G2 = (3.0 - math.sqrt(3.0)) / 6.0

    s  = (x + y) * F2
    i  = math.floor(x + s)
    j  = math.floor(y + s)
    t  = (i + j) * G2
    X0 = i - t
    Y0 = j - t
    x0 = x - X0
    y0 = y - Y0

    if x0 > y0:
        i1, j1 = 1, 0
    else:
        i1, j1 = 0, 1

    x1 = x0 - i1 + G2
    y1 = y0 - j1 + G2
    x2 = x0 - 1.0 + 2.0 * G2
    y2 = y0 - 1.0 + 2.0 * G2

    ii = int(i) & 255
    jj = int(j) & 255

    gi0 = perm[ii +      perm[jj     ]] % 12
    gi1 = perm[ii + i1 + perm[jj + j1]] % 12
    gi2 = perm[ii +  1 + perm[jj +  1]] % 12

    def contrib(gidx, px, py):
        t_ = 0.5 - px*px - py*py
        if t_ < 0:
            return 0.0
        t_ *= t_
        return t_ * t_ * _dot2(_GRAD2[gidx], px, py)

    return 70.0 * (contrib(gi0, x0, y0) +
                   contrib(gi1, x1, y1) +
                   contrib(gi2, x2, y2))


def fbm(perm: list, x: float, y: float,
        octaves: int = 5, persistence: float = 0.5, lacunarity: float = 2.0) -> float:
    """Fractional Brownian Motion — stacks multiple noise octaves."""
    value, amplitude, frequency = 0.0, 1.0, 1.0
    for _ in range(octaves):
        value     += simplex2(perm, x * frequency, y * frequency) * amplitude
        amplitude *= persistence
        frequency *= lacunarity
    return value


# ─────────────────────────────────────────────────────────────
#  Biome Classification
# ─────────────────────────────────────────────────────────────

BIOMES = {
    "ocean":    {"min_h": 0,  "max_h": 4,  "color": "#3b82f6"},
    "beach":    {"min_h": 4,  "max_h": 6,  "color": "#fde68a"},
    "forest":   {"min_h": 6,  "max_h": 12, "color": "#16a34a"},
    "highland": {"min_h": 12, "max_h": 18, "color": "#78716c"},
    "mountain": {"min_h": 18, "max_h": 32, "color": "#e2e8f0"},
}

def classify_biome(h: int) -> str:
    for name, info in BIOMES.items():
        if info["min_h"] <= h < info["max_h"]:
            return name
    return "mountain"


# ─────────────────────────────────────────────────────────────
#  Structure Placement
# ─────────────────────────────────────────────────────────────

def place_structures(heightmap: list[list[int]], biomes: list[list[str]],
                     seed: int) -> list[dict]:
    """Deterministically place trees, crystals, and spawn structures."""
    rng    = random.Random(seed + 7)
    size   = len(heightmap)
    result = []

    for z in range(size):
        for x in range(size):
            biome = biomes[z][x]
            h     = heightmap[z][x]
            rv    = rng.random()

            if biome == "forest" and rv < 0.06:
                result.append({"type": "tree", "x": x, "y": h + 1, "z": z})
            elif biome == "highland" and rv < 0.03:
                result.append({"type": "crystal_vein", "x": x, "y": h, "z": z})
            elif biome == "mountain" and rv < 0.04:
                result.append({"type": "rock_pillar", "x": x, "y": h, "z": z,
                                "height": rng.randint(2, 6)})

    return result


# ─────────────────────────────────────────────────────────────
#  Main Generator
# ─────────────────────────────────────────────────────────────

def generate_map(seed: int = 4242, size: int = 32) -> dict:
    """Generate a complete world-seed map and return it as a dict."""
    print(f"[*] Generating {size}x{size} terrain  (seed={seed})...")

    perm          = _setup_simplex(seed)
    scale         = 0.045
    sea_level     = 5
    height_scale  = 22

    heightmap: list[list[int]] = []
    biomes:    list[list[str]] = []

    for z in range(size):
        h_row, b_row = [], []
        for x in range(size):
            # Multi-octave noise
            nx = x * scale
            nz = z * scale
            raw = fbm(perm, nx, nz, octaves=6, persistence=0.52)

            # Remap [-1,1] → height
            norm  = (raw + 1.0) / 2.0           # 0..1
            h     = int(sea_level + norm * height_scale)
            h     = max(1, min(h, size - 1))

            h_row.append(h)
            b_row.append(classify_biome(h))

        heightmap.append(h_row)
        biomes.append(b_row)

    structures = place_structures(heightmap, biomes, seed)

    # Count biome distribution
    biome_counts: dict[str, int] = {}
    for row in biomes:
        for b in row:
            biome_counts[b] = biome_counts.get(b, 0) + 1

    print("  Biome breakdown:")
    for b, count in sorted(biome_counts.items(), key=lambda x: -x[1]):
        pct = count / (size * size) * 100
        print(f"    {b:12s}: {count:5d} blocks  ({pct:.1f}%)")
    print(f"  Structures placed: {len(structures)}")
    print("[OK] Generation complete.")

    return {
        "seed":       seed,
        "size":       size,
        "heightmap":  heightmap,
        "biomes":     biomes,
        "biome_info": BIOMES,
        "structures": structures,
    }


# ─────────────────────────────────────────────────────────────
#  CLI
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Voxverse terrain generator")
    parser.add_argument("--seed",   type=int, default=4242,               help="World seed integer")
    parser.add_argument("--size",   type=int, default=32,                 help="Map size (NxN blocks)")
    parser.add_argument("--output", type=str, default="public/map.json",  help="Output JSON path")
    args = parser.parse_args()

    world = generate_map(seed=args.seed, size=args.size)

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(world, f, separators=(",", ":"))

    print(f"\n[SAVED] to  {args.output}  ({os.path.getsize(args.output) // 1024} KB)")
