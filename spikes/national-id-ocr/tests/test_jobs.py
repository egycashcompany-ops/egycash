"""Jobs: a read started now, watched as it goes (idle → reading → match / invalid / unreadable)."""

from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.jobs import Jobs  # noqa: E402


def _answer(status: str, document_type: str = "national_id"):
    return 200, {"documentType": document_type, "verdict": {"status": status, "reasons": []}, "fields": {"x": {"value": "1"}}}


def _wait_done(jobs: Jobs, job_id: str, timeout: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = jobs.get(job_id)
        if state["done"]:
            return state
        time.sleep(0.01)
    raise AssertionError("job did not finish")


def test_a_job_reports_reading_then_its_verdict():
    gate = threading.Event()

    def runner(payload):
        gate.wait(2)
        return _answer("match")

    jobs = Jobs(runner)
    job_id = jobs.create({"documentType": "national_id"})
    assert jobs.get(job_id)["state"] in ("queued", "reading")
    gate.set()
    state = _wait_done(jobs, job_id)
    assert state["state"] == "match"
    assert state["result"]["verdict"]["status"] == "match"
    assert state["documentType"] == "national_id"
    assert state["elapsedMs"] >= 0


def test_not_match_is_the_invalid_state():
    jobs = Jobs(lambda payload: _answer("not_match"))
    assert _wait_done(jobs, jobs.create({}))["state"] == "invalid"


def test_unreadable_stays_unreadable():
    jobs = Jobs(lambda payload: _answer("unreadable"))
    assert _wait_done(jobs, jobs.create({}))["state"] == "unreadable"


def test_a_failed_read_is_failed_never_an_empty_result():
    def runner(payload):
        raise RuntimeError("boom")

    jobs = Jobs(runner)
    state = _wait_done(jobs, jobs.create({}))
    assert state["state"] == "failed"
    assert "result" not in state or state["result"] is None
    assert state["error"]


def test_an_http_error_answer_is_failed_with_its_message():
    jobs = Jobs(lambda payload: (400, {"error": "documentType must be one of: national_id"}))
    state = _wait_done(jobs, jobs.create({}))
    assert state["state"] == "failed"
    assert "national_id" in state["error"]


def test_events_list_every_state_in_order():
    jobs = Jobs(lambda payload: _answer("match"))
    job_id = jobs.create({})
    _wait_done(jobs, job_id)
    states = [event["state"] for event in jobs.events(job_id, timeout=1)]
    assert states[0] in ("queued", "reading")
    assert states[-1] == "match"


def test_three_jobs_run_at_the_same_time():
    """The readers page sends one per document type at once; none waits for another."""
    started: list[float] = []
    lock = threading.Lock()

    def runner(payload):
        with lock:
            started.append(time.monotonic())
        time.sleep(0.3)
        return _answer("match", payload["documentType"])

    jobs = Jobs(runner, max_parallel=3)
    began = time.monotonic()
    ids = [jobs.create({"documentType": name}) for name in ("national_id", "egycash_id", "army_exemption")]
    states = [_wait_done(jobs, job_id) for job_id in ids]
    assert time.monotonic() - began < 0.3 * 1.5 + 0.2
    assert [state["result"]["documentType"] for state in states] == ["national_id", "egycash_id", "army_exemption"]


def test_an_unknown_job_is_none():
    assert Jobs(lambda payload: _answer("match")).get("nope") is None


def test_finished_results_expire_so_personal_data_does_not_linger():
    jobs = Jobs(lambda payload: _answer("match"), ttl_seconds=0.05)
    job_id = jobs.create({})
    _wait_done(jobs, job_id)
    time.sleep(0.1)
    jobs.sweep()
    assert jobs.get(job_id) is None


def test_the_job_never_keeps_the_photos():
    jobs = Jobs(lambda payload: _answer("match"))
    job_id = jobs.create({"imageBase64": "AAAA", "frontImageBase64": "BBBB"})
    _wait_done(jobs, job_id)
    assert "AAAA" not in repr(jobs._jobs[job_id].__dict__)  # noqa: SLF001


def test_a_full_queue_refuses_new_jobs_instead_of_holding_their_photos():
    import pytest

    from nidocr.jobs import QueueFull

    gate = threading.Event()
    jobs = Jobs(lambda payload: (gate.wait(5), _answer("match"))[1], max_parallel=1, max_pending=2)
    jobs.create({})
    jobs.create({})
    with pytest.raises(QueueFull):
        jobs.create({})
    gate.set()
