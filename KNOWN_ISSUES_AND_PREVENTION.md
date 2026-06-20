# trainerzip-mcp — Known Issues & Prevention Guide

> Date: 2026-06-18 · Scope: code review of the trainerzip-mcp MVP (`src/db.ts`, `src/index.ts`, `src/domain.ts`)
> Purpose: (1) a complete, triaged list of latent bugs, (2) a prevention checklist so the same classes of bug do not recur.

---

## 0. Why these slipped past the smoke test

The smoke test passed (14/14), but it ran under conditions that **masked real deployment behavior**. "Smoke passes" is necessary, not sufficient.

- The test set `TRAINERZIP_DB_PATH` explicitly → hid the cwd-based DB path bug (C2).
- `cwd` was the project directory (writable) → hid the same bug from another angle.
- It ran with the **same Node** used to build → hid the native ABI mismatch (C3).
- The offline equivalent harness used Node's built-in `node:sqlite`, **not** `better-sqlite3` → would never surface `better-sqlite3` native/driver issues.
- Tests ran at a fixed moment and never crossed the UTC↔KST midnight boundary → hid the timezone bug (C1).

---

## 1. Critical — will break in real Kakao Tools / Claude Desktop use

| ID | Location | Symptom | Root cause | Fix |
|----|----------|---------|-----------|-----|
| **C1** | `index.ts` `today()` (~L15); `domain.ts` `computeProgressStats` (~L102) | Wrong calendar day in KR between 00:00–08:59 KST; stats window off by up to 9h | `new Date().toISOString()` returns **UTC**; `new Date("YYYY-MM-DD")` parses as **UTC midnight** | Compute local date explicitly (KST or server-configured TZ). Store dates in one canonical TZ. Never derive a "calendar day" from `toISOString()`. |
| **C2** | `db.ts` `initDb()` (~L35) | Server **crashes on startup** when launched by a host | DB path defaults to `join(process.cwd(), "trainerzip.db")`; host `cwd` is often `/` → cannot create file | Default to a writable location (e.g. `path.join(os.homedir(), ".trainerzip", "trainerzip.db")`, `mkdir -p` first). Keep `TRAINERZIP_DB_PATH` override. |
| **C3** | deploy config + `better-sqlite3` | `Error: ... NODE_MODULE_VERSION mismatch` → startup crash | Config uses bare `"command": "node"`; the Node that the host spawns may differ (ABI) from the Node used for `npm install` | Pin Node version (`.nvmrc` / `engines`), use an **absolute node path** in config, or rebuild on target (`npm rebuild better-sqlite3`). Consider a pure-JS/builtin SQLite to remove native deps. |
| **C4** | `index.ts` top-level `db.initDb()` (~L10); all tool handlers | A thrown DB error escapes as an unhandled crash / ugly protocol error instead of a clean tool error | `initDb()` runs at **import time** (sync) so `main().catch` cannot catch it; handlers have no `try/catch` | Guard `initDb()` and exit with a clear stderr message. Wrap every handler in a helper that catches and returns `{ content, isError: true }`. |

---

## 2. Silent malfunctions — wrong behavior, no crash

| ID | Location | Symptom | Root cause | Fix |
|----|----------|---------|-----------|-----|
| **S1** | `index.ts` `schedule_session` (~L242); `db.ts` `listSchedulesOnDate` (~L219) | A saved session **never appears** in `get_my_briefing` | `datetime` stored as a free `z.string()`; briefing matches with `LIKE 'YYYY-MM-DD%'`. Model may send `2026-06-19T10:00`, `6/19 10시`, `오늘 10시`, leading spaces → prefix mismatch | Validate/normalize to canonical `YYYY-MM-DD HH:MM` on write (regex or date parse); reject/repair non-conforming input. Store date and time in separate, typed columns. |
| **S2** | `db.ts` `resolveMembersByName` (~L192) | Spurious "N candidates" or wrong match | Uses `name.includes(q)` substring match → `"민"` matches 김**민**지 / **민**수 | Rank: exact → `startsWith` → `includes`. Return single result when exact/unique; only ask to disambiguate when truly ambiguous. |
| **S3** | `domain.ts` `generateRoutine` (~L46–50) | Routine prints an **empty "메인:" section** | If injuries exclude every item in `POOL[part]`, `chosen` is empty | If all excluded, fall back to safe alternatives or return an explicit "no safe exercises for this focus — pick another" message. |
| **S4** | `index.ts` `draft_feedback` (~L223) | "미발송 피드백 (N건)" inflates; one logical feedback counts as many | Every `draft_feedback` call inserts a new pending row; regenerating a draft 3× = 3 pending | Upsert one pending row per (member, day), or only log on an explicit "queue/send" action rather than on draft generation. |

---

## 3. Minor — consistency, validation, standards

