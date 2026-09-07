#!/usr/bin/env python3
"""Build a compact static-asset directory for the FN browser release.

The authored system packages retain their production evidence (source images,
validation reports and multiple mask variants).  Browsers only need the level
definition, one lossless outline, the web mask and two display images.  This
script creates that smaller, deployable view without mutating the source pack.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PUBLIC = ROOT / 'public'
SOURCE_SYSTEM = SOURCE_PUBLIC / 'system-levels'
RELEASE_PUBLIC = ROOT / 'public-release'


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def save_webp(
    source: Path,
    destination: Path,
    *,
    quality: int | None = None,
    max_size: tuple[int, int] | None = None,
    preserve_alpha: bool = False,
) -> None:
    with Image.open(source) as original:
        # ``outline.png`` 是黑笔触加透明底图。若强制转 RGB，透明区会被
        # Pillow 合成为黑色，前端的线稿层就会遮住整张画布。
        image = original.convert('RGBA' if preserve_alpha and 'A' in original.getbands() else 'RGB')
        if max_size:
            image.thumbnail(max_size, Image.Resampling.LANCZOS)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if quality is None:
            image.save(destination, 'WEBP', lossless=True, method=6)
        else:
            image.save(destination, 'WEBP', quality=quality, method=6)


def copy_runtime_public_assets() -> None:
    """Copy non-system assets Vite still serves at root-relative URLs."""
    RELEASE_PUBLIC.mkdir(parents=True, exist_ok=True)
    for source in SOURCE_PUBLIC.iterdir():
        if source.name == 'system-levels':
            continue
        destination = RELEASE_PUBLIC / source.name
        if source.is_dir():
            shutil.copytree(source, destination, dirs_exist_ok=True)
        else:
            shutil.copy2(source, destination)


def prepare_system_levels() -> int:
    manifest = json.loads((SOURCE_SYSTEM / 'index.json').read_text(encoding='utf-8'))
    levels = manifest.get('levels', [])
    target_system = RELEASE_PUBLIC / 'system-levels'
    target_system.mkdir(parents=True, exist_ok=True)
    write_json(target_system / 'index.json', manifest)

    prepared = 0
    for entry in levels:
        if not entry.get('ready'):
            continue
        asset_id = str(entry['assetId'])
        source = SOURCE_SYSTEM / asset_id
        target = target_system / asset_id
        level = json.loads((source / 'level.json').read_text(encoding='utf-8'))
        level.update({
            'preview': 'preview.webp',
            'reference': 'reference.webp',
            'lineart': 'outline.webp',
            'outline': 'outline.webp',
            'regionMask': 'region_mask_web.png',
            'regionMaskWeb': 'region_mask_web.png',
        })
        level.pop('regionsMeta', None)
        write_json(target / 'level.json', level)
        # 1024px 透明线稿在 1200px 画布上缩放显示仍足够锐利；点击区域始终
        # 读取原尺寸的 PNG Mask，因此不会影响区域 ID 或填色准确性。
        save_webp(source / 'outline.png', target / 'outline.webp', preserve_alpha=True, max_size=(1024, 1024))
        # 参考图只在侧栏和关卡卡片展示，768px 足够清晰；不参与区域点击。
        save_webp(source / 'reference.png', target / 'reference.webp', quality=80, max_size=(768, 768))
        save_webp(source / 'preview.png', target / 'preview.webp', quality=80, max_size=(420, 420))
        shutil.copy2(source / 'region_mask_web.png', target / 'region_mask_web.png')
        prepared += 1
    return prepared


def main() -> None:
    if not (SOURCE_SYSTEM / 'index.json').is_file():
        raise SystemExit('missing public/system-levels/index.json; publish the system catalog first')
    copy_runtime_public_assets()
    count = prepare_system_levels()
    size = sum(path.stat().st_size for path in RELEASE_PUBLIC.rglob('*') if path.is_file())
    print(json.dumps({'preparedLevels': count, 'releasePublic': str(RELEASE_PUBLIC), 'bytes': size}, ensure_ascii=False))


if __name__ == '__main__':
    main()
