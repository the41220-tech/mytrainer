// 순수 도메인 로직 — 결정적(deterministic)이라 단위 테스트가 쉽고 "기술적 안정성"에 유리.
// 루틴/피드백/통계는 서버 내부에서 규칙 기반으로 계산한다(LLM 추정 금지 → 수치 신뢰성 확보).
import type { Member, Exercise, SessionRow } from "./db.js";

// 부상 부위 → 피해야 할 운동 (G6 안전 가드의 기초)
const INJURY_AVOID: Record<string, string[]> = {
  무릎: ["바벨 스쿼트", "런지", "레그 익스텐션", "점프"],
  허리: ["데드리프트", "바벨 로우", "굿모닝", "레그 프레스(고중량)"],
  어깨: ["오버헤드 프레스", "업라이트 로우", "딥스", "비하인드 넥 프레스"],
  손목: ["바벨 컬", "프론트 스쿼트(랙)", "푸시업"],
  발목: ["점프", "런지", "박스 스텝업"],
};

// 부위별 운동 풀
const POOL: Record<string, string[]> = {
  하체: ["바벨 스쿼트", "레그 프레스", "런지", "레그 컬", "레그 익스텐션", "힙 쓰러스트"],
  가슴: ["벤치 프레스", "인클라인 덤벨 프레스", "체스트 플라이", "푸시업"],
  등: ["랫 풀다운", "시티드 로우", "바벨 로우", "풀업"],
  어깨: ["오버헤드 프레스", "사이드 레터럴 레이즈", "리어 델트 플라이"],
  팔: ["바벨 컬", "덤벨 컬", "트라이셉스 푸시다운", "딥스"],
  코어: ["플랭크", "행잉 레그레이즈", "케이블 크런치", "데드버그"],
  전신: ["바벨 스쿼트", "벤치 프레스", "랫 풀다운", "오버헤드 프레스", "플랭크"],
};

type GoalScheme = { label: string; sets: number; reps: string; rest: string };
const GOAL_SCHEME: Record<string, GoalScheme> = {
  감량: { label: "체지방 감량(서킷)", sets: 3, reps: "12~15회", rest: "30~45초" },
  증량: { label: "근비대(분할)", sets: 4, reps: "8~12회", rest: "60~90초" },
  근력: { label: "근력(고중량 저반복)", sets: 5, reps: "3~6회", rest: "2~3분" },
  재활: { label: "재활(저강도)", sets: 2, reps: "15~20회", rest: "충분히" },
  체력: { label: "전신 체력", sets: 3, reps: "10~12회", rest: "45~60초" },
};

export function generateRoutine(member: Member, focus?: string): { text: string; excluded: string[] } {
  const scheme = GOAL_SCHEME[member.goal ?? "체력"] ?? GOAL_SCHEME["체력"];
  const part = focus && POOL[focus] ? focus : member.goal === "감량" ? "전신" : "전신";
  const avoid = new Set<string>();
  for (const inj of member.injuries) {
    for (const key of Object.keys(INJURY_AVOID)) {
      if (inj.includes(key)) INJURY_AVOID[key].forEach((e) => avoid.add(e));
    }
  }
  const candidates = POOL[part] ?? POOL["전신"];
  const chosen: string[] = [];
  const excluded: string[] = [];
  for (const ex of candidates) {
    if (avoid.has(ex)) excluded.push(ex);
    else chosen.push(ex);
    if (chosen.length >= 5) break;
  }
  const lines = chosen.map((ex, i) => `  ${i + 1}. ${ex} — ${scheme.sets}세트 × ${scheme.reps} (휴식 ${scheme.rest})`);
  const text =
    `[루틴 초안] ${member.name} · 목표: ${member.goal ?? "미설정"} · 포커스: ${part}\n` +
    `구성: ${scheme.label}\n` +
    `워밍업: 5~10분 유산소 + 동적 스트레칭\n` +
    `메인:\n${lines.join("\n")}\n` +
    `마무리: 5분 정리운동 + 타깃 부위 스트레칭` +
    (excluded.length ? `\n\n⚠️ 부상(${member.injuries.join(", ")}) 고려해 제외: ${excluded.join(", ")}` : "") +
    `\n\n※ 이 루틴은 초안입니다. 트레이너가 회원 컨디션에 맞춰 최종 확인·조정하세요.`;
  return { text, excluded };
}

