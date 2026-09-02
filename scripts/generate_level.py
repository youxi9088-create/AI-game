import json
from collections import Counter, defaultdict, deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'public' / 'ling-ling-garden.png'
OUTPUT = ROOT / 'public' / 'ling-ling-level.json'
GRID_WIDTH = 160
GRID_HEIGHT = 120
CANVAS_WIDTH = 640
CANVAS_HEIGHT = 480
COLORS = 16
MIN_REGION_SIZE = 26


def find_components(labels: np.ndarray):
    height, width = labels.shape
    visited = np.zeros_like(labels, dtype=bool)
    components = []
    for y in range(height):
        for x in range(width):
            if visited[y, x]:
                continue
            color = int(labels[y, x])
            visited[y, x] = True
            queue = deque([(x, y)])
            cells = []
            while queue:
                current_x, current_y = queue.popleft()
                cells.append((current_x, current_y))
                for next_x, next_y in ((current_x - 1, current_y), (current_x + 1, current_y), (current_x, current_y - 1), (current_x, current_y + 1)):
                    if 0 <= next_x < width and 0 <= next_y < height and not visited[next_y, next_x] and labels[next_y, next_x] == color:
                        visited[next_y, next_x] = True
                        queue.append((next_x, next_y))
            components.append((color, cells))
    return components


def merge_tiny_regions(labels: np.ndarray):
    height, width = labels.shape
    for _ in range(4):
        changed = False
        for color, cells in find_components(labels):
            if len(cells) >= MIN_REGION_SIZE:
                continue
            neighbours = Counter()
            for x, y in cells:
                for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= next_x < width and 0 <= next_y < height and labels[next_y, next_x] != color:
                        neighbours[int(labels[next_y, next_x])] += 1
            if neighbours:
                replacement, _ = neighbours.most_common(1)[0]
                for x, y in cells:
                    labels[y, x] = replacement
                changed = True
        if not changed:
            break
    return labels


def component_path(cells):
    by_row = defaultdict(list)
    for x, y in cells:
        by_row[y].append(x)
    scale_x = CANVAS_WIDTH / GRID_WIDTH
    scale_y = CANVAS_HEIGHT / GRID_HEIGHT
    commands = []
    for y, xs in by_row.items():
        xs.sort()
        run_start = xs[0]
        previous = xs[0]
        for x in xs[1:] + [None]:
            if x is not None and x == previous + 1:
                previous = x
                continue
            x0 = run_start * scale_x
            y0 = y * scale_y
            run_width = (previous - run_start + 1) * scale_x
            commands.append(f'M{x0:.2f} {y0:.2f}h{run_width:.2f}v{scale_y:.2f}h{-run_width:.2f}z')
            if x is not None:
                run_start = x
                previous = x
    return ''.join(commands)


def label_position(cells):
    centre_x = sum(x for x, _ in cells) / len(cells)
    centre_y = sum(y for _, y in cells) / len(cells)
    x, y = min(cells, key=lambda cell: (cell[0] - centre_x) ** 2 + (cell[1] - centre_y) ** 2)
    return {'x': round((x + .5) * CANVAS_WIDTH / GRID_WIDTH, 2), 'y': round((y + .5) * CANVAS_HEIGHT / GRID_HEIGHT + 5, 2)}


def main() -> None:
    original = Image.open(SOURCE).convert('RGB')
    fitted = ImageOps.fit(original, (GRID_WIDTH, GRID_HEIGHT), method=Image.Resampling.LANCZOS, centering=(.5, .5))
    smooth = fitted.filter(ImageFilter.GaussianBlur(radius=1.15))
    quantized = smooth.quantize(colors=COLORS, method=Image.Quantize.MEDIANCUT)
    palette_data = quantized.getpalette()
    labels = np.array(quantized, dtype=np.uint8)
    labels = np.array(Image.fromarray(labels).filter(ImageFilter.ModeFilter(size=5)), dtype=np.uint8)
    labels = merge_tiny_regions(labels)

    used_colors = sorted(int(value) for value in np.unique(labels))
    color_index = {value: index for index, value in enumerate(used_colors)}
    palette = [f'#{palette_data[value * 3]:02x}{palette_data[value * 3 + 1]:02x}{palette_data[value * 3 + 2]:02x}' for value in used_colors]
    regions = []
    for region_number, (color, cells) in enumerate(find_components(labels), start=1):
        regions.append({
            'id': f'garden-region-{region_number}',
            'color': color_index[color],
            'shape': {'kind': 'path', 'd': component_path(cells)},
            'label': label_position(cells),
        })

    OUTPUT.write_text(json.dumps({'palette': palette, 'regions': regions, 'viewBox': f'0 0 {CANVAS_WIDTH} {CANVAS_HEIGHT}'}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'generated {len(regions)} regions across {len(palette)} colours')


if __name__ == '__main__':
    main()
