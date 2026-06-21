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
- **남은 것 = 사람만 가능한 배포 액션**(아래 §2~§4): GitHub push → KC(`playmcp.kakaocloud.io`) Git 빌드 → PlayMCP 등록·테스트·심사 → 전체공개 → 예선 비즈폼 제출.

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

## 2. PlayMCP in KC 배포 → Endpoint URL 획득
> KC = 카카오 클라우드가 공모전용으로 **무상 제공**하는 MCP 배포 서비스(`playmcp.kakaocloud.io`). **예선 참가는 반드시 KC로 배포**해야 인정됨(임의 클라우드·터널 불가).
> ⚠️ KC 유의: ① 예선기간(6/15~7/14)에만 서버 발급 ② 무상은 한시적(공모전 종료 후 회수) ③ **계정당 2대** ④ 공모전 외 용도·미접수 시 회수.

### 2-A. Git 소스 빌드 (권장 — 우리 `Dockerfile` 사용) ⭐
1. GitHub에 push (저장소 **루트에 `Dockerfile`**; public이면 PAT 불필요):
   ```bash
   cd trainerzip-mcp
   git init && git add -A && git commit -m "mytrainer MCP + Dockerfile"
   git branch -M main && git remote add origin https://github.com/<너>/<repo>.git
   git push -u origin main
   ```
2. `playmcp.kakaocloud.io` 로그인(PlayMCP 회원 카카오계정) → "**+ 새 MCP 서버 등록**" → "**Git 소스 빌드**".
3. 입력: 이름·설명 / **Git URL** / 브랜치 `main` / Dockerfile 경로 `Dockerfile` / PAT(private 저장소만, public이면 비움).
4. 등록하기 → Status `Starting`→`Active`(수십 초~수 분) → 상세정보의 **Endpoint URL 복사**. ← PlayMCP에 넣을 주소.

> `Dockerfile`은 **linux/amd64 고정·멀티스테이지**(tsc 빌드 + better-sqlite3 네이티브 컴파일 후 바이너리째 복사). 기본 env: `PORT=8080`, `MYTRAINER_DB_PATH=/data/mytrainer.db`.

### 2-B. 컨테이너 이미지 방식 (대안)
- 로컬: `docker build --platform linux/amd64 -t <user>/mytrainer:1 .` → 레지스트리(docker.io/ghcr.io) push → KC "**이미지 등록**"에 Registry 호스트·`image_name`·`image_tag`(+private면 Registry 사용자/비번) 입력. (⚠️ **arm64 빌드는 활성화 실패** — 맥은 `--platform linux/amd64` 필수)

### 2-C. 개인용(Phase 0) 환경변수 — 현재
- 무인증 단일 DB. KC 환경변수엔 `MYTRAINER_DB_PATH`(영속 경로) 외 추가 없음. `MYTRAINER_REQUIRE_KEY` **미설정**.
- KC가 영속 볼륨을 안 주면 데이터는 재배포마다 초기화 → 필요 시 외부DB(Turso). 다중 사용자 전환은 `로드맵_배포단계.md`(§5 참고).

## 3. PlayMCP 등록 → 테스트 → 심사 → 공개
1. PlayMCP 개발자 콘솔 → **새로운 MCP 서버 등록** → **MCP Endpoint**에 KC Endpoint URL 입력 → **"정보 불러오기"** (성공해서 22개 tool이 떠야 함; 실패 = 내 MCP 문제).
2. (인증 쓰면) Key/Token 헤더 이름을 서버와 일치(`x-api-key`).
3. 정보 입력 후 반드시 **"임시 등록"** — ⚠️ 이때 "등록 및 심사요청"은 누르지 말 것.
4. 임시등록 상태에서 **"MCP 상세 미리보기" → "도구함에 추가"** → PlayMCP **AI채팅으로 충분히 테스트**.
5. 테스트 완료되면 **"심사 요청"** — ⚠️ **7/7(화)까지**(통상 영업일 1~2일, 최대 7일). 반려 시 카카오 **대표이메일**로 사유 발송 → 수정 후 재요청.
6. 승인 후 공개 상태 **'나에게만 공개' → '전체 공개'** 전환 → 전체공개된 MCP **상세페이지로 이동 후 브라우저 주소창 주소 복사**(예: `https://playmcp.kakao.com/mcp/123…`). ← 예선 접수에 쓸 주소.

## 4. 예선 접수 (비즈폼)
- AGENTIC PLAYER 10 공모전 페이지 → **[Player 예선 참여]** → 접수 양식(비즈폼)에 §3-6의 **PlayMCP 공개 주소** 입력 → 제출. **최대 2개** MCP 등록 가능. 마감 **7/14(화)**.

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
- [ ] 로컬: `npm install && npm run build && npm run start:http` OK + Inspector로 tools/list 22개
- [ ] GitHub push (저장소 **루트에 `Dockerfile`**, public)
- [ ] KC(`playmcp.kakaocloud.io`) **Git 소스 빌드** → `Active` → **Endpoint URL** 확보
- [ ] PlayMCP 등록 → 정보 불러오기 → **임시 등록** → 도구함 추가 → **AI채팅 테스트** → **심사 요청(7/7까지)**
- [ ] 승인 → **전체 공개** → 상세페이지 브라우저 주소 복사
- [ ] **[Player 예선 참여] 비즈폼 제출(7/14까지)**, 최대 2개
