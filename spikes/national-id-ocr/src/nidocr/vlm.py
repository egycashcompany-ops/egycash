"""Vision-language readers for the prose fields, behind the existing Recognizer protocol.

Selected with `OCR_TEXT_RECOGNIZER`:

  paddle        PaddleOCR only — the default, and exactly the behaviour before this module existed
  paddleocr_vl  PaddleOCR-VL-1.6 (0.9B) via transformers, CPU
  qwen          Qwen3.5-4B, Q4_K_M GGUF + its vision projector, via a local llama-server

WHAT A VLM IS ALLOWED TO READ. Only `fullNameAr`, `address` and `occupation` — free Arabic text,
where PaddleOCR is weakest and a reviewer checks every value against the card. The national ID
and the expiry never go near a VLM: they keep the PaddleOCR path with its read ensemble,
structural repair and both-sides vote, because a language model that "reads" a plausible digit is
the one failure those checks exist to stop. Religion and marital status stay on PaddleOCR too:
they snap to a closed vocabulary already.

WHERE CONFIDENCE COMES FROM. Not from the model. A VLM's own certainty is not calibrated against
anything, and it is most fluent exactly when it is inventing. The same crop is read by PaddleOCR
as well, and the field's score is how closely the two agree after rasm folding (dots removed, so a
dot PaddleOCR lost is not counted as disagreement). Two very different models reading the same
pixels the same way is evidence; one of them being sure is not.

Everything here is offline: weights are baked into the image, and llama-server runs on the
container's loopback with `--offline`.
"""

from __future__ import annotations

import atexit
import base64
import json
import logging
import os
import re
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from typing import Protocol

import cv2
import numpy as np

from .arabic import rasm_fold
from .engine import LineRead, Recognition, Recognizer
from .scoring import levenshtein

LOG = logging.getLogger("nidocr.vlm")

#: The only fields a VLM reads. See the module docstring for why each of the others is excluded.
VLM_FIELDS = frozenset({"fullNameAr", "address", "occupation"})

#: For instruction-following models (Qwen). Exact transcription, no commentary, nothing invented.
TRANSCRIBE_PROMPT = (
    "Transcribe the text in this image exactly as it is printed, in its original language and "
    "reading order. Output only the transcription, with no explanation or formatting. If the text "
    "is unreadable, output nothing."
)

#: PaddleOCR-VL is not instruction-tuned: it is trained on a fixed set of task prompts, and its
#: model card lists 'OCR:' as the text-recognition task. A free-form instruction is out of
#: distribution for it, so it gets its own prompt — and "empty if unreadable" is enforced by the
#: agreement score instead of by asking.
PADDLEOCR_VL_PROMPT = "OCR:"

#: Generous for one field's text, small enough that a model that starts rambling stops quickly.
MAX_NEW_TOKENS = 128


class TextReader(Protocol):
    """Reads one field crop to text. No score: confidence comes from agreement, not from here."""

    id: str

    def read(self, crop: np.ndarray) -> str: ...

    def close(self) -> None: ...


def agreement(text: str, reference: str) -> float:
    """How closely two readings agree, in [0, 1], after rasm folding and ignoring spaces.

    1 - edit distance over the longer length. Spaces are removed because the two models split
    words differently and that is not a disagreement about what is printed.
    """
    left = rasm_fold(text).replace(" ", "")
    right = rasm_fold(reference).replace(" ", "")
    longest = max(len(left), len(right))
    if longest == 0:
        return 0.0
    return max(0.0, 1.0 - levenshtein(left, right) / longest)


_THINK = re.compile(r"<think>.*?</think>", re.S)


def clean_transcription(raw: str) -> str:
    """One line of text from a model's answer: no reasoning tags, no quotes, no line breaks."""
    text = _THINK.sub("", raw or "")
    text = text.replace("<think>", "").replace("</think>", "")
    text = text.strip().strip('"“”«»`').strip()
    return re.sub(r"\s+", " ", text)


