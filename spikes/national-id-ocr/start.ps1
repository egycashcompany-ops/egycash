# Start the National ID OCR on its own: the OCR service plus the test pages.
#
#   powershell -ExecutionPolicy Bypass -File start.ps1            # PaddleOCR (default)
#   powershell -ExecutionPolicy Bypass -File start.ps1 -Rebuild   # rebuild the image first
#
# Needs only Docker Desktop and Python 3 on this PC. Everything runs from this folder.
param([switch]$Rebuild)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if ($Rebuild -or -not (docker images -q ecms/nid-ocr-spike:latest)) {
    Write-Host "Building the OCR image (the first build downloads the models; a few minutes)..."
    docker build -t ecms/nid-ocr-spike:latest .
}

# The service (port 8099), with PaddleOCR loaded.
powershell -ExecutionPolicy Bypass -File tools/use_reader.ps1 paddle

# The test pages (8101 PaddleOCR, 8102 PaddleOCR-VL, 8103 Qwen), restarted if already running.
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -match 'compare_ui|test_ui' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process python -WindowStyle Hidden -WorkingDirectory $PSScriptRoot -ArgumentList 'tools/compare_ui.py'
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Ready:"
Write-Host "  PaddleOCR     http://127.0.0.1:8101"
Write-Host "  PaddleOCR-VL  http://127.0.0.1:8102   (first: docker build --target paddleocr-vl -t ecms/nid-ocr-spike:paddleocr-vl .)"
Write-Host "  Qwen          http://127.0.0.1:8103   (first: docker build --target qwen -t ecms/nid-ocr-spike:qwen .)"
Start-Process "http://127.0.0.1:8101"
