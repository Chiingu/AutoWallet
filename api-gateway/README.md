# authorization service — boot failure report (2 issues, 1 root cause)

**To:** ZRAY9A · **From:** ZAKARIA (DevOps & QA) · **Date:** 2026-09-26
**Verdict up front:** this is **NOT a missing-dependency issue**. The
`jsonwebtoken` package is installed and loads fine. The crash is caused by
**type-only imports not marked `import type`** in two of your files, which
violates the project's own `tsconfig.json` settings. The fix is **3 lines,
in your files, zero `npm install`**.

Everything below was reproduced from a fresh `npm ci` (no stale cache, no
local state). A running Docker container of the service is attached to our
stack; it exits (1) at boot with the traceback quoted in §3.

---

## 1. Why "missing dependency" is provably wrong

`jsonwebtoken` ships **two different things**, in two different files:

| What | Where | Example | Who sees it |
|---|---|---|---|
| **Real code** (runtime) | `node_modules/jsonwebtoken/index.js` | `sign`, `verify`, `decode`, class `TokenExpiredError` | Node.js when the program runs |
| **Type descriptions** (compile-time only) | `node_modules/jsonwebtoken/*.d.ts` | `SignOptions`, `Secret`, **`JwtPayload`** | TypeScript compiler only — erased before running |

`JwtPayload` is a **shape description** ("the decoded token has `sub`, `exp`,
`role`…"), not an object. The compiled JavaScript has *never* contained a
runtime export named `JwtPayload`. Node.js does not read `.d.ts` files at all.

Three independent proofs it is not a dependency problem:

1. **`npm ci` completed cleanly** from `package-lock.json` — zero install
   errors. A truly missing package produces
   `Cannot find module 'jsonwebtoken'` — a completely different message than
   the one we got.
2. **The library loaded successfully.** The crash happens *after* Node found
   and opened `jsonwebtoken`, while processing the remaining names on the
   import line. If the dependency were missing, the process would die earlier
   with "Cannot find module".
3. **No `npm install <anything>` can fix it.** The name `JwtPayload` does not
   exist as a runtime export in the library's compiled code. Installing more
   packages cannot add an export the library never had. Only editing the
   import line can.

## 2. The exact location

`authorization/src/middleware/authenticate.ts`, lines 1–2:

```ts
1: import { Request, Response, NextFunction } from "express";
2: import jwt, { JwtPayload, TokenExpiredError } from "jsonwebtoken";
```

These four names are **type-only**: `Request`, `Response`, `NextFunction`
(express), `JwtPayload` (jsonwebtoken). Only `jwt` (default import) and
`TokenExpiredError` are real runtime values.

The type is used just once, at line 16, **purely as a label**:

```ts
const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
//                                                            └─ erased at runtime
```

Nothing at runtime ever needs a real `JwtPayload` — so importing it is 100%
unnecessary, and removing that name from the import is safe.

**The trigger:** `authorization/tsconfig.json` sets
`"verbatimModuleSyntax": true`. That option's contract is: *every import name
you write is emitted into the final JavaScript exactly as written, unless you
mark type-only imports with `import type` yourself.* The code doesn't mark
them, so the name `JwtPayload` reaches Node at runtime, Node validates named
imports against the library's real exports, doesn't find it, and the process
dies **before the server ever opens port 3000**.

## 3. The actual crash (captured in our container, fresh build)

```
authorization-1  | /app/src/middleware/authenticate.ts:2
authorization-1  | import jwt, { JwtPayload, TokenExpiredError } from "jsonwebtoken";
authorization-1  |               ^
authorization-1  | SyntaxError: The requested module 'jsonwebtoken' does not
authorization-1  | provide an export named 'JwtPayload'
authorization-1  |     at ModuleJob._instantiate (node:internal/modules/esm/module_job:226:21)
...
authorization-1  | Node.js v22.23.3
```

## 4. Second issue (same root cause): the official build path never worked

`authorization/package.json` advertises:

```json
"build": "tsc",
"start": "node dist/server.js"
```

Running `npx tsc` after a clean `npm ci` **fails with 5 errors and produces no
`dist/` at all**:

| Error | Location | Meaning |
... (80 lines left)