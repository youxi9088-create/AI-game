# -*- coding: utf-8 -*-
"""ColorVerse 本机关卡生成 API（FastAPI）。

POST /api/generate-level?title=<标题>&difficulty=<难度>，请求体为图片二进制。
任务会异步执行，前端用 GET /api/jobs/<job-id> 展示发布流水线进度。
本地开发默认监听 127.0.0.1；Linux 容器可用环境变量公开 API、跨域白名单和
生成后的关卡静态文件。
"""
from __future__ import annotations

import io
import json
import os
import re
import shutil
import sys
import time
import traceback
from pathlib import Path
from threading import Lock, Thread
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest, urlopen

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from ai_gateway import gateway_status, generate_lineart
from lineart_quality import LineartQualityError, analyse_source_for_lineart, evaluate_lineart, matching_golden_sample
from level_validator import LevelValidationError, validate_level
from subject_preprocess import preprocess_reference_for_lineart

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

PORT = int(os.environ.get("LEVEL_SERVICE_PORT", "5399"))
HOST = os.environ.get("LEVEL_SERVICE_HOST", "127.0.0.1")
MAX_SIZE = 15 * 1024 * 1024  # 15MB
LEVELS_DIR = ROOT / "public" / "levels"
# 线上必须设置为对浏览器可访问的 HTTPS 服务根地址，例如
# https://coloring-levels.example.com。未设置时保留相对路径，兼容本地 Vite。
LEVEL_SERVICE_PUBLIC_ORIGIN = os.environ.get("LEVEL_SERVICE_PUBLIC_ORIGIN", "").strip().rstrip("/")
AI_REFERENCE_UPLOAD_URL = os.environ.get(
    'COLORVERSE_AI_REFERENCE_UPLOAD_URL',
    'https://f.new.ndhy.com/a/coloring-game/api/ai-reference',
)
JOBS: dict[str, dict] = {}
JOBS_LOCK = Lock()


def _csv_env(name: str) -> list[str]:
    return [item.strip().rstrip("/") for item in os.environ.get(name, "").split(",") if item.strip()]


def public_level_url(path: str) -> str:
    """将服务生成的 /levels 文件路径转换为浏览器可直接读取的 URL。"""
    normalized = path if path.startswith("/") else f"/{path}"
    return f"{LEVEL_SERVICE_PUBLIC_ORIGIN}{normalized}" if LEVEL_SERVICE_PUBLIC_ORIGIN else normalized

PIPELINE_STEPS = [
    ("prepare", "接收并校验图片", "检查格式、尺寸与图片内容"),
    ("preprocess", "预处理画面", "统一画布尺寸，准备颜色数据"),
    ("lineart", "生成填色线稿", "使用 Coloring Book Line Art 生成白底黑线稿"),
    ("reinforce", "加固线稿边界", "清理残线、补小断线并统一轮廓笔触"),
    ("quality", "验收线稿质量", "检查密度、边缘残线、闭合区域；基准图额外校验构图"),
    ("segment", "划分主要区域", "以线稿作为边界生成可点击区域蒙版"),
    ("palette", "提取专属调色板", "从原图归纳建议颜色"),
    ("vectorize", "整理可点击区域", "写入区域 ID 与点击映射"),
    ("package", "打包本地关卡", "写入预览图、线稿、Mask 和关卡数据"),
    ("verify", "校验关卡", "检查区域、色板与预览结果"),
]

NUMBER_ART_PIPELINE_STEPS = [
    ("prepare", "接收并校验图片", "检查图片格式、尺寸与可读取性"),
    ("crop", "裁剪画面主体", "自动移除四周空白，保留作品主体比例"),
    ("palette", "提取数字调色板", "用颜色聚类归纳本幅画专属色板"),
    ("pixelize", "生成数字色块", "把画面转成带编号、可逐格点击的像素画"),
    ("package", "打包数字关卡", "写入预览、完成效果、调色板和关卡数据"),
    ("verify", "校验并发布到画册", "确认格子数量、数字和色板一一对应"),
]

