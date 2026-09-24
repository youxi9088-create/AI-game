"""Normalize generated character cutouts to the single-pose composition expected by the UI.

Some image workflows return a role sheet (a full-body pose plus several action
poses) even when a resource asks for a lobby or table standee.  Alpha repair
cannot fix that semantic error.  This helper detects connected alpha regions,
selects one suitable hero region, and pads it on a transparent 4:5 canvas.
It is intentionally deterministic so the same asset does not change between
server restarts or re-materialization.
"""

from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


def components(mask: np.ndarray) -> list[tuple[int, int, int, int, int]]:
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    found = []
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or seen[y, x]:
                continue
            q = deque([(x, y)])
            seen[y, x] = True
            min_x = max_x = x
            min_y = max_y = y
            count = 0
            while q:
                px, py = q.popleft()
                count += 1
                min_x = min(min_x, px)
                max_x = max(max_x, px)
                min_y = min(min_y, py)
                max_y = max(max_y, py)
                for nx, ny in ((px - 1, py), (px + 1, py), (px, py - 1), (px, py + 1),
                               (px - 1, py - 1), (px + 1, py - 1), (px - 1, py + 1), (px + 1, py + 1)):
                    if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((nx, ny))
            found.append((count, min_x, min_y, max_x + 1, max_y + 1))
    return found


def choose_bbox(image: Image.Image, mode: str) -> tuple[int, int, int, int] | None:
    rgba = image.convert("RGBA")
    alpha = np.asarray(rgba.getchannel("A"), dtype=np.uint8)
    ys, xs = np.where(alpha >= 24)
    if len(xs) == 0:
        return None
    # Work at a small fixed scale so the component choice is stable and fast.
    small_w = 240
    small_h = max(1, round(alpha.shape[0] * small_w / alpha.shape[1]))
    small = rgba.getchannel("A").resize((small_w, small_h), Image.Resampling.BILINEAR)
    mask = np.asarray(small, dtype=np.uint8) >= 24
    comps = [c for c in components(mask) if c[0] >= 45]
    if len(comps) <= 1:
        return None
    sx = alpha.shape[1] / small_w
    sy = alpha.shape[0] / small_h
    candidates = []
    for count, x0, y0, x1, y1 in comps:
        width = x1 - x0
        height = y1 - y0
        ratio = width / max(height, 1)
        area = width * height
        # A single portrait crop is broad/compact; the full-body sheet cell is
        # deliberately tall and is selected only for the master resource.
        candidates.append({
            "count": count, "x0": x0, "y0": y0, "x1": x1, "y1": y1,
            "ratio": ratio, "area": area,
        })
    if mode == "master":
        picked = max(candidates, key=lambda c: (c["area"], c["count"]))
    else:
        compact = [c for c in candidates if 0.42 <= c["ratio"] <= 1.7 and c["area"] >= small_w * small_h * 0.025]
        picked = max(compact or candidates, key=lambda c: (c["area"], c["count"]))
    # Convert back to source pixels and add a restrained breathing margin.
    x0 = max(0, int(picked["x0"] * sx) - int(28 * sx))
    y0 = max(0, int(picked["y0"] * sy) - int(28 * sy))
    x1 = min(alpha.shape[1], int(picked["x1"] * sx) + int(28 * sx))
    y1 = min(alpha.shape[0], int(picked["y1"] * sy) + int(28 * sy))
    return x0, y0, x1, y1


def normalize(source: Path, target: Path, mode: str) -> None:
    image = Image.open(source).convert("RGBA")
    bbox = choose_bbox(image, mode)
    if bbox is None:
        output = image
    else:
        crop = image.crop(bbox)
        # UI contracts use a 4:5 portrait frame for both the lobby and table.
        # Keep the master portrait slightly taller but still a single figure.
        canvas_w, canvas_h = (1024, 1280) if mode != "master" else (1200, 1600)
        scale = min(canvas_w / crop.width, canvas_h / crop.height)
        resized = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))), Image.Resampling.LANCZOS)
        output = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        output.alpha_composite(resized, ((canvas_w - resized.width) // 2, (canvas_h - resized.height) // 2))
    target.parent.mkdir(parents=True, exist_ok=True)
    output.save(target, format="PNG", optimize=True)


def main() -> int:
    if len(sys.argv) != 4 or sys.argv[3] not in {"master", "standee"}:
        print("usage: normalize-character-composition.py SOURCE.png TARGET.png master|standee", file=sys.stderr)
        return 2
    normalize(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
