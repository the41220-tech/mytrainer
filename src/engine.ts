// 나만의 전문 트레이너 — 분석·예측 엔진 (순수·결정적, 외부 의존 0)
// 성장 / 기록 분석 / 부상 이력 / 성장 예측을 "내 데이터 + 실제 계산"으로 처리.
// LLM 추정 금지 → 수치 신뢰성(=심사 '안정성') 확보.

export type SetEntry = {
  date: string;        // YYYY-MM-DD
  exercise: string;    // 예: "벤치 프레스"
  weight: number;      // kg
  reps: number;
  sets?: number;       // 동일 세트 수 (기본 1)
  rpe?: number;        // 1~10 (선택)
};
export type Injury = { bodypart: string; type?: string; date: string; status: "active" | "recovered"; note?: string };
export type Goal = { exercise: string; target1rm: number; deadline?: string };

// ---- 도메인 상수 ----
const INJURY_AVOID: Record<string, string[]> = {
  무릎: ["바벨 스쿼트", "런지", "레그 익스텐션", "점프"],
  허리: ["데드리프트", "바벨 로우", "굿모닝"],
  어깨: ["오버헤드 프레스", "업라이트 로우", "딥스"],
  손목: ["바벨 컬", "푸시업"],
  발목: ["점프", "런지", "박스 스텝업"],
};
function bodyPartOf(name: string): string {
  if (/데드리프트|랫|로우|풀업|풀\s?다운/.test(name)) return "등";
  if (/스쿼트|레그|런지|힙|레그컬/.test(name)) return "하체";
  if (/벤치|체스트|푸시업|플라이|딥스/.test(name)) return "가슴";
  if (/오버헤드|숄더|레터럴|델트/.test(name)) return "어깨";
  if (/컬|트라이셉/.test(name)) return "팔";
  if (/플랭크|크런치|레그레이즈|코어/.test(name)) return "코어";
  return "기타";
}
const PUSH = new Set(["가슴", "어깨", "팔"]);
const round = (n: number, d = 1) => +n.toFixed(d);
const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

// ---- 1RM 추정 (Epley) ----
export function e1rm(weight: number, reps: number): number {
  if (reps <= 1) return round(weight);
  return round(weight * (1 + reps / 30)); // Epley 공식
}

// 운동별 일자별 최고 e1RM 시계열
function bestE1rmSeries(entries: SetEntry[], exercise: string): { date: string; e1rm: number }[] {
  const byDate = new Map<string, number>();
  for (const e of entries) {
    if (e.exercise !== exercise) continue;
    const v = e1rm(e.weight, e.reps);
    byDate.set(e.date, Math.max(byDate.get(e.date) ?? 0, v));
  }
  return [...byDate.entries()].map(([date, v]) => ({ date, e1rm: v })).sort((a, b) => a.date.localeCompare(b.date));
}

// 일 단위 선형회귀 기울기(kg/day)
function slopePerDay(series: { date: string; e1rm: number }[]): number {
  if (series.length < 2) return 0;
  const x0 = series[0].date;
  const xs = series.map((p) => daysBetween(x0, p.date));
  const ys = series.map((p) => p.e1rm);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}

// ---- 성장 요약 ----
export function growthSummary(entries: SetEntry[], exercise: string) {
  const s = bestE1rmSeries(entries, exercise);
  if (s.length < 2) return { exercise, sessions: s.length, enough: false as const };
  const weeklyGain = round(slopePerDay(s) * 7);
  const recentWeeklyGain = round(slopePerDay(s.slice(-6)) * 7); // 최근 6세션 = 현재 속도(둔화 반영)
  return {
    exercise, enough: true as const, sessions: s.length,
    currentE1rm: s[s.length - 1].e1rm,
    allTimeBest: round(Math.max(...s.map((p) => p.e1rm))),
    firstE1rm: s[0].e1rm,
    weeklyGainKg: weeklyGain,
    recentWeeklyGainKg: recentWeeklyGain,
  };
}

