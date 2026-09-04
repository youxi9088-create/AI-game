#!/usr/bin/env python3
"""将已配对的彩色参考图与线稿打包为可直接载入的线框填色关卡。

不调用 AI：颜色来自 --color，边界来自 --lineart。适合批量补充系统预制关卡。
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

from generate_level_v2 import generate_level
from level_validator import validate_level
from lineart_quality import evaluate_lineart


DIFFICULTY_PARAMS = {
    '简单': dict(n_seg=280, merge_thresh=18.0, palette_n=8, min_area_ratio=0.0025, target_range=(25, 70)),
    '普通': dict(n_seg=500, merge_thresh=14.0, palette_n=14, min_area_ratio=0.0008, target_range=(45, 130)),
    # 困难档只有建议下限。密集线稿由最小可点击面积校验决定是否可玩，不按区域数封顶。
    '困难': dict(n_seg=800, merge_thresh=11.0, palette_n=18, min_area_ratio=0.0004, target_range=(80, None)),
}


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def main() -> None:
    parser = argparse.ArgumentParser(description='打包已有线稿与彩色参考图为真人线框填色关卡')
    parser.add_argument('--color', required=True, help='已对齐的彩色参考图')
    parser.add_argument('--lineart', required=True, help='已对齐的 Coloring Book Line Art')
    parser.add_argument('--out', required=True, help='新的关卡输出目录；必须不存在')
    parser.add_argument('--id', required=True, dest='level_id', help='稳定关卡 ID')
    parser.add_argument('--title', required=True, help='关卡名称')
    parser.add_argument('--difficulty', choices=DIFFICULTY_PARAMS, default='困难', help='生成难度')
    args = parser.parse_args()

    color_path = Path(args.color).resolve()
    lineart_path = Path(args.lineart).resolve()
    output = Path(args.out).resolve()
    if not color_path.is_file() or not lineart_path.is_file():
        raise FileNotFoundError('彩色参考图或线稿不存在')
    if output.exists():
        raise FileExistsError(f'为保护已有产物，输出目录必须不存在：{output}')

    quality = evaluate_lineart(str(lineart_path))
    if not quality.get('passed'):
        raise RuntimeError(f'线稿质量未达可玩标准：{quality.get("summary", "未知原因")}')

    output.mkdir(parents=True)
    level = generate_level(
        str(color_path), str(lineart_path), output, args.level_id, title=args.title,
        **DIFFICULTY_PARAMS[args.difficulty],
    )
    # 统一保存一张与 Mask 尺寸严格一致的完成参考图，供游戏左侧参考面板显示。
    shutil.copy2(output / 'preview.png', output / 'reference.png')
    level.update({
        'difficulty': args.difficulty,
        'reference': f'/levels/{args.level_id}/reference.png',
        'lineArt': True,
    })
    (output / 'level.json').write_text(json.dumps(level, ensure_ascii=False, indent=2), encoding='utf-8')

    source = read_json(output / 'source.json')
    source.update({
        'colorReferenceSource': str(color_path),
        'lineArtSource': str(lineart_path),
        'pipeline': 'prebuilt-color-reference+coloring-book-lineart+lineart-barrier+slic+v2',
        'referenceImage': 'reference.png',
        'license': 'user-provided prebuilt level assets',
    })
    (output / 'source.json').write_text(json.dumps(source, ensure_ascii=False, indent=2), encoding='utf-8')
    (output / 'lineart_quality.json').write_text(json.dumps({
        'engine': 'provided-coloring-book-lineart',
        'qualityGate': quality,
    }, ensure_ascii=False, indent=2), encoding='utf-8')

    # reference.png 不是老校验器的必需产物，因此额外校验其尺寸，避免进入画布时被拉伸。
    reference_size = Image.open(output / 'reference.png').size
    mask_size = Image.open(output / 'region_mask.png').size
    if reference_size != mask_size:
        raise RuntimeError(f'参考图尺寸与 Region Mask 不一致：{reference_size} vs {mask_size}')

    validation = validate_level(output)
    (output / 'level_validation.json').write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding='utf-8')
    result = {
        'levelId': args.level_id,
        'output': str(output),
        'regions': len(level['regions']),
        'colors': len(level['palette']),
        'difficulty': args.difficulty,
        'lineartQuality': quality,
        'validation': validation,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not validation['passed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
