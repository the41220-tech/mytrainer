#!/usr/bin/env node
// 트레이너ZIP — 헬스 트레이너용 표준 MCP 서버 (v1 SDK, stdio).
// 호스트 독립: Claude/ChatGPT/Cursor/카카오 PlayMCP 등 어떤 MCP 호스트에서도 동작.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as db from "./db.js";
import { generateRoutine, draftFeedback, computeProgressStats } from "./domain.js";

db.initDb();

const server = new McpServer({ name: "trainerzip", version: "0.1.0" });

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const today = () => new Date().toISOString().slice(0, 10);

// 회원 참조 해석 (G1: 동명이인/미등록 가드)
type RefArgs = { memberId?: number; memberName?: string };
function resolveRef(a: RefArgs): { ok: true; member: db.Member } | { ok: false; text: string } {
  if (a.memberId != null) {
    const m = db.getMemberById(a.memberId);
    return m ? { ok: true, member: m } : { ok: false, text: `id ${a.memberId} 회원을 찾을 수 없습니다. list_members로 확인하세요.` };
  }
  if (a.memberName) {
    const cands = db.resolveMembersByName(a.memberName);
    if (cands.length === 0) return { ok: false, text: `'${a.memberName}' 회원이 없습니다. register_member로 먼저 등록하세요.` };
    if (cands.length > 1)
      return { ok: false, text: `'${a.memberName}' 후보가 ${cands.length}명입니다 → ${cands.map((c) => `${c.name}(id:${c.id}, ${c.goal ?? "목표미정"})`).join(", ")}. memberId로 다시 지정하세요.` };
    return { ok: true, member: cands[0] };
  }
  return { ok: false, text: "memberId 또는 memberName 중 하나는 필요합니다." };
}
const REF = { memberId: z.number().int().optional(), memberName: z.string().optional() };

// 1) get_my_status — 최우선 호출 (G2: 플랜·쿼터·동의 상태)
server.registerTool(
  "get_my_status",
  {
    title: "내 상태",
    description: "[최우선 호출] 대화 시작 시 먼저 호출. 트레이너 플랜·쿼터·회원 수·미발송 피드백·동의 현황을 요약. 트리거: '시작', '상태', '오늘'",
    inputSchema: {},
  },
  async () => {
    const t = db.getTrainer();
    const members = db.listMembers();
    const noConsent = members.filter((m) => m.consentStatus !== "granted").length;
    const pending = db.pendingFeedbackMembers().length;
    return text(
      `트레이너ZIP 상태\n- 플랜: ${t.plan} (쿼터 ${t.quota})\n- 등록 회원: ${members.length}명\n- 동의 미완 회원: ${noConsent}명${noConsent ? " (민감정보 사용 전 동의 필요)" : ""}\n- 미발송 피드백: ${pending}건\n- 저장된 말투 샘플: ${t.styleSamples.length}개`
    );
  }
);

// 2) set_my_style
server.registerTool(
  "set_my_style",
  {
    title: "내 말투 설정",
    description: "트레이너 말투 샘플을 저장/조회/삭제. 피드백 초안 톤에 반영. 트리거: '내 말투 저장', '스타일 설정'",
    inputSchema: { action: z.enum(["add", "view", "clear"]), sample: z.string().optional() },
  },
  async ({ action, sample }) => {
    const list = db.setStyle(action, sample);
    return text(action === "view" ? `저장된 말투 샘플(${list.length}):\n${list.map((s, i) => `${i + 1}. ${s}`).join("\n") || "(없음)"}` : `완료. 현재 샘플 ${list.length}개.`);
  }
);

// 3) register_member — G4: 동의 필수
server.registerTool(
  "register_member",
  {
    title: "회원 등록",
    description: "새 회원 카드를 등록. 민감 건강정보(부상·질환) 저장에는 회원 동의(consent=true)가 필수. 트리거: '회원 등록', '아이 추가'",
    inputSchema: {
      name: z.string(),
      consent: z.boolean().describe("회원 본인의 정보 저장 동의 여부. true가 아니면 등록 거부"),
      gender: z.string().optional(),
      age: z.number().int().optional(),
      goal: z.enum(["감량", "증량", "근력", "재활", "체력"]).optional(),
      injuries: z.array(z.string()).optional(),
      healthConditions: z.array(z.string()).optional(),
      aliases: z.array(z.string()).optional(),
      regSessionsLeft: z.number().int().optional(),
      notes: z.string().optional(),
    },
  },
  async (a) => {
    if (a.consent !== true)
      return text("⚠️ 등록 보류: 회원의 정보 저장 동의가 필요합니다(개인정보 보호). 회원 동의를 받은 뒤 consent=true로 다시 등록하세요.");
    const m = db.addMember({
      name: a.name,
      gender: a.gender ?? null,
      age: a.age ?? null,
      goal: a.goal ?? null,
      injuries: a.injuries ?? [],
      healthConditions: a.healthConditions ?? [],
      aliases: a.aliases ?? [],
      regSessionsLeft: a.regSessionsLeft ?? null,
      regStart: today(),
      notes: a.notes ?? null,
      consentStatus: "granted",
    });
    return text(`✅ 등록 완료: ${m.name} (id:${m.id}, 목표:${m.goal ?? "미정"})${m.injuries.length ? `, 부상:${m.injuries.join(",")}` : ""}`);
  }
);

