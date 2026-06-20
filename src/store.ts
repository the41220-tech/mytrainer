// 나만의 근력 AI — 스토어. 다중 사용자 격리: Key/Token → 사용자별 DB 파일.
// openStore({key})로 요청마다 사용자 store를 얻는다(파일경로별 캐시 재사용).
import Database from "better-sqlite3";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import type { SetEntry, Injury, Goal } from "./engine.js";

export type Cardio = { date: string; type: string; minutes: number; distanceKm?: number; avgHr?: number; calories?: number };

export interface Store {
  getProfile(): { units: string; level: string | null; bodyweight: number | null; rep_low: number; rep_high: number };
  setProfile(p: Partial<{ units: string; level: string; bodyweight: number; rep_low: number; rep_high: number }>): any;
  getOpenSession(): any;
  startSession(at: string, focus?: string, note?: string): { id: number; already: boolean; start_at: string };
  endSession(at: string): { id: number; start_at: string; end_at: string; focus: string | null } | null;
  currentSessionId(): number | null;
  sessionSets(id: number): SetEntry[];
  addSet(s: SetEntry, sessionId?: number | null): void;
  addSets(arr: SetEntry[]): number;
  listSets(): SetEntry[];
  listRecent(n?: number): any[];
  deleteLast(): boolean;
  addCardio(c: Cardio, sessionId?: number | null): void;
  listCardio(n?: number): any[];
  addInjury(i: Injury): void;
  updateInjuryStatus(bodypart: string, status: "active" | "recovered"): number;
  listInjuries(activeOnly?: boolean): Injury[];
  setGoal(g: Goal): void;
  listGoals(): Goal[];
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK (id=1), units TEXT NOT NULL DEFAULT 'kg', level TEXT, bodyweight REAL, rep_low INTEGER NOT NULL DEFAULT 5, rep_high INTEGER NOT NULL DEFAULT 8);
  CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, start_at TEXT NOT NULL, end_at TEXT, focus TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'open');
  CREATE TABLE IF NOT EXISTS sets (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, date TEXT NOT NULL, exercise TEXT NOT NULL, weight REAL NOT NULL, reps INTEGER NOT NULL, sets INTEGER NOT NULL DEFAULT 1, rpe REAL);
  CREATE TABLE IF NOT EXISTS cardio (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, date TEXT NOT NULL, type TEXT NOT NULL, minutes REAL NOT NULL, distance_km REAL, avg_hr INTEGER, calories REAL);
  CREATE TABLE IF NOT EXISTS injuries (id INTEGER PRIMARY KEY AUTOINCREMENT, bodypart TEXT NOT NULL, type TEXT, date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', note TEXT);
  CREATE TABLE IF NOT EXISTS goals (id INTEGER PRIMARY KEY AUTOINCREMENT, exercise TEXT NOT NULL, target1rm REAL NOT NULL, deadline TEXT);
`;

function baseDir(): string { return process.env.MYTRAINER_DB_DIR || join(homedir(), ".mytrainer"); }
function resolveFile(opts: { path?: string; key?: string }): string {
  if (opts.path) return opts.path;
  if (opts.key) {
    const dir = join(baseDir(), "users");
    try { mkdirSync(dir, { recursive: true }); } catch { /* */ }
    return join(dir, createHash("sha256").update(opts.key).digest("hex").slice(0, 16) + ".db"); // 키 원문 노출 금지(해시)
  }
  if (process.env.MYTRAINER_DB_PATH) return process.env.MYTRAINER_DB_PATH;
  try { mkdirSync(baseDir(), { recursive: true }); } catch { /* */ }
  return join(baseDir(), "mytrainer.db");
}

// 파일경로 → {store, db} LRU 캐시. 상한 초과 시 가장 오래된 연결 close(파일핸들 누수 방지).
const MAX_CACHE = Number(process.env.MYTRAINER_MAX_CACHE ?? 200);
const cache = new Map<string, { store: Store; db: Database.Database }>();
export function openStore(opts: { path?: string; key?: string } = {}): Store {
  const file = resolveFile(opts);
  const hit = cache.get(file);
  if (hit) { cache.delete(file); cache.set(file, hit); return hit.store; } // LRU 갱신
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  db.prepare("INSERT OR IGNORE INTO profile (id) VALUES (1)").run();
  const store = makeStore(db);
  cache.set(file, { store, db });
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest) { const ev = cache.get(oldest); cache.delete(oldest); try { ev?.db.close(); } catch { /* */ } }
  }
  return store;
}

function rowToSet(r: any): SetEntry { return { date: r.date, exercise: r.exercise, weight: r.weight, reps: r.reps, sets: r.sets, rpe: r.rpe ?? undefined }; }

function makeStore(db: Database.Database): Store {
  return {
    getProfile() { return db.prepare("SELECT * FROM profile WHERE id = 1").get() as any; },
    setProfile(p) { const m = { ...this.getProfile(), ...p }; db.prepare("UPDATE profile SET units=@units, level=@level, bodyweight=@bodyweight, rep_low=@rep_low, rep_high=@rep_high WHERE id=1").run({ units: m.units, level: m.level ?? null, bodyweight: m.bodyweight ?? null, rep_low: m.rep_low, rep_high: m.rep_high }); return this.getProfile(); },
    getOpenSession() { return db.prepare("SELECT * FROM sessions WHERE status='open' ORDER BY id DESC LIMIT 1").get() ?? null; },
    startSession(at, focus, note) { const open = this.getOpenSession(); if (open) return { id: open.id, already: true, start_at: open.start_at }; const info = db.prepare("INSERT INTO sessions (start_at, focus, note, status) VALUES (?,?,?,'open')").run(at, focus ?? null, note ?? null); return { id: Number(info.lastInsertRowid), already: false, start_at: at }; },
    endSession(at) { const open = this.getOpenSession(); if (!open) return null; db.prepare("UPDATE sessions SET status='closed', end_at=? WHERE id=?").run(at, open.id); return { id: open.id, start_at: open.start_at, end_at: at, focus: open.focus ?? null }; },
    currentSessionId() { const o = this.getOpenSession(); return o ? o.id : null; },
    sessionSets(id) { return (db.prepare("SELECT * FROM sets WHERE session_id = ?").all(id) as any[]).map(rowToSet); },
    addSet(s, sessionId) { db.prepare("INSERT INTO sets (session_id, date, exercise, weight, reps, sets, rpe) VALUES (@session_id,@date,@exercise,@weight,@reps,@sets,@rpe)").run({ session_id: sessionId ?? null, date: s.date, exercise: s.exercise, weight: s.weight, reps: s.reps, sets: s.sets ?? 1, rpe: s.rpe ?? null }); },
    addSets(arr) { for (const s of arr) this.addSet(s, null); return arr.length; },
    listSets() { return (db.prepare("SELECT * FROM sets").all() as any[]).map(rowToSet); },
    listRecent(n = 10) { return db.prepare("SELECT date, exercise, weight, reps, sets, rpe FROM sets ORDER BY date DESC, id DESC LIMIT ?").all(n) as any[]; },
    deleteLast() { const r = db.prepare("SELECT id FROM sets ORDER BY id DESC LIMIT 1").get() as any; if (r) db.prepare("DELETE FROM sets WHERE id=?").run(r.id); return !!r; },
    addCardio(c, sessionId) { db.prepare("INSERT INTO cardio (session_id, date, type, minutes, distance_km, avg_hr, calories) VALUES (@session_id,@date,@type,@minutes,@distance_km,@avg_hr,@calories)").run({ session_id: sessionId ?? null, date: c.date, type: c.type, minutes: c.minutes, distance_km: c.distanceKm ?? null, avg_hr: c.avgHr ?? null, calories: c.calories ?? null }); },
    listCardio(n = 10) { return db.prepare("SELECT date, type, minutes, distance_km, avg_hr, calories FROM cardio ORDER BY date DESC, id DESC LIMIT ?").all(n) as any[]; },
    addInjury(i) { db.prepare("INSERT INTO injuries (bodypart, type, date, status, note) VALUES (@bodypart,@type,@date,@status,@note)").run({ bodypart: i.bodypart, type: i.type ?? null, date: i.date, status: i.status, note: i.note ?? null }); },
    updateInjuryStatus(bodypart, status) { return db.prepare("UPDATE injuries SET status=? WHERE bodypart=? AND status != 'recovered'").run(status, bodypart).changes; },
    listInjuries(activeOnly = false) { const rows = (activeOnly ? db.prepare("SELECT * FROM injuries WHERE status='active'") : db.prepare("SELECT * FROM injuries")).all() as any[]; return rows.map((r) => ({ bodypart: r.bodypart, type: r.type ?? undefined, date: r.date, status: r.status, note: r.note ?? undefined })); },
    setGoal(g) { db.prepare("INSERT INTO goals (exercise, target1rm, deadline) VALUES (@exercise,@target1rm,@deadline)").run({ exercise: g.exercise, target1rm: g.target1rm, deadline: g.deadline ?? null }); },
    listGoals() { return (db.prepare("SELECT exercise, target1rm, deadline FROM goals").all() as any[]).map((r) => ({ exercise: r.exercise, target1rm: r.target1rm, deadline: r.deadline ?? undefined })); },
  };
}