#: The largest crop a VLM is shown, in pixels. A vision model's cost grows with the image: both
#: readers turn it into one token per 28x28 patch, and generation attends to every one of them.
#: A field crop from a phone photo of a card is ~1500x350 (~670 patches); at this size it is
#: ~800x190 (~190), while the printed text stays ~90 px per line — far more than either model
#: needs to read it. Without the cap a real photo took 3-4x longer per field than a synthetic card.
VLM_MAX_WIDTH = int(os.environ.get("VLM_MAX_WIDTH", "800"))
VLM_MAX_HEIGHT = int(os.environ.get("VLM_MAX_HEIGHT", "192"))


def fit_for_vlm(crop: np.ndarray) -> np.ndarray:
    """Shrink a crop to the VLM size cap, keeping its aspect ratio. Never enlarges."""
    height, width = crop.shape[:2]
    scale = min(1.0, VLM_MAX_WIDTH / max(width, 1), VLM_MAX_HEIGHT / max(height, 1))
    if scale >= 1.0:
        return crop
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return cv2.resize(crop, size, interpolation=cv2.INTER_AREA)


class HybridRecognizer:
    """PaddleOCR for every field, a VLM for the prose fields, agreement for the confidence.

    `extract` tells a recognizer which field it is reading through `bind` — the same hook the mock
    uses — and only a bound VLM field is sent to the reader. Everything else, including whole-card
    detection, is PaddleOCR unchanged.
    """

    def __init__(self, base: Recognizer, reader: TextReader, *, fields=VLM_FIELDS) -> None:
        self._base = base
        self._reader = reader
        self._fields = frozenset(fields)
        # Per request thread, and consumed by the read it was bound for. A single shared slot that
        # was never cleared let a read nobody bound — the back's religion gap — go to the VLM as
        # whatever field the front bound last, and let one request's binding steer another's.
        self._binding = threading.local()
        self.id = f"{getattr(base, 'id', 'base')}+{reader.id}"

    @property
    def keep_line_images(self) -> bool:
        return bool(getattr(self._base, "keep_line_images", False))

    @keep_line_images.setter
    def keep_line_images(self, value: bool) -> None:
        if hasattr(self._base, "keep_line_images"):
            self._base.keep_line_images = value

    @property
    def _current(self) -> str | None:
        return getattr(self._binding, "field", None)

    def bind(self, field_name: str) -> None:
        self._binding.field = field_name
        bind = getattr(self._base, "bind", None)
        if bind is not None:
            bind(field_name)

    def unbind(self) -> None:
        self._binding.field = None

    def detect_lines(self, image: np.ndarray) -> list[tuple[object, str, float]]:
        return self._base.detect_lines(image)

    def read_page(self, image: np.ndarray) -> list[tuple[object, str, float]]:
        read = getattr(self._base, "read_page", None) or self._base.detect_lines
        return read(image)

    def recognize(self, crop: np.ndarray, *, rtl: bool = True) -> Recognition:
        reference = self._base.recognize(crop, rtl=rtl)
        if self._current not in self._fields:
            return reference
        # The prose path reads a field more than once (a retry with more contrast), so the binding
        # holds for the whole field and is released by the next `bind` — or by `unbind`.
        try:
            text = clean_transcription(self._reader.read(fit_for_vlm(crop)))
        except Exception:  # noqa: BLE001 — a VLM failure costs the field its VLM read, not the card
            LOG.warning(
                "%s failed on %s; keeping the PaddleOCR read",
                self._reader.id,
                self._current,
                exc_info=True,
            )
            return reference
        score = agreement(text, reference.text) if text else 0.0
        return Recognition(
            text=text,
            score=score,
            lines=(
                LineRead(text=text, score=score),
                *(
                    LineRead(text=f"[paddle] {line.text}", score=line.score)
                    for line in reference.lines
                ),
            ),
        )

    def external_usage(self) -> tuple[float, float]:
        """(CPU seconds, peak RSS MB) spent outside this process — llama-server for Qwen."""
        usage = getattr(self._reader, "external_usage", None)
        return usage() if usage is not None else (0.0, 0.0)

    def close(self) -> None:
        self._reader.close()


def _png_base64(crop: np.ndarray) -> str:
    ok, buffer = cv2.imencode(".png", crop)
    if not ok:
        raise ValueError("could not encode the crop")
    return base64.b64encode(buffer.tobytes()).decode("ascii")


