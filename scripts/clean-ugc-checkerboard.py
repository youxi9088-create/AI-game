"""Make the supplied UGC PNGs usable as layered game assets.

The source exports are RGB images with a checkerboard *baked into the pixels*.
Only the bright neutral region connected to the canvas edge is made transparent;
coloured casino background and the character remain untouched.
"""
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "apps" / "web" / "assets" / "pals" / "ugc"
SOURCE_ID = "5fe85ced-2ef0-48ec-af65-90cdf3e0fc82"


def edge_connected_neutral(rgb: np.ndarray) -> np.ndarray:
    spread = rgb.max(axis=2) - rgb.min(axis=2)
    luminance = rgb.mean(axis=2)
    candidate = (spread <= 20) & (luminance >= 170)
    h, w = candidate.shape
    seen = np.zeros_like(candidate, dtype=bool)
    q = deque()
    for x in range(w):
        if candidate[0, x]: q.append((0, x)); seen[0, x] = True
        if candidate[h - 1, x] and not seen[h - 1, x]: q.append((h - 1, x)); seen[h - 1, x] = True
    for y in range(h):
        if candidate[y, 0] and not seen[y, 0]: q.append((y, 0)); seen[y, 0] = True
        if candidate[y, w - 1] and not seen[y, w - 1]: q.append((y, w - 1)); seen[y, w - 1] = True
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and candidate[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    return seen


def clean(name: str) -> None:
    source = ASSET_DIR / f"{SOURCE_ID}-{name}.png"
    target = ASSET_DIR / f"{SOURCE_ID}-{name}-cutout.png"
    image = Image.open(source).convert("RGBA")
    rgb = np.asarray(image)[..., :3]
    transparent = edge_connected_neutral(rgb)
    rgba = np.asarray(image).copy()
    rgba[..., 3][transparent] = 0
    Image.fromarray(rgba, "RGBA").save(target)
    print(f"{target.name}: removed {transparent.mean():.1%} edge-connected checkerboard")


for asset_name in ("master-portrait", "table-standee"):
    clean(asset_name)