# 难度 -> 区域数/色数目标。线稿始终是唯一的视觉边界来源。
DIFFICULTY_PARAMS = {
    "简单": dict(n_seg=280, merge_thresh=18.0, palette_n=8, min_area_ratio=0.0025, target_range=(25, 70)),
    "普通": dict(n_seg=500, merge_thresh=14.0, palette_n=14, min_area_ratio=0.0008, target_range=(45, 130)),
    "困难": dict(n_seg=800, merge_thresh=11.0, palette_n=18, min_area_ratio=0.0004, target_range=(80, 240)),
}

# 图生图的第一候选优先忠实保留构图；若质量门发现照片纹理仍然过密，第二候选
# 不改变参考图、模型或玩法要求，只把背景收敛为少量大轮廓，使其能真正进入填色。
REFERENCE_LINEART_PROMPTS = (
    "严格以参考图为准，将画面改编为可玩的 Coloring Book Line Art 填色线稿。",
    "严格以参考图为准，将画面改编为可玩的 Coloring Book Line Art 填色线稿。"
    "这是同一张参考图的自动重试：保留主要人物/宠物、姿势、表情、手部和最重要的前景物体；"
    "将复杂背景归纳为不超过 6 个大轮廓，不画单片叶子、叶脉、桌面纹理、墙面结构、食物纹理、线缆或小装饰；"
    "优先 35–120 个清晰闭合的可填色区域，而不是还原照片中的每一处细节。",
)

COMPLEX_PHOTO_LINEART_PROMPTS = (
    "COLORVERSE_COMPLEX_PHOTO。严格以参考图为准，将画面改编为可玩的 Coloring Book Line Art 填色线稿。"
    "保留人物/宠物、姿势、表情和关键前景物；背景只保留能说明场景的少量大轮廓，绝不逐一描摹纹理。",
    "COLORVERSE_COMPLEX_PHOTO。严格以同一张参考图为准重新生成可玩的 Coloring Book Line Art 填色线稿。"
    "这是自动重试：保留主体、姿势、表情和一两个关键物体；把密集背景进一步缩减为不超过 4 个大轮廓。"
    "不要画叶片、叶脉、头发丝、桌面纹理、键盘、线缆、食物、墙面细节、小装饰或阴影；"
    "优先 35–120 个清晰闭合的可填色区域。",
)

app = FastAPI(title="ColorVerse Level Generation Service", docs_url=None, redoc_url=None)
# 默认包含现有 FN 前端和局域网/本地调试地址；生产环境可用
# LEVEL_SERVICE_ALLOWED_ORIGINS 追加新的 HTTPS 前端域名。
ALLOWED_ORIGINS = sorted({
    "https://f.new.ndhy.com",
    *_csv_env("LEVEL_SERVICE_ALLOWED_ORIGINS"),
})
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https?://(?:localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(:\d+)?$",
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


def update_job(job_id, step_id=None, step_status=None, message=None, job_status=None, **extra):
    """更新任务；step_status 与 job_status 分开，避免同名参数覆盖。"""
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        if step_id:
            current_index = next((i for i, item in enumerate(job["steps"]) if item["id"] == step_id), -1)
            if current_index >= 0:
                for item in job["steps"][:current_index]:
                    if item["status"] in ("queued", "running"):
                        item["status"] = "completed"
                item = job["steps"][current_index]
                if step_status:
                    item["status"] = step_status
                if message:
                    item["message"] = message
        if job_status == "failed":
            running = next((item for item in reversed(job["steps"]) if item["status"] == "running"), None)
            if running:
                running["status"] = "failed"
        if job_status:
            job["status"] = job_status
        job.update(extra)
        job["updatedAt"] = int(time.time() * 1000)


def _ai_aspect_ratio(width: int, height: int) -> str:
    ratio = width / max(1, height)
    # 旧的 4:3 输出会把 1.42:1 的原图压窄。即梦 5.0 可用规格中，3:2
    # 更接近这类横幅插画，能减少人物与标题被横向重排的概率。
    if ratio >= 1.38:
        return "2496x1664"
    if ratio > 1.15:
        return "2304x1728"
    if ratio < .87:
        return "1728x2304"
    return "2048x2048"


