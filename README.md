# mytrainer MCP — personal strength records, calculations, and briefings

mytrainer addresses a concrete workflow: turn exercise sets recorded in conversation into persistent records, calculated training volume, next-set suggestions, and a progress briefing. The MCP host handles conversation and tool selection; this server stores records in SQLite and computes results in TypeScript rather than asking a language model to invent numbers. This is an implemented workflow, not evidence of customer adoption or improved fitness outcomes.

The repository also retains the earlier **TrainerZIP (트레이너ZIP)** trainer/member prototype. Its consent, member-disambiguation, routine, and feedback tools are not part of the current application. See the synthetic legacy walkthrough below before interpreting older documentation.

## Current scope and host support

The stack is TypeScript, `@modelcontextprotocol/sdk` v1, Express, better-sqlite3, and Zod. [package.json](package.json) starts `dist/mytrainer.js`; [tsconfig.json](tsconfig.json) excludes the legacy `index.ts`, `db.ts`, and `domain.ts` from the normal build.

| Interface or host | Implemented / intended | Verified on 2026-10-02 |
|---|---|---|
| Local stdio | `src/mytrainer.ts`, launched by `npm start` | SDK client initialization, tool listing, and synthetic calls |
| Streamable HTTP | `src/http.ts`: stateless `POST /mcp`, `GET /health`; GET/DELETE `/mcp` return 405 | Loopback SDK handshake, tool calls, health, missing-key rejection, and two-key record separation |
| Claude Desktop | Intended local stdio configuration below | Not tested inside the desktop host |
| ChatGPT / Cursor | Potential clients if their transport/configuration supports this server | Not tested; no “any host” compatibility claim |
| Kakao PlayMCP / Kakao Cloud | HTTP implementation exists; deployment/registration instructions in [DEPLOY.md](DEPLOY.md) | No remote endpoint, registration, approval, or Kakao chat verified |
| Kakao / Google OAuth | Not implemented in the current HTTP source | Not tested |

The active server exposes **20 tools**, confirmed by `tools/list`. DEPLOY.md's 22-tool count and parts of [the secondary strength README](README_근력AI.md) are historical documentation, not the current catalog. Deployment deadlines and provider requirements recorded in DEPLOY.md are dated guidance, not freshly checked service policy.

## Implemented workflow and technical choices

1. `start_session` opens a session; another start reuses the open session instead of creating a duplicate.
2. `log_set` stores exercise, weight, repetitions, optional set count and RPE, with an explicit date or the server's KST date. An open session is linked automatically. `log_cardio` stores cardio separately.
3. `end_session` reports duration, recorded set rows, exercises, and volume. In a synthetic local call, one row containing bench press at 80 kg, 5 repetitions, and 5 sets produced volume **2,000**. This checks arithmetic, not training effectiveness.
4. `analyze`, `list_prs`, and `get_growth` calculate summaries from stored records. `predict_goal` combines a recent e1RM trend with a training-level prior; insufficient data and sufficiently established nonpositive trends can refuse an ETA.
5. `log_injury` and `injury_guard` expose a rule-based avoid list for recognized body-part names. The host should consult it before discussing a routine. The active server does not generate a complete routine or automatically block unsafe `log_set` calls. Review suggestions before acting on them.

The separation is visible in [engine.ts](src/engine.ts) (pure calculations), [store.ts](src/store.ts) (SQLite and a Store interface), [mytrainer.ts](src/mytrainer.ts) (tool definitions and shared `buildServer(store)`), and [http.ts](src/http.ts) (HTTP transport).

These choices have costs:

- MCP reuses a host's conversational interface but leaves parsing, consent collection, and tool sequencing dependent on that host. The current personal server has no member-registration consent gate.
- SQLite provides local persistence without a live database service, but the native driver must match the runtime, WAL files need an appropriate local filesystem, and deployment needs persistent storage and backups.
- Stateless HTTP constructs a server per request and maps a supplied key to a database file. This avoids a session registry but adds per-request work. A bounded LRU connection cache closes evicted databases.
- A header key is a **partition selector**, not a verified account identity: any nonempty value passes the required-key check. There is no key registry, OAuth, revocation, or demonstrated production authorization. Hashing filenames does not encrypt health records. Do not expose this server with real personal data based on this mechanism alone.
- Formula-based e1RM, heuristic growth priors/decay, keyword body-part classification, and ACWR flags are inspectable and repeatable, but they are not clinically validated assessments or calibrated probabilities. ETA ranges are heuristic ranges, not measured confidence intervals.

## Evidenced failure and change

[The pipeline audit](PIPELINE_MODULE_AUDIT.md) documents a verification failure: the old smoke test targeted `index.js`, not the application being deployed. Current build configuration excludes that legacy module, the start script targets `mytrainer.js`, and the obsolete npm smoke script is absent. The old test file remains, so invoking it after only a normal build does **not** verify the active server.

