"""Reads started now and watched as they go, for the Readers page (and any caller that polls).

POST /jobs starts a read and answers with its id at once; GET /jobs/<id> is its state; and
GET /jobs/<id>/events streams each change as server-sent events. States:

    queued → reading → match | invalid | unreadable | failed

`invalid` is the verdict `not_match` (the UI's invalid theme). `failed` is a read that did not
finish, an error or a refused request, and is never shown as an empty result.

Photos are handed to the runner and dropped; only the answer is kept, and only for a short time.
"""

from __future__ import annotations

import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator

Runner = Callable[[dict], "tuple[int, dict]"]

_STATE_OF_VERDICT = {"match": "match", "not_match": "invalid", "unreadable": "unreadable"}
TERMINAL = frozenset({"match", "invalid", "unreadable", "failed"})


class QueueFull(RuntimeError):
    """Too many reads waiting: refuse a new one rather than hold its photos in memory (HTTP 429)."""


@dataclass
class Job:
    id: str
    document_type: str
    state: str = "queued"
    created: float = field(default_factory=time.monotonic)
    started: float | None = None
    finished: float | None = None
    result: dict | None = None
    error: str | None = None
    history: list[dict] = field(default_factory=list)

    def public(self) -> dict[str, Any]:
        now = self.finished or time.monotonic()
        return {
            "id": self.id,
            "documentType": self.document_type,
            "state": self.state,
            "done": self.state in TERMINAL,
            "elapsedMs": round((now - (self.started or now)) * 1000.0, 1),
            "queuedMs": round(((self.started or now) - self.created) * 1000.0, 1),
            "result": self.result,
            "error": self.error,
        }


class Jobs:
    def __init__(
        self,
        runner: Runner,
        max_parallel: int | None = None,
        ttl_seconds: float | None = None,
        max_pending: int | None = None,
    ):
        self._runner = runner
        self._ttl = ttl_seconds if ttl_seconds is not None else float(os.environ.get("OCR_JOB_TTL_SECONDS", "300"))
        parallel = max_parallel or int(os.environ.get("OCR_JOB_PARALLEL", "6"))
        self._executor = ThreadPoolExecutor(max_workers=parallel, thread_name_prefix="job")
        #: Reads not yet finished (queued or reading). Each holds up to two photos in memory.
        self._max_pending = max_pending or int(os.environ.get("OCR_JOB_MAX_PENDING", "24"))
        self._jobs: dict[str, Job] = {}
        self._changed = threading.Condition()

    def create(self, payload: dict) -> str:
        self.sweep()
        job = Job(id=uuid.uuid4().hex, document_type=str(payload.get("documentType") or "national_id"))
        with self._changed:
            if sum(1 for item in self._jobs.values() if item.state not in TERMINAL) >= self._max_pending:
                raise QueueFull("too many reads waiting; try again shortly")
            self._jobs[job.id] = job
            self._mark(job, "queued")
        self._executor.submit(self._run, job, payload)
        return job.id

    def _mark(self, job: Job, state: str) -> None:
        """Under the lock: move a job on and wake every watcher."""
        job.state = state
        job.history.append({"state": state, "at": time.monotonic()})
        self._changed.notify_all()

    def _run(self, job: Job, payload: dict) -> None:
        with self._changed:
            job.started = time.monotonic()
            self._mark(job, "reading")
        try:
            status, body = self._runner(payload)
        except Exception as error:  # noqa: BLE001 - reported as a failed job, not a dead thread
            status, body = 500, {"error": f"read failed: {type(error).__name__}"}
        finally:
            payload = {}  # the photos go with the request  # noqa: F841
        with self._changed:
            job.finished = time.monotonic()
            if status == 200:
                job.result = body
                job.document_type = body.get("documentType", job.document_type)
                self._mark(job, _STATE_OF_VERDICT.get((body.get("verdict") or {}).get("status"), "unreadable"))
            else:
                job.error = str(body.get("error") or f"HTTP {status}")
                self._mark(job, "failed")

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._changed:
            job = self._jobs.get(job_id)
            return None if job is None else job.public()

    def events(self, job_id: str, timeout: float = 120.0) -> Iterator[dict[str, Any]]:
        """Each state the job has been in, then each new one, until it is done (or `timeout`)."""
        sent = 0
        deadline = time.monotonic() + timeout
        while True:
            with self._changed:
                job = self._jobs.get(job_id)
                if job is None:
                    return
                while sent == len(job.history) and job.state not in TERMINAL:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        return
                    self._changed.wait(remaining)
                pending = job.history[sent:]
                sent = len(job.history)
                snapshot = job.public()
            for entry in pending:
                event = {**snapshot, "state": entry["state"], "done": entry["state"] in TERMINAL}
                if not event["done"]:
                    event["result"] = None
                yield event
            if snapshot["done"]:
                return

    def sweep(self) -> None:
        """Forget finished jobs older than the time-to-live: answers carry personal data."""
        now = time.monotonic()
        with self._changed:
            for job_id in [key for key, job in self._jobs.items() if job.finished and now - job.finished > self._ttl]:
                del self._jobs[job_id]