export function draftFeedback(member: Member, last: SessionRow | null, tone?: string): string {
  const greet = tone === "전문" ? `${member.name} 회원님, 오늘 수업 수고 많으셨습니다.` : `${member.name}님 오늘도 정말 잘하셨어요! 💪`;
  let body = "";
  if (last && last.exercises.length) {
    const items = last.exercises.map((e) => `${e.name}${e.weight ? ` ${e.weight}kg` : ""}${e.sets ? ` ${e.sets}x${e.reps ?? ""}` : ""}`).join(", ");
    body = `오늘은 ${items} 진행했어요. `;
  }
  const goalLine =
    member.goal === "감량" ? "다음 수업까지 하루 30분 유산소 한 번만 챙겨주세요." :
    member.goal === "증량" ? "단백질(체중 1kg당 1.6g) 꼭 챙기시고 충분히 주무세요." :
    member.goal === "재활" ? "통증 있으면 무리하지 마시고 알려주세요." :
    "다음 수업 전 가볍게 스트레칭 잊지 마세요.";
  const allergyNote = member.healthConditions.length ? `\n(참고: ${member.healthConditions.join(", ")} 주의)` : "";
  return (
    `[복붙용 피드백 초안]\n` +
    `${greet}\n${body}${goalLine}${allergyNote}\n다음 시간에 만나요!\n` +
    `\n※ 직접 전송은 안 됩니다 — 위 내용을 복사해 회원 카톡에 보내세요.`
  );
}

// 부위 추정(통계용) — 운동명 키워드 매칭
function bodyPartOf(name: string): string {
  const n = name.toLowerCase();
  if (/(스쿼트|레그|런지|힙|데드)/.test(name)) return "하체";
  if (/(벤치|체스트|푸시업|플라이|프레스)/.test(name) && /(체스트|벤치|플라이|푸시업)/.test(name)) return "가슴";
  if (/(랫|로우|풀업|풀 ?다운|등)/.test(name)) return "등";
  if (/(숄더|오버헤드|레터럴|델트|어깨)/.test(name)) return "어깨";
  if (/(컬|트라이셉스|딥스|팔)/.test(name)) return "팔";
  if (/(플랭크|크런치|코어|레그레이즈|abs)/.test(n)) return "코어";
  return "기타";
}

export function computeProgressStats(sessions: SessionRow[], period: "week" | "month" | "all"): string {
  const now = new Date();
  const days = period === "week" ? 7 : period === "month" ? 30 : 100000;
  const since = new Date(now.getTime() - days * 86400000);
  const prevSince = new Date(now.getTime() - 2 * days * 86400000);

  const inRange = (s: SessionRow, a: Date, b: Date) => {
    const d = new Date(s.date);
    return d >= a && d < b;
  };
  const cur = sessions.filter((s) => inRange(s, since, now));
  const prev = sessions.filter((s) => inRange(s, prevSince, since));

  const volumeOf = (list: SessionRow[]) =>
    list.reduce((sum, s) => sum + s.exercises.reduce((v, e) => v + (e.weight ?? 0) * (e.sets ?? 0) * (e.reps ?? 0), 0), 0);

  const curVol = volumeOf(cur);
  const prevVol = volumeOf(prev);
  const byPart: Record<string, number> = {};
  for (const s of cur) for (const e of s.exercises) {
    const p = bodyPartOf(e.name);
    byPart[p] = (byPart[p] ?? 0) + (e.weight ?? 0) * (e.sets ?? 0) * (e.reps ?? 0);
  }
  const trend = prevVol === 0 ? (curVol > 0 ? "이전 구간 데이터 없음" : "기록 없음") : `${(((curVol - prevVol) / prevVol) * 100).toFixed(0)}% (${curVol >= prevVol ? "▲ 증가" : "▼ 감소"})`;
  const partLine = Object.keys(byPart).length
    ? Object.entries(byPart).sort((a, b) => b[1] - a[1]).map(([p, v]) => `  - ${p}: ${v.toLocaleString()}`).join("\n")
    : "  - (볼륨 기록 없음)";

  return (
    `[진척 통계] 최근 ${period === "week" ? "1주" : period === "month" ? "1달" : "전체"}\n` +
    `세션 수: ${cur.length}회\n` +
    `총 볼륨(무게×세트×횟수): ${curVol.toLocaleString()}\n` +
    `이전 동일 구간 대비: ${trend}\n` +
    `부위별 볼륨:\n${partLine}\n` +
    `\n※ 수치는 기록된 세션에서 실제 계산한 값입니다(추정 아님).`
  );
}
