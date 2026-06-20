# 배포 가이드 — 나만의 근력 AI → PlayMCP (AGENTIC PLAYER 10)

> 출처: PlayMCP 공식 기술 글(tech.kakao.com/posts/734), AGENTIC PLAYER 10 공식 페이지, 노션 가이드 kko.to/player10. (2026-06 확인)

## 0. PlayMCP 확정 스펙 (이대로 맞춰 구현함)
- **전송: Streamable HTTP, 원격(Remote) MCP만.** stdio 불가.
- **stateless 기본**(HTTP POST 단발), SSE는 옵션. → 우리 `http.ts`는 `sessionIdGenerator: undefined`로 stateless.
- **필수 구현**: Initialization(`initialize`+`initialized`) → `tools/list` → `tools/call`. (SDK가 자동 처리)
- **엔드포인트**: 단일 `POST /mcp`.
- **인증(택1)**: 없음 / **Key·Token(커스텀 헤더)** / OAuth2(Authorization Code, PKCE). → 우리는 선택적 Key/Token 지원.
- **툴 가이드**: 응답은 JSON/Markdown 등 포맷팅 문자열(직렬화 X), 너무 큰 응답 금지, 설명 명확히. (우리 tool은 텍스트 반환·간결 → 부합)

## 0.5 배포 직전 상태 (준비 완료 ✅)
- **배포 단계: Phase 0 — 개인용**(영속 저장만 확보, 무인증 단일 DB). 다중 사용자는 나중에 설정/OAuth로 전환. 단계별: **`로드맵_배포단계.md`**.
- **서버**: Streamable HTTP(`http.ts`, stateless, `POST /mcp`) + stdio(`mytrainer.ts`). 22개 tool(기록·ML·분석·경고·동기부여).
- **모델**: 2층 예측 **v2(둔화 반영·범위 출력)** — 최근기울기×경력 프라이어, 감쇠 ETA. `predict_goal`에 반영, 실행검증(6/6). (설계: `모델설계_2층예측.md`)
- **다중 사용자 격리**: 헤더 Key/Token → 사용자별 DB(해시), LRU 캐시 상한. 검증 8/8.
- **장애 보강**: 빌드 결합 제거·핸들러 try경계·`/health` DB점검·캐시 누수·listen 에러 처리(감사: `PIPELINE_MODULE_AUDIT.md`).
- **데모 시드**: `npm run seed`(실제 무릎부상·체중 + 예시 근력) — 검증 10/10.
- **남은 것 = 사람만 가능한 배포 액션**(아래 §2~§4): 카카오 클라우드 Endpoint·PlayMCP 등록·예선 제출.

> 드라이버 폴백(권장·선택): better-sqlite3 네이티브 빌드가 막히면 `store`는 인터페이스 추상화라 `node:sqlite`로 교체 가능(검증 하니스가 그 방식). 필요 시 별도 작업.

## 1. 로컬 검증 (배포 전)
```bash
npm install            # express 포함 설치
npm run build          # tsc → dist/
npm run start:http     # = node dist/http.js  (기본 :3000, POST /mcp)
```
- 헬스체크: `curl localhost:3000/health` → `{"ok":true,...}`
- MCP 점검: **MCP Inspector**(`npx @modelcontextprotocol/inspector`)로 `http://localhost:3000/mcp` 연결 → `tools/list`에 22개 tool, `tools/call`로 `log_set`·`predict_goal` 확인.
- (로컬 Claude Desktop은 stdio가 편함: `npm start` = `dist/mytrainer.js`)

## 2. 카카오 클라우드 Endpoint 생성
- 공식 노션 가이드(**kko.to/player10**)대로 카카오 클라우드에 MCP 서버 Endpoint 생성(공모전용 인당 2대 지원).
- 공개 URL 예: `https://<your-endpoint>/mcp` ← 이게 PlayMCP에 등록할 주소.