// ---- 성장 예측 모델 v2: 2층(개인 회귀 × 경력 프라이어) + 둔화(체감) 반영 ----
// 경력별 복합운동 주간 e1RM 기대 증가(프라이어, kg/주). 문헌 근사로 하향(실측 중급 ≈ 월 1~2kg).
const PRIOR_WEEKLY_GAIN: Record<string, number> = { 초급: 1.5, 중급: 0.5, 고급: 0.2 };
// 개인(최근) 기울기 × 프라이어 혼합. 강한 shrinkage(K=8) + 상한으로 과장 차단.
export function blendedWeeklyGain(recentSlope: number, sessions: number, level?: string) {
  const prior = PRIOR_WEEKLY_GAIN[level ?? "중급"] ?? 0.5;
  // 개인 데이터 충분(>=6)하고 정체/감소면 프라이어로 가리지 않음
  if (sessions >= 6 && recentSlope <= 0) return { gain: round(recentSlope), w: 1, prior, basis: "개인 추세(정체)" };
  const w = sessions / (sessions + 8); // K=8: 데이터 많아야 개인 비중↑ (n8→0.5, n16→0.67)
  let gain = w * recentSlope + (1 - w) * prior;
  gain = Math.min(gain, prior * 3); // 상한: 프라이어 3배 (단기 급상승 외삽 차단)
  return { gain: round(gain), w: round(w, 2), prior, basis: `개인(최근) ${Math.round(w * 100)}% × 경력 ${Math.round((1 - w) * 100)}%·상한` };
}

// 둔화 반영 ETA: 주간 증가가 매주 프라이어 쪽으로 감쇠(r) → 목표가 멀수록 비선형으로 느려짐.
function etaWithDecay(gap: number, baseGain: number, prior: number, r = 0.85, cap = 520): number {
  let acc = 0, w = 0, g = baseGain;
  while (acc < gap && w < cap) { acc += g; w++; g = prior + (g - prior) * r; } // g는 prior로 수렴(하한)
  return w;
}

// ---- 성장 예측: 목표 1RM 도달 ETA (v2: 최근기울기 + 둔화 + 범위) ----
export function goalETA(entries: SetEntry[], exercise: string, target1rm: number, today = new Date().toISOString().slice(0, 10), level?: string) {
  const g = growthSummary(entries, exercise);
  if (!g.enough) return { ok: false as const, msg: "데이터 부족(세션 2회 미만)" };
  if (g.currentE1rm >= target1rm) return { ok: true as const, alreadyReached: true, currentE1rm: g.currentE1rm };
  const b = blendedWeeklyGain(g.recentWeeklyGainKg, g.sessions, level);
  if (b.gain <= 0) return { ok: false as const, msg: "최근 정체 — 선형 예측 불가. 전략 변경(디로드·종목변경) 필요." };
  const gap = round(target1rm - g.currentE1rm);
  const weeks = etaWithDecay(gap, b.gain, b.prior);          // 중심 추정(둔화 반영)
  const optimistic = Math.max(1, Math.round(gap / b.gain));   // 현재 속도 유지(낙관)
  const conservative = Math.round(gap / b.prior);             // 경력 평균까지 둔화(보수)
  const reach = new Date(today); reach.setDate(reach.getDate() + weeks * 7);
  return {
    ok: true as const, weeks,
    rangeWeeks: [Math.min(optimistic, weeks), Math.max(conservative, weeks)] as [number, number],
    reachDate: reach.toISOString().slice(0, 10),
    currentE1rm: g.currentE1rm, weeklyGainKg: b.gain, model: b.basis,
    caveat: "\n둔화(체감) 반영 추정 — 목표가 멀수록 느려짐. 보장 아님.",
  };
}

// ---- 정체 감지 ----
export function detectPlateau(entries: SetEntry[], exercise: string, lookbackWeeks = 4) {
  const s = bestE1rmSeries(entries, exercise);
  if (s.length < 2) return { plateau: false, enough: false };
  const last = s[s.length - 1];
  const cutoff = daysBetween(s[0].date, last.date) - lookbackWeeks * 7;
  const win = s.filter((p) => daysBetween(s[0].date, p.date) >= Math.max(0, cutoff));
  const start = win[0].e1rm, end = win[win.length - 1].e1rm;
  const improvePct = start === 0 ? 0 : round(((end - start) / start) * 100, 1);
  return { plateau: improvePct < 1, improvePct, windowSessions: win.length, lookbackWeeks };
}

// ---- 다음 세트 예측 (더블 프로그레션) ----
export function suggestNext(entries: SetEntry[], exercise: string, repRange: [number, number] = [5, 8], inc = 2.5) {
  const ex = entries.filter((e) => e.exercise === exercise).sort((a, b) => a.date.localeCompare(b.date));
  if (!ex.length) return { ok: false as const, msg: "기록 없음" };
  const lastDate = ex[ex.length - 1].date;
  const lastDay = ex.filter((e) => e.date === lastDate);
  const best = lastDay.reduce((a, b) => (b.weight > a.weight ? b : a));
  if (best.rpe != null && best.rpe >= 9.5) return { ok: true as const, action: "deload", weight: round(best.weight * 0.9), reps: repRange[0], rationale: "최근 RPE 9.5+ → 과부하, 10% 디로드 권장" };
  if (best.reps >= repRange[1]) return { ok: true as const, action: "increase_weight", weight: round(best.weight + inc), reps: repRange[0], rationale: `상단 반복(${repRange[1]}) 달성 → +${inc}kg, ${repRange[0]}회부터` };
  return { ok: true as const, action: "increase_reps", weight: best.weight, reps: best.reps + 1, rationale: `반복 +1 (목표 ${repRange[1]}회 도달 시 증량)` };
}