// 4) update_member
server.registerTool(
  "update_member",
  {
    title: "회원 수정",
    description: "등록된 회원의 목표·부상·측정값 등을 수정. 트리거: '회원 정보 수정', '부상 추가'",
    inputSchema: {
      ...REF,
      goal: z.enum(["감량", "증량", "근력", "재활", "체력"]).optional(),
      injuries: z.array(z.string()).optional(),
      healthConditions: z.array(z.string()).optional(),
      age: z.number().int().optional(),
      gender: z.string().optional(),
      aliases: z.array(z.string()).optional(),
      regSessionsLeft: z.number().int().optional(),
      notes: z.string().optional(),
    },
  },
  async (a) => {
    const r = resolveRef(a);
    if (!r.ok) return text(r.text);
    const patch: Partial<db.Member> = {};
    if (a.goal !== undefined) patch.goal = a.goal;
    if (a.injuries !== undefined) patch.injuries = a.injuries;
    if (a.healthConditions !== undefined) patch.healthConditions = a.healthConditions;
    if (a.age !== undefined) patch.age = a.age;
    if (a.gender !== undefined) patch.gender = a.gender;
    if (a.aliases !== undefined) patch.aliases = a.aliases;
    if (a.regSessionsLeft !== undefined) patch.regSessionsLeft = a.regSessionsLeft;
    if (a.notes !== undefined) patch.notes = a.notes;
    const m = db.updateMember(r.member.id, patch)!;
    return text(`✅ 수정 완료: ${m.name} (목표:${m.goal ?? "미정"}, 부상:${m.injuries.join(",") || "없음"}, 잔여세션:${m.regSessionsLeft ?? "-"})`);
  }
);

// 5) list_members
server.registerTool(
  "list_members",
  {
    title: "회원 목록",
    description: "등록된 회원 목록을 보여줌. goal로 필터 가능. 트리거: '회원 목록', '회원들 보여줘'",
    inputSchema: { goal: z.enum(["감량", "증량", "근력", "재활", "체력"]).optional() },
  },
  async ({ goal }) => {
    const list = db.listMembers(goal);
    if (!list.length) return text("등록된 회원이 없습니다. register_member로 추가하세요.");
    return text(list.map((m) => `- ${m.name} (id:${m.id}) 목표:${m.goal ?? "미정"} 잔여:${m.regSessionsLeft ?? "-"}회${m.injuries.length ? ` 부상:${m.injuries.join(",")}` : ""}`).join("\n"));
  }
);

// 6) get_member
server.registerTool(
  "get_member",
  { title: "회원 상세", description: "단일 회원 상세 카드 조회. 트리거: 'OO 정보', 'OO 카드'", inputSchema: { ...REF } },
  async (a) => {
    const r = resolveRef(a);
    if (!r.ok) return text(r.text);
    const m = r.member;
    return text(
      `[회원 카드] ${m.name} (id:${m.id})\n- 성별/나이: ${m.gender ?? "-"}/${m.age ?? "-"}\n- 목표: ${m.goal ?? "미정"}\n- 부상: ${m.injuries.join(", ") || "없음"}\n- 건강 특이사항: ${m.healthConditions.join(", ") || "없음"}\n- 잔여 세션: ${m.regSessionsLeft ?? "-"}\n- 등록일: ${m.regStart ?? "-"}\n- 동의: ${m.consentStatus}`
    );
  }
);

// 7) resolve_member — G1
server.registerTool(
  "resolve_member",
  { title: "회원 식별", description: "이름/별칭으로 회원 후보를 찾음(동명이인 처리). 트리거: 'OO 누구', '회원 찾기'", inputSchema: { name: z.string() } },
  async ({ name }) => {
    const cands = db.resolveMembersByName(name);
    if (!cands.length) return text(`'${name}' 후보 없음. register_member로 등록하세요.`);
    return text(`'${name}' 후보 ${cands.length}명:\n${cands.map((c) => `- ${c.name} (id:${c.id}, 목표:${c.goal ?? "미정"}, 등록:${c.regStart ?? "-"})`).join("\n")}`);
  }
);

// 8) log_session
server.registerTool(
  "log_session",
  {
    title: "세션 기록",
    description: "회원의 운동 세션을 기록. exercises 배열(name/weight/sets/reps/rpe) 또는 memo. 트리거: '오늘 OO 기록', 'OO 운동 저장'",
    inputSchema: {
      ...REF,
      date: z.string().optional().describe("YYYY-MM-DD, 생략 시 오늘"),
      exercises: z.array(z.object({ name: z.string(), weight: z.number().optional(), sets: z.number().int().optional(), reps: z.number().int().optional(), rpe: z.number().optional() })).optional(),
      memo: z.string().optional(),
    },
  },
  async (a) => {
    const r = resolveRef(a);
    if (!r.ok) return text(r.text);
    const s = db.addSession(r.member.id, a.date ?? today(), a.exercises ?? [], a.memo);
    if (r.member.regSessionsLeft != null) db.updateMember(r.member.id, { regSessionsLeft: Math.max(0, r.member.regSessionsLeft - 1) });
    return text(`✅ 세션 기록: ${r.member.name} ${s.date} · 운동 ${s.exercises.length}종${a.memo ? ` · 메모 있음` : ""}`);
  }
);

