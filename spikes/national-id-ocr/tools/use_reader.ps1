# Switch the OCR service behind the test page to one reader.
#
#   powershell -File tools/use_reader.ps1 paddle         # PaddleOCR only (default, ~2 s/card)
#   powershell -File tools/use_reader.ps1 qwen           # Qwen reads name/address/occupation (~13 s/card)
#   powershell -File tools/use_reader.ps1 paddleocr-vl   # PaddleOCR-VL reads them (~50 s/card)
#
# Only one runs at a time: Qwen alone needs ~6.8 GB of Docker's 7.4 GB. The test page
# (http://127.0.0.1:8098) keeps talking to port 8099, so just refresh it after switching.
param([ValidateSet("paddle", "qwen", "paddleocr-vl")][string]$Reader = "paddle")

$tag = @{ "paddle" = "latest"; "qwen" = "qwen"; "paddleocr-vl" = "paddleocr-vl" }[$Reader]
docker rm -f nid-ocr-serve 2>$null | Out-Null
docker run -d --rm --name nid-ocr-serve -p 127.0.0.1:8099:8099 "ecms/nid-ocr-spike:$tag" | Out-Null
Write-Host "Starting $Reader (models take up to a minute to load)..."
for ($i = 0; $i -lt 90; $i++) {
    try {
        $h = Invoke-RestMethod http://127.0.0.1:8099/health -TimeoutSec 3
        if ($h.recognizerLoaded) { Write-Host "Ready: textRecognizer = $($h.textRecognizer)"; exit 0 }
    } catch {}
    Start-Sleep -Seconds 2
}
Write-Host "Not ready after 3 minutes. Logs:"; docker logs --tail 20 nid-ocr-serve; exit 1