def _upload_preprocessed_reference(image_path: Path) -> str:
    """复用当前站点的 CS 上传接口，让 AIHub 能读取本机预处理后的参考图。

    原图已由浏览器上传过一次；这里仅在高细节照片需要背景归纳时上传一份
    临时 PNG。失败时停止任务，不以原始参考图悄悄绕过预处理节点。
    """
    boundary = f'----ColorVerse{int(time.time() * 1000)}'
    image_bytes = image_path.read_bytes()
    body = b''.join((
        f'--{boundary}\r\n'.encode('ascii'),
        b'Content-Disposition: form-data; name="file"; filename="lineart-reference.png"\r\n',
        b'Content-Type: image/png\r\n\r\n',
        image_bytes,
        f'\r\n--{boundary}--\r\n'.encode('ascii'),
    ))
    request = UrlRequest(
        AI_REFERENCE_UPLOAD_URL,
        data=body,
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}', 'Accept': 'application/json'},
        method='POST',
    )
    try:
        with urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode('utf-8'))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f'预处理参考图上传失败，不能继续 AI 线稿生成：{exc}') from exc
    url = str(payload.get('url') or '').strip() if isinstance(payload, dict) else ''
    if not re.fullmatch(r'https?://[^\s]+', url):
        raise RuntimeError('预处理参考图上传未返回有效的公网地址。')
    return url


