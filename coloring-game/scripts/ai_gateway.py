"""AIHub 图生图适配层：用户参考图 -> 即梦 5.0 Coloring Book Line Art。

严格遵循 aihub-asset-production 的 run -> status -> outputs 三段式流程。
鉴权优先读取 AIHUB_AGENT_TOKEN 环境变量；本地开发也可读取被 Git 忽略的
``aihub.local.env``。即梦工作流 App ID 是固定的公开能力标识，直接由本模块维护；
只有 Token 需要由本机文件或 Linux 服务端环境变量提供。
"""
from __future__ import annotations

import io
import json
import os
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
LOCAL_TOKEN_FILE = ROOT / 'aihub.local.env'
AIHUB_BASE_URL = 'https://bv.new.ndhy.com/api/agent/aihub'
WORKFLOW_ALIAS = 'jimeng'
# AIHub 即梦图生图工作流的公开能力标识；它不是 Token，不能用于鉴权。
WORKFLOW_APP_ID = 'e5fd4410-b1ac-4418-a83d-b1f7989c2f4a'
URL_PATTERN = re.compile(r'https?://[^\s"\'<>\]\)]+', re.IGNORECASE)

# 即梦的“黑白线稿”并不等同于能玩填色本。该约束要求封闭、稳定的外轮廓，
# 并禁止参考图中蝴蝶那类断笔/颗粒/画布残线。
COLORING_BOOK_QUALITY_CONSTRAINT = '''

COLORVERSE_COLORING_BOOK_V2. Produce a premium children's coloring-book page,
not a sketch. Use only solid black, smooth, rounded ink outlines on a pure white
background. Every major object and every intended paintable area must have a
clearly closed contour. Keep a single consistent medium-bold stroke weight,
large readable shapes, a clean hierarchy of foreground and background, and a
small blank safety margin around all four canvas edges. Do not use pencil
texture, stippling, hatching, dashed or broken strokes, faint gray lines,
scribbles, clipped edge marks, panel borders, shadows, fills, gradients,
color, text, letters, numbers, grids, watermarks, photorealism, or tiny noise.
'''.strip()

# 图生图与文生图的约束不能混用：文生图应避免文字，而用户上传的作品
# 可能本身就有标题或牌子。图生图优先锁定原图构图，再把视觉语言收敛为
# 可填色的黑白线稿。
REFERENCE_COLORING_BOOK_CONSTRAINT = '''

COLORVERSE_REFERENCE_COLORING_BOOK_V1. Use the supplied reference image as the
only composition reference. Preserve the main subjects, their count, pose,
placement, camera framing and important foreground/background objects. Redraw
the same scene rather than inventing a variation or a new composition. Preserve
any readable title as the same words in the same relative location. Render it
as a premium children's coloring-book page: pure white
background, solid black smooth rounded outlines, consistent medium-bold stroke
weight and clearly closed contours around all intended paintable areas. Simplify
photo texture, painterly brush marks and tiny decorations into large readable
shapes. Do not add or remove main objects, do not crop the composition, do not
use color, gray, shading, hatching, stippling, sketch texture, broken strokes,
grids, watermarks or borders. If the reference includes a prominent short title,
redraw it as clean outline lettering only; otherwise do not invent text.
'''.strip()

REFERENCE_COMPLEX_PHOTO_CONSTRAINT = '''

COLORVERSE_REFERENCE_COMPLEX_PHOTO_V1. Use the supplied reference image as the
only composition reference. Preserve the main person or animal, their count,
pose, expression, camera framing and the one or two most important foreground
objects. This is a high-detail real photo: do not trace every leaf, hair strand,
plant pot, laptop key, cable, food item, wall texture, shadow or small decor.
Replace busy backgrounds with at most six large, clearly separated silhouette
groups. Keep only broad foreground/background shapes needed to read the scene.
Redraw it as a premium children's coloring-book page: pure white background,
solid black smooth rounded outlines, consistent medium-bold stroke weight and
clearly closed contours around all intended paintable areas. Prefer 35–120
large closed paintable regions. Do not crop or invent subjects. Do not use
color, gray, shading, hatching, stippling, sketch texture, broken strokes,
grids, watermarks, borders, text, letters or numbers unless the supplied
reference has one short, essential title.
'''.strip()