### 2-A. 개인용 배포 설정 (현재 Phase 0 — 이대로) ⭐
- **무인증 + 단일 DB + 영속 볼륨.** 핵심은 디스크가 안 날아가게 하는 것뿐.
- **영속 볼륨**을 하나 붙이고(예: `/data`) 그 경로를 `MYTRAINER_DB_PATH`로:
  ```bash
  MYTRAINER_DB_PATH=/data/mytrainer.db PORT=8080 node dist/http.js
  ```
- `MYTRAINER_REQUIRE_KEY`는 **설정하지 않음**(나 혼자 쓰는 단계). 데이터는 단일 파일에 영속.
- (선택) 첫 데이터 채우기: 같은 `MYTRAINER_DB_PATH`로 `node dist/seed.js` 1회.

### 2-B. 다중 사용자 전환 시 (나중 Phase 1+)
- `MYTRAINER_REQUIRE_KEY=true` + `MYTRAINER_KEY_HEADER=x-api-key` + `MYTRAINER_DB_DIR`=영속 볼륨. (§5 / `로드맵_배포단계.md`)
- 진짜 사용자별 분리가 필요하면 OAuth(Phase 2)로.

## 3. PlayMCP 등록 → 심사 → 공개
1. PlayMCP 개발자 콘솔 → **새로운 MCP 서버 등록** → Endpoint URL 입력 → **"정보 불러오기"**(서버가 `tools/list` 응답해야 정보가 뜸).
2. 인증 쓰면: **Key/Token** 방식 선택 + 커스텀 헤더 이름(예: `x-api-key`)·설명 입력.
3. 개발 중엔 **"임시 등록"**(비공개)로 테스트. 완성되면 **"등록 및 심사 요청"** — ⚠️ **7/7(화)까지**(심사 영업일 최대 7일).
4. 심사 통과 후 공개 상태 **'나에게만 공개' → '전체 공개'로 변경**(안 하면 접수 제외).

## 4. 예선 접수
- AGENTIC PLAYER 10 페이지 하단 **[Player 예선 참여]** 버튼 → 최종 제출(1회). 접수 마감 **7/14(화)**. 결과는 카카오톡 채널 메시지.

## 5. 다중 사용자 격리 (구현 완료 ✅)
요청 헤더의 **Key/Token 값 → 사용자별 DB 파일**로 자동 분리됩니다(키는 SHA-256 해시로 파일명, 원문 비저장). 같은 키는 연결 캐시 재사용. (격리·캐시 동등 하니스 검증 8/8 통과)
- **공개(다중 사용자) 시**: `MYTRAINER_REQUIRE_KEY=true` → 키 헤더 없으면 401(사용자 식별 강제).
- **헤더 이름**: `MYTRAINER_KEY_HEADER`(기본 `x-api-key`) — PlayMCP 등록 시 Key/Token '커스텀 헤더' 이름과 일치시킬 것.
- **사용자 DB 위치**: `MYTRAINER_DB_DIR`(기본 `~/.mytrainer`) 아래 `users/<해시>.db`. 클라우드에선 영속 볼륨으로.
- **개인용**: 키 없이 쓰면 기본 단일 DB(`MYTRAINER_DB_PATH`).

배포 예: `MYTRAINER_REQUIRE_KEY=true MYTRAINER_KEY_HEADER=x-api-key MYTRAINER_DB_DIR=/data/users PORT=8080 node dist/http.js`

## 6. 본선(진출 시)
- Kakao Tools 입점용 추가 개발 필수(7/30~8/27). **Widget 스펙** + 더 엄격한 MCP 표준. 우리 tool은 표준 준수라 위젯 레이어만 추가.

## 체크리스트
- [ ] `npm install && npm run build && npm run start:http` 로컬 OK + Inspector로 tools/list 확인
- [ ] 카카오 클라우드 Endpoint 생성 + `/mcp` 공개 URL 확보 (kko.to/player10)
- [ ] 다중 사용자: `MYTRAINER_REQUIRE_KEY=true` + 헤더 이름을 PlayMCP Key/Token과 일치 (§5)
- [ ] PlayMCP 등록 → **심사요청 7/7까지** → 승인 후 **전체 공개**
- [ ] **[Player 예선 참여] 제출 7/14까지**
