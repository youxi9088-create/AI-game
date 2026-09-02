"""把彩色图片转换为 Paint by Number 数字填色关卡。"""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


COLOR_COUNT = {'简单': 18, '普通': 32, '困难': 48}
GRID_SIZE = {'简单': (28, 38), '普通': (38, 51), '困难': (48, 64)}


def _crop_white_margin(image: Image.Image) -> Image.Image:
    rgb = np.asarray(image.convert('RGB'))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    content = gray < 245
    ys, xs = np.where(content)
    if not len(xs):
        return image.convert('RGB')
    pad = max(4, round(min(image.size) * .008))
    left, right = max(0, xs.min() - pad), min(image.width, xs.max() + pad + 1)
    top, bottom = max(0, ys.min() - pad), min(image.height, ys.max() + pad + 1)
    return image.convert('RGB').crop((left, top, right, bottom))


def _hex(color: np.ndarray) -> str:
    return '#%02X%02X%02X' % tuple(int(value) for value in color)


def generate_number_art_level(source_path, out_dir, level_id: str, title: str, difficulty: str = '困难', category: str = '世界名画', progress=None):
    def report(step_id: str, message: str):
        if progress:
            progress(step_id, 'running', message)

    difficulty = difficulty if difficulty in COLOR_COUNT else '困难'
    output = Path(out_dir)
    output.mkdir(parents=True, exist_ok=True)
    report('prepare', '正在读取图片并检测白边')
    with Image.open(source_path) as source_image:
        image = _crop_white_margin(source_image.copy())
    report('crop', '已裁掉留白并统一画布尺寸')
    width = min(image.width, 900)
    height = max(1, round(image.height * width / image.width))
    image = image.resize((width, height), Image.Resampling.LANCZOS)
    rgb = np.asarray(image, dtype=np.uint8)

    report('palette', f'正在提取 {COLOR_COUNT[difficulty]} 种专属颜色')
    pixels = rgb.reshape(-1, 3).astype(np.float32)
    sample_step = max(1, len(pixels) // 48000)
    samples = pixels[::sample_step]
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, .45)
    _, _, centers = cv2.kmeans(samples, COLOR_COUNT[difficulty], None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    centers = np.clip(np.round(centers), 0, 255).astype(np.uint8)
    # 按明暗稳定排序，让数字与颜色编号在每次生成中一致。
    order = np.argsort(centers @ np.array([.2126, .7152, .0722]))
    centers = centers[order]
    palette = [_hex(color) for color in centers]

    columns, rows = GRID_SIZE[difficulty]
    report('pixelize', f'正在生成 {columns} × {rows} 个可点击数字色块')
    cells: list[int] = []
    preview = np.zeros_like(rgb)
    for row in range(rows):
        y0, y1 = round(row * height / rows), round((row + 1) * height / rows)
        for column in range(columns):
            x0, x1 = round(column * width / columns), round((column + 1) * width / columns)
            average = rgb[y0:y1, x0:x1].reshape(-1, 3).mean(axis=0)
            distance = np.square(centers.astype(np.float32) - average).sum(axis=1)
            color_index = int(distance.argmin())
            cells.append(color_index)
            preview[y0:y1, x0:x1] = centers[color_index]

    report('package', '正在写入预览图、完成效果与关卡数据')
    pixel_regions = [{'id': f'cell-{index}', 'color': color, 'fillable': True} for index, color in enumerate(cells)]
    image.save(output / 'source.png')
    Image.fromarray(preview, 'RGB').save(output / 'preview.png')
    Image.fromarray(preview, 'RGB').save(output / 'verify_fill.png')
    (output / 'pixel_grid.json').write_text(json.dumps({'columns': columns, 'rows': rows, 'cells': cells}, ensure_ascii=False), encoding='utf-8')
    level = {
        'id': level_id,
        'title': title or '数字填色作品',
        'subtitle': f'数字填色 · {columns * rows} 个编号色块',
        'category': category,
        'difficulty': difficulty,
        'palette': palette,
        'regions': pixel_regions,
        'viewBox': f'0 0 {width} {height}',
        'preview': f'/levels/{level_id}/preview.png',
        'verify': f'/levels/{level_id}/verify_fill.png',
        'source': f'/levels/{level_id}/source.png',
        'pixelGrid': {'columns': columns, 'rows': rows, 'cells': cells},
        'mode': 'paint-by-number-pixels',
        'custom': True,
    }
    (output / 'level.json').write_text(json.dumps(level, ensure_ascii=False, indent=2), encoding='utf-8')
    return level
