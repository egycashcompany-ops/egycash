# Start the National ID OCR on Windows: the OCR service (Docker) plus the test page.
#
#   powershell -ExecutionPolicy Bypass -File start.ps1            # start
#   powershell -ExecutionPolicy Bypass -File start.ps1 -Phone     # also open the page to phones on this Wi-Fi
#   powershell -ExecutionPolicy Bypass -File start.ps1 -Rebuild   # rebuild the image first (after code changes)
#   powershell -ExecutionPolicy Bypass -File start.ps1 -Stop      # stop everything
#
# Needs Docker Desktop (running) and Python 3. Everything runs on this computer; nothing is sent out.
param([switch]$Rebuild, [switch]$Phone, [switch]$Stop)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$Image = "ecms/nid-ocr:latest"
$Container = "nid-ocr-serve"

function Stop-TestPage {
    Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='py.exe'" |
        Where-Object { $_.CommandLine -match 'test_ui\.py' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

function Remove-Service {
    $ErrorActionPreference = "Continue"
    docker rm -f $Container *> $null
}

if ($Stop) {
    Stop-TestPage
    Remove-Service
    Write-Host "Stopped."
    exit 0
}

# 1. Docker must be installed and running.
$ErrorActionPreference = "Continue"
docker info *> $null
$dockerOk = $LASTEXITCODE -eq 0
$ErrorActionPreference = "Stop"
if (-not $dockerOk) {
    Write-Host "Docker is not running. Start Docker Desktop, wait until it says 'running', then try again." -ForegroundColor Red
    exit 1
}

# 2. Python runs the test page (standard library only, nothing to install).
$Python = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } elseif (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { $null }
if (-not $Python) {
    Write-Host "Python 3 was not found. Install it from https://www.python.org/downloads/ (tick 'Add python.exe to PATH')." -ForegroundColor Red
    exit 1
}

# 3. Build the image once. The first build downloads the PaddleOCR models (about 10-20 minutes).
if ($Rebuild -or -not (docker images -q $Image)) {
    Write-Host "Building the OCR image (first time only, about 10-20 minutes)..."
    $ErrorActionPreference = "Continue"
    docker build -t $Image .
    $built = $LASTEXITCODE -eq 0
    $ErrorActionPreference = "Stop"
    if (-not $built) { Write-Host "The build failed; see the messages above." -ForegroundColor Red; exit 1 }
}

# 4. Start the OCR service on port 8099 (this computer only).
Remove-Service
docker run -d --rm --name $Container -p 127.0.0.1:8099:8099 -e OCR_PRELOAD=1 $Image | Out-Null
Write-Host "Starting the OCR service (the models take up to a minute to load)..."
$ready = $false
for ($i = 0; $i -lt 90; $i++) {
    try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8099/health -TimeoutSec 3 | Out-Null; $ready = $true; break }
    catch { Start-Sleep -Seconds 2 }
}
if (-not $ready) { Write-Host "The OCR service did not start. Check: docker logs $Container" -ForegroundColor Red; exit 1 }

# One read of a synthetic sample card (nobody's real card): the reader's first run is slow, so it
# is paid here rather than on the first real card.
Write-Host "Warming up the reader (about 20 seconds)..."
$ErrorActionPreference = "Continue"
& $Python -c "import base64,json,urllib.request;b=base64.b64encode(open('fixtures/synthetic/synthetic-000-front.jpg','rb').read()).decode();urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8099/extract',json.dumps({'frontImageBase64':b}).encode(),{'Content-Type':'application/json'}),timeout=600).read()" *> $null
$ErrorActionPreference = "Stop"

# 5. Start the test page on port 8101.
Stop-TestPage
$uiArgs = @('tools/test_ui.py'); if ($Phone) { $uiArgs += '--lan' }
Start-Process $Python -WindowStyle Hidden -WorkingDirectory $PSScriptRoot -ArgumentList $uiArgs
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Ready:  http://127.0.0.1:8101/readers   (the three readers)" -ForegroundColor Green
Write-Host "        http://127.0.0.1:8101           (National ID test page with the live camera guide)"
if ($Phone) {
    # The adapter with a gateway is the one on the Wi-Fi/LAN; virtual adapters (WSL, Hyper-V) have none.
    $ip = (Get-NetIPConfiguration -ErrorAction SilentlyContinue |
        Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } |
        Select-Object -First 1).IPv4Address.IPAddress
    if ($ip) {
        Write-Host "Phone (same Wi-Fi):  http://${ip}:8101/readers" -ForegroundColor Green
        # The live camera with the card frame guide needs https on a phone (self-signed: the phone
        # warns once). Port 8443 needs the same firewall rule as 8101.
        Write-Host "Phone with live camera guide:  https://${ip}:8443" -ForegroundColor Green
    }
}
Write-Host "To stop:  powershell -ExecutionPolicy Bypass -File start.ps1 -Stop"
Start-Process "http://127.0.0.1:8101/readers"
