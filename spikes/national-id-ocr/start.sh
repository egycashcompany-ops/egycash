#!/usr/bin/env bash
# Start the National ID OCR on macOS or Linux: the OCR service (Docker) plus the test page.
#
#   ./start.sh            # start
#   ./start.sh --phone    # also open the page to phones on this Wi-Fi
#   ./start.sh --rebuild  # rebuild the image first (after code changes)
#   ./start.sh --stop     # stop everything
#
# Needs Docker (running) and Python 3. Everything runs on this computer; nothing is sent out.
set -euo pipefail
cd "$(dirname "$0")"
IMAGE="ecms/nid-ocr:latest"
CONTAINER="nid-ocr-serve"
PHONE=""; REBUILD=""
for arg in "$@"; do
  case "$arg" in
    --phone) PHONE="--lan" ;;
    --rebuild) REBUILD=1 ;;
    --stop) pkill -f "tools/test_ui.py" || true; docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; echo "Stopped."; exit 0 ;;
  esac
done

docker info >/dev/null 2>&1 || { echo "Docker is not running. Start Docker, then try again."; exit 1; }
command -v python3 >/dev/null || { echo "Python 3 was not found. Install it first."; exit 1; }

if [ -n "$REBUILD" ] || [ -z "$(docker images -q "$IMAGE")" ]; then
  echo "Building the OCR image (first time only, about 10-20 minutes)..."
  docker build -t "$IMAGE" .
fi

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --rm --name "$CONTAINER" -p 127.0.0.1:8099:8099 -e OCR_PRELOAD=1 "$IMAGE" >/dev/null
echo "Starting the OCR service (the models take up to a minute to load)..."
for _ in $(seq 1 90); do
  curl -fs http://127.0.0.1:8099/health >/dev/null 2>&1 && break
  sleep 2
done
curl -fs http://127.0.0.1:8099/health >/dev/null || { echo "The OCR service did not start. Check: docker logs $CONTAINER"; exit 1; }

# One read of a synthetic sample card (nobody's real card): the reader's first run is slow.
echo "Warming up the reader (about 20 seconds)..."
python3 -c "import base64,json,urllib.request;b=base64.b64encode(open('fixtures/synthetic/synthetic-000-front.jpg','rb').read()).decode();urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8099/extract',json.dumps({'frontImageBase64':b}).encode(),{'Content-Type':'application/json'}),timeout=600).read()" >/dev/null 2>&1 || true

pkill -f "tools/test_ui.py" || true
nohup python3 tools/test_ui.py $PHONE >/tmp/nid-ocr-test-page.log 2>&1 &
sleep 2
echo
echo "Ready:  http://127.0.0.1:8101/readers   (the three readers)"
echo "        http://127.0.0.1:8101           (National ID test page with the live camera guide)"
[ -n "$PHONE" ] && grep "phone" /tmp/nid-ocr-test-page.log || true
echo "To stop:  ./start.sh --stop"
(command -v open >/dev/null && open http://127.0.0.1:8101/readers) || (command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:8101/readers) || true
