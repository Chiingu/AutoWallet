*This project has been created as part of the 42 curriculum by <mbounoui>, <login2>, <login3>, <login4>, <login5>.*



# AutoWallet

An automatic budgeting engine for freelancers. When a payment arrives, AutoWallet splits it instantly into rent, tax, savings, and free-to-spend envelopes according to rules the user configures once — no manual decisions on every payment.

## Key features

- Email + password authentication with hashed, salted passwords (bcrypt)
- JWT-based session handling
- Automatic wallet provisioning on signup (Main, Rent, Tax, Savings, Free)
- A configurable, priority-ordered rule engine supporting both fixed-amount and percentage-based splits, with optional conditions (e.g. "only save if under a balance cap")
- Redis-backed locking to prevent race conditions when a user's wallets are updated
- A standalone bank simulator service for local testing without a real banking integration
- REST API with full request/response validation on both the frontend and backend

## Description

AutoWallet is built around one idea: a user connects an income source once, and every payment that arrives afterward is automatically divided across a set of envelopes — no recurring manual budgeting. The core of the project is the **rule engine**: a plain, dependency-free function that takes a payment amount and a prioritized list of rules, and returns exactly how much should go to each envelope.

Rules run in priority order against a shrinking pool of money. A rule can either lock a fixed amount (e.g. "always reserve exactly 3,500 for rent") or take a percentage of whatever remains after higher-priority rules have run (e.g. "put 15% of what's left into tax"). Rules can also carry an optional condition — for example, the rent rule only fires if the rent envelope isn't already full, so a second payment in the same month doesn't lock rent twice.

## Instructions

### Prerequisites

- Python 3.11+
- Docker (for Redis, and later for full containerized deployment)
- `pip` and `venv`

### 1. Clone and enter the backend

```bash
git clone <repo-url>
cd AutoWallet/backend
```

### 2. Set up the virtual environment

```bash
python3 -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Configure environment variables

Copy the example file and fill in real values:

```bash
cp .env.example .env
```

`.env` requires:

```
DATABASE_URL=sqlite:///./flowpay.db
SECRET_KEY=your-secret-key-here
REDIS_URL=redis://localhost:6379/0
```

### 4. Start Redis

```bash
docker run -d --name autowallet-redis -p 6379:6379 redis:7
```

Confirm it's running:

```bash
docker exec -it autowallet-redis redis-cli ping   # should print PONG
```

### 5. Run database migrations

```bash
alembic upgrade head
```

### 6. Start the backend

```bash
uvicorn app.main:app --reload
```

The API is now running at `http://127.0.0.1:8000`. Interactive API docs (Swagger UI) are available at `http://127.0.0.1:8000/docs` — you can register a user, log in, and test every endpoint directly from the browser.



## Resources

