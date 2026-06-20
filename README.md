# 트레이너ZIP MCP 서버

헬스 트레이너용 **표준 MCP 서버**. 회원 이력(영속 메모리)·루틴 초안·피드백 초안·진척 통계를 제공한다.
호스트 독립이라 **Claude · ChatGPT · Cursor 등 어떤 MCP 호스트**에서도 동작하며, 카카오 **PlayMCP**에 등록하면 카카오톡에서도 쓸 수 있다.

- 스택: TypeScript + `@modelcontextprotocol/sdk`(v1.x) + better-sqlite3 + zod
- 전송: stdio (로컬). 카카오 클라우드 원격 배포용 Streamable HTTP는 다음 단계.
- 설계 근거: `../트레이너ZIP_MCP_스펙.md`

## 빌드 & 실행

```bash
npm install
npm run build      # tsc → dist/
npm start          # node dist/index.js (stdio)
```

> ℹ️ 이 저장소는 의존성 미설치 상태로 제공됩니다. `npm install`을 먼저 실행하세요.
> (작성 환경(샌드박스)에서는 npm 레지스트리가 차단되어 있어, 순수 도메인 로직만 실행 검증했고 풀 빌드/스모크는 로컬에서 돌려야 합니다.)

## 스모크 테스트

빌드 후 stdio로 서버를 띄워 MCP 핸드셰이크 + 주요 툴 호출을 자동 검증한다.

```bash
npm run build && npm run smoke
```

검증 항목: 14개 툴 노출 · 동의 없는 등록 거부(G4) · 동명이인 모호 처리(G1) · 부상 운동 자동 제외 · 볼륨 통계 실계산(4,280) · 미발송 피드백 브리핑(G3).

## 호스트에 연결 (예: Claude Desktop)

`claude_desktop_config.json`에 추가:

```json
{
  "mcpServers": {
    "trainerzip": {
      "command": "node",
      "args": ["/절대경로/trainerzip-mcp/dist/index.js"],
      "env": { "TRAINERZIP_DB_PATH": "/절대경로/trainerzip.db" }
    }
  }
}
```

## 환경변수

- `TRAINERZIP_DB_PATH` — SQLite 파일 경로(기본: 실행 디렉터리의 `trainerzip.db`).

## Tool 목록 (14)

| Tool | 설명 |
|---|---|
| `get_my_status` | (최우선) 플랜·쿼터·회원 수·미발송 피드백·동의 현황 |
| `get_my_briefing` | 오늘 세션·미발송 피드백·재등록 임박 요약 |
| `register_member` | 회원 등록 (동의 필수 · G4) |
| `update_member` | 회원 정보 수정 |
| `list_members` / `get_member` | 목록 / 상세 |
| `resolve_member` | 이름·별칭으로 후보 식별 (동명이인 · G1) |
| `log_session` | 운동 세션 기록 |
| `generate_routine` | 목표·부상 반영 루틴 초안(금기 운동 제외) |
| `draft_feedback` | 복붙용 피드백 초안 + 미발송 큐 적재(G3) |
| `mark_feedback_sent` | 전송 완료 처리 |
| `progress_stats` | 볼륨·부위·추세 실계산(추정 아님) |
| `schedule_session` | 세션 일정 저장 |
| `set_my_style` | 트레이너 말투 샘플 저장 |

## 설계 가드 (스펙 §12 대응)

- **G1 회원 식별**: 동명이인/미등록은 `resolve_member`로 되묻고 `memberId` 요구.
- **G2 상태/쿼터**: `get_my_status` 최우선 호출.
- **G4 동의**: `register_member`는 `consent=true` 아니면 등록 거부.
- **G6 안전**: 부상 부위별 금기 운동을 루틴에서 자동 제외 + 면책 문구.

## 다음 단계

1. **Streamable HTTP 전송** 추가 → 카카오 클라우드 Endpoint 배포(공모전 필수).
2. **다중 제공자 OAuth**(카카오·구글) 연동 → 원격 다중 테넌트.
3. **Pro**: 식단 사진 분석(Vision), 외부 캘린더 동기화.
