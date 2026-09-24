"""Convert a provider RGB image with a neutral edge matte into RGBA.

The image providers sometimes return a black/white matte even when the
workflow asks for transparency.  This is deliberately conservative: only a
neutral region connected to the canvas edge is removed, so dark clothing and
hair that are separated from the edge remain intact.
"""
from collections import deque
from pathlib import Path
import sys

import numpy as np
from PIL import Image


def edge_connected(mask: np.ndarray) -> np.ndarray:
    height, width = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    queue = deque()

    for x in range(width):
        if mask[0, x]:
            seen[0, x] = True
            queue.append((0, x))
        if mask[height - 1, x] and not seen[height - 1, x]:
            seen[height - 1, x] = True
            queue.append((height - 1, x))
    for y in range(height):
        if mask[y, 0] and not seen[y, 0]:
            seen[y, 0] = True
            queue.append((y, 0))
        if mask[y, width - 1] and not seen[y, width - 1]:
            seen[y, width - 1] = True
            queue.append((y, width - 1))

    while queue:
        y, x = queue.popleft()
        for next_y, next_x in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= next_y < height and 0 <= next_x < width and mask[next_y, next_x] and not seen[next_y, next_x]:
                seen[next_y, next_x] = True
                queue.append((next_y, next_x))
    return seen


def connected_to_transparent(candidate: np.ndarray, transparent: np.ndarray) -> np.ndarray:
    """Find a neutral matte that touches an existing transparent canvas.

    Some providers return a nominal RGBA PNG, but leave an opaque white island
    between crossed hands or under hair.  It is not edge-connected, so the
    original matte repair cannot see it.  Starting from *all* transparent
    pixels lets us remove only neutral, low-chroma pixels that are connected to
    the already proven background; skin and coloured clothing are excluded.
    """
    height, width = candidate.shape
    seen = np.zeros_like(candidate, dtype=bool)
    queue = deque()
    seeds = np.argwhere(transparent)
    for y, x in seeds:
        y, x = int(y), int(x)
        if candidate[y, x]:
            seen[y, x] = True
            queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for next_y, next_x in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= next_y < height and 0 <= next_x < width and candidate[next_y, next_x] and not seen[next_y, next_x]:
                seen[next_y, next_x] = True
                queue.append((next_y, next_x))
    return seen


def large_components(mask: np.ndarray, minimum_area: int) -> np.ndarray:
    """Keep only sizeable 4-connected components.

    This is an opt-in last-mile cleanup for a known provider failure: a white
    card-shaped island remains inside a otherwise-valid alpha canvas.  Tiny
    specular highlights must never become transparent.
    """
    height, width = mask.shape
    kept = np.zeros_like(mask, dtype=bool)
    seen = np.zeros_like(mask, dtype=bool)
    for start_y, start_x in np.argwhere(mask):
        start_y, start_x = int(start_y), int(start_x)
        if seen[start_y, start_x]:
            continue
        queue = deque([(start_y, start_x)])
        seen[start_y, start_x] = True
        points = []
        while queue:
            y, x = queue.popleft()
            points.append((y, x))
            for next_y, next_x in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= next_y < height and 0 <= next_x < width and mask[next_y, next_x] and not seen[next_y, next_x]:
                    seen[next_y, next_x] = True
                    queue.append((next_y, next_x))
        if len(points) >= minimum_area:
            ys, xs = zip(*points)
            kept[ys, xs] = True
    return kept