class LlamaServerReader:
    """Qwen3.5-4B (GGUF + mmproj) behind llama-server on the container's own loopback.

    llama-server rather than a Python binding: it is the reference implementation of llama.cpp's
    multimodal support, it is what the model's GGUF publishers document, and it ships as a pinned
    official image whose binaries are copied in as-is. One server process is started per
    recognizer and kept for its lifetime — loading 3.4 GB of weights per crop would dominate every
    number this comparison reports.

    Thinking is off three ways, because any one being ignored by a template change would silently
    multiply latency: `--reasoning off`, the `enable_thinking: false` template switch on the server,
    and again per request. Temperature is 0.
    """

    id = "qwen3.5-4b-q4km"

    def __init__(
        self,
        model: str | None = None,
        mmproj: str | None = None,
        *,
        binary: str | None = None,
        threads: int | None = None,
        startup_timeout: float = 600.0,
    ) -> None:
        self._model = model or os.environ.get(
            "QWEN_GGUF", "/models/vlm/qwen/Qwen3.5-4B-Q4_K_M.gguf"
        )
        self._mmproj = mmproj or os.environ.get("QWEN_MMPROJ", "/models/vlm/qwen/mmproj-F16.gguf")
        self._binary = binary or os.environ.get("LLAMA_SERVER", "/opt/llama/llama-server")
        self._threads = threads or int(os.environ.get("VLM_THREADS", str(os.cpu_count() or 4)))
        self._lock = threading.Lock()
        self._port = _free_port()
        self._process = subprocess.Popen(  # noqa: S603 — fixed argv, no shell, local paths only
            [
                self._binary,
                "-m", self._model,
                "--mmproj", self._mmproj,
                "--host", "127.0.0.1",
                "--port", str(self._port),
                "-c", "4096",
                "-np", "1",
                "-t", str(self._threads),
                "--temp", "0",
                "--reasoning", "off",
                "--chat-template-kwargs", json.dumps({"enable_thinking": False}),
                "--no-webui",
                "--offline",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        atexit.register(self.close)
        self._wait_until_ready(startup_timeout)

    def _url(self, path: str) -> str:
        return f"http://127.0.0.1:{self._port}{path}"

    def _wait_until_ready(self, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._process.poll() is not None:
                raise RuntimeError(f"llama-server exited with code {self._process.returncode}")
            try:
                with urllib.request.urlopen(self._url("/health"), timeout=5) as response:
                    if response.status == 200:
                        return
            except (urllib.error.URLError, ConnectionError, TimeoutError):
                pass
            time.sleep(1.0)
        self.close()
        raise RuntimeError("llama-server did not become ready in time")

    def read(self, crop: np.ndarray) -> str:
        body = {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{_png_base64(crop)}"},
                        },
                        {"type": "text", "text": TRANSCRIBE_PROMPT},
                    ],
                }
            ],
            "temperature": 0,
            "max_tokens": MAX_NEW_TOKENS,
            "chat_template_kwargs": {"enable_thinking": False},
        }
        request = urllib.request.Request(
            self._url("/v1/chat/completions"),
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with self._lock, urllib.request.urlopen(request, timeout=300) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return str(payload["choices"][0]["message"].get("content") or "")

    def external_usage(self) -> tuple[float, float]:
        """(CPU seconds so far, peak RSS MB) of the llama-server process — the harness adds these
        to its own, because the model's work happens in this child, not in the Python process."""
        pid = self._process.pid
        try:
            fields = open(f"/proc/{pid}/stat", encoding="ascii").read().rsplit(")", 1)[1].split()
            ticks = os.sysconf("SC_CLK_TCK")
            cpu = (int(fields[11]) + int(fields[12])) / ticks  # utime, stime
            peak = 0.0
            for line in open(f"/proc/{pid}/status", encoding="ascii"):
                if line.startswith("VmHWM:"):
                    peak = int(line.split()[1]) / 1024.0
            return cpu, peak
        except (OSError, ValueError, IndexError):
            return 0.0, 0.0

    def close(self) -> None:
        """Stop the server and reap it."""
        process = getattr(self, "_process", None)
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


class PaddleOcrVlReader:
    """PaddleOCR-VL-1.6 (0.9B) through transformers, on CPU.

    The model card's own element-level path: `AutoModelForImageTextToText` + `AutoProcessor`, task
    prompt 'OCR:'. The full PaddleOCR-VL document pipeline (layout model + vLLM server) is built
    for whole pages on a GPU; here the field box has already done layout's job, which is exactly
    the element-level case.
    """

    id = "paddleocr-vl-1.6"

    def __init__(self, model_dir: str | None = None, *, threads: int | None = None) -> None:
        import torch  # noqa: PLC0415 — heavy, and only in the VLM image
        from transformers import AutoModelForImageTextToText, AutoProcessor  # noqa: PLC0415

        self._torch = torch
        path = model_dir or os.environ.get("PADDLEOCR_VL_DIR", "/models/vlm/PaddleOCR-VL-1.6")
        # The card loads bfloat16, which is what GPUs want. On a CPU without native bf16 every
        # matmul is emulated; `PADDLEOCR_VL_DTYPE=float32` trades 2x the memory for that.
        dtype = getattr(torch, os.environ.get("PADDLEOCR_VL_DTYPE", "bfloat16"))
        torch.set_num_threads(
            threads or int(os.environ.get("VLM_THREADS", str(os.cpu_count() or 4)))
        )
        # The model card loads it natively (transformers >= 5). The pinned snapshot also carries
        # the repository's own modelling code, used only if the installed transformers does not
        # know the architecture — it is local, pinned code, never fetched.
        try:
            model = AutoModelForImageTextToText.from_pretrained(
                path, torch_dtype=dtype, local_files_only=True
            )
            processor = AutoProcessor.from_pretrained(path, local_files_only=True)
        except (ValueError, KeyError, OSError):
            model = AutoModelForImageTextToText.from_pretrained(
                path, torch_dtype=dtype, local_files_only=True, trust_remote_code=True
            )
            processor = AutoProcessor.from_pretrained(
                path, local_files_only=True, trust_remote_code=True
            )
        self._model = model.to("cpu").eval()
        self._processor = processor
        self._lock = threading.Lock()

    def read(self, crop: np.ndarray) -> str:
        from PIL import Image  # noqa: PLC0415

        image = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {"type": "text", "text": PADDLEOCR_VL_PROMPT},
                ],
            }
        ]
        with self._lock, self._torch.inference_mode():
            inputs = self._processor.apply_chat_template(
                messages,
                add_generation_prompt=True,
                tokenize=True,
                return_dict=True,
                return_tensors="pt",
                # No size override: the pinned processor's own defaults are the model card's
                # (longest edge 1280*28*28 pixels), and transformers 5.19 no longer exposes the
                # `min_pixels` attribute the card's example reads.
            )
            outputs = self._model.generate(
                **inputs, max_new_tokens=MAX_NEW_TOKENS, do_sample=False
            )
            return self._processor.decode(
                outputs[0][inputs["input_ids"].shape[-1] :], skip_special_tokens=True
            )

    def close(self) -> None:
        return None


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


#: The values `OCR_TEXT_RECOGNIZER` accepts.
RECOGNIZER_KINDS = ("paddle", "paddleocr_vl", "qwen")


def build_recognizer(kind: str | None = None, model_dir: str | None = None) -> Recognizer:
    """The recognizer `OCR_TEXT_RECOGNIZER` asks for. Unset means 'paddle' — nothing changes."""
    from .engine import PaddleRecognizer  # noqa: PLC0415 — lazy: paddle is heavy

    chosen = (kind or os.environ.get("OCR_TEXT_RECOGNIZER") or "paddle").strip().lower()
    if chosen not in RECOGNIZER_KINDS:
        raise ValueError(
            f"OCR_TEXT_RECOGNIZER={chosen!r} is not one of {', '.join(RECOGNIZER_KINDS)}"
        )
    base = PaddleRecognizer(model_dir=model_dir)
    if chosen == "paddle":
        return base
    reader: TextReader = PaddleOcrVlReader() if chosen == "paddleocr_vl" else LlamaServerReader()
    return HybridRecognizer(base, reader)
