# 나만의 근력 AI (mytrainer MCP)

내 근력 데이터를 **저장·가공·브리핑**하는 개인용 표준 MCP 서버. 클로드 등 어떤 MCP 호스트에서도 대화로 기록·분석·예측.
"운동 분석은 차트가 아니라 대화다 — 정확한 계산(엔진) 위에서 '왜·뭘 바꿔'를 대화로."

- 스택: TypeScript · `@modelcontextprotocol/sdk`(v1) · better-sqlite3 · zod
- 핵심: `src/engine.ts`(결정적 분석·예측 엔진, 실행검증됨) · `src/store.ts`(SQLite) · `src/mytrainer.ts`(서버)
- 범위: **근력 전용**(수면·체중 제외). 엔진의 체중/수면 함수는 휴면(향후 확장용).

## 빌드 & 실행
```bash
npm install
npm run build       # tsc → dist/
npm start           # = node dist/mytrainer.js (stdio)
```
DB 경로: `MYTRAINER_DB_PATH`(기본: `~/.mytrainer/mytrainer.db`).

## 클로드에 연결 (claude_desktop_config.json)
```json
{
  "mcpServers": {
    "mytrainer": {
      "command": "node",
      "args": ["/절대경로/trainerzip-mcp/dist/mytrainer.js"],
      "env": { "MYTRAINER_DB_PATH": "/절대경로/mytrainer.db" }
    }
  }
}
```

## Tool 목록 — 5책임 구조

**① 기록 담당**
| Tool | 역할 |
|---|---|
| `start_session` | 세션 시작(이후 세트 자동 연결) |
| `end_session` | 세션 종료 + 요약(시간·볼륨·종목) |
| `log_set` | 근력 세트 기록(자연어 파싱, e1RM 즉시) |
| `log_cardio` | 유산소 기록(러닝·바이크·로잉…) |
| `list_recent` / `delete_last` | 조회 / 직전 삭제 |
| `import_history` | 기존 앱 데이터 일괄(콜드스타트 격파) |

**② ML 담당(예측)**
| `estimate_1rm` | Epley 1RM 추정 |
| `predict_goal` | 목표 1RM 도달 시점 예측(정체 시 거부) |
| `suggest_next` | 다음 세트 무게/반복(더블 프로그레션·디로드) |

**③ 분석 담당**
| `get_growth` | 현재 1RM·주간 성장·추세 |
| `analyze` | 기간 볼륨·부위 밸런스 |
| `detect_plateau` | 정체 감지 |
| `my_weakpoint` | 볼륨 최저 = 보강 필요 부위 |
| `list_prs` | 종목별 PR |

**④ 경고·알림 담당**
| `log_injury` / `update_injury` | 부상 이력 기록·회복 |
| `injury_guard` | 활성 부상 → 금기 운동 |
| `injury_risk` | 부위별 ACWR 부상위험 |
| `check_alerts` | 정체·부상위험·부상 일괄 점검 |

**⑤ 동기부여 담당**
| `get_briefing` | 이번주·가까운 목표·PR·격려 한 번에 |
| `motivate` | 진척 기반 한마디 |

**상태·목표**: `get_my_status` · `set_profile` · `set_goal`

## 엔진(검증된 계산)
e1RM(Epley) · 종목별 선형회귀 성장/주간증가 · 목표 ETA(정체 시 예측 거부) · 정체 감지 · 더블 프로그레션 · 볼륨/밸런스/PR · 약점부위 · 부상 금기 · **ACWR**(급성:만성 작업부하). 모두 결정적 계산 = LLM 환각 없음.

## 설계 원칙
- **개인 ML 2층**: 공식(프라이어) → 내 데이터 쌓이면 개인 fit(회귀). small data에서도 "학습되는" 느낌.
- **호스트 독립**: 표준 MCP라 어디서든. (대회용은 카카오 클라우드 Endpoint 배포 + Streamable HTTP 추가 필요)
- **안전**: 예측·제안에 추정치·통증 시 중단 고지 자동.
