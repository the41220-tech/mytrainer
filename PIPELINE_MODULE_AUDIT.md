# 파이프라인 · 모듈화 점검 (장애 가정 감사)

> "중대 장애/배포 문제 발생"을 가정한 점검. 현재 소스 기준. ✅=이번에 수정, ⚠️=배포 설정/권장.

## 파이프라인
```
src/*.ts ──tsc(build)──> dist/*.js ──run──> (stdio: mytrainer.js | HTTP: http.js)
                                            └─> store(better-sqlite3, 네이티브) ─> SQLite 파일(영속)
                                            └─> engine(순수, 무의존)
```

## 장애 지점 (심각도순)

| ID | 지점 | 원인 | 영향 | 상태 |
|---|---|---|---|---|
| **C1** | 빌드 | 죽은 B2B 모듈(index/db/domain)이 빌드에 결합 | 한 곳 에러 → **전체 빌드 실패 → 배포 불가** | ✅ tsconfig `exclude` + 죽은 bin/script 제거 |
| **C2** | 런타임 | better-sqlite3 **네이티브 ABI/컴파일** 단일 장애점 | 기동 불가 | ⚠️ Node 버전 고정·`npm rebuild`. Store 인터페이스라 드라이버 교체 가능(node:sqlite로 입증) |
| **C3** | HTTP 핸들러 | `openStore/buildServer`가 try 밖 | DB 오픈 실패 시 **요청 행/크래시** | ✅ try 안으로 이동 |
| **C4** | 배포 | DB가 **휘발성 디스크** | 재배포 시 전 사용자 데이터 소실 | ⚠️ 영속 볼륨 필수(`MYTRAINER_DB_DIR`) |
| **H1** | store | 연결 캐시 **무한 증가** | 파일핸들/메모리 누수 → OOM | ✅ LRU 상한 + 축출 시 close |
| **H2** | 기동 | `listen` 에러 미처리(포트 점유) | 조용한 실패 | ✅ error 핸들 + exit |
| **H3** | 헬스 | `/health`가 DB 미점검 | 헬스 OK인데 실제 장애 | ✅ DB probe(503) |
| **H4** | QA | 스모크가 죽은 `index.js` 대상 | 잘못된 안전감 | ✅ 스크립트 제거(QA=점검가이드/Inspector) |
| M1 | mytrainer | 25-tool 단일 모놀리식 | 유지보수성 | 권장: 책임별 분리(logging/ml/analysis/alerts/motivation) |
| M2 | http | stateless라 요청마다 buildServer | CPU 오버헤드(소규모 무방) | 관찰 |
| M3 | 관측성 | console.error만 | 장애 추적 빈약 | 권장: 구조화 로그·요청ID |

## 모듈 결합 평가
| 모듈 | 의존 | 평가 |
|---|---|---|
| `engine.ts` | **없음(순수)** | ◎ 테스트·재사용 최강, 드라이버/인프라 장애와 분리. 2층 예측 모델 포함 |
| `store.ts` | better-sqlite3 | ○ **Store 인터페이스로 추상화** → 드라이버 교체 입증(node:sqlite) |
| `mytrainer.ts` | store·engine·SDK | ○ `buildServer(store)` **의존성 주입** → stdio·HTTP 공용 |
| `http.ts`/stdio | 진입점 | ○ 전송별 분리 |
| `seed.ts` | 타입만 + 동적 import | ○ |

**결합 양호.** 핵심 로직(engine)이 순수라 인프라 장애와 분리됨. 남은 표면: 네이티브 의존(C2)·DB 영속성(C4) = 배포 설정으로 차단.

## 회복력 요약
- 코드 결함(C1·C3·H1~H4) = **이번에 처리**(격리·시드·모델 재검증 통과).
- 배포 환경 결함(C2·C4) = **배포 설정으로 차단**(Node 고정, 영속 볼륨).
- engine 순수성 덕에 "계산 정확성"은 어떤 전송/DB 장애에도 불변.
