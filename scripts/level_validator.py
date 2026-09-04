# -*- coding: utf-8 -*-
"""真人线框关卡的最终产物校验：文件、Mask、区域 ID、色板和可点击面积。"""
from __future__ import annotations

import json
import argparse
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image


REQUIRED_FILES = (
    'level.json', 'source.json', 'preview.png', 'outline.png', 'lineart.png',
    'region_mask.png', 'region_mask_web.png', 'regions.json', 'verify_fill.png',
)
MIN_CLICK_AREA = {'简单': 120, '普通': 80, '困难': 45}
# 区域数用于给创作者说明生成密度，不参与通过/失败判定。困难档没有上限。
REGION_COUNT_GUIDANCE = {
    '简单': {'recommendedMin': 25, 'recommendedMax': 70, 'label': '建议 25–70 区'},
    '普通': {'recommendedMin': 45, 'recommendedMax': 130, 'label': '建议 45–130 区'},
    '困难': {'recommendedMin': 80, 'recommendedMax': None, 'label': '建议 80 区以上（无上限）'},
}


class LevelValidationError(RuntimeError):
    def __init__(self, report: dict[str, Any]):
        self.report = report
        super().__init__(f"关卡校验未通过：{'；'.join(report['errors'])}")


def _read_json(path: Path) -> dict[str, Any]:
    with path.open('r', encoding='utf-8') as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f'{path.name} 不是 JSON 对象')
    return payload


def validate_level(level_dir: str | Path) -> dict[str, Any]:
    directory = Path(level_dir)
    errors: list[str] = []
    warnings: list[str] = []
    missing = [name for name in REQUIRED_FILES if not (directory / name).is_file()]
    if missing:
        errors.append(f"缺少关卡产物：{', '.join(missing)}")
        return {'passed': False, 'errors': errors, 'warnings': warnings}

    try:
        level = _read_json(directory / 'level.json')
        source = _read_json(directory / 'source.json')
        metadata = _read_json(directory / 'regions.json')
        mask = np.asarray(Image.open(directory / 'region_mask.png'), dtype=np.uint16)
        web_mask = np.asarray(Image.open(directory / 'region_mask_web.png').convert('RGBA'), dtype=np.uint8)
        lineart = Image.open(directory / 'lineart.png')
        preview = Image.open(directory / 'preview.png')
    except Exception as exc:  # noqa: BLE001
        return {'passed': False, 'errors': [f'无法读取关卡产物：{exc}'], 'warnings': warnings}

    regions = level.get('regions') if isinstance(level.get('regions'), list) else []
    palette = level.get('palette') if isinstance(level.get('palette'), list) else []
    difficulty = level.get('difficulty') if level.get('difficulty') in MIN_CLICK_AREA else '普通'
    if not level.get('id'):
        errors.append('level.json 缺少稳定关卡 ID')
    if not palette:
        errors.append('关卡缺少调色板')
    if not regions:
        errors.append('关卡没有可点击区域')
    if not source.get('license'):
        errors.append('source.json 缺少素材授权记录')

    try:
        _, _, view_width, view_height = (int(value) for value in str(level.get('viewBox', '')).split())
        if (view_width, view_height) != (mask.shape[1], mask.shape[0]):
            errors.append('viewBox 与 Region Mask 尺寸不一致')
    except (TypeError, ValueError):
        errors.append('level.json 的 viewBox 无效')
    if lineart.size != (mask.shape[1], mask.shape[0]) or preview.size != (mask.shape[1], mask.shape[0]):
        errors.append('线稿、预览图与 Region Mask 尺寸不一致')

    ids: set[str] = set()
    mask_ids: set[int] = set()
    expected_mask_ids: set[int] = set()
    min_area = MIN_CLICK_AREA[difficulty]
    region_areas: list[int] = []
    for region in regions:
        if not isinstance(region, dict):
            errors.append('regions 含无效对象')
            continue
        region_id = str(region.get('id') or '')
        mask_id = region.get('maskId')
        color = region.get('color')
        if not region_id or region_id in ids:
            errors.append(f'区域 ID 为空或重复：{region_id or "(空)"}')
        ids.add(region_id)
        if not isinstance(mask_id, int) or mask_id <= 0 or mask_id in mask_ids:
            errors.append(f'区域 Mask ID 无效或重复：{region_id or "(空)"}')
            continue
        mask_ids.add(mask_id)
        expected_mask_ids.add(mask_id)
        if not isinstance(color, int) or color < 0 or color >= len(palette):
            errors.append(f'区域色板索引无效：{region_id}')
        area = int((mask == mask_id).sum())
        region_areas.append(area)
        if area < min_area:
            errors.append(f'区域过小、难以点击：{region_id}（{area}px，小于 {min_area}px）')
        components, _, _, _ = cv2.connectedComponentsWithStats((mask == mask_id).astype(np.uint8), connectivity=8)
        if components != 2:
            errors.append(f'区域不是单一连通块：{region_id}')

    actual_mask_ids = {int(value) for value in np.unique(mask) if int(value) > 0}
    unknown = actual_mask_ids - expected_mask_ids
    absent = expected_mask_ids - actual_mask_ids
    if unknown:
        errors.append(f'Region Mask 含未登记 ID：{sorted(unknown)[:6]}')
    if absent:
        errors.append(f'level.json 含未落入 Mask 的区域：{sorted(absent)[:6]}')
    decoded_web = web_mask[..., 0].astype(np.uint16) | (web_mask[..., 1].astype(np.uint16) << 8)
    if not np.array_equal(decoded_web, mask):
        errors.append('浏览器专用 Region Mask 与 uint16 Mask 不一致')
    if int((mask > 0).sum()) == 0:
        errors.append('Region Mask 没有任何可填色像素')
    if len(metadata.get('regions', [])) != len(regions):
        errors.append('regions.json 与 level.json 的区域数量不一致')

    lineart_quality_path = directory / 'lineart_quality.json'
    if lineart_quality_path.is_file():
        try:
            quality = _read_json(lineart_quality_path).get('qualityGate', {})
            if not quality.get('passed'):
                errors.append('线稿质量门未通过却进入了关卡打包')
        except Exception as exc:  # noqa: BLE001
            errors.append(f'无法读取线稿质量报告：{exc}')
    else:
        warnings.append('未找到 lineart_quality.json；该关卡未记录线稿质量门')

    result = {
        'passed': not errors,
        'levelId': level.get('id'),
        'difficulty': difficulty,
        'regions': len(regions),
        'regionGuidance': {
            **REGION_COUNT_GUIDANCE[difficulty],
            'actual': len(regions),
            'policy': 'advisory',
        },
        'colors': len(palette),
        'fillablePixels': int((mask > 0).sum()),
        'minRegionArea': min(region_areas) if region_areas else 0,
        'errors': errors,
        'warnings': warnings,
    }
    result['summary'] = (
        f"关卡校验通过：{result['regions']} 个区域、{result['colors']} 种颜色、最小可点击区域 {result['minRegionArea']}px"
        if result['passed'] else f"关卡校验失败：{'；'.join(errors)}"
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description='校验真人线框填色关卡产物')
    parser.add_argument('level', help='关卡目录，或该目录中的 level.json')
    arguments = parser.parse_args()
    target = Path(arguments.level)
    report = validate_level(target.parent if target.name == 'level.json' else target)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not report['passed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
