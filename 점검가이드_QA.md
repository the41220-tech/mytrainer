# 점검 가이드 (QA) — 나만의 근력 AI MCP

> 제출 전, 이 순서대로 점검하면 "빌드 → 기동 → tool 동작 → 격리 → PlayMCP 등록"까지 확인됩니다.
> 환경: 본인 컴퓨터(Node 18+). 샌드박스는 npm 차단이라 빌드/기동은 로컬에서.

## 0. 준비
```bash
cd "/Users/gamgyeongmin/Kakao mcp project/trainerzip-mcp"
node -v      # v18 이상 확인
npm install  # @modelcontextprotocol/sdk, better-sqlite3, express 설치
npm run build
```
- ❌ better-sqlite3 빌드 에러 → `npm rebuild better-sqlite3` 또는 Node 버전 통일(§7-3).

## 1. 기동 + 헬스체크
```bash
npm run start:http        # 기본 :3000, POST /mcp
# 다른 터미널:
curl -s localhost:3000/health
```
**기대**: `{"ok":true,"server":"mytrainer","transport":"streamable-http","multiTenant":false}`
- 로컬 Claude Desktop용 stdio는 `npm start`(= dist/mytrainer.js).

## 2. MCP Inspector 점검 (주력)
가장 확실한 점검 도구. 핸드셰이크·SSE를 알아서 처리합니다.
```bash
npx @modelcontextprotocol/inspector
```
- Transport: **Streamable HTTP**, URL: `http://localhost:3000/mcp`
- **Connect** → `tools/list`에 **22개 tool**이 보이면 정상(기록/ML/분석/경고/동기부여 그룹).
- 각 tool의 description·inputSchema가 뜨는지 확인.

## 3. 핵심 시나리오 E2E (Inspector에서 순서대로 호출)
실제 계산이 맞는지 검증하는 인수 테스트. (값은 엔진 검증치와 동일해야 함)

| # | tool | arguments | 기대 결과 |
|---|---|---|---|
| 1 | `import_history` | `{"sets":[{"date":"2026-05-01","exercise":"벤치 프레스","weight":70,"reps":5},{"date":"2026-05-08","exercise":"벤치 프레스","weight":72.5,"reps":5},{"date":"2026-05-15","exercise":"벤치 프레스","weight":75,"reps":5},{"date":"2026-05-29","exercise":"벤치 프레스","weight":77.5,"reps":5},{"date":"2026-06-05","exercise":"벤치 프레스","weight":80,"reps":5},{"date":"2026-06-12","exercise":"벤치 프레스","weight":80,"reps":5}]}` | "6개 기록 완료" |
| 2 | `get_growth` | `{"exercise":"벤치 프레스"}` | 현재 1RM **93.3kg**, 주간 +약2kg |
| 3 | `predict_goal` | `{"exercise":"벤치 프레스","target1rm":100}` | 약 **3~4주 뒤** 도달 + 면책 문구 |
| 4 | `suggest_next` | `{"exercise":"벤치 프레스"}` | **80kg × 6회**(반복 증가) |
| 5 | `log_injury` | `{"bodypart":"무릎"}` | 금기에 **바벨 스쿼트** 포함 |
| 6 | `injury_guard` | `{}` | 활성 부상 무릎 / 금기 목록 |
| 7 | `get_briefing` | `{}` | 이번주 운동·목표·격려 한 줄 |

- 세션 흐름도 점검: `start_session` → `log_set {"exercise":"벤치 프레스","weight":80,"reps":5}` → `end_session`(시간·볼륨 요약).
- ✅ 위가 다 맞으면 "정확한 계산(환각 없음)"이 입증됩니다.

## 4. 다중 사용자 격리 점검
```bash
# 격리 강제 모드로 기동
MYTRAINER_REQUIRE_KEY=true npm run start:http
```
- Inspector 연결 설정에서 **Custom Header** `x-api-key: alice` 로 연결 → `log_set` 1건 기록 → `list_recent` 1건.
- 헤더를 `x-api-key: bob` 으로 **재연결** → `list_recent` **0건**(alice 데이터 안 보임)이면 격리 정상.
- 헤더 없이 연결 → **401**(키 필요)면 강제 모드 정상.

## 5. PlayMCP 등록 전 점검
- PlayMCP 콘솔의 **"정보 불러오기"**는 내부적으로 `tools/list`를 호출합니다. → §2에서 tools/list가 뜨면 등록 시 서버 정보도 정상 표시됩니다.
- 공개 URL(`https://<endpoint>/mcp`)로 위 §2 점검을 한 번 더(클라우드 기동 후).
- Key/Token 인증을 쓸 경우, PlayMCP의 커스텀 헤더 이름을 `MYTRAINER_KEY_HEADER`와 **일치**시켰는지 확인.

## 6. (선택) curl 빠른 점검
`/health`는 확실히 동작합니다. `/mcp`는 MCP 핸드셰이크·SSE 협상이 있어 **Inspector 사용을 권장**합니다. curl로 볼 땐 Accept 헤더 필요:
```bash
curl -sS -X POST localhost:3000/mcp \
 -H "Content-Type: application/json" \
 -H "Accept: application/json, text/event-stream" \
 -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
- 응답이 SSE 프레이밍(`event:`/`data:`)으로 올 수 있음 — 정상. tool 목록 JSON이 보이면 OK.

## 7. 자주 터지는 곳 & 해결 (KNOWN_ISSUES 연계)
1. **시작하자마자 죽음 / DB 못 씀** → `MYTRAINER_DB_PATH`(또는 `MYTRAINER_DB_DIR`)를 쓰기 가능한 절대경로로. cwd 의존 금지.
2. **클라우드에서 접속 안 됨** → 포트/호스트 확인(`PORT`), 외부에서 `/health` 도달되는지.
3. **better-sqlite3 로드 실패(NODE_MODULE_VERSION)** → 빌드한 Node와 실행 Node 버전 통일, `npm rebuild better-sqlite3`.
4. **tools/list 비었음/오류** → 빌드 됐는지(`dist/` 존재), `import` 경로 `.js` 확장자 확인.
5. **날짜가 하루 어긋남** → 서버는 KST로 계산(엔진 today=KST). 클라우드 TZ와 무관하게 동작하나, 로그 확인 시 참고.
6. **응답 너무 큼 에러** → tool은 간결 텍스트 반환(이미 준수). `list_recent` n을 과도하게 키우지 말 것.

## 8. 제출 전 최종 체크리스트
- [ ] `npm install && npm run build` 무에러
- [ ] `npm run start:http` + `/health` OK
- [ ] Inspector로 tools/list 22개 + §3 시나리오 값 일치(93.3 / 3~4주 / 80×6 / 무릎 금기)
- [ ] 다중사용자: alice/bob 격리 + 무키 401 (§4)
- [ ] 클라우드 공개 URL에서 §2 재확인
- [ ] PlayMCP "정보 불러오기" 성공 → **심사요청(7/7)** → 승인 후 **전체공개**
- [ ] **[Player 예선 참여] 제출(7/14)**
