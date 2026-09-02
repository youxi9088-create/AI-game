# -*- coding: utf-8 -*-
"""将模型输出净化为可玩 Coloring Book Line Art。

文生图模型可以画出好看的黑白插画，但经常带有断笔、铅笔颗粒或画布角落
残线。它们会让区域分割漏水，最终出现“点不到”或“一点蔓延”的区域。
本模块只做保守的像素后处理：保留画面结构，不凭空增加内容。
"""
from __future__ import annotations

from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageOps


def _remove_corner_artifacts(ink: np.ndarray) -> tuple[np.ndarray, int]:
    """移除只贴住画布角的短残线，不裁切正常画面边缘内容。"""
    count, labels, stats, _ = cv2.connectedComponentsWithStats((ink > 0).astype(np.uint8), connectivity=8)
    height, width = ink.shape
    edge = max(3, round(min(width, height) * 0.008))
    corner_zone = max(24, round(min(width, height) * 0.10))
    max_corner_area = max(120, round(width * height * 0.006))
    cleaned = ink.copy()
    removed = 0
    for label in range(1, count):
        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        box_w = int(stats[label, cv2.CC_STAT_WIDTH])
        box_h = int(stats[label, cv2.CC_STAT_HEIGHT])
        area = int(stats[label, cv2.CC_STAT_AREA])
        hits_left, hits_right = x <= edge, x + box_w >= width - edge
        hits_top, hits_bottom = y <= edge, y + box_h >= height - edge
        touches_corner = (hits_left or hits_right) and (hits_top or hits_bottom)
        # 生成图偶尔会留下“不接画面”的弧线，位置在角落但离边缘只有几像素，
        # 因而同时覆盖“贴边”和“整段落在角落安全区”两种情况。
        sits_in_corner = (
            (x + box_w <= corner_zone and y + box_h <= corner_zone)
            or (x >= width - corner_zone and y + box_h <= corner_zone)
            or (x + box_w <= corner_zone and y >= height - corner_zone)
            or (x >= width - corner_zone and y >= height - corner_zone)
        )
        if (touches_corner or sits_in_corner) and area <= max_corner_area:
            cleaned[labels == label] = 0
            removed += 1
    return cleaned, removed


def _drop_specks(ink: np.ndarray, min_area: int) -> tuple[np.ndarray, int]:
    count, labels, stats, _ = cv2.connectedComponentsWithStats((ink > 0).astype(np.uint8), connectivity=8)
    cleaned = np.zeros_like(ink)
    removed = 0
    for label in range(1, count):
        if int(stats[label, cv2.CC_STAT_AREA]) >= min_area:
            cleaned[labels == label] = 255
        else:
            removed += 1
    return cleaned, removed


def add_white_safety_margin(lineart: Image.Image, ratio: float = 0.035) -> Image.Image:
    """在不裁掉内容的前提下，为线稿加入白色安全边距。

    这不是裁切，也不会把贴边对象删除：整张线稿等比缩小后居中放回原尺寸画布。
    对模型遗留的画布边缘残线尤其有效，同时仍保留原始构图和全部主体。
    """
    source = lineart.convert('L')
    width, height = source.size
    inset_x = max(1, round(width * ratio))
    inset_y = max(1, round(height * ratio))
    resized = source.resize((width - inset_x * 2, height - inset_y * 2), Image.Resampling.LANCZOS)
    canvas = Image.new('L', (width, height), 255)
    canvas.paste(resized, (inset_x, inset_y))
    return canvas


def reinforce_lineart(
    raw: Image.Image,
    *,
    threshold: int = 225,
    close_iterations: int = 1,
    dilate_iterations: int = 1,
) -> tuple[Image.Image, dict[str, Any]]:
    """输出白底、连续、稳定笔触的线稿及可追溯处理指标。

    处理力度刻意限定为“小缝闭合 + 一像素加粗”：这能修复模型常见的断线，
    又不会将相邻花瓣、人物五官等正常区域粗暴粘连。
    """
    gray = np.asarray(ImageOps.exif_transpose(raw).convert('L'), dtype=np.uint8)
    if float(gray.mean()) < 127:
        gray = 255 - gray

    # 先把灰色铅笔线变成可分割的纯黑笔触。默认 225 能收进浅灰轮廓，同时避开白底。
    # 对高纹理真人照片，会由调用方使用更低阈值且不加粗的候选，主动丢掉模型画出的
    # 浅灰碎纹理，而不是把它们加粗后伪装成可玩线稿。
    filtered = cv2.bilateralFilter(gray, 5, 28, 28)
    _, ink = cv2.threshold(filtered, threshold, 255, cv2.THRESH_BINARY_INV)
    ink, removed_corners = _remove_corner_artifacts(ink)

    # 3px 闭运算只补小断点；随后一像素椭圆加粗，让显示线和逻辑边界一致。
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    stroke_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    if close_iterations:
        ink = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, close_kernel, iterations=close_iterations)
    if dilate_iterations:
        ink = cv2.dilate(ink, stroke_kernel, iterations=dilate_iterations)
    # 过滤铅笔点和极短虚线；人物五官、花瓣等真正结构通常远大于此阈值。
    min_area = max(36, round(ink.shape[0] * ink.shape[1] * 0.000075))
    ink, removed_specks = _drop_specks(ink, min_area)

    lineart = Image.fromarray(255 - ink, 'L')
    coverage = round(float((ink > 0).mean()) * 100, 2)
    return lineart, {
        'lineCoverage': coverage,
        'removedCornerArtifacts': removed_corners,
        'removedSpecks': removed_specks,
        'minSpeckArea': min_area,
        'method': f'threshold-{threshold}+corner-clean+3px-close-{close_iterations}+stroke-{dilate_iterations}',
    }