// ---- 기록 분석 (볼륨·PR·밸런스) ----
export function analyzeRecords(entries: SetEntry[], periodDays = 30, today = new Date().toISOString().slice(0, 10)) {
  const since = new Date(today); since.setDate(since.getDate() - periodDays);
  const recent = entries.filter((e) => new Date(e.date) >= since);
  const vol = (e: SetEntry) => e.weight * e.reps * (e.sets ?? 1);
  const totalVolume = round(recent.reduce((s, e) => s + vol(e), 0), 0);
  const byPart: Record<string, number> = {};
  for (const e of recent) { const p = bodyPartOf(e.exercise); byPart[p] = (byPart[p] ?? 0) + vol(e); }
  // PR: 운동별 최고 중량 / 최고 e1RM (전체 기간)
  const prs: Record<string, { maxWeight: number; maxE1rm: number }> = {};
  for (const e of entries) {
    const k = e.exercise; const v = e1rm(e.weight, e.reps);
    prs[k] = prs[k] ? { maxWeight: Math.max(prs[k].maxWeight, e.weight), maxE1rm: Math.max(prs[k].maxE1rm, v) } : { maxWeight: e.weight, maxE1rm: v };
  }
  const push = Object.entries(byPart).filter(([p]) => PUSH.has(p)).reduce((s, [, v]) => s + v, 0);
  const pull = byPart["등"] ?? 0;
  const lower = byPart["하체"] ?? 0;
  const upper = push + pull;
  return {
    periodDays, sessions: new Set(recent.map((e) => e.date)).size, totalVolume, byPart,
    prs,
    balance: {
      pushPull: pull === 0 ? "당기기 기록 없음" : `밀기:당기기 = ${round(push / pull, 2)} (이상 1.0~1.3)`,
      upperLower: lower === 0 ? "하체 기록 없음" : `상체:하체 = ${round(upper / lower, 2)}`,
    },
  };
}

// ---- 부상: 금기 운동 + 부상위험(ACWR) ----
export function contraindicated(injuries: Injury[]): string[] {
  const out = new Set<string>();
  for (const inj of injuries) if (inj.status === "active") for (const k of Object.keys(INJURY_AVOID)) if (inj.bodypart.includes(k)) INJURY_AVOID[k].forEach((x) => out.add(x));
  return [...out];
}
// ACWR(급성:만성 작업부하 비율) — 부위별 이번주 볼륨 / 직전 4주 평균. >1.5 부상위험↑(스포츠과학 지표)
export function injuryRisk(entries: SetEntry[], bodypart: string, today = new Date().toISOString().slice(0, 10)) {
  const vol = (e: SetEntry) => e.weight * e.reps * (e.sets ?? 1);
  const t = new Date(today).getTime();
  const weekVol = (wAgo: number) => entries.filter((e) => bodyPartOf(e.exercise) === bodypart).filter((e) => {
    const d = Math.round((t - new Date(e.date).getTime()) / 86400000);
    return d >= wAgo * 7 && d < (wAgo + 1) * 7;
  }).reduce((s, e) => s + vol(e), 0);
  const acute = weekVol(0);
  const chronic = [1, 2, 3, 4].map(weekVol).reduce((a, b) => a + b, 0) / 4;
  if (chronic === 0) return { bodypart, acwr: null, msg: "만성 데이터 부족" };
  const acwr = round(acute / chronic, 2);
  const flag = acwr > 1.5 ? "⚠️ 부상위험 높음(급증)" : acwr < 0.8 ? "감소(디트레이닝 주의)" : "적정";
  return { bodypart, acute: round(acute, 0), chronic: round(chronic, 0), acwr, flag };
}

// ════════════════════════════════════════════════════════════
// 2층 ML — 몸무게 · 수면 · 상관 (프라이어 = 공식, 개인 fit = 내 데이터)
// 한 사람 데이터는 작다 → 거대 ML이 아니라 개인 회귀/캘리브레이션.
// ════════════════════════════════════════════════════════════
const KCAL_PER_KG = 7700; // 체지방 1kg ≈ 7700kcal

// [프라이어] Mifflin-St Jeor BMR + 활동계수 → TDEE 기본값(데이터 없을 때 콜드스타트)
export function mifflinTDEE(weightKg: number, heightCm: number, age: number, sex: "male" | "female", activity = 1.4) {
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "male" ? 5 : -161);
  return { bmr: round(bmr, 0), tdeePrior: round(bmr * activity, 0) };
}