[The prediction design note](모델설계_2층예측.md) records overly optimistic straight-line ETA output in v1 and a v2 change to recent trends, smaller priors, shrinkage, caps, decay, and range output. Those mechanisms are present in `engine.ts`; the note's historical examples are not an independent forecast-accuracy evaluation. No owner contribution or customer-feedback provenance is inferred from that note.

[The earlier known-issues review](KNOWN_ISSUES_AND_PREVENTION.md) explains why passing a local smoke can hide cwd, native ABI, timezone, malformed-date, and duplicate-feedback problems. It concerns the legacy prototype; it should not be read as proof that every issue is fixed in either implementation.

## Synthetic trainer workflow — legacy scope only

This illustrates the guards in `src/index.ts` / `src/domain.ts`, not tools available through `npm start` or HTTP. All names and injury entries in this walkthrough and its executed smoke test are synthetic.

1. Attempt `register_member` for synthetic “김민지” with `consent=false`: registration is held. `consent=true` is an explicit caller assertion, not proof of legally valid consent.
2. Register two synthetic members with that name, one with a knee-injury flag. Calling `generate_routine` by `memberName` returns two candidates and requires `memberId`; it does not silently select a person.
3. Select the knee-flagged member by ID and request lower-body focus. The rule-based draft omits barbell squats from its main section, lists them among exclusions, and asks the trainer to review and adjust. An avoid list is not a guarantee that remaining exercises are safe.
4. Record synthetic leg press and leg curl sets. `progress_stats` reports **4,280** volume from the fixture, not an estimated outcome.
5. `draft_feedback` returns copy/paste text and creates a pending-feedback entry. The smoke verified its appearance in the briefing. A trainer should review it, send it outside the server, then call `mark_feedback_sent`; actual delivery and that final marking step were not tested in this run. There is no automatic Kakao message sending. Repeated drafting can create multiple pending rows, as the known-issues review notes.

## Setup and local verification

Use a compatible Node runtime consistently for install, build, and the host process. `package.json` declares Node >=18, but that is not a tested runtime matrix. **Node 22.23.3 on macOS arm64 worked in this review; Node 26.8.2 failed to compile better-sqlite3 11.10.0 with V8 API errors.** The driver failure is not fixed by this README.

```bash
npm ci --include=dev
npm run build
# Create a disposable directory for synthetic records, never a real member DB.
mkdir -p /tmp/mytrainer-synthetic
MYTRAINER_DB_PATH=/tmp/mytrainer-synthetic/local.db npm start
```

The stdio process speaks MCP, not an interactive terminal prompt; connect a client and keep stdout reserved for JSON-RPC. For HTTP, in a separate terminal after building:

```bash
MYTRAINER_DB_PATH=/tmp/mytrainer-synthetic/http.db \
MYTRAINER_DB_DIR=/tmp/mytrainer-synthetic/users \
MYTRAINER_REQUIRE_KEY=true PORT=3000 npm run start:http
curl http://127.0.0.1:3000/health
```

HTTP currently listens without an explicit loopback binding. Keep this synthetic test behind local firewall controls; do not treat it as a secured public deployment. Use an MCP client such as Inspector with `http://127.0.0.1:3000/mcp` and a synthetic `x-api-key` header. Check initialization, `tools/list` (20), then `tools/call`; a health response alone is not an MCP acceptance test. Inspector is an optional separately installed client, not a repository dependency.

For Claude Desktop, the following is a configuration example, not an executed host result. Replace placeholders with absolute paths and create the database's parent directory first. Use the same Node binary that installed the native driver.

```json
{
  "mcpServers": {
    "mytrainer": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/mytrainer/dist/mytrainer.js"],
      "env": { "MYTRAINER_DB_PATH": "/absolute/path/to/synthetic/local.db" }
    }
  }
}
```

### Verification record — 2026-10-02

At source revision `08052afdec0cec2dea25300dd04a7aa9012c0918`, checks ran in an isolated copy outside the repository, using only synthetic databases. No live APIs, real member records, deployment, or remote writes were used. The seed source/data was deliberately not included or executed.

| Execution | Observed result and boundary |
|---|---|
| `npm ci --include=dev --ignore-scripts --no-audit --no-fund` | Installed 171 packages from the lockfile; native driver rebuilt separately under Node 22.23.3 |
| `npm run build` in the safe copy | Passed for copied sources; **not a full-repository build**, because `src/seed.ts` was omitted to avoid personal seed data |
| Temporary SDK-client smoke against active stdio and loopback HTTP | **14 synthetic checks passed**: 20-tool listing on both transports, legacy tools absent, insufficient-data refusal, negative-weight rejection, duplicate-session reuse, volume 2,000, knee avoid list, SQLite health, HTTP 401/405, two-key record separation, and flat-trend ETA refusal |
| Explicit compilation of legacy sources, then `node test/smoke.mjs` | Printed **ALL PASS**: initialization, 14 legacy tools, consent refusal, two-member ambiguity, routine exclusions, volume 4,280, feedback draft/pending briefing, and member count |
| Node 26 native rebuild | Failed; no successful Node 26 support claim |