def _token_from_local_file() -> str:
    """读取本机私有配置；文件被 Git 忽略，且不会传给浏览器。"""
    if not LOCAL_TOKEN_FILE.is_file():
        return ''
    try:
        for raw_line in LOCAL_TOKEN_FILE.read_text(encoding='utf-8').splitlines():
            line = raw_line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            if key.strip() == 'AIHUB_AGENT_TOKEN':
                return value.strip().strip('"').strip("'")
    except OSError:
        return ''
    return ''


def _token() -> str:
    return os.environ.get('AIHUB_AGENT_TOKEN', '').strip() or _token_from_local_file()


def _workflow_app_id() -> str:
    """返回固定的即梦工作流标识；鉴权始终由 AIHUB_AGENT_TOKEN 完成。"""
    return WORKFLOW_APP_ID


def gateway_status() -> dict[str, Any]:
    configured = bool(_token())
    missing = []
    if not _token():
        missing.append('AIHUB_AGENT_TOKEN')
    return {
        'configured': configured,
        'workflowAlias': WORKFLOW_ALIAS,
        'model': '即梦5.0',
        'missing': missing,
        'hint': '本地可在 aihub.local.env 配置 Token；Linux 服务只须配置 AIHUB_AGENT_TOKEN。',
    }


def _headers() -> dict[str, str]:
    token = _token()
    if not token:
        raise RuntimeError('AIHub 未配置：请在项目根目录的 aihub.local.env 填写 AIHUB_AGENT_TOKEN，或配置服务环境变量。')
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json; charset=utf-8'}


def _read_json(request: Request, timeout: int = 30) -> dict[str, Any]:
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='replace')[:500]
        raise RuntimeError(f'AIHub 请求失败（HTTP {exc.code}）：{detail}') from exc
    except URLError as exc:
        raise RuntimeError(f'无法连接 AIHub：{exc.reason}') from exc
    try:
        payload = json.loads(raw.decode('utf-8'))
    except json.JSONDecodeError as exc:
        raise RuntimeError('AIHub 返回的不是 JSON') from exc
    if not isinstance(payload, dict):
        raise RuntimeError('AIHub 返回格式不正确')
    return payload


def _post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    request = Request(f'{AIHUB_BASE_URL}{path}', data=body, headers=_headers(), method='POST')
    return _read_json(request)


def _get(path: str) -> dict[str, Any]:
    return _read_json(Request(f'{AIHUB_BASE_URL}{path}', headers=_headers(), method='GET'))


def _urls_in(value: Any) -> list[str]:
    if isinstance(value, str):
        return URL_PATTERN.findall(value)
    if isinstance(value, list):
        return [url for item in value for url in _urls_in(item)]
    if isinstance(value, dict):
        ordered: list[str] = []
        for key in ('image_url_list', 'image_url', 'images', 'image', 'url', 'output', 'files', 'outputs', 'data'):
            if key in value:
                ordered.extend(_urls_in(value[key]))
        for key, item in value.items():
            if key not in {'image_url_list', 'image_url', 'images', 'image', 'url', 'output', 'files', 'outputs', 'data'}:
                ordered.extend(_urls_in(item))
        return ordered
    return []


def _validate_reference_url(reference_url: str) -> str:
    """AIHub 图生图只接受其服务端可拉取的公网 HTTPS/HTTP 地址。"""
    value = reference_url.strip()
    parsed = urlparse(value)
    if parsed.scheme not in {'https', 'http'} or not parsed.netloc:
        raise RuntimeError('参考图地址必须是 AIHub 可访问的 HTTP/HTTPS 地址。')
    host = (parsed.hostname or '').lower()
    if host in {'localhost', '127.0.0.1', '0.0.0.0'} or host.startswith('192.168.') or host.startswith('10.'):
        raise RuntimeError('参考图不能使用本机或局域网地址；请先上传到内容存储。')
    # 参考图 URL 会由 AIHub 服务端再次拉取。先在调用侧做轻量可达性校验，
    # 避免把 403/404/过期签名 URL 发送给一个耗时的异步工作流。
    try:
        with urlopen(Request(value, headers={'User-Agent': 'ColorVerse-local/1.0'}, method='HEAD'), timeout=20):
            return value
    except (HTTPError, URLError, TimeoutError):
        try:
            request = Request(value, headers={'User-Agent': 'ColorVerse-local/1.0', 'Range': 'bytes=0-0'})
            with urlopen(request, timeout=20) as response:
                response.read(1)
                return value
        except (HTTPError, URLError, TimeoutError) as exc:
            raise RuntimeError(f'参考图地址不可访问或已过期：{exc}') from exc


