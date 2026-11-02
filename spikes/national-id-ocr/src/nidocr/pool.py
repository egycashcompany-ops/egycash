"""Reads in parallel: a pool of worker processes, each with its own Paddle models.

One `PaddleRecognizer` runs every Paddle call on a single thread (see engine.PaddleRecognizer._call),
so requests in one process queue behind each other. With `OCR_WORKERS=3` the service starts three
worker processes, and three reads (one per document type, on the Readers page) really run at once.
Each worker holds its own models, about 0.5 to 1 GB of memory, and keeps BLAS to one thread
(OMP_NUM_THREADS=1), so give the container at least that many cores.

`OCR_WORKERS=0` (the default outside Docker, and in the tests) reads in the request's own process.
"""

from __future__ import annotations

import logging
import multiprocessing
import os
import threading
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool

LOG = logging.getLogger("nidocr.pool")

_executor: ProcessPoolExecutor | None = None
_lock = threading.Lock()


def configured_workers() -> int:
    try:
        return max(0, int(os.environ.get("OCR_WORKERS", "0")))
    except ValueError:
        return 0


def threads_per_worker(cores: int | None = None, workers: int | None = None) -> int | None:
    """Paddle threads for each worker: its share of the cores, so the workers do not fight.

    Paddle defaults to 8 CPU threads per process; three workers on 12 cores would ask for 24, and
    three reads at once then took 1.6x the slowest single read (G5). `OCR_CPU_THREADS` overrides.
    None without a pool: the single process keeps Paddle's own default.
    """
    explicit = os.environ.get("OCR_CPU_THREADS", "").strip()
    if explicit.isdigit() and int(explicit) > 0:
        return int(explicit)
    workers = configured_workers() if workers is None else workers
    if workers <= 0:
        return None
    cores = cores or os.cpu_count() or 1
    return max(1, cores // workers)


def _init_worker(threads: int | None = None) -> None:
    """In each worker: load the models once, before the first read."""
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s [worker] %(message)s")
    if threads:
        os.environ["OCR_CPU_THREADS"] = str(threads)
    from .service import get_recognizer  # noqa: PLC0415

    get_recognizer()


def _work(payload: dict) -> tuple[int, dict]:
    from .service import run_extraction  # noqa: PLC0415

    return run_extraction(payload)


def start(workers: int | None = None) -> int:
    """Start the pool (idempotent). Returns how many workers read in parallel (0 = in-process)."""
    global _executor  # noqa: PLW0603 - one pool per service process
    count = configured_workers() if workers is None else workers
    with _lock:
        if _executor is None and count > 0:
            # "spawn": Paddle's native threads do not survive fork.
            _executor = ProcessPoolExecutor(
                max_workers=count, mp_context=multiprocessing.get_context("spawn"),
                initializer=_init_worker, initargs=(threads_per_worker(workers=count),),
            )
            # Warm every worker now, so the first three reads do not each pay the model load.
            for future in [_executor.submit(_noop) for _ in range(count)]:
                future.result()
            LOG.info("reading with %d worker processes", count)
    return count


def _noop() -> None:
    return None


def stop() -> None:
    global _executor  # noqa: PLW0603
    with _lock:
        if _executor is not None:
            _executor.shutdown(wait=False, cancel_futures=True)
            _executor = None


def submit_extraction(payload: dict) -> tuple[int, dict]:
    """Read in a worker if there is a pool, else here. A dead worker is a 503, never an empty answer."""
    executor = _executor
    if executor is None:
        from .service import run_extraction  # noqa: PLC0415

        return run_extraction(payload)
    try:
        return executor.submit(_work, payload).result()
    except BrokenProcessPool:
        LOG.exception("a worker process died; restarting the pool")
        stop()
        start()
        return 503, {"error": "the OCR worker stopped; try again"}
