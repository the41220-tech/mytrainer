#!/usr/bin/env node
// 데모 시드 — 첫 실행 시 DB를 채워 바로 시연 가능하게.
// 실제 개인기록(app.db) 반영: 체중 78.1kg, 무릎 통증(하체 강도↓).
// ⚠️ 근력 '세트(무게×횟수)'는 app.db에 없어 합성(예시)입니다. 실제 로깅 시작 전 데모용.
import { fileURLToPath } from "node:url";
import type { Store } from "./store.js";
import type { SetEntry } from "./engine.js";

export function seedDemo(store: Store) {
  const day = (back: number) => { const d = new Date(Date.now() + 9 * 3600 * 1000); d.setDate(d.getDate() - back); return d.toISOString().slice(0, 10); };

  // ── 실제 개인기록 반영 ──
  store.setProfile({ units: "kg", level: "중급", bodyweight: 78.1, rep_low: 5, rep_high: 8 });
  store.addInjury({ bodypart: "무릎", type: "통증", date: day(21), status: "active", note: "하체 강도 낮춤 (개인 기록 반영)" });

  // ── 데모(합성) 근력 진척 ──
  const sets: SetEntry[] = [];
  const prog = (ex: string, start: number, step: number, weeks: number, lastBack = 0, reps = 5) => {
    for (let i = 0; i < weeks; i++) sets.push({ date: day(lastBack + (weeks - 1 - i) * 7), exercise: ex, weight: +(start + step * i).toFixed(1), reps, sets: 3, rpe: i === weeks - 1 ? 8 : undefined });
  };
  prog("벤치 프레스", 62.5, 2.5, 8, 0);    // 62.5→80 (최신=오늘) → e1RM 93.3
  prog("데드리프트", 100, 5, 7, 1);         // 100→130
  prog("오버헤드 프레스", 40, 1.25, 6, 2);  // 40→46.25
  prog("바벨 스쿼트", 80, 2.5, 4, 21);      // 무릎 통증으로 3주 전 이후 중단 → injury_guard로 금기 표시
  store.addSets(sets);

  // 유산소 데모
  store.addCardio({ date: day(2), type: "러닝", minutes: 25, distanceKm: 4.5 });

  // 목표
  store.setGoal({ exercise: "벤치 프레스", target1rm: 100 });
  store.setGoal({ exercise: "데드리프트", target1rm: 150 });

  return { profile: "78.1kg·중급", injuries: 1, sets: sets.length, cardio: 1, goals: 2 };
}

// 직접 실행 시 기본/지정 DB에 시드
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const { openStore } = await import("./store.js");
  const s = openStore({});
  const r = seedDemo(s);
  console.error(`✅ 데모 시드 완료: ${JSON.stringify(r)} (실제: 무릎 부상·체중 78.1 / 근력 세트는 예시)`);
}
