#!/usr/bin/env node
// 나만의 근력 AI — MCP 서버 (근력 전용). 기록/ML/분석/경고·알림/동기부여.
// buildServer()는 stdio·Streamable HTTP 양쪽에서 재사용. 직접 실행 시 stdio.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { openStore, type Store } from "./store.js";
import * as E from "./engine.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const KST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
const dd = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
const DISC = "\n※ 추정치 — 컨디션·부상 변수 있음. 통증 시 중단하고 전문가와 상담.";
const vol = (s: any) => s.weight * s.reps * (s.sets ?? 1);
const setShape = { exercise: z.string().min(1), weight: z.number().nonnegative(), reps: z.number().int().positive(), sets: z.number().int().positive().optional(), rpe: z.number().min(1).max(10).optional() };
const SERVICE = "나만의 근력 트레이너"; // 모든 tool description에 포함(PlayMCP 심사 요건)
// 읽기 전용(조회·분석·예측) 툴 — annotations.readOnlyHint=true
const READONLY_TOOLS = new Set(["list_recent", "predict_goal", "suggest_next", "get_growth", "analyze", "detect_plateau", "my_weakpoint", "list_prs", "injury_guard", "injury_risk", "check_alerts", "get_briefing"]);

// stdio·HTTP 공용 서버 팩토리 (stateless HTTP는 요청마다 사용자 store로 호출)
export function buildServer(store: Store): McpServer {
  const server = new McpServer({ name: "mytrainer", version: "0.3.0" });
  const reg = (name: string, cfg: any, fn: (a: any) => string) => {
    const full = {
      title: cfg.title,
      description: `[${SERVICE}] ${cfg.description}`,                    // 심사 요건: 설명에 서비스명 포함
      inputSchema: cfg.inputSchema,
      annotations: { title: cfg.title ?? name, readOnlyHint: READONLY_TOOLS.has(name), destructiveHint: false, idempotentHint: READONLY_TOOLS.has(name), openWorldHint: false }, // 심사 요건: 힌트 4종 모두 정의
    };
    server.registerTool(name, full, async (a: any) => {
      try { return text(fn(a)); } catch (e: any) { return { content: [{ type: "text" as const, text: "오류: " + (e?.message ?? String(e)) }], isError: true }; }
    });
  };

  // ════ 기록 담당 ════
  reg("start_session", { title: "세션 시작", description: "[기록] 운동 세션 시작. 이후 log_set은 이 세션에 묶임. 트리거:'운동 시작','세션 시작'", inputSchema: { focus: z.string().optional(), note: z.string().optional() } },
    (a) => { const s = store.startSession(NOW(), a.focus, a.note); return s.already ? `이미 진행 중 세션 #${s.id} (${s.start_at})` : `🏋️ 세션 #${s.id} 시작 (${s.start_at})${a.focus ? ` · ${a.focus}` : ""}`; });

  reg("end_session", { title: "세션 종료", description: "[기록] 현재 세션 종료 + 요약(시간·볼륨·종목). 트리거:'운동 끝','세션 종료'", inputSchema: {} },
    () => { const s = store.endSession(NOW()); if (!s) return "열린 세션이 없습니다."; const ss = store.sessionSets(s.id); const v = ss.reduce((x, e) => x + vol(e), 0); const mins = Math.max(0, Math.round((Date.parse(s.end_at) - Date.parse(s.start_at)) / 60000)); return `🏁 세션 #${s.id} 종료${s.focus ? ` ·${s.focus}` : ""}\n- 시간: ${mins}분\n- 세트: ${ss.length} · 볼륨 ${Math.round(v).toLocaleString()}\n- 종목: ${[...new Set(ss.map((e) => e.exercise))].join(", ") || "없음"}`; });

  reg("log_set", { title: "세트 기록", description: "[기록] 근력 세트 기록(모델이 '벤치 80 5x5' 파싱해 호출). 진행 세션 있으면 자동 연결. 트리거:'기록','했어'", inputSchema: { ...setShape, date: z.string().optional() } },
    (a) => { const d = a.date ?? KST(); if (!validDate(d)) throw new Error("date는 YYYY-MM-DD"); const sid = store.currentSessionId(); store.addSet({ date: d, exercise: a.exercise, weight: a.weight, reps: a.reps, sets: a.sets, rpe: a.rpe }, sid); return `✅ ${d} ${a.exercise} ${a.weight}kg ${a.sets ?? 1}×${a.reps}${a.rpe ? ` @RPE${a.rpe}` : ""} ${sid ? `(세션 #${sid})` : "(세션 외)"} · e1RM ${E.e1rm(a.weight, a.reps)}kg`; });

  reg("log_cardio", { title: "유산소 기록", description: "[기록] 유산소 기록(러닝·바이크·로잉 등). 트리거:'유산소','달렸어','러닝'", inputSchema: { type: z.string().min(1), minutes: z.number().positive(), distanceKm: z.number().nonnegative().optional(), avgHr: z.number().int().positive().optional(), calories: z.number().nonnegative().optional(), date: z.string().optional() } },
    (a) => { const d = a.date ?? KST(); if (!validDate(d)) throw new Error("date는 YYYY-MM-DD"); store.addCardio({ date: d, type: a.type, minutes: a.minutes, distanceKm: a.distanceKm, avgHr: a.avgHr, calories: a.calories }, store.currentSessionId()); return `✅ ${d} 유산소: ${a.type} ${a.minutes}분${a.distanceKm ? ` ${a.distanceKm}km` : ""}${a.avgHr ? ` 평균 ${a.avgHr}bpm` : ""}`; });

  reg("list_recent", { title: "최근 기록", description: "[기록] 최근 세트 조회. 트리거:'최근','내 기록'", inputSchema: { n: z.number().int().positive().max(50).optional() } },
    (a) => { const r = store.listRecent(a.n ?? 10); return r.length ? r.map((x) => `- ${x.date} ${x.exercise} ${x.weight}×${x.reps}×${x.sets}`).join("\n") : "기록 없음."; });

  // ════ ML 담당(예측) ════
  reg("predict_goal", { title: "목표 예측", description: "[ML] 목표 1RM 도달 시점 예측(정체 시 거부). 트리거:'언제','벤치 100 언제'", inputSchema: { exercise: z.string().min(1), target1rm: z.number().positive() } },
    (a) => { const e: any = E.goalETA(store.listSets(), a.exercise, a.target1rm, KST(), store.getProfile().level ?? undefined); if (!e.ok) return `${a.exercise}→${a.target1rm}kg: ${e.msg}`; if (e.alreadyReached) return `🎉 이미 ${e.currentE1rm}kg로 달성!`; return `[예측·2층모델] ${a.exercise} ${e.currentE1rm}kg → ${a.target1rm}kg\n중심 추정 약 ${e.weeks}주 뒤(${e.reachDate}) · 범위 ${e.rangeWeeks[0]}~${e.rangeWeeks[1]}주\n주간 +${e.weeklyGainKg}kg (${e.model})${e.caveat}${DISC}`; });

  reg("suggest_next", { title: "다음 세트 제안", description: "[ML] 다음 세트 무게/반복(더블 프로그레션·디로드). 트리거:'다음','오늘 무게'", inputSchema: { exercise: z.string().min(1), repLow: z.number().int().positive().optional(), repHigh: z.number().int().positive().optional() } },
    (a) => { const r: any = E.suggestNext(store.listSets(), a.exercise, [a.repLow ?? 5, a.repHigh ?? 8]); if (!r.ok) return `${a.exercise}: ${r.msg}`; return `[다음] ${a.exercise} ${r.weight}kg × ${r.reps}회 (${r.action})\n근거: ${r.rationale}${DISC}`; });

  // ════ 분석 담당 ════
  reg("get_growth", { title: "성장 분석", description: "[분석] 종목 현재 1RM·주간성장·추세. 트리거:'성장','추세','내 벤치 얼마'", inputSchema: { exercise: z.string().min(1) } },
    (a) => { const g: any = E.growthSummary(store.listSets(), a.exercise); if (!g.enough) return `${a.exercise}: 세션 ${g.sessions}회(2회 이상 필요)`; return `[성장·${a.exercise}] 현재 1RM ${g.currentE1rm}kg (시작 ${g.firstE1rm}→현재, ${g.sessions}세션)\n주간 ${g.weeklyGainKg >= 0 ? "+" : ""}${g.weeklyGainKg}kg · 최고 ${g.allTimeBest}kg`; });

  reg("analyze", { title: "기록 분석", description: "[분석] 기간 볼륨·부위 밸런스. 트리거:'분석','볼륨','밸런스'", inputSchema: { periodDays: z.number().int().positive().max(365).optional() } },
    (a) => { const r = E.analyzeRecords(store.listSets(), a.periodDays ?? 30, KST()); const parts = Object.entries(r.byPart).sort((x, y) => (y[1] as number) - (x[1] as number)).map(([p, v2]) => `  - ${p}: ${Math.round(v2 as number).toLocaleString()}`).join("\n"); return `[분석·최근 ${r.periodDays}일] 세션 ${r.sessions} · 볼륨 ${r.totalVolume.toLocaleString()}\n${parts || "  -"}\n밸런스: ${r.balance.pushPull} / ${r.balance.upperLower}`; });

  reg("detect_plateau", { title: "정체 감지", description: "[분석] 종목 정체 여부. 트리거:'정체','막혔','안 늘어'", inputSchema: { exercise: z.string().min(1), lookbackWeeks: z.number().int().positive().max(12).optional() } },
    (a) => { const p: any = E.detectPlateau(store.listSets(), a.exercise, a.lookbackWeeks ?? 4); if (p.enough === false) return `${a.exercise}: 데이터 부족`; return p.plateau ? `⚠️ ${a.exercise} 정체(${a.lookbackWeeks ?? 4}주 ${p.improvePct}%↑) → 디로드·변형 권장` : `✅ ${a.exercise} 성장 중(+${p.improvePct}%)`; });

  reg("my_weakpoint", { title: "약점 부위", description: "[분석] 볼륨 최저 = 보강 필요 부위. 트리거:'약점','부족한 부위'", inputSchema: { periodDays: z.number().int().positive().optional() } },
    (a) => { const w: any = E.weakPoint(store.listSets(), a.periodDays ?? 90, KST()); return w.ok ? `약점 부위: ${w.weak}(볼륨 ${w.weakVolume.toLocaleString()}) · 최다 ${w.strongest} (${w.ratio}배 차) → ${w.weak} 보강 권장` : w.msg; });

  reg("list_prs", { title: "개인기록", description: "[분석] 종목별 최고 중량·1RM(PR). 트리거:'PR','개인기록','최고 기록'", inputSchema: {} },
    () => { const prs = E.analyzeRecords(store.listSets(), 100000, KST()).prs; const keys = Object.keys(prs); return keys.length ? keys.map((k) => `- ${k}: 최고 ${prs[k].maxWeight}kg · e1RM ${prs[k].maxE1rm}kg`).join("\n") : "기록 없음."; });

  // ════ 경고·알림 담당 ════
  reg("log_injury", { title: "부상 기록", description: "[경고] 부상 기록(활성). 트리거:'부상','아파','다쳤'", inputSchema: { bodypart: z.string().min(1), type: z.string().optional(), date: z.string().optional(), note: z.string().optional() } },
    (a) => { const d = a.date ?? KST(); if (!validDate(d)) throw new Error("date는 YYYY-MM-DD"); store.addInjury({ bodypart: a.bodypart, type: a.type, date: d, status: "active", note: a.note }); return `✅ 부상 기록: ${a.bodypart}. 금기 운동 제외: ${E.contraindicated(store.listInjuries(true)).join(", ") || "없음"}`; });

  reg("update_injury", { title: "부상 상태", description: "[경고] 부상 회복/재발 처리. 트리거:'나았','회복','재발'", inputSchema: { bodypart: z.string().min(1), status: z.enum(["active", "recovered"]) } },
    (a) => store.updateInjuryStatus(a.bodypart, a.status) ? `✅ ${a.bodypart} → ${a.status}` : `${a.bodypart} 활성 부상 없음`);

  reg("injury_guard", { title: "금기 운동", description: "[경고] 활성 부상 기준 금기 운동. 루틴 전 호출. 트리거:'금기','피해야'", inputSchema: {} },
    () => { const inj = store.listInjuries(true); if (!inj.length) return "활성 부상 없음 — 제한 없음."; return `활성 부상: ${inj.map((i) => i.bodypart).join(", ")}\n금기: ${E.contraindicated(inj).join(", ") || "특이사항 없음"}`; });

  reg("injury_risk", { title: "부상위험(ACWR)", description: "[경고] 부위별 급성:만성 작업부하비. >1.5 위험. 트리거:'부상위험','무리','과훈련'", inputSchema: { bodypart: z.string().min(1) } },
    (a) => { const r: any = E.injuryRisk(store.listSets(), a.bodypart, KST()); return r.acwr == null ? `${a.bodypart}: ${r.msg}` : `${a.bodypart} ACWR ${r.acwr} (급성 ${r.acute}/만성 ${r.chronic}) → ${r.flag}`; });

  reg("check_alerts", { title: "경고 스캔", description: "[경고] 정체·부상위험·활성부상을 한 번에 점검. 트리거:'경고','점검','괜찮아?'", inputSchema: {} },
    () => {
      const sets = store.listSets(); const out: string[] = [];
      for (const ex of [...new Set(sets.map((s) => s.exercise))]) { const p: any = E.detectPlateau(sets, ex, 4); if (p.plateau) out.push(`정체: ${ex} (4주 ${p.improvePct}%)`); }
      for (const part of ["가슴", "등", "하체", "어깨", "팔"]) { const r: any = E.injuryRisk(sets, part, KST()); if (r.acwr != null && r.acwr > 1.5) out.push(`부상위험: ${part} ACWR ${r.acwr}`); }
      const inj = store.listInjuries(true); if (inj.length) out.push(`활성 부상: ${inj.map((i) => i.bodypart).join(",")} (금기 ${E.contraindicated(inj).join(",")})`);
      return out.length ? "⚠️ 알림\n" + out.map((x) => "- " + x).join("\n") : "✅ 특이 경고 없음";
    });

  // ════ 동기부여 담당 ════
  reg("get_briefing", { title: "브리핑", description: "[동기부여] 이번주 운동·가까운 목표·최근 PR·격려. 트리거:'브리핑','오늘 뭐','요약'", inputSchema: {} },
    () => {
      const sets = store.listSets(); const t = KST();
      if (!sets.length) return "아직 기록이 없어요. start_session으로 시작해볼까요? 💪";
      const wk = new Set(sets.filter((s) => dd(s.date, t) >= 0 && dd(s.date, t) < 7).map((s) => s.date)).size;
      const goals = store.listGoals();
      const near = goals.map((g) => ({ g, e: E.goalETA(sets, g.exercise, g.target1rm, t) as any })).filter((x) => x.e.ok && !x.e.alreadyReached).sort((a, b) => a.e.weeks - b.e.weeks)[0];
      const prs = E.analyzeRecords(sets, 100000, t).prs; const topEx = Object.keys(prs)[0];
      return `[이번주 브리핑 · ${t}]\n💪 이번주 운동 ${wk}일\n` +
        (near ? `🎯 가장 가까운 목표: ${near.g.exercise} ${near.g.target1rm}kg → 약 ${near.e.weeks}주 뒤(${near.e.reachDate})\n` : "🎯 목표 미설정 — set_goal로 정해보세요\n") +
        (topEx ? `🏆 ${topEx} 최고 ${prs[topEx].maxWeight}kg(e1RM ${prs[topEx].maxE1rm}kg)\n` : "") +
        `${wk >= 3 ? "이번주 꾸준하네요. 그대로 갑시다! 🔥" : "한 세트라도 더 — 습관이 이깁니다."}`;
    });

  // ════ 프로필·목표·상태 ════
  reg("set_profile", { title: "프로필", description: "[상태] 단위·경력·체중·기본 반복범위. 트리거:'프로필','내 정보'", inputSchema: { units: z.enum(["kg", "lb"]).optional(), level: z.enum(["초급", "중급", "고급"]).optional(), bodyweight: z.number().positive().optional(), repLow: z.number().int().positive().optional(), repHigh: z.number().int().positive().optional() } },
    (a) => { const p = store.setProfile({ units: a.units, level: a.level, bodyweight: a.bodyweight, rep_low: a.repLow, rep_high: a.repHigh }); return `✅ ${p.units} · ${p.level ?? "-"} · 체중 ${p.bodyweight ?? "-"} · 기본 ${p.rep_low}~${p.rep_high}회`; });

  reg("set_goal", { title: "목표 설정", description: "[상태] 종목 목표 1RM. 트리거:'목표','벤치 100 목표'", inputSchema: { exercise: z.string().min(1), target1rm: z.number().positive(), deadline: z.string().optional() } },
    (a) => { if (a.deadline && !validDate(a.deadline)) throw new Error("deadline은 YYYY-MM-DD"); store.setGoal({ exercise: a.exercise, target1rm: a.target1rm, deadline: a.deadline }); return `🎯 목표: ${a.exercise} 1RM ${a.target1rm}kg${a.deadline ? ` (~${a.deadline})` : ""}`; });

  return server;
}

// 직접 실행 시 stdio (로컬 Claude Desktop용)
async function mainStdio() {
  const server = buildServer(openStore({})); // 로컬 단일 사용자
  await server.connect(new StdioServerTransport());
  console.error("mytrainer(근력) MCP server running on stdio");
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  mainStdio().catch((e) => { console.error("fatal:", e); process.exit(1); });
}