- [FastAPI documentation](https://fastapi.tiangolo.com/)
- [SQLAlchemy documentation](https://docs.sqlalchemy.org/)
- [Alembic documentation](https://alembic.sqlalchemy.org/)
- [Redis documentation](https://redis.io/docs/)
- [PyJWT documentation](https://pyjwt.readthedocs.io/)
- [Passlib (bcrypt) documentation](https://passlib.readthedocs.io/)

---

## Team Information

> **TODO — fill in for real before submission.**

| Login | Role(s) | Responsibilities |
|---|---|---|
| `<mbounoui>` | Backend Developer | Architecture, database models, auth, rule engine |
| `<login2>` | Frontend Developer | *TODO* |
| `<login3>` | Auth & Realtime Engineer | *TODO* |
| `<login4>` | DevOps & QA Engineer | *TODO* |
| `<login5>` | Data & Compliance Engineer | *TODO* |



## Technical Stack

- **Backend:** FastAPI (Python) — chosen for async support, automatic OpenAPI docs, and strong request/response validation via Pydantic
- **ORM:** SQLAlchemy, with Alembic for versioned schema migrations
- **Database:** SQLite for local development; PostgreSQL planned for containerized deployment
- **Caching / locking:** Redis, used specifically to prevent race conditions when concurrent requests touch the same user's wallets
- **Auth:** JWT (via PyJWT) for stateless session tokens; bcrypt (via Passlib) for password hashing
- **Frontend:** *TODO*
- **Containerization:** Docker (Redis running via Docker locally; full `docker-compose.yml` planned)

## Database Schema

Four core tables:

- **`users`** — id, email (unique), hashed_password, full_name, bank_account_id (unique), role, is_active, oauth fields, 2FA fields, created_at
- **`wallets`** — id, user_id (FK → users), wallet_type (main / rent / tax / savings / free), balance
- **`rules`** — id, user_id (FK → users), name, rule_type (lock_fixed / percentage_remainder), target_wallet, priority, fixed_amount, percentage, condition_field, condition_operator, condition_value, is_active
- **`transactions`** — id, user_id (FK → users), reference (unique), amount, status, created_at, processed_at

Each user has exactly one row per wallet type (5 total) and a starting set of rules, both created automatically on signup. Rules are evaluated in ascending `priority` order; each rule's `condition_field` is checked against the user's live wallet balances before the rule is allowed to fire.

## Features List

 
## Features List
 
| Feature | Status | Implemented by |
|---|---|---|
| User registration (name, email, password, bank account ID) | ✅ Done | `mbounoui` — Backend Lead |
| Password hashing (bcrypt) | ✅ Done | `mbounoui` — Backend Lead |
| Login + JWT issuance | ✅ Done | `mbounoui` — Backend Lead |
| Protected routes via `get_current_user` | ✅ Done | `mbounoui` — Backend Lead |
| Auto-provisioning of wallets and rules on signup | ✅ Done | `mbounoui` — Backend Lead |
| Rule engine (priority order, fixed/percentage, conditions) | ✅ Done | `mbounoui` — Backend Lead |
| Transaction creation + wallet updates | ✅ Done | `mbounoui` — Backend Lead |
| Redis lock against concurrent transaction processing | ✅ Done | `mbounoui` — Backend Lead |
| GET endpoints for wallets, rules, transactions | ✅ Done | `mbounoui` — Backend Lead |
| Bank simulator (standalone) | ✅ Done | `mbounoui` — Backend Lead |
| Webhook connecting bank simulator to backend | ✅ Done | `mbounoui` — Backend Lead |
| Frontend (signup, login, dashboard, rules, history) | ❌ Not started | *TODO* — Frontend Developer |
| Frontend-side input validation | ❌ Not started | *TODO* — Frontend Developer |
| WebSocket real-time updates | ❌ Not started | *TODO* — Auth & Realtime Engineer |
| Advanced permissions / roles | ❌ Not started | *TODO* — Auth & Realtime Engineer |
| 2FA | ❌ Not started | *TODO* — Auth & Realtime Engineer |
| OAuth login | ❌ Not started | *TODO* — Auth & Realtime Engineer |
| API security hardening (API key, rate limiting) | ❌ Not started | *TODO* — Auth & Realtime Engineer |
| Docker Compose (full stack, single command) | ❌ Not started | *TODO* — DevOps & QA Engineer |
| HTTPS / reverse proxy | ❌ Not started | *TODO* — DevOps & QA Engineer |
| Postgres migration for containerized deployment | ❌ Not started | *TODO* — DevOps & QA Engineer |
| Automated tests (pytest) | ❌ Not started | *TODO* — DevOps & QA Engineer |
| CI pipeline | ❌ Not started | *TODO* — DevOps & QA Engineer |
| Privacy Policy / Terms of Service pages | ❌ Not started | *TODO* — Data & Compliance Engineer |
| Analytics dashboard | ❌ Not started | *TODO* — Data & Compliance Engineer |
| GDPR data export/delete | ❌ Not started | *TODO* — Data & Compliance Engineer |
| LLM-powered assistant | ❌ Not started | *TODO* — Data & Compliance Engineer |
 
## Modules

> **TODO — confirm final module selection as a team and update this table before submission.** Target: 14+ points.

| Category | Module | Major/Minor | Points | Status |
|---|---|---|---|---|
| Web | Frontend + backend framework | Major | 2 | Backend done, frontend pending |
| Web | Real-time features (WebSockets) | Major | 2 | Not started |
| Web | Public API (secured, documented, 5+ endpoints) | Major | 2 | 8 endpoints exist; rate limiting + API key pending |
| Web | ORM | Minor | 1 | ✅ Done (SQLAlchemy) |
| User Management | Advanced permissions | Major | 2 | Not started |
| User Management | 2FA | Minor | 1 | Schema ready, logic not implemented |
| User Management | OAuth login | Minor | 1 | Schema ready, logic not implemented |
| Data & Analytics | Advanced analytics dashboard | Major | 2 | Not started |
| Data & Analytics | GDPR compliance | Minor | 1 | Not started |
| AI | LLM interface | Major | 2 | Not started |
 

## Individual Contributions


**`<login1>`:**
- Designed the database schema (User, Wallet, Rule, Transaction)
- Implemented registration, login, JWT auth, and the `get_current_user` dependency
- Designed and implemented the rule engine as a standalone, testable function
- Implemented transaction processing, wallet updates, and Redis-based locking
- Set up Alembic migrations, including SQLite batch-mode compatibility
- Built the standalone bank simulator service

**`<login2>`:** *TODO*

**`<login3>`:** *TODO*

**`<login4>`:** *TODO*

**`<login5>`:** *TODO*

---