| ID | Location | Issue | Fix |
|----|----------|-------|-----|
| **M1** | `index.ts` `log_session` (~L199) | Always decrements `regSessionsLeft`; logging a *past*/corrected session wrongly burns a session | Decrement only for "live" sessions; add an explicit flag or a separate adjust path. |
| **M2** | `index.ts` `register_member` description (~L73) | Leftover trigger `"아이 추가"` copied from 어린이ZIP → may misfire | Remove stale triggers; keep domain-correct triggers only. |
| **M3** | `index.ts` `register_member` / `update_member` | `regSessionsLeft` accepts negatives | `z.number().int().min(0)`. |
| **M4** | `db.ts` (multiple: `rowToMember(r: any)`, `getTrainer`, casts) | `any` usage violates project TS rule ("avoid `any`, use `unknown` + narrow") | Define a `Row` type / use `unknown` and narrow; type the prepared-statement results. |
| **M5** | `domain.ts` `computeProgressStats` (~L120, L126) | `toLocaleString()` is locale-dependent → inconsistent number formatting | Format explicitly (e.g. fixed `Intl.NumberFormat("ko-KR")`) or keep raw numbers. |
| **M6** | `db.ts` `initDb()` (~L37) | `journal_mode = WAL` can corrupt/fail on synced filesystems (iCloud, Dropbox, SMB) | Keep the DB out of synced folders; or use `journal_mode = DELETE` if the DB may live in one. |

---

## 4. Prevention checklist — so these never recur

### A. Deployment (MCP servers are spawned by a host, not by you)
- [ ] Never assume `cwd`. Resolve all writable paths from `os.homedir()`/env and `mkdir -p` before use.
- [ ] Never assume which Node runs the server. Pin Node (`engines`, `.nvmrc`) and prefer an absolute interpreter path in host config.
- [ ] Prefer zero-native-dependency builds when feasible; if native (e.g. `better-sqlite3`), document `npm rebuild` on the target and test under the host's Node.
- [ ] On stdio transport, **only JSON-RPC goes to stdout**. All logs → stderr. Audit every dependency for stray stdout writes.

### B. Dates & time
- [ ] Define one canonical timezone for the product; centralize a single `localDate()` / `now()` helper. Ban ad-hoc `toISOString().slice(0,10)` for "calendar day".
- [ ] When comparing stored date strings to "now", parse both in the same TZ; never mix `new Date("YYYY-MM-DD")` (UTC) with `new Date()` (instant).
- [ ] Add a test that runs at the UTC↔local midnight boundary.

### C. SQLite & native modules
- [ ] Keep the DB file outside cloud-synced folders; choose `journal_mode` to match the deployment filesystem.
- [ ] Pin the SQLite driver and verify it loads under the **host's** runtime, not just the build runtime.
- [ ] Wrap DB initialization in `try/catch`; fail fast with a human-readable stderr message and non-zero exit.

### D. Input handling & normalization (the model is your "user" — it sends messy input)
- [ ] Validate and **normalize** every free-form field (dates, times, names) on write; do not rely on `LIKE`-prefix matching against unnormalized data.
- [ ] Store structured data structured (separate date/time columns, typed enums) rather than as opaque strings.
- [ ] Lookups: exact → prefix → fuzzy, in that order; only ask to disambiguate when genuinely ambiguous.
- [ ] Constrain numbers (`.min/.max`), and treat "record past event" vs "record live event" as distinct operations.

### E. Error handling & observability
- [ ] Every tool handler is wrapped so failures return `{ isError: true, content: [...] }`, never an uncaught throw.
- [ ] Top-level init and `main()` both catch and log to stderr with context.
- [ ] Generated content with side effects (queue inserts, decrements) must be **idempotent** or gated behind explicit user intent, not produced as a side effect of "draft/preview".

### F. Coding standards & review (per repo TS rules)
- [ ] No `any` — use `unknown` + narrowing or explicit row types.
- [ ] Explicit types on exported functions.
- [ ] No `console.log` in production paths (stderr-only logging on stdio servers).
- [ ] Run `tsc --noEmit` + lint in CI before any release.

---

## 5. Pre-release verification gate (run before submitting/shipping)

- [ ] Build with `tsc`, then run the smoke test with **no** `TRAINERZIP_DB_PATH` set and from a **different cwd** (e.g. `/tmp`) to catch C2.
- [ ] Launch the built server via the **exact host config** (same Node path the host will use) to catch C3.
- [ ] Smoke-run once with the system clock set near local midnight to catch C1.
- [ ] Exercise each tool's failure path (missing member, ambiguous name, bad datetime, all-excluded routine) and confirm clean `isError` responses (C4, S1–S3).
- [ ] Generate a draft twice; confirm pending feedback count does not double (S4).

---

*Severity legend: Critical = breaks on real deploy · Silent = wrong result without crashing · Minor = consistency/validation/standards.*
