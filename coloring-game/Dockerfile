# AIHub 驱动的 Coloring Book Line Art 关卡生产线。
# 主路径只做图像预处理、线稿加固、分区与打包，CPU 即可；不需要 GPU。
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    LEVEL_SERVICE_HOST=0.0.0.0 \
    LEVEL_SERVICE_PORT=8080

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-server.txt ./
RUN python -m pip install --upgrade pip \
    && python -m pip install -r requirements-server.txt

COPY scripts ./scripts
COPY public ./public

RUN mkdir -p /app/public/levels

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os; from urllib.request import urlopen; urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('LEVEL_SERVICE_PORT', '8080'), timeout=3)"

CMD ["python", "scripts/level_service.py"]
