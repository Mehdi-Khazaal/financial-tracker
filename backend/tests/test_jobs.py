"""Background job queue: enqueue, dispatch, retry, dead-lettering."""

from datetime import timedelta

from models.database import Job, utc_now
from services import jobs


def test_dispatch_runs_registered_handler(db_session):
    calls = []
    jobs.register("test.echo", lambda s, p: calls.append(p))

    jobs.enqueue(db_session, "test.echo", {"hello": "world"})
    result = jobs.dispatch(db_session)

    assert result == {"ran": 1, "succeeded": 1, "failed": 0}
    assert calls == [{"hello": "world"}]

    row = db_session.query(Job).one()
    assert row.status == "done"
    assert row.locked_until is None


def test_missing_handler_marks_failed(db_session):
    # No registration for this kind.
    jobs.enqueue(db_session, "test.no_handler", {})
    result = jobs.dispatch(db_session)
    assert result["failed"] == 1
    row = db_session.query(Job).filter_by(kind="test.no_handler").one()
    assert row.status == "failed"
    assert "no handler" in (row.last_error or "")


def test_handler_error_reschedules_with_backoff(db_session):
    def boom(session, payload):
        raise RuntimeError("expected")
    jobs.register("test.boom", boom)

    jobs.enqueue(db_session, "test.boom", {})
    jobs.dispatch(db_session)

    row = db_session.query(Job).filter_by(kind="test.boom").one()
    assert row.status == "pending"
    assert row.tries == 1
    assert row.run_at > utc_now()
    assert "expected" in (row.last_error or "")


def test_max_tries_marks_dead(db_session):
    jobs.register("test.always_fail", lambda s, p: (_ for _ in ()).throw(RuntimeError("nope")))
    row = jobs.enqueue(db_session, "test.always_fail", {})

    # Force it through MAX_TRIES.
    for _ in range(jobs.MAX_TRIES):
        # Make it eligible again immediately.
        db_session.query(Job).filter_by(id=row.id).update({"run_at": utc_now() - timedelta(seconds=1)})
        db_session.commit()
        jobs.dispatch(db_session)

    final = db_session.query(Job).filter_by(id=row.id).one()
    assert final.status == "dead"
    assert final.tries == jobs.MAX_TRIES


def test_future_run_at_is_not_dispatched(db_session):
    calls = []
    jobs.register("test.future", lambda s, p: calls.append(1))
    jobs.enqueue(db_session, "test.future", {}, run_at=utc_now() + timedelta(hours=1))

    result = jobs.dispatch(db_session)
    assert result == {"ran": 0, "succeeded": 0, "failed": 0}
    assert calls == []


def test_cron_endpoint_requires_secret(client, monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "s3cret")

    r = client.post("/cron/run-jobs")
    assert r.status_code == 403

    r = client.post("/cron/run-jobs", headers={"X-Cron-Secret": "s3cret"})
    assert r.status_code == 200
    assert r.json() == {"ran": 0, "succeeded": 0, "failed": 0}