The active smoke harness was review-only, outside the repository; there is no checked-in equivalent active test script, and **`npm run smoke` does not exist**. To reproduce the legacy test in a disposable checkout, install dependencies with a compatible Node, then explicitly compile its excluded sources:

```bash
./node_modules/.bin/tsc src/index.ts src/db.ts src/domain.ts \
  --target ES2022 --module Node16 --moduleResolution Node16 \
  --strict --esModuleInterop --skipLibCheck --outDir dist
node test/smoke.mjs
```

That script creates and deletes `smoke-test.db` in its cwd: use a disposable checkout with no existing file of that name. It is a legacy check, not active-server coverage. Full seed-inclusive build, desktop-host integration, cloud persistence/restarts, concurrent tenant stress, timezone boundary behavior, forecast accuracy, and clinical safety remain unverified here.

## Configuration reference

| Variable | Current behavior |
|---|---|
| `MYTRAINER_DB_PATH` | Unkeyed SQLite file; default `~/.mytrainer/mytrainer.db`. Explicit paths need an existing parent directory. |
| `MYTRAINER_DB_DIR` | Base directory, default `~/.mytrainer`; keyed files go under `users/`, named with the first 16 hex characters of a SHA-256 key hash. |
| `MYTRAINER_REQUIRE_KEY` | HTTP requires a nonempty key only when exactly `true`; default `false` shares the unkeyed database for requests without a key. |
| `MYTRAINER_KEY_HEADER` | HTTP partition-key header name, default `x-api-key`. |
| `MYTRAINER_MAX_CACHE` | Maximum cached SQLite connections, default 200. |
| `PORT` | HTTP port, default 3000. |
| `TRAINERZIP_DB_PATH` | Legacy trainer server only; not the active personal server. |

## Tool catalog

### Active personal server — 20 tools

| Responsibility | Tools | Behavior |
|---|---|---|
| Recording | `start_session`, `end_session`, `log_set`, `log_cardio`, `list_recent` | Persist sessions/records and return summaries |
| Prediction | `predict_goal`, `suggest_next` | Heuristic ETA and next-set suggestions |
| Analysis | `get_growth`, `analyze`, `detect_plateau`, `my_weakpoint`, `list_prs` | Calculate trends, volume, balance, and records |
| Injury flags | `log_injury`, `update_injury`, `injury_guard`, `injury_risk`, `check_alerts` | Persist flags and return rule-based warnings; not diagnosis |
| Briefing | `get_briefing` | Summarize recent records and goals |
| Profile / goals | `set_profile`, `set_goal` | Store settings and targets |

`delete_last`, `import_history`, `estimate_1rm`, `motivate`, and `get_my_status` are not registered by the active server despite appearing in older material. Profile units are stored, but calculation/output paths still use kg wording; lb conversion is not established.

### Retained TrainerZIP prototype — 14 tools, excluded from normal build

`get_my_status`, `get_my_briefing`, `register_member`, `update_member`, `list_members`, `get_member`, `resolve_member`, `log_session`, `generate_routine`, `draft_feedback`, `mark_feedback_sent`, `progress_stats`, `schedule_session`, `set_my_style`.

## Proposed next evaluation

First add an active-server synthetic regression harness to the repository and run a clean, seed-inclusive build with explicitly synthetic seed data. Proposed acceptance checks: exact active tool catalog, both transports completing initialize/list/call, invalid-input error responses, no cross-key record access, and persistence after a restart using an explicit disposable volume. Record Node/OS versions and failures, not just a green health endpoint.

Before claiming remote Kakao support, separately verify a deployed HTTPS endpoint, the actual host's tool calls, durable storage across redeploys, and an owner-approved identity/authorization design. OAuth remains future work. Before presenting predictions as useful forecasts, compare held-out synthetic/noisy trajectories against simple baselines and report error and refusal rates; synthetic success would still not establish clinical safety or real-user benefit.

## Supporting documentation and attribution

The original TrainerZIP name and legacy implementation are retained rather than represented as current features. Technical protocol implementation uses the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk); persistence uses [better-sqlite3](https://github.com/WiseLibs/better-sqlite3). DEPLOY.md attributes its provider guidance to Kakao's technical article and competition guides; those are historical references, not a claimed deployment result. No individual/team contribution biography is established here.

- [Deployment guide and historical provider references](DEPLOY.md)
- [Pipeline/module audit](PIPELINE_MODULE_AUDIT.md)
- [Prediction model design and heuristic limits](모델설계_2층예측.md)
- [Legacy known issues and prevention checklist](KNOWN_ISSUES_AND_PREVENTION.md)
