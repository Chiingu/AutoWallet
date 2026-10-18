
# Contributing to AutoWallet

This document explains how we work together on this repo. Read it once before your first pull request — it'll save everyone time later.

## Setup

```bash
git clone https://github.com/<org>/AutoWallet.git
cd AutoWallet
```

Each service has its own setup — see the root `README.md` for backend/frontend/simulator instructions.

## Branch protection

`main` is protected. Nobody — including the tech lead — pushes directly to it. Every change goes through a pull request with at least one approval before merging.

## Daily workflow

```bash
git checkout main
git pull                                  # always start from the latest main
git checkout -b feature/short-description # one branch per task
```

Work, commit, then:

```bash
git push -u origin feature/short-description
```

Open a pull request on GitHub targeting `main`. Tag a teammate to review it. Once approved, merge and delete the branch (GitHub has a one-click button for this after merge).

## Branch naming

```
<type>/<short-description>
```

Examples:
- `feature/oauth-login`
- `feature/websocket-notifications`
- `fix/rent-condition-bug`
- `chore/update-gitignore`



## Pull requests

- Keep PRs scoped to one task. A PR that touches auth, the frontend, and Docker all at once is hard to review and easy to break something in.
- Write a short description: what changed, and how you tested it (a command you ran, a screenshot, a curl output — whatever proves it works).
- Requesting a review from a specific teammate is better than leaving it open for anyone — pick whoever's most likely to understand that part of the codebase.
- Don't merge your own PR without an approval, even if you're confident it's correct. This is the one habit most likely to prevent a real production-style bug from slipping through.

## File ownership — avoiding merge conflicts

Most painful merge conflicts come from multiple people editing the same file for unrelated reasons. Two rules prevent almost all of them:

1. **New features get their own file.** If you're adding a new set of endpoints, create a new file under `app/api/` (like `wallets.py`, `rules.py`, `transactions.py` already are) rather than adding routes into an existing file someone else is also touching.
2. **`main.py` only ever gets one-line additions** — an `include_router(...)` call for your new file. Never restructure `main.py` itself without checking with the team first; it's the one file everyone's work touches.

The same principle applies to `models.py` — if you need a new column or table, say so in the team channel before editing it, since two people adding fields to the same model at the same time is the most likely real conflict we'll hit.

## Database migrations

If your change touches `models.py`, you must also generate and commit the matching Alembic migration:

```bash
alembic revision --autogenerate -m "describe the change"
```

**Always read the generated migration file before committing it.** Autogenerate is good but not perfect — it can miss renamed columns or certain constraint changes. If your model change involves adding a `NOT NULL` column to a table that might already have rows (locally, during dev), check row counts first or you'll hit a runtime error when applying it.

## Task tracking

We use GitHub Issues, not a separate tool. One issue per task, assigned to the person doing it, labeled by area (`frontend`, `backend`, `devops`, `compliance`). If you're picking up unassigned work, assign yourself before starting so we don't duplicate effort.

## Before you open a PR, check:

- [ ] Does it run locally without errors?
- [ ] Did you test the actual behavior, not just "it compiles"? (curl it, click through it, whatever fits)
- [ ] If you touched `models.py`, did you generate and include the migration?
- [ ] Did you avoid committing `.env`, `venv/`, `node_modules/`, or `*.db` files? (check `git status` before adding)
- [ ] Is your commit message explaining *why*, not just *what*?


If you're not sure whether something is yours, ask before duplicating someone else's work — it's cheaper than untangling two people's PRs touching the same feature.