def _error_message(payload: dict[str, Any]) -> str:
    error = payload.get('error') or payload.get('aiHubError') or payload.get('lastPollError') or {}
    if isinstance(error, dict):
        return str(error.get('message') or error.get('detail') or json.dumps(error, ensure_ascii=False))
    return str(error or payload.get('message') or '工作流执行失败')


def _wait_for_result(run_id: str, timeout_seconds: int = 20 * 60) -> dict[str, Any]:
    started = time.monotonic()
    while time.monotonic() - started < timeout_seconds:
        status = _get(f'/workflows/runs/{run_id}')
        state = status.get('status')
        if state == 'succeeded':
            return _get(f'/workflows/runs/{run_id}/outputs')
        if state in {'failed', 'stopped'}:
            raise RuntimeError(f'AIHub 工作流 {state}：{_error_message(status)}')
        time.sleep(10)
    raise RuntimeError('AIHub 文生图等待超过 20 分钟，任务已停止等待。')


def generate_lineart(
    prompt: str,
    progress=None,
    reference_url: str | None = None,
    aspect_ratio: str = '1728x2304',
    source_path: str | Path | None = None,
) -> dict[str, Any]:
    """执行即梦 5.0 的文生图或带参考图图生图，并下载为本地线稿 PNG。"""
    if not _token():
        raise RuntimeError('AIHub 未配置：请打开项目根目录的 aihub.local.env，在 AIHUB_AGENT_TOKEN= 后填入 bvk_ 开头的凭证并保存。该文件仅供本机使用，不会提交到 Git。')
    clean_prompt = prompt.strip()
    if len(clean_prompt) < 4:
        raise RuntimeError('提示词至少需要 4 个字符')
    if len(clean_prompt) > 1200:
        raise RuntimeError('提示词不能超过 1200 个字符')
    reference = _validate_reference_url(reference_url) if reference_url else ''
    complex_reference = 'COLORVERSE_COMPLEX_PHOTO' in clean_prompt
    quality_constraint = (
        REFERENCE_COMPLEX_PHOTO_CONSTRAINT if reference and complex_reference
        else REFERENCE_COLORING_BOOK_CONSTRAINT if reference
        else COLORING_BOOK_QUALITY_CONSTRAINT
    )
    constraint_marker = (
        'COLORVERSE_REFERENCE_COMPLEX_PHOTO_V1' if reference and complex_reference
        else 'COLORVERSE_REFERENCE_COLORING_BOOK_V1' if reference
        else 'COLORVERSE_COLORING_BOOK_V2'
    )
    if constraint_marker not in clean_prompt:
        clean_prompt = f'{clean_prompt}\n\n{quality_constraint}'

    inputs = {
        'prompt': clean_prompt,
        'aspect_ratio': aspect_ratio,
        'version': '即梦5.0',
        'count': 1,
        'is_expert': '否',
    }
    if reference:
        inputs['image_urls'] = reference
    run = _post('/workflows/run', {
        'appId': _workflow_app_id(),
        'inputs': inputs,
        'meta': {'label': 'colorverse-coloring-book-lineart'},
    })
    run_id = str(run.get('runId') or run.get('id') or '')
    if not run_id:
        raise RuntimeError(f'AIHub 未返回 runId：{json.dumps(run, ensure_ascii=False)[:500]}')

    outputs = _wait_for_result(run_id)
    image_urls = _urls_in(outputs)
    if not image_urls:
        raise RuntimeError('AIHub 工作流已完成，但 outputs 中没有图片 URL。')
    image_url = image_urls[0]
    if progress:
        progress('download', 'running', '已收到模型结果，正在下载并校验图片')
    try:
        with urlopen(Request(image_url, headers={'User-Agent': 'ColorVerse-local/1.0'}), timeout=60) as response:
            image_bytes = response.read(15 * 1024 * 1024 + 1)
    except (HTTPError, URLError) as exc:
        raise RuntimeError(f'无法下载 AIHub 返回的图片：{exc}') from exc
    if not image_bytes or len(image_bytes) > 15 * 1024 * 1024:
        raise RuntimeError('AIHub 返回的图片为空或超过 15MB')

    from PIL import Image
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
        image.load()
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError('AIHub 返回内容不是有效图片') from exc

    output_id = f'lineart-candidate-{int(time.time() * 1000)}'
    output_dir = ROOT / 'public' / '_lineart-candidates' / output_id
    output_dir.mkdir(parents=True, exist_ok=True)
    image.save(output_dir / 'lineart_raw.png', 'PNG', optimize=True)
    if progress:
        progress('reinforce', 'running', '正在清理角落残线、补小断线并加固轮廓')
    from lineart_reinforcement import add_white_safety_margin, reinforce_lineart
    from lineart_quality import evaluate_lineart

    # 第一份候选保留标准笔触。若模型把真实纹理画得过密，第二份只是确定性的
    # 细纹理清理版本（不再调用模型，不修改质量门），避免“加粗”反而放大问题。
    candidates: list[tuple[Image.Image, dict[str, Any], dict[str, Any]]] = []
    default_lineart, default_reinforcement = reinforce_lineart(image)
    default_quality = evaluate_lineart(default_lineart, source_path=source_path)
    candidates.append((default_lineart, default_reinforcement, default_quality))
    coverage_check = next((item for item in default_quality['checks'] if item['id'] == 'coverage'), None)
    edge_check = next((item for item in default_quality['checks'] if item['id'] == 'edge'), None)
    if (coverage_check and not coverage_check['passed']) or (edge_check and not edge_check['passed']):
        if progress:
            progress('reinforce', 'running', '检测到线条过密或边缘残线，正在保守清理浅灰纹理')
        for threshold, close_iterations, dilate_iterations in ((205, 1, 0), (190, 0, 0)):
            candidate_lineart, candidate_reinforcement = reinforce_lineart(
                image,
                threshold=threshold,
                close_iterations=close_iterations,
                dilate_iterations=dilate_iterations,
            )
            candidate_lineart = add_white_safety_margin(candidate_lineart)
            candidate_reinforcement['safetyMarginRatio'] = 0.035
            candidate_reinforcement['method'] += '+white-safety-margin'
            candidate_quality = evaluate_lineart(candidate_lineart, source_path=source_path)
            candidates.append((candidate_lineart, candidate_reinforcement, candidate_quality))

    def candidate_score(item: tuple[Image.Image, dict[str, Any], dict[str, Any]]) -> tuple[int, int, float]:
        quality = item[2]
        failed_count = sum(1 for check in quality['checks'] if not check['passed'])
        fillable = int(quality['metrics']['fillableRegionsEstimate'])
        coverage = float(quality['metrics']['lineCoverage'])
        return (0 if quality['passed'] else 1, failed_count, -fillable if quality['passed'] else abs(coverage - 5.5))

    lineart, reinforcement, quality = min(candidates, key=candidate_score)
    reinforcement['candidatesTried'] = [
        {'method': item[1]['method'], 'lineCoverage': item[2]['metrics']['lineCoverage'], 'passed': item[2]['passed']}
        for item in candidates
    ]
    lineart.save(output_dir / 'lineart.png', 'PNG', optimize=True)
    (output_dir / 'source.json').write_text(json.dumps({
        'workflowAlias': WORKFLOW_ALIAS,
        'model': '即梦5.0',
        'runId': run_id,
        'prompt': clean_prompt,
        'referenceUrl': reference or None,
        'imageUrl': image_url,
        'generatedAt': int(time.time() * 1000),
        'rawLineart': f'/_lineart-candidates/{output_id}/lineart_raw.png',
        'reinforcement': reinforcement,
        'qualityGate': quality,
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    return {
        'id': output_id,
        'lineart': f'/_lineart-candidates/{output_id}/lineart.png',
        'rawLineart': f'/_lineart-candidates/{output_id}/lineart_raw.png',
        'source': f'/_lineart-candidates/{output_id}/source.json',
        'workflowRunId': run_id,
        'workflowAlias': WORKFLOW_ALIAS,
        'referenceUrl': reference or None,
        'width': lineart.width,
        'height': lineart.height,
        'reinforcement': reinforcement,
        'quality': quality,
    }