def repair(source: Path, target: Path, remove_large_white_islands: bool = False) -> None:
    image = Image.open(source).convert("RGBA")
    rgba = np.asarray(image).copy()
    rgb = rgba[..., :3]
    maximum = rgb.max(axis=2)
    minimum = rgb.min(axis=2)
    chroma = maximum - minimum

    original_alpha = rgba[..., 3].copy()
    corner_pixels = np.stack((rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]))
    corner_luma = float(corner_pixels.mean())
    if corner_luma < 96:
        candidate = (maximum <= 28) & (chroma <= 12)
        fringe = (maximum <= 64) & (chroma <= 22)
    else:
        # Generated white mattes are often softly shaded at the arm/torso
        # gap, so a pure-white threshold leaves a visible white plate there.
        # This remains neutral-only and edge-connected, preserving warm skin
        # and coloured costume details while accepting the matte's grey rim.
        candidate = (minimum >= 145) & (chroma <= 52)
        fringe = (minimum >= 105) & (chroma <= 68)

    background = edge_connected(candidate)
    # A few image providers composite the subject onto a black full canvas,
    # then leave a separate *white* rectangle in negative spaces such as the
    # arm-to-torso gap.  The first pass correctly keys only the outer black
    # canvas, but those white islands are not edge-connected in the original
    # raster.  After the outer canvas is proven background, we can safely
    # flood only bright, near-neutral pixels that touch that newly discovered
    # background.  This is intentionally not a global white key: white
    # clothes/highlights enclosed by the silhouette stay opaque.
    if corner_luma < 96:
        inner_white_matte = (minimum >= 228) & (chroma <= 24)
        background |= connected_to_transparent(inner_white_matte, background)
    # A pre-keyed PNG can have transparent corners (usually stored with black
    # RGB), while a white plate remains inside the silhouette.  Merge only a
    # bright neutral component that touches that existing transparent canvas.
    # This addresses the common crossed-hands white island without eroding
    # warm skin tones or coloured props.
    has_transparent_canvas = float((original_alpha <= 4).mean()) > 0.02
    if has_transparent_canvas:
        pale_neutral = (minimum >= 185) & (chroma <= 30)
        background |= connected_to_transparent(pale_neutral, original_alpha <= 4)
        # Only a human-confirmed cleanup may use this stronger pass.  It is
        # deliberately opt-in because a character can legitimately wear white.
        if remove_large_white_islands:
            opaque_white = (original_alpha >= 240) & (minimum >= 242) & (chroma <= 18)
            background |= large_components(opaque_white, minimum_area=512)
    removed_ratio = float(background.mean())
    if removed_ratio < 0.02 or removed_ratio > 0.97:
        raise RuntimeError(f"edge matte is not reliable (removed={removed_ratio:.3f})")

    # Do not make this a binary mask.  A white source matte has already been
    # mixed into the antialiased pixels around hair, ears and shoulders.  The
    # former one-ring mask set those pixels to alpha=96 but left their white
    # RGB values untouched, which looks like a glowing white outline on the
    # dark casino scene.  Grow a short, conservative soft edge and remove the
    # known canvas colour from every semi-transparent pixel afterwards.
    alpha = original_alpha.copy() if has_transparent_canvas else np.full(background.shape, 255, dtype=np.uint8)
    alpha[background] = 0
    rings = [(72, background)]
    for opacity, previous in ((150, background), (220, None)):
        if previous is None:
            previous = rings[-1][1]
        neighbour = np.zeros_like(background)
        neighbour[1:, :] |= previous[:-1, :]
        neighbour[:-1, :] |= previous[1:, :]
        neighbour[:, 1:] |= previous[:, :-1]
        neighbour[:, :-1] |= previous[:, 1:]
        ring = neighbour & ~background & fringe
        alpha[ring] = np.minimum(alpha[ring], opacity)
        rings.append((opacity, ring | previous))

    # Estimate the flat matte from the four corners and un-premultiply it from
    # soft pixels.  Transparent RGB is cleared as well: some renderers sample
    # it at scaled edges and otherwise reintroduce a pale fringe.
    matte = np.median(corner_pixels.astype(np.float32), axis=0)
    soft = (alpha > 0) & (alpha < 255)
    coverage = alpha[soft].astype(np.float32)[:, None] / 255.0
    repaired = (rgb[soft].astype(np.float32) - matte * (1.0 - coverage)) / np.maximum(coverage, 1e-4)
    rgb[soft] = np.clip(np.rint(repaired), 0, 255).astype(np.uint8)
    rgb[alpha == 0] = 0
    rgba[..., 3] = alpha
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(target, format="PNG")
    print(f"removed_edge_ratio={removed_ratio:.4f}")


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        raise SystemExit("usage: repair-opaque-alpha.py INPUT OUTPUT [--remove-large-white-islands]")
    repair(Path(sys.argv[1]), Path(sys.argv[2]), "--remove-large-white-islands" in sys.argv[3:])