// 9) generate_routine
server.registerTool(
  "generate_routine",
  { title: "루틴 초안", description: "회원 목표·부상을 반영해 다음 루틴 초안을 생성(부상 금기 운동 자동 제외). 트리거: 'OO 루틴 짜줘'", inputSchema: { ...REF, focus: z.enum(["하체", "가슴", "등", "어깨", "팔", "코어", "전신"]).optional() } },
  async (a) => {
    const r = resolveRef(a);
    if (!r.ok) return text(r.text);
    return text(generateRoutine(r.member, a.focus).text);
  }
);

// 10) draft_feedback — 복붙 초안 + 미발송 큐 적재(G3)
server.registerTool(
  "draft_feedback",
  { title: "피드백 초안", description: "회원에게 보낼 복붙용 피드백/숙제 메시지 초안 생성. 직접 전송은 불가. 트리거: 'OO 피드백 써줘', '숙제 메시지'", inputSchema: { ...REF, tone: z.enum(["친근", "전문"]).optional() } },
  async (a) => {
    const r = resolveRef(a);
    if (!r.ok) return text(r.text);
    const last = db.listSessions(r.member.id)[0] ?? null;
    db.logFeedback(r.member.id); // 미발송 상태로 큐 적재
    return text(draftFeedback(r.member, last, a.tone) + `\n(전송 후 mark_feedback_sent 호출하면 미발송 목록에서 빠집니다.)`);
  }
);

// 11) progress_stats
server.registerTool(
  "progress_stats",
  { title: "진척 통계", description: "기록된 세션으로 볼륨·부위 균형·추세를 실제 계산(추정 아님). 트리거: 'OO 진척', 'OO 통계'", inputSchema: { ...REF, period: z.enum(["week", "month", "all"]).optional() } },
  async (a) => {
    const r = resolveRef(a);
    if (!r.ok) return text(r.text);
    return text(computeProgressStats(db.listSessions(r.member.id), a.period ?? "month"));
  }
);

// 12) schedule_session — 서버 저장(외부 캘린더 동기화는 옵션/후속)
server.registerTool(
  "schedule_session",
  { title: "세션 예약", description: "PT 세션 일정을 저장. (카카오/구글 캘린더 동기화는 후속) 트리거: 'OO 예약', '일정 잡아줘'", inputSchema: { ...REF, datetime: z.string().describe("YYYY-MM-DD HH:MM") } },
  async (a) => {
    const r = resolveRef(a);
    if (!r.ok) return text(r.text);
    const s = db.addSchedule(r.member.id, a.datetime);
    return text(`✅ 예약 저장: ${r.member.name} · ${s.datetime}`);
  }
);

// 13) mark_feedback_sent
server.registerTool(
  "mark_feedback_sent",
  { title: "피드백 전송 처리", description: "복붙으로 회원에게 전송 완료한 피드백을 처리. 트리거: 'OO 보냈어', '전송 완료'", inputSchema: { ...REF } },
  async (a) => {
    const r = resolveRef(a);
    if (!r.ok) return text(r.text);
    const n = db.markFeedbackSent(r.member.id);
    return text(n ? `✅ ${r.member.name} 피드백 ${n}건 발송 처리.` : `${r.member.name} 미발송 피드백이 없습니다.`);
  }
);

// 14) get_my_briefing
server.registerTool(
  "get_my_briefing",
  { title: "오늘 브리핑", description: "[최우선 호출 가능] 오늘 세션·미발송 피드백·재등록 임박 회원을 한 번에 요약. 트리거: '오늘 브리핑', '오늘 뭐 있어'", inputSchema: {} },
  async () => {
    const d = today();
    const sched = db.listSchedulesOnDate(d);
    const pending = db.pendingFeedbackMembers();
    const lowSessions = db.listMembers().filter((m) => m.regSessionsLeft != null && m.regSessionsLeft <= 2);
    return text(
      `[오늘 브리핑 · ${d}]\n` +
      `■ 예약 세션 (${sched.length}건)\n${sched.map((s: any) => `  - ${s.datetime} ${s.member_name}`).join("\n") || "  - 없음"}\n` +
      `■ 미발송 피드백 (${pending.length}명)\n${pending.map((p) => `  - ${p.name} (${p.count}건)`).join("\n") || "  - 없음"}\n` +
      `■ 재등록 임박 (잔여 ≤2)\n${lowSessions.map((m) => `  - ${m.name} (잔여 ${m.regSessionsLeft}회)`).join("\n") || "  - 없음"}`
    );
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio 서버는 로그를 stderr로만 출력해야 함(stdout은 JSON-RPC 전용)
  console.error("trainerzip MCP server running on stdio");
}
main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
