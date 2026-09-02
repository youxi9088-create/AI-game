# -*- coding: utf-8 -*-
"""为 Coloring Book Line Art 准备“主体清楚、背景简化”的参考图。

这一层只在本机处理用户刚上传的原图：人脸检测用于保护人物/宠物的中心构图，
背景则做平滑和有限色彩量化。它不是 SAM 的替代品；当未来安装并验收 SAM 模型
后，可在 ``_foreground_protection_mask`` 中替换为真正的语义 Mask，调用契约不变。
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageOps


def _face_boxes(gray: np.ndarray) -> list[tuple[int, int, int, int]]:
    if not hasattr(cv2, 'CascadeClassifier'):
        return []
    cascade_path = Path(cv2.data.haarcascades) / 'haarcascade_frontalface_default.xml'
    detector = cv2.CascadeClassifier(str(cascade_path))
    if detector.empty():
        return []
    faces = detector.detectMultiScale(gray, scaleFactor=1.12, minNeighbors=5, minSize=(28, 28))
    return [tuple(int(value) for value in face) for face in faces]


def _foreground_protection_mask(shape: tuple[int, int], faces: list[tuple[int, int, int, int]]) -> np.ndarray:
    """构建人物保护区；脸部为核心，向下扩展至上半身和手部常见区域。"""
    height, width = shape
    mask = np.zeros((height, width), dtype=np.uint8)
    if faces:
        for x, y, face_w, face_h in faces:
            center = (int(x + face_w * .5), int(y + face_h * 2.55))
            axes = (max(24, int(face_w * 2.05)), max(40, int(face_h * 3.35)))
            cv2.ellipse(mask, center, axes, 0, 0, 360, 255, thickness=-1)
            cv2.ellipse(mask, (int(x + face_w * .5), int(y + face_h * .5)), (int(face_w * .78), int(face_h * .88)), 0, 0, 360, 255, thickness=-1)
    else:
        # 没有人脸时不猜测“物体类别”；保护中间主体区域，让动物和物品照片
        # 仍能接受背景归纳，而不是整张图被强行模糊。
        cv2.ellipse(mask, (width // 2, height // 2), (int(width * .31), int(height * .43)), 0, 0, 360, 255, thickness=-1)
    return cv2.GaussianBlur(mask, (0, 0), sigmaX=max(8, round(min(width, height) * .035)))


def _quantize_background(bgr: np.ndarray, colors: int = 8) -> np.ndarray:
    """归纳背景为少量平滑色块，保留场景色调但不留下叶脉、纹理等细节。"""
    smoothed = cv2.pyrMeanShiftFiltering(bgr, sp=16, sr=42, maxLevel=1)
    height, width = smoothed.shape[:2]
    pixels = smoothed.reshape(-1, 3).astype(np.float32)
    rng = np.random.default_rng(17)
    sample_size = min(len(pixels), 18_000)
    sample = pixels[rng.choice(len(pixels), sample_size, replace=False)]
    _, _, centers = cv2.kmeans(sample, colors, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 18, 1.0), 2, cv2.KMEANS_PP_CENTERS)
    output = np.empty_like(pixels)
    for start in range(0, len(pixels), 50_000):
        chunk = pixels[start:start + 50_000]
        nearest = ((chunk[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2).argmin(axis=1)
        output[start:start + len(chunk)] = centers[nearest]
    return output.reshape(height, width, 3).astype(np.uint8)


def _refine_foreground_with_grabcut(bgr: np.ndarray, protection: np.ndarray) -> tuple[np.ndarray, bool]:
    """将人物引导区作为 GrabCut 种子，分离主体与复杂背景；失败则保留安全的椭圆保护区。"""
    if not hasattr(cv2, 'grabCut'):
        return protection, False
    height, width = protection.shape
    seed = np.full((height, width), cv2.GC_PR_BGD, dtype=np.uint8)
    border = max(3, round(min(width, height) * .025))
    seed[:border, :] = cv2.GC_BGD
    seed[-border:, :] = cv2.GC_BGD
    seed[:, :border] = cv2.GC_BGD
    seed[:, -border:] = cv2.GC_BGD
    seed[protection > 90] = cv2.GC_PR_FGD
    seed[protection > 205] = cv2.GC_FGD
    try:
        bg_model = np.zeros((1, 65), np.float64)
        fg_model = np.zeros((1, 65), np.float64)
        cv2.grabCut(bgr, seed, None, bg_model, fg_model, 2, cv2.GC_INIT_WITH_MASK)
    except cv2.error:
        return protection, False
    foreground = np.where((seed == cv2.GC_FGD) | (seed == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    refined = cv2.GaussianBlur(foreground, (0, 0), sigmaX=max(6, round(min(width, height) * .018)))
    return np.maximum(protection, refined), True


def preprocess_reference_for_lineart(source: str | Path, target: str | Path) -> dict[str, Any]:
    """写出供图生图使用的预处理版本；原图不修改，仍用于完成态色板和预览。"""
    source_path, target_path = Path(source), Path(target)
    image = ImageOps.exif_transpose(Image.open(source_path)).convert('RGB')
    max_width = 1400
    if image.width > max_width:
        image = image.resize((max_width, round(image.height * max_width / image.width)), Image.Resampling.LANCZOS)
    rgb = np.asarray(image, dtype=np.uint8)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    faces = _face_boxes(gray)
    protection = _foreground_protection_mask(gray.shape, faces).astype(np.float32) / 255.0
    protection, grabcut_applied = _refine_foreground_with_grabcut(bgr, (protection * 255).astype(np.uint8))
    protection = protection.astype(np.float32) / 255.0
    simplified = _quantize_background(bgr, colors=8)
    mixed = (bgr.astype(np.float32) * protection[..., None] + simplified.astype(np.float32) * (1.0 - protection[..., None])).clip(0, 255).astype(np.uint8)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(cv2.cvtColor(mixed, cv2.COLOR_BGR2RGB), 'RGB').save(target_path, 'PNG', optimize=True)
    return {
        'applied': True,
        'engine': (
            'opencv-face-guided-protection+grabcut-foreground+background-quantization' if faces and grabcut_applied else
            'opencv-center-subject-grabcut+background-quantization' if grabcut_applied else
            'opencv-center-subject-protection+background-quantization'
        ),
        'facesDetected': len(faces),
        'grabCutApplied': grabcut_applied,
        'backgroundColors': 8,
        'outputSize': [image.width, image.height],
        'message': (
            f'识别到 {len(faces)} 个面部主体，已通过前景分割保护主体并将背景归纳为 8 组大色块。'
            if faces and grabcut_applied else
            f'识别到 {len(faces)} 个面部主体，已保护主体并将背景归纳为 8 组大色块。'
            if faces else
            '未检测到可用人脸，已通过中心主体分割保护主要对象并将背景归纳为 8 组大色块。'
        ),
    }
