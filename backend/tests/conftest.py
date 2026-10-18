"""Pytest setup for AutoWallet backend tests.

Provides every test with a throwaway in-memory database and a test
client that calls the API without a running server. No real data
is ever touched.
"""
import pytest
import fakeredis
import httpx
import respx
import jwt as pyjwt
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.auth_client import AUTHORIZATION_URL
from app.core.config import settings
from app.core.database import Base, get_db
from app.core.security import create_access_token, hash_password
from app.main import app
from app.models.models import User, UserRole
from app.services.provisioning import create_default_rules, create_default_wallets

# In-memory SQLite: exists only in RAM, gone when the test run ends.
TEST_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,  # one shared connection so all tables live in the same RAM db
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    """Create all tables once at the start of the session, drop them at the end."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session():
    """A database session for direct DB checks inside a test.

    Rolls back after every test so tests stay isolated from each other.
    """
    connection = engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture(autouse=True)
def fake_redis(monkeypatch):
    """Swap every Redis client the app uses for an in-memory fake, so tests
    (and CI) need no running Redis server. The REAL lock code still executes
    against the fake.

    Patched in EACH module that holds its own imported reference — because
    `from X import Y` copies the reference at import time, patching only
    the original in app.core.redis_client changes nothing for importers.
    New modules importing redis_client must be added here.
    """
    # decode_responses=True mirrors the PRODUCTION client (redis.Redis.from_url
    # in app/core/redis_client.py) — with it, hget/get return str like the real
    # stack; without it every Redis string comes back as bytes and code that
    # compares str (e.g. gdpr's hmac.compare_digest) explodes in tests only.
    fake = fakeredis.FakeStrictRedis(decode_responses=True)
    monkeypatch.setattr("app.api.transactions.redis_client", fake)
    monkeypatch.setattr("app.services.payment_processor.redis_client", fake)
    monkeypatch.setattr("app.api.oauth.redis_client", fake)
    monkeypatch.setattr("app.ai.rate_limit.redis_client", fake)
    monkeypatch.setattr("app.gdpr.router.redis_client", fake)
    yield fake


@pytest.fixture(autouse=True)
def no_background_scheduler(monkeypatch):
    """Keep the REAL 60-second poller scheduler out of the test process.

    app/main.py starts a BackgroundScheduler on app startup that polls the
    bank simulator against the REAL database. In tests that would mean
    background writes and real HTTP calls racing the tests. start() is
    patched to a no-op, plus a defensive shutdown either side.
    """
    from app.workers.poller import scheduler

    if scheduler.running:
        scheduler.shutdown(wait=False)
    monkeypatch.setattr(scheduler, "start", lambda: None)
    yield
    if scheduler.running:
        scheduler.shutdown(wait=False)


@pytest.fixture
def poller_uses_test_db(db_session, monkeypatch):
    """Point the poller's SessionLocal at THIS test's session.

    poll_bank_simulator() creates its own DB session via SessionLocal().
    Left alone it would write to the real database file; patched here it
    joins the throwaway in-memory database, so tests control and observe
    everything it writes.
    """
    monkeypatch.setattr("app.workers.poller.SessionLocal", lambda: db_session)


@pytest.fixture
def client(db_session):
    """A test client that calls the API using the throwaway database
    instead of the real one (FastAPI's official dependency-override pattern)."""
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def test_user(db_session):
    """A ready-made registered user with wallets and default rules."""
    user = User(
        email="zakaria.test@autowallet.dev",
        full_name="Zakaria QA Tester",
        hashed_password=hash_password("SuperSecret1337!"),
        bank_account_id="MA64000100000042",
        role=UserRole.user,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    create_default_wallets(user, db_session)
    create_default_rules(user, db_session)
    db_session.commit()
    return user


@pytest.fixture
def auth_headers(test_user):
    """A valid JWT in a header, so tests can call protected endpoints."""
    token = create_access_token(user_id=test_user.id, role=test_user.role.value)
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# The authorization-service seam
#
# require_client (app/core/auth_client.py) POSTs every guarded request to
# the gateway's /api/authorize — a hostname that only exists
# inside the docker network. Without interception every guarded test dies
# with 503. Like the fakeredis patch above, the REAL middleware code keeps
# running; only the network hop is replaced, by respx at the httpx
# transport layer (the same HTTP client the middleware uses).
#
# The intercepted URL is the middleware's OWN constant (imported above),
# never a copy — a rename (authorization -> api-gateway, PR #44) once
# desynced the two and reddened the whole guarded suite.
#
# Default answer is 200 "allowed": the ~50 business-logic tests merely need
# the guard to open the door. The guard's own decision matrix (what status
# in → what status out) is exercised in tests/test_auth_client.py.
# ---------------------------------------------------------------------------


def _realish_authorize(request: httpx.Request) -> httpx.Response:
    """Answer the way the REAL service would (api-gateway/src:
    authenticate.ts decodes the JWT with the shared secret and requires a
    `role` claim; authorize.ts then checks rolePermissions)."""
    token = request.headers.get("Authorization", "").removeprefix("Bearer ")
    try:
        payload = pyjwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except pyjwt.PyJWTError:
        return httpx.Response(401, json={"error": "Invalid Token"})

    role = payload.get("role")
    if not role:
        return httpx.Response(403, json={"error": "Insufficient permissions"})
    return httpx.Response(
        200,
        json={"allowed": True, "user_id": payload.get("sub"), "role": role},
    )


class AuthorizationServiceStub:
    """Per-test controller: choose what the fake service answers."""

    def __init__(self):
        self._status = 200
        self._json = {"allowed": True, "user_id": None, "role": "user"}
        self._error: Exception | None = None
        self._realish = False
        self.calls: list[httpx.Request] = []

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        if self._realish:
            return _realish_authorize(request)
        if self._error is not None:
            raise self._error
        return httpx.Response(self._status, json=self._json)

    def respond(self, status_code: int, json: dict | None = None) -> None:
        """Script a fixed status from the service (e.g. 401, 403, 404, 500)."""
        self._status = status_code
        self._json = json if json is not None else {"allowed": status_code == 200}
        self._error = None
        self._realish = False

    def refuse(self) -> None:
        """Simulate an outage: nothing listening at the gateway's port."""
        self._error = httpx.ConnectError("[Errno 111] Connection refused")

    def timeout(self) -> None:
        """Simulate the service hanging past the middleware's 3s timeout."""
        self._error = httpx.ReadTimeout("Timed out")

    def realish(self) -> None:
        """Decode the JWT and enforce the role claim like the real service."""
        self._realish = True
        self._error = None


@pytest.fixture(autouse=True)
def authorization_service():
    """Intercept the middleware's call to the authorization service.

    autouse = every test gets it without asking, so no guarded test can
    ever leak a real network call. assert_all_called=False because many
    tests exercise unguarded endpoints and never trigger the route.
    """
    with respx.mock(assert_all_called=False) as mock:
        route = mock.post(AUTHORIZATION_URL)
        stub = AuthorizationServiceStub()
        route.side_effect = stub._handle
        yield stub


# ---------------------------------------------------------------------------
# The AI-provider seam
#
# app/ai/provider.py POSTs the conversation to {ai_base_url}/chat/completions
# with httpx. Like the authorization seam, tests intercept it at the httpx
# transport layer — no test ever reaches a real AI provider.
#
# The provider URL is repointed at a fake host per test. The gateway hop is
# re-registered inside the nested mock so these tests keep passing once
# finding #15 (AI routes missing the require_client hop) is fixed.
# ---------------------------------------------------------------------------

@pytest.fixture
def ai_provider(monkeypatch):
    """Point the AI provider at a fake URL; returns the respx route to script."""
    monkeypatch.setattr(settings, "ai_api_key", "qa-test-key")
    monkeypatch.setattr(settings, "ai_base_url", "https://ai.test")
    with respx.mock(assert_all_called=False) as mock:
        mock.post(AUTHORIZATION_URL).respond(
            json={"allowed": True, "user_id": None, "role": "user"}
        )
        route = mock.post("https://ai.test/chat/completions")
        yield route


# ---------------------------------------------------------------------------
# The GDPR email outbox
#
# app/gdpr/router.py sends every confirmation through send_email
# (smtplib → localhost:1025). Tests replace it with an in-memory outbox so
# no test ever touches a real SMTP server, and can read the captured codes.
# ---------------------------------------------------------------------------

@pytest.fixture
def gdpr_email(monkeypatch):
    """Record every email app/gdpr tries to send; return the outbox list."""
    outbox: list[dict] = []

    def record(to: str, subject: str, body: str) -> None:
        outbox.append({"to": to, "subject": subject, "body": body})

    monkeypatch.setattr("app.gdpr.router.send_email", record)
    return outbox
