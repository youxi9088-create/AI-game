# -*- coding: utf-8 -*-
"""真人照片 -> Coloring Book Line Art。

视觉线稿由 ``controlnet_aux.LineartDetector`` 生成；OpenCV 只负责阈值、
去噪和线条闭合。输出 ``lineart.png`` 始终是白底黑线，不能作为游戏
逻辑 Mask 使用；游戏逻辑由后续的 ``region_mask.png`` 独立承担。
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image, ImageOps
from controlnet_aux import LineartDetector

MODEL_ID = 'lllyasviel/Annotators'
MODEL_CACHE = Path(os.environ.get('COLORVERSE_MODEL_CACHE', Path.home() / '.cache' / 'colorverse-models'))
LOCAL_MODEL_DIR = Path(os.environ.get('COLORVERSE_LINEART_DIR', Path(__file__).resolve().parents[1] / 'models' / 'lineart'))
_detector: LineartDetector | None = None


def get_lineart_detector() -> LineartDetector:
    """进程内只加载一次；模型权重由 Hugging Face 缓存持久化。"""
    global _detector
    if _detector is None:
        # 人工下载时可直接放两个权重到 models/lineart/，不要求用户拼装 HF 缓存目录。
        local_weights_ready = all((LOCAL_MODEL_DIR / name).is_file() for name in ('sk_model.pth', 'sk_model2.pth'))
        try:
            if local_weights_ready:
                _detector = LineartDetector.from_pretrained(str(LOCAL_MODEL_DIR))
            else:
                MODEL_CACHE.mkdir(parents=True, exist_ok=True)
                _detector = LineartDetector.from_pretrained(MODEL_ID, cache_dir=str(MODEL_CACHE))
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(
                "无法取得 Coloring Book Line Art 模型权重。请确认本机可访问 Hugging Face，"
                "或把 sk_model.pth 与 sk_model2.pth 放入 models/lineart/ 后重试。"
            ) from exc
        _detector.to('cuda' if torch.cuda.is_available() else 'cpu')
    return _detector


def preprocess(image: Image.Image, work_width: int) -> Image.Image:
    image = ImageOps.exif_transpose(image).convert('RGB')
    width, height = image.size
    scale = min(1.0, work_width / width)
    if scale < 1.0:
        image = image.resize((round(width * scale), round(height * scale)), Image.Resampling.LANCZOS)
    return image


def close_and_clean(raw: Image.Image) -> Image.Image:
    """将模型输出规范化为连续、可分割的白底黑线。"""
    from lineart_reinforcement import reinforce_lineart

    return reinforce_lineart(raw)[0]


def create_lineart(source: str | Path, target: str | Path, work_width: int = 1200) -> dict:
    source = Path(source)
    target = Path(target)
    original = preprocess(Image.open(source), work_width)
    detector = get_lineart_detector()
    with torch.inference_mode():
        raw = detector(original, coarse=True, detect_resolution=768, image_resolution=max(original.size))
    lineart = close_and_clean(raw)
    target.parent.mkdir(parents=True, exist_ok=True)
    lineart.save(target)
    pixels = np.asarray(lineart, dtype=np.uint8)
    return {
        'width': lineart.width,
        'height': lineart.height,
        'lineCoverage': round(float((pixels < 128).mean()) * 100, 2),
        'engine': 'controlnet_aux.LineartDetector (coarse)',
        'model': MODEL_ID,
        'device': 'cuda' if torch.cuda.is_available() else 'cpu',
    }


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit('用法: python coloring_book_lineart.py <输入图片> <lineart.png>')
    print(json.dumps(create_lineart(sys.argv[1], sys.argv[2]), ensure_ascii=False))


if __name__ == '__main__':
    main()