def make_level(image_bytes: bytes, title: str, difficulty: str = "普通", progress=None, reference_url: str | None = None):
    from generate_level_v2 import generate_level
    from PIL import Image

    tmp = ROOT / "public" / "levels" / "_uploads_tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    ts = int(time.time() * 1000)
    src = tmp / f"src-{ts}.png"
    if progress:
        progress("prepare", "running", "正在读取并校验上传图片")
    img = Image.open(io.BytesIO(image_bytes))
    img.save(src)  # 统一转 PNG，亦可验证图片合法性
    source_profile = analyse_source_for_lineart(src)
    level_id = f"upload-{ts}"
    out_dir = ROOT / "public" / "levels" / level_id
    lineart_path = out_dir / "lineart.png"
    if progress:
        progress("preprocess", "running", "已完成图片规范化，正在分析主体与背景复杂度")

    golden = matching_golden_sample(src)
    preprocess_info = {
        'applied': False,
        'engine': 'not-required',
        'message': '画面细节密度适中，保留原始参考图构图。',
    }
    lineart_reference_url = reference_url
    if golden:
        # 同一原图曾经已有验收通过的线稿时，优先使用确定性产物。这样用户再次
        # 选择同一图片会得到同一关，而不是让图生图模型无谓重绘一次。
        lineart_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(golden["lineart"], lineart_path)
        quality = evaluate_lineart(lineart_path, source_path=src)
        lineart_info = {
            "lineCoverage": quality["metrics"]["lineCoverage"],
            "engine": "verified-golden-sample",
            "quality": quality,
            "goldenSample": {"id": golden["id"], "name": golden["name"]},
        }
        if progress:
            progress("preprocess", "completed", "已命中历史验收样本，无需再次处理参考图")
            progress("lineart", "running", "正在读取历史验收线稿")
            progress("lineart", "completed", f"命中历史验收样本《{golden['name']}》，复用干净线稿")
    elif reference_url:
        if source_profile and source_profile['requiresBackgroundSimplification']:
            preprocessed_path = tmp / f'lineart-reference-{ts}.png'
            preprocess_info = preprocess_reference_for_lineart(src, preprocessed_path)
            if progress:
                progress("preprocess", "running", f"{preprocess_info['message']} 正在上传 AI 参考版本")
            lineart_reference_url = _upload_preprocessed_reference(preprocessed_path)
            out_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(preprocessed_path, out_dir / 'reference_preprocessed.png')
        if progress:
            progress("preprocess", "completed", preprocess_info['message'])
            progress("lineart", "running", "正在生成 Coloring Book Line Art")
        # 本机收到的是原图字节；AIHub 需读取同一张图的 CS 公网临时地址。
        # 输出线稿再与原图一起进入区域分割，完成色板始终来自用户原图。
        def ai_report(step_id, status="running", message=None):
            if not progress:
                return
            if step_id == "reinforce":
                progress("reinforce", status, message)
            elif step_id == "quality":
                progress("quality", status, message)
            else:
                progress("lineart", status, message)

        prompts = COMPLEX_PHOTO_LINEART_PROMPTS if source_profile and source_profile['requiresBackgroundSimplification'] else REFERENCE_LINEART_PROMPTS
        prompt_strategy = '复杂真人照片：优先主体保留与背景强简化' if prompts is COMPLEX_PHOTO_LINEART_PROMPTS else '标准图片：主体保留与闭合轮廓'
        ai_attempts = []
        ai_result = None
        for attempt_index, attempt_prompt in enumerate(prompts, start=1):
            if attempt_index > 1 and progress:
                previous = ai_attempts[-1]["quality"]
                progress("lineart", "running", f"第 1 次未通过：{previous['summary']}；正在用同一原图自动生成强简化候选（2/2）")
            candidate = generate_lineart(
                attempt_prompt,
                progress=ai_report,
                reference_url=lineart_reference_url,
                aspect_ratio=_ai_aspect_ratio(img.width, img.height),
                source_path=src,
            )
            ai_attempts.append({"attempt": attempt_index, "id": candidate["id"], "quality": candidate["quality"]})
            ai_result = candidate
            if candidate["quality"]["passed"]:
                break
        assert ai_result is not None
        quality = ai_result["quality"]
        quality["retry"] = {
            "maxAttempts": len(prompts),
            "attempted": len(ai_attempts),
            "autoRetried": len(ai_attempts) > 1,
            "exhausted": not quality["passed"],
            "strategy": f"{prompt_strategy}；第二次仅强化背景简化与闭合区域约束，参考图、模型和玩法要求不变。",
        }
        quality["attempts"] = [{
            "attempt": item["attempt"],
            "id": item["id"],
            "passed": item["quality"]["passed"],
            "summary": item["quality"]["summary"],
        } for item in ai_attempts]
        generated_lineart = ROOT / "public" / str(ai_result["lineart"]).lstrip("/")
        if not generated_lineart.is_file():
            raise RuntimeError("AIHub 已返回线稿，但本地线稿文件未找到。")
        lineart_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(generated_lineart, lineart_path)
        lineart_info = {
            "lineCoverage": ai_result["quality"]["metrics"]["lineCoverage"],
            "engine": "aihub-reference-image",
            "quality": ai_result["quality"],
        }
    else:
        if progress:
            progress("preprocess", "completed", "未提供 AIHub 参考图，使用本地线稿检测路径")
            progress("lineart", "running", "正在通过本地 LineartDetector 生成线稿")
        # 容器的正式路径传入 CS 参考图并使用 AIHub，因此无需为了少数本地
        # 回退请求而把 Torch/ControlNet 模型预装进所有 Linux 服务实例。
        from coloring_book_lineart import create_lineart
        lineart_info = create_lineart(src, lineart_path)
        lineart_info["quality"] = evaluate_lineart(lineart_path, source_path=src)
    if progress:
        progress("reinforce", "completed", "已完成断线闭合、边角残线清理与轮廓加固")
        progress("quality", "running", "正在检查线条密度、留白和可填色轮廓")
    quality = lineart_info["quality"]
    if not quality["passed"]:
        if progress:
            progress("quality", "failed", quality["summary"])
        raise LineartQualityError(quality)
    if progress:
        progress("quality", "completed", quality["summary"])
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "lineart_quality.json").write_text(json.dumps({
        "engine": lineart_info["engine"],
        "goldenSample": lineart_info.get("goldenSample"),
        "preprocess": preprocess_info,
        "qualityGate": quality,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    params = DIFFICULTY_PARAMS.get(difficulty, DIFFICULTY_PARAMS["普通"])
    level = generate_level(src, lineart_path, out_dir, level_id, title or level_id, progress=progress, **params)
    level["difficulty"] = difficulty if difficulty in DIFFICULTY_PARAMS else "普通"
    level["lineartQuality"] = f"/levels/{level_id}/lineart_quality.json"
    (out_dir / "level.json").write_text(json.dumps(level, ensure_ascii=False), encoding="utf-8")
    source_path = out_dir / 'source.json'
    source_record = json.loads(source_path.read_text(encoding='utf-8'))
    source_record.update({
        'referenceImageUrl': reference_url,
        'lineartReferenceUrl': lineart_reference_url,
        'preprocess': preprocess_info,
        'authorization': 'user-provided upload; user is responsible for having rights to use the image',
    })
    source_path.write_text(json.dumps(source_record, ensure_ascii=False, indent=2), encoding='utf-8')
    if progress:
        progress('verify', 'running', '正在校验关卡产物、Mask 连通性和最小可点击区域')
    validation = validate_level(out_dir)
    (out_dir / 'level_validation.json').write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding='utf-8')
    level['validation'] = f'/levels/{level_id}/level_validation.json'
    (out_dir / 'level.json').write_text(json.dumps(level, ensure_ascii=False), encoding='utf-8')
    if not validation['passed']:
        if progress:
            progress('verify', 'failed', validation['summary'])
        raise LevelValidationError(validation)
    if progress:
        progress('verify', 'completed', validation['summary'])
    lineart_info['validation'] = validation
    return level_id, level, lineart_info


def run_job(job_id, image_bytes, title, difficulty, reference_url=None):
    try:
        def report(step_id, status="running", message=None):
            update_job(job_id, step_id, step_status=status, message=message)

        update_job(job_id, job_status="running")
        level_id, level, lineart_info = make_level(image_bytes, title, difficulty, report, reference_url=reference_url)
        update_job(job_id, "verify", step_status="completed", message=lineart_info['validation']['summary'], job_status="completed", result={
            "id": level_id,
            "url": public_level_url(f"/levels/{level_id}/level.json"),
            "title": level["title"],
            "regions": len(level["regions"]),
            "colors": len(level["palette"]),
            "lineart": public_level_url(f"/levels/{level_id}/lineart.png"),
            "regionMask": public_level_url(f"/levels/{level_id}/region_mask.png"),
            "regionMaskWeb": public_level_url(f"/levels/{level_id}/region_mask_web.png"),
            "verify": public_level_url(f"/levels/{level_id}/verify_fill.png"),
            "lineCoverage": lineart_info["lineCoverage"],
            "quality": lineart_info["quality"],
            "validation": lineart_info['validation'],
        })
    except LineartQualityError as exc:
        update_job(job_id, job_status="failed", error=str(exc), quality=exc.report)
    except LevelValidationError as exc:
        update_job(job_id, job_status='failed', error=str(exc), validation=exc.report)
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        update_job(job_id, job_status="failed", error=str(exc))


def make_number_image_level(image_bytes: bytes, title: str, difficulty: str, category: str, progress=None):
    from generate_number_art_level import generate_number_art_level

    from PIL import Image
    image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
    level_id = f"number-level-{int(time.time() * 1000)}"
    output = ROOT / "public" / "levels" / level_id
    source = output / "_source.png"
    output.mkdir(parents=True, exist_ok=True)
    image.save(source)
    level = generate_number_art_level(source, output, level_id, title or "数字填色作品", difficulty, category or "世界名画", progress)
    source.unlink(missing_ok=True)
    return level_id, level


def run_number_image_job(job_id, image_bytes, title, difficulty, category):
    try:
        def report(step_id, status="running", message=None):
            update_job(job_id, step_id, step_status=status, message=message)

        update_job(job_id, job_status="running")
        level_id, level = make_number_image_level(image_bytes, title, difficulty, category, report)
        update_job(job_id, "verify", step_status="completed", message="数字、色板与完成效果校验完成", job_status="completed", result={
            "id": level_id,
            "url": f"/levels/{level_id}/level.json",
            "title": level["title"],
            "regions": len(level["regions"]),
            "colors": len(level["palette"]),
            "preview": level["preview"],
            "verify": level["verify"],
            "source": level["source"],
            "columns": level["pixelGrid"]["columns"],
            "rows": level["pixelGrid"]["rows"],
        })
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        update_job(job_id, job_status="failed", error=str(exc))


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "engine": "fastapi",
        "pipeline": "coloring-book-lineart",
        "publicOrigin": LEVEL_SERVICE_PUBLIC_ORIGIN or None,
        "levelsPath": "/levels",
        "aiGateway": gateway_status(),
    }


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        payload = json.loads(json.dumps(job, ensure_ascii=False)) if job else None
    if payload is None:
        raise HTTPException(status_code=404, detail="任务不存在或已过期")
    return payload


@app.post("/api/generate-level", status_code=202)
async def generate_level(request: Request, title: str = "", difficulty: str = "普通", reference_url: str = ""):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_SIZE:
        raise HTTPException(status_code=413, detail="图片超过 15MB")
    image_bytes = await request.body()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="空请求体")
    if len(image_bytes) > MAX_SIZE:
        raise HTTPException(status_code=413, detail="图片超过 15MB")
    job_id = f"job-{int(time.time() * 1000)}"
    now = int(time.time() * 1000)
    with JOBS_LOCK:
        JOBS[job_id] = {
            "id": job_id,
            "status": "queued",
            "title": title or "我的填色画",
            "difficulty": difficulty,
            # 仅保存本次任务已上传的临时公开参考图，用于前端在刷新后恢复“输入图片 → 流水线”的完整上下文。
            "referenceUrl": reference_url.strip() or None,
            "createdAt": now,
            "updatedAt": now,
            "steps": [{"id": key, "title": name, "description": detail, "status": "queued"} for key, name, detail in PIPELINE_STEPS],
            "result": None,
            "error": None,
        }
    Thread(target=run_job, args=(job_id, image_bytes, title, difficulty, reference_url.strip() or None), daemon=True).start()
    return JSONResponse(status_code=202, content={"jobId": job_id})


