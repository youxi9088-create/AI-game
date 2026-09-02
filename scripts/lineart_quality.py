# -*- coding: utf-8 -*-
"""Coloring Book Line Art 的可玩性验收。

这一层故意位于 AI 生成和区域分割之间。它不尝试把错误的 AI 重绘"修好"，
而是用可解释的图像指标阻止不可玩的线稿进入 Mask / 关卡打包流程。

对于已收录的基准原图，还会把新线稿与已验收的历史线稿进行版式比对。这是
回归保护，不是把该基准图的结果套用到其他用户图片上。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]

# 这组文件是已经人工确认可玩的「林间的幸福」基准样本。只有上传图与原图
# 的感知哈希足够接近时，才启用后面的版式一致性门槛。
GOLDEN_SAMPLES = (
    {
        'id': 'ling-ling-garden-v1',
        'name': '林间的幸福 · 历史验收线稿',
        'source': ROOT / 'public' / 'ling-ling-garden.png',
        'lineart': ROOT / 'public' / 'ling-ling-lineart.png',
        'maxSourceHashDistance': 6,
        # 同一张基准图的正确结果应保持人物、动物、标题、地平线和主体留白的
        # 相对位置。0.90 可以拦住“看起来仍像同一场景、实际已被模型重绘”的结果。
        'minLayoutCorrelation': 0.90,
    },
)

MIN_COVERAGE = 0.45
MAX_COVERAGE = 12.0
MAX_EDGE_COVERAGE = 5.5
MIN_FILLABLE_REGIONS = 12
MAX_SMALL_COMPONENTS_PER_MP = 260


def _gray_image(path: str | Path | Image.Image) -> np.ndarray:
    image = ImageOps.exif_transpose(path if isinstance(path, Image.Image) else Image.open(path)).convert('L')
    return np.asarray(image, dtype=np.uint8)


def _ink(gray: np.ndarray) -> np.ndarray:
    return (gray < 200).astype(np.uint8)


def _edge_coverage(ink: np.ndarray) -> float:
    height, width = ink.shape
    thickness = max(3, round(min(width, height) * 0.006))
    ring = np.concatenate((
        ink[:thickness, :].ravel(), ink[-thickness:, :].ravel(),
        ink[:, :thickness].ravel(), ink[:, -thickness:].ravel(),
    ))
    return float(ring.mean() * 100) if ring.size else 0.0


def _fillable_region_count(ink: np.ndarray) -> int:
    """估算被黑线完整围住、可被点击的留白区域数量。"""
    height, width = ink.shape
    barrier = cv2.dilate(ink, np.ones((3, 3), dtype=np.uint8), iterations=1)
    count, _, stats, _ = cv2.connectedComponentsWithStats((barrier == 0).astype(np.uint8), connectivity=8)
    min_area = max(120, round(height * width * 0.00008))
    regions = 0
    for label in range(1, count):
        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        box_width = int(stats[label, cv2.CC_STAT_WIDTH])
        box_height = int(stats[label, cv2.CC_STAT_HEIGHT])
        area = int(stats[label, cv2.CC_STAT_AREA])
        touches_canvas = x == 0 or y == 0 or x + box_width >= width or y + box_height >= height
        if not touches_canvas and area >= min_area:
            regions += 1
    return regions


def _perceptual_hash(path: str | Path) -> int:
    gray = _gray_image(path)
    reduced = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32)
    coefficients = cv2.dct(reduced)[:8, :8]
    median = float(np.median(coefficients.flatten()[1:]))
    bits = coefficients > median
    value = 0
    for bit in bits.flatten():
        value = (value << 1) | int(bool(bit))
    return value


def _hash_distance(first: int, second: int) -> int:
    return (first ^ second).bit_count()


def _layout_map(path: str | Path) -> np.ndarray:
    ink = _ink(_gray_image(path)).astype(np.float32)
    # 低分辨率 + 轻微高斯模糊会关注主体、文字、前中后景的相对布局，忽略笔触粗细。
    reduced = cv2.resize(ink, (96, 72), interpolation=cv2.INTER_AREA)
    return cv2.GaussianBlur(reduced, (0, 0), 1.7)


def _layout_correlation(candidate: str | Path, golden: str | Path) -> float:
    first = _layout_map(candidate).ravel()
    second = _layout_map(golden).ravel()
    if float(first.std()) < 1e-6 or float(second.std()) < 1e-6:
        return 0.0
    return float(np.corrcoef(first, second)[0, 1])


def analyse_lineart(lineart_path: str | Path | Image.Image) -> dict[str, Any]:
    """输出可在界面展示的、稳定的线稿质量指标。"""
    gray = _gray_image(lineart_path)
    ink = _ink(gray)
    height, width = ink.shape
    components, _, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    min_speck_area = max(36, round(width * height * 0.000075))
    component_areas = stats[1:, cv2.CC_STAT_AREA] if components > 1 else np.array([], dtype=np.int32)
    small_components = int(np.sum(component_areas < min_speck_area))
    megapixels = max(width * height / 1_000_000, 0.01)
    return {
        'width': int(width),
        'height': int(height),
        'lineCoverage': round(float(ink.mean() * 100), 2),
        'edgeInkCoverage': round(_edge_coverage(ink), 2),
        'inkComponents': int(max(0, components - 1)),
        'smallComponents': small_components,
        'smallComponentsPerMp': round(small_components / megapixels, 2),
        'fillableRegionsEstimate': _fillable_region_count(ink),
    }


def analyse_source_for_lineart(source_path: str | Path | None) -> dict[str, Any] | None:
    """识别会导致线稿过密的输入类型，用于选择生成策略和给用户解释原因。

    这不是质量门，也不会拒绝用户图片；它只避免把高纹理真人照片交给“忠实描摹”
    的提示词。指标只在本地计算，不上传原图。
    """
    if not source_path or not Path(source_path).is_file():
        return None
    gray = _gray_image(source_path)
    height, width = gray.shape
    scale = min(1.0, 900 / max(width, height))
    if scale < 1:
        gray = cv2.resize(gray, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    edges = cv2.Canny(gray, 80, 180)
    edge_density = float((edges > 0).mean() * 100)
    contrast = float(gray.std())
    dense = edge_density >= 8.0 or (edge_density >= 6.2 and contrast >= 58)
    return {
        'kind': 'high-detail-photo' if dense else 'standard-image',
        'edgeDensity': round(edge_density, 2),
        'contrast': round(contrast, 2),
        'requiresBackgroundSimplification': dense,
        'message': (
            '检测到较多纹理和小物体；生成时会保留主体，并把背景归纳为少量大轮廓。'
            if dense else '画面细节密度适中，将使用标准的主体保留线稿策略。'
        ),
    }


def _source_baseline(source_path: str | Path | None) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    if not source_path:
        return None, None
    path = Path(source_path)
    if not path.is_file():
        return None, None
    source_hash = _perceptual_hash(path)
    closest: tuple[int, dict[str, Any]] | None = None
    for sample in GOLDEN_SAMPLES:
        if not sample['source'].is_file() or not sample['lineart'].is_file():
            continue
        distance = _hash_distance(source_hash, _perceptual_hash(sample['source']))
        if closest is None or distance < closest[0]:
            closest = (distance, sample)
    if closest is None:
        return None, None
    distance, sample = closest
    metadata = {
        'id': sample['id'],
        'name': sample['name'],
        'sourceHashDistance': distance,
        'matched': distance <= sample['maxSourceHashDistance'],
    }
    return (sample if metadata['matched'] else None), metadata


def matching_golden_sample(source_path: str | Path | None) -> dict[str, Any] | None:
    """返回与上传图匹配的人工验收样本；用于确定性回归，不用于普通图片。"""
    sample, _ = _source_baseline(source_path)
    return sample


def evaluate_lineart(lineart_path: str | Path | Image.Image, source_path: str | Path | None = None) -> dict[str, Any]:
    """执行质量门槛，返回完整报告；调用方决定是否继续下游处理。"""
    metrics = analyse_lineart(lineart_path)
    checks: list[dict[str, Any]] = []

    def check(check_id: str, title: str, passed: bool, detail: str) -> None:
        checks.append({'id': check_id, 'title': title, 'passed': bool(passed), 'detail': detail})

    coverage = metrics['lineCoverage']
    check(
        'coverage', '线条密度', MIN_COVERAGE <= coverage <= MAX_COVERAGE,
        f'{coverage}%（可玩范围 {MIN_COVERAGE}%–{MAX_COVERAGE}%）',
    )
    edge = metrics['edgeInkCoverage']
    check(
        'edge', '画布边缘残线', edge <= MAX_EDGE_COVERAGE,
        f'{edge}%（上限 {MAX_EDGE_COVERAGE}%）',
    )
    fillable = metrics['fillableRegionsEstimate']
    check(
        'regions', '闭合可填区域', fillable >= MIN_FILLABLE_REGIONS,
        f'估计 {fillable} 个闭合区域（至少 {MIN_FILLABLE_REGIONS} 个）',
    )
    small = metrics['smallComponentsPerMp']
    check(
        'noise', '碎线与噪点', small <= MAX_SMALL_COMPONENTS_PER_MP,
        f'{small} 个/百万像素（上限 {MAX_SMALL_COMPONENTS_PER_MP}）',
    )

    source_profile = analyse_source_for_lineart(source_path)
    baseline, baseline_info = _source_baseline(source_path)
    if baseline and not isinstance(lineart_path, Image.Image):
        similarity = round(_layout_correlation(lineart_path, baseline['lineart']), 3)
        metrics['goldenLayoutCorrelation'] = similarity
        check(
            'golden-layout', '历史线稿构图一致性', similarity >= baseline['minLayoutCorrelation'],
            f'{similarity}（基准《{baseline["name"]}》，最低 {baseline["minLayoutCorrelation"]}）',
        )

    failed = [item for item in checks if not item['passed']]
    summary = '、'.join(item['title'] for item in failed) if failed else '线稿通过可玩性验收'
    failed_ids = {item['id'] for item in failed}
    input_advice = [
        '优先选择主体清晰、光线均匀、背景不过度拥挤的照片或插画。',
        '推荐 1–3 个主体、主体占画面约三分之一以上，边缘留有少量空白。',
        '避免纯风景、密集树叶/草地、毛发特写、强水彩纹理、复杂文字、水印和黑色边框。',
    ]
    if source_profile and source_profile['requiresBackgroundSimplification']:
        input_advice.insert(0, '当前照片属于高细节实拍图：可以使用，但应让主体占画面更大，并减少密集绿植、桌面杂物或细碎背景。')
    reasons: list[str] = []
    if 'coverage' in failed_ids:
        if coverage > MAX_COVERAGE:
            reasons.append('线条过密：模型把纹理、阴影或细小装饰也识别成了轮廓')
        else:
            reasons.append('线条过少：主体轮廓不够清晰，无法形成稳定的填色边界')
    if 'edge' in failed_ids:
        reasons.append('画面四周有明显残线或黑边，可能来自裁切、边框或水印')
    if 'regions' in failed_ids:
        reasons.append('封闭区域太少：轮廓存在断线，点击填色可能会跨区域蔓延')
    if 'noise' in failed_ids:
        reasons.append('碎线噪点过多：原图纹理或模型草稿笔触不适合直接分区')
    if 'golden-layout' in failed_ids:
        reasons.append('模型重绘偏离了原图构图；这不是重新上传同一图片能解决的问题')
    if source_profile and source_profile['requiresBackgroundSimplification'] and failed:
        reasons.insert(0, '输入包含较多真实纹理，当前候选没有把背景充分归纳为大轮廓')
    user_message = '；'.join(reasons) if reasons else '线稿结构清晰，可继续进行区域分割。'
    return {
        'version': 1,
        'passed': not failed,
        'summary': summary,
        'metrics': metrics,
        'checks': checks,
        'baseline': baseline_info,
        'sourceProfile': source_profile,
        'userMessage': user_message,
        'inputAdvice': input_advice,
    }


class LineartQualityError(RuntimeError):
    def __init__(self, report: dict[str, Any]):
        self.report = report
        failed = '、'.join(item['title'] for item in report['checks'] if not item['passed'])
        retry = report.get('retry') or {}
        retried = '系统已使用同一原图自动重跑 1 次，' if retry.get('autoRetried') else ''
        super().__init__(f'线稿质量未达可玩标准：{failed}。{retried}{report.get("userMessage", "")}')


def main() -> None:
    parser = argparse.ArgumentParser(description='验收 Coloring Book Line Art')
    parser.add_argument('lineart')
    parser.add_argument('--source')
    arguments = parser.parse_args()
    print(json.dumps(evaluate_lineart(arguments.lineart, arguments.source), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
