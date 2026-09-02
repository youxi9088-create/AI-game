param(
  [string]$PythonPath = ''
)

$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root '.venv-ai'
$requirements = Join-Path $root 'requirements-ai.txt'

if ([string]::IsNullOrWhiteSpace($PythonPath)) {
  # 优先使用 Windows Python Launcher，避免把开发者个人安装目录写进项目。
  $discovered = & py -3.11 -c 'import sys; print(sys.executable)' 2>$null
  if ($LASTEXITCODE -eq 0 -and $discovered) {
    $PythonPath = $discovered.Trim()
  }
}

if (-not (Test-Path -LiteralPath $PythonPath)) {
  throw "未自动找到 Python 3.11。请传入可用路径，例如：.\scripts\setup_ai_env.ps1 -PythonPath 'D:\Python311\python.exe'"
}

& $PythonPath -m venv $venv
& (Join-Path $venv 'Scripts\python.exe') -m pip install --upgrade pip
& (Join-Path $venv 'Scripts\python.exe') -m pip install torch==2.13.0+cu126 torchvision==0.28.0+cu126 --index-url https://download.pytorch.org/whl/cu126
& (Join-Path $venv 'Scripts\python.exe') -m pip install -r $requirements 'uvicorn[standard]' pydantic