@app.get("/api/ai-gateway/status")
def ai_gateway_status():
    return gateway_status()


@app.post("/api/import-number-image", status_code=201)
async def import_number_image(request: Request, title: str = "", difficulty: str = "困难", category: str = "世界名画"):
    image_bytes = await request.body()
    if not image_bytes or len(image_bytes) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="请上传不超过 15MB 的图片")
    try:
        level_id, level = make_number_image_level(image_bytes, title, difficulty, category)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"数字填色关卡生成失败：{exc}") from exc
    return JSONResponse(status_code=201, content={
        "id": level_id,
        "url": public_level_url(f"/levels/{level_id}/level.json"),
        "title": level["title"],
        "regions": len(level["regions"]),
        "colors": len(level["palette"]),
    })


@app.post("/api/generate-number-level", status_code=202)
async def generate_number_level(request: Request, title: str = "", difficulty: str = "困难", category: str = "世界名画"):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_SIZE:
        raise HTTPException(status_code=413, detail="图片超过 15MB")
    image_bytes = await request.body()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="请先选择一张图片")
    if len(image_bytes) > MAX_SIZE:
        raise HTTPException(status_code=413, detail="图片超过 15MB")
    job_id = f"number-job-{int(time.time() * 1000)}"
    now = int(time.time() * 1000)
    with JOBS_LOCK:
        JOBS[job_id] = {
            "id": job_id,
            "status": "queued",
            "title": title or "数字填色作品",
            "difficulty": difficulty,
            "category": category,
            "createdAt": now,
            "updatedAt": now,
            "steps": [{"id": key, "title": name, "description": detail, "status": "queued"} for key, name, detail in NUMBER_ART_PIPELINE_STEPS],
            "result": None,
            "error": None,
        }
    Thread(target=run_number_image_job, args=(job_id, image_bytes, title, difficulty, category), daemon=True).start()
    return JSONResponse(status_code=202, content={"jobId": job_id})


# 关卡文件和输出图片必须由生产线服务本身公开；否则前端只能拿到 job 完成
# 状态，却无法读取新生成的 level.json / lineart / mask。
app.mount("/levels", StaticFiles(directory=LEVELS_DIR, check_dir=False), name="levels")


if __name__ == "__main__":
    import uvicorn

    print(f"关卡生成服务已启动: http://{HOST}:{PORT}", flush=True)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