// [개인 fit] 내 체중변화 + 총섭취로 '나의 실제 TDEE' 역산
export function estimateTDEE(weightStartKg: number, weightEndKg: number, totalCalories: number, days: number) {
  if (days <= 0) return { ok: false as const, msg: "기간 부족" };
  const dW = weightEndKg - weightStartKg;
  const tdee = round((totalCalories - dW * KCAL_PER_KG) / days, 0);
  const confidence = days >= 21 ? "높음" : days >= 10 ? "보통" : "낮음(데이터 짧음)";
  return { ok: true as const, tdeeKcal: tdee, days, weightChangeKg: round(dW), confidence };
}

// [예측] 현재 체중 + 평균 섭취 + TDEE → N주 뒤 체중
export function weightForecast(currentKg: number, avgDailyCalories: number, tdeeKcal: number, weeks: number) {
  const dailyBalance = avgDailyCalories - tdeeKcal;
  return {
    predictedKg: round(currentKg + (dailyBalance * 7 * weeks) / KCAL_PER_KG),
    weeklyChangeKg: round((dailyBalance * 7) / KCAL_PER_KG, 2),
    dailyBalance: round(dailyBalance, 0),
  };
}

// 체중 추세(주간 kg)
export function weightTrendPerWeek(series: { date: string; weightKg: number }[]) {
  const s = [...series].sort((a, b) => a.date.localeCompare(b.date));
  if (s.length < 2) return { ok: false as const, msg: "체중 기록 2회 이상 필요" };
  const x0 = s[0].date;
  const pts = s.map((p) => ({ x: daysBetween(x0, p.date), y: p.weightKg }));
  const n = pts.length, mx = pts.reduce((a, b) => a + b.x, 0) / n, my = pts.reduce((a, b) => a + b.y, 0) / n;
  let num = 0, den = 0; for (const p of pts) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
  return { ok: true as const, perWeekKg: round(den === 0 ? 0 : (num / den) * 7), current: s[s.length - 1].weightKg };
}

// 수면 요약 (개인 패턴)
export function sleepSummary(series: { date: string; hours: number }[]) {
  if (!series.length) return { ok: false as const, msg: "수면 기록 없음" };
  const hs = series.map((s) => s.hours); const n = hs.length;
  const avg = hs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(hs.reduce((a, b) => a + (b - avg) ** 2, 0) / n);
  return { ok: true as const, nights: n, avgHours: round(avg), consistencySd: round(sd), pctUnder7: round((hs.filter((h) => h < 7).length / n) * 100, 0) };
}

// 피어슨 상관 (개인 패턴 발견: 수면↔체중, 수면↔근력 등). lagDays: A 다음날 B를 보려면 1.
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length; if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx === 0 || dy === 0 ? NaN : round(num / Math.sqrt(dx * dy), 2);
}
export function correlateSeries(A: { date: string; val: number }[], B: { date: string; val: number }[], lagDays = 0) {
  const mapB = new Map(B.map((p) => [p.date, p.val]));
  const xs: number[] = [], ys: number[] = [];
  for (const a of A) {
    const d = new Date(a.date); d.setDate(d.getDate() + lagDays);
    const key = d.toISOString().slice(0, 10);
    if (mapB.has(key)) { xs.push(a.val); ys.push(mapB.get(key)!); }
  }
  const r = pearson(xs, ys);
  const strength = isNaN(r) ? "데이터 부족(3쌍 미만)" : Math.abs(r) >= 0.5 ? "뚜렷" : Math.abs(r) >= 0.3 ? "약함" : "미미";
  return { n: xs.length, r: isNaN(r) ? null : r, strength, note: "상관관계일 뿐 인과 아님" };
}

// 약점 부위 (분석: 주요 부위 볼륨 최소 = 보강 필요)
export function weakPoint(sets: SetEntry[], periodDays = 90, today = new Date().toISOString().slice(0, 10)) {
  const a = analyzeRecords(sets, periodDays, today);
  const major = ["가슴", "등", "하체", "어깨", "팔"];
  const vols = major.map((p) => ({ p, v: a.byPart[p] ?? 0 })).filter((x) => x.v > 0);
  if (vols.length < 2) return { ok: false as const, msg: "부위 데이터 부족" };
  const weak = vols.reduce((m, x) => (x.v < m.v ? x : m));
  const strong = vols.reduce((m, x) => (x.v > m.v ? x : m));
  return { ok: true as const, weak: weak.p, weakVolume: Math.round(weak.v), strongest: strong.p, ratio: round(strong.v / (weak.v || 1)) };
}
