"""ColorVerse 正式版本机生成节点。

节点只发起到云端的 HTTPS 请求，不开放本机端口。它领取一项任务后，
下载用户已上传到对象存储的图片，调用本地数字填色生成器，再把结果回传。
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import sys
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from generate_number_art_level import generate_number_art_level


HUB_URL = os.environ.get('GENERATION_HUB_URL', 'https://f.new.ndhy.com/a/coloring-game/api/generator-node').strip()
NODE_TOKEN = os.environ.get('GENERATOR_NODE_TOKEN', '').strip()
NODE_ID = os.environ.get('GENERATOR_NODE_ID', os.environ.get('COMPUTERNAME', 'colorverse-node')).strip()
POLL_SECONDS = max(1.0, float(os.environ.get('GENERATION_NODE_POLL_SECONDS', '2')))
WORK_ROOT = ROOT / '.generation-node-work'


def request_json(payload: dict, timeout: int = 60):
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    request = urllib.request.Request(HUB_URL, data=body, method='POST', headers={
        'content-type': 'application/json',
        'x-generator-node-token': NODE_TOKEN,
    })
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if response.status == 204:
                return None
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'云端节点接口返回 {exc.code}: {detail}') from exc


def download(url: str, target: Path):
    request = urllib.request.Request(url, headers={'user-agent': 'ColorVerse-generation-node/1.0'})
    with urllib.request.urlopen(request, timeout=90) as response:
        target.write_bytes(response.read())


def as_base64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode('ascii')


def process(job: dict):
    job_id = str(job['jobId'])
    safe_id = ''.join(char for char in job_id if char.isalnum() or char in '-_')
    if not safe_id:
        raise RuntimeError('任务标识不合法')
    work = WORK_ROOT / safe_id
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    try:
        source = work / 'source-image'
        download(str(job['sourceUrl']), source)
        output = work / 'output'
        level = generate_number_art_level(source, output, f'cloud-{safe_id}', str(job['title']), str(job['difficulty']), str(job['category']))
        return {
            'action': 'complete',
            'nodeId': NODE_ID,
            'jobId': job_id,
            'level': level,
            'previewBase64': as_base64(output / 'preview.png'),
            'verifyBase64': as_base64(output / 'verify_fill.png'),
        }
    finally:
        if work.exists():
            shutil.rmtree(work)


def main():
    if not NODE_TOKEN:
        raise SystemExit('请设置 GENERATOR_NODE_TOKEN 后再启动生成节点。')
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    print(f'ColorVerse 生成节点已启动：{NODE_ID}', flush=True)
    print(f'任务中心：{HUB_URL}', flush=True)
    while True:
        try:
            claimed = request_json({'action': 'claim', 'nodeId': NODE_ID}, timeout=20)
            job = claimed.get('job') if isinstance(claimed, dict) else None
            if not job:
                time.sleep(POLL_SECONDS)
                continue
            print(f'领取任务：{job["jobId"]}', flush=True)
            try:
                response = request_json(process(job), timeout=120)
                print(f'任务完成：{job["jobId"]} → {response.get("levelUrl", "") if response else ""}', flush=True)
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                request_json({'action': 'fail', 'nodeId': NODE_ID, 'jobId': job['jobId'], 'error': str(exc)}, timeout=30)
        except KeyboardInterrupt:
            print('生成节点已停止。', flush=True)
            return
        except Exception as exc:  # noqa: BLE001
            print(f'节点连接异常：{exc}', flush=True)
            time.sleep(max(POLL_SECONDS, 5))


if __name__ == '__main__':
    main()
