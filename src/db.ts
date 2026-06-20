// SQLite 데이터 레이어 — 회원 카드(영속 메모리)의 심장.
// 단일 트레이너(로컬/단일 테넌트) 기준 MVP. 원격 다중 테넌트는 trainer_id로 확장.
import Database from "better-sqlite3";
import { join } from "node:path";

export type Member = {
  id: number;
  name: string;
  aliases: string[];
  gender: string | null;
  age: number | null;
  goal: string | null; // 감량 | 증량 | 근력 | 재활 | 체력
  injuries: string[];
  healthConditions: string[];
  baseline: Record<string, unknown>;
  regStart: string | null;
  regSessionsLeft: number | null;
  regExpire: string | null;
  notes: string | null;
  consentStatus: "granted" | "none";
  createdAt: string;
};

export type Exercise = { name: string; weight?: number; sets?: number; reps?: number; rpe?: number };
export type SessionRow = { id: number; memberId: number; date: string; exercises: Exercise[]; memo: string | null };

function parseJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string" || s.length === 0) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

let db: Database.Database;

export function initDb(dbPath?: string): Database.Database {
  const file = dbPath || process.env.TRAINERZIP_DB_PATH || join(process.cwd(), "trainerzip.db");
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS trainer (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      nickname TEXT,
      plan TEXT NOT NULL DEFAULT 'Basic',
      quota INTEGER NOT NULL DEFAULT 0,
      style_samples TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      gender TEXT,
      age INTEGER,
      goal TEXT,
      injuries TEXT NOT NULL DEFAULT '[]',
      health_conditions TEXT NOT NULL DEFAULT '[]',
      baseline TEXT NOT NULL DEFAULT '{}',
      reg_start TEXT,
      reg_sessions_left INTEGER,
      reg_expire TEXT,
      notes TEXT,
      consent_status TEXT NOT NULL DEFAULT 'none',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      exercises TEXT NOT NULL DEFAULT '[]',
      memo TEXT,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      datetime TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '예정',
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS feedback_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      date TEXT NOT NULL DEFAULT (datetime('now')),
      sent INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    );
  `);
  db.prepare("INSERT OR IGNORE INTO trainer (id, nickname) VALUES (1, NULL)").run();
  return db;
}

function rowToMember(r: any): Member {
  return {
    id: r.id,
    name: r.name,
    aliases: parseJson<string[]>(r.aliases, []),
    gender: r.gender ?? null,
    age: r.age ?? null,
    goal: r.goal ?? null,
    injuries: parseJson<string[]>(r.injuries, []),
    healthConditions: parseJson<string[]>(r.health_conditions, []),
    baseline: parseJson<Record<string, unknown>>(r.baseline, {}),
    regStart: r.reg_start ?? null,
    regSessionsLeft: r.reg_sessions_left ?? null,
    regExpire: r.reg_expire ?? null,
    notes: r.notes ?? null,
    consentStatus: (r.consent_status as "granted" | "none") ?? "none",
    createdAt: r.created_at,
  };
}

// ---- Trainer ----
export function getTrainer() {
  const r: any = db.prepare("SELECT * FROM trainer WHERE id = 1").get();
  return { nickname: r.nickname as string | null, plan: r.plan as string, quota: r.quota as number, styleSamples: parseJson<string[]>(r.style_samples, []) };
}
export function setStyle(action: "add" | "view" | "clear", sample?: string): string[] {
  const cur = getTrainer().styleSamples;
  let next = cur;
  if (action === "add" && sample) next = [...cur, sample].slice(-10);
  else if (action === "clear") next = [];
  db.prepare("UPDATE trainer SET style_samples = ? WHERE id = 1").run(JSON.stringify(next));
  return next;
}

// ---- Members ----
export function addMember(m: Partial<Member> & { name: string }): Member {
  const info = db.prepare(`
    INSERT INTO members (name, aliases, gender, age, goal, injuries, health_conditions, baseline, reg_start, reg_sessions_left, reg_expire, notes, consent_status)
    VALUES (@name, @aliases, @gender, @age, @goal, @injuries, @health_conditions, @baseline, @reg_start, @reg_sessions_left, @reg_expire, @notes, @consent_status)
  `).run({
    name: m.name,
    aliases: JSON.stringify(m.aliases ?? []),
    gender: m.gender ?? null,
    age: m.age ?? null,
    goal: m.goal ?? null,
    injuries: JSON.stringify(m.injuries ?? []),
    health_conditions: JSON.stringify(m.healthConditions ?? []),
    baseline: JSON.stringify(m.baseline ?? {}),
    reg_start: m.regStart ?? null,
    reg_sessions_left: m.regSessionsLeft ?? null,
    reg_expire: m.regExpire ?? null,
    notes: m.notes ?? null,
    consent_status: m.consentStatus ?? "none",
  });
  return getMemberById(Number(info.lastInsertRowid))!;
}

export function updateMember(id: number, patch: Partial<Member>): Member | null {
  const cur = getMemberById(id);
  if (!cur) return null;
  const merged = { ...cur, ...patch };
  db.prepare(`
    UPDATE members SET name=@name, aliases=@aliases, gender=@gender, age=@age, goal=@goal,
      injuries=@injuries, health_conditions=@health_conditions, baseline=@baseline,
      reg_start=@reg_start, reg_sessions_left=@reg_sessions_left, reg_expire=@reg_expire,
      notes=@notes, consent_status=@consent_status WHERE id=@id
  `).run({
    id,
    name: merged.name,
    aliases: JSON.stringify(merged.aliases ?? []),
    gender: merged.gender ?? null,
    age: merged.age ?? null,
    goal: merged.goal ?? null,
    injuries: JSON.stringify(merged.injuries ?? []),
    health_conditions: JSON.stringify(merged.healthConditions ?? []),
    baseline: JSON.stringify(merged.baseline ?? {}),
    reg_start: merged.regStart ?? null,
    reg_sessions_left: merged.regSessionsLeft ?? null,
    reg_expire: merged.regExpire ?? null,
    notes: merged.notes ?? null,
    consent_status: merged.consentStatus ?? "none",
  });
  return getMemberById(id);
}

export function getMemberById(id: number): Member | null {
  const r = db.prepare("SELECT * FROM members WHERE id = ?").get(id);
  return r ? rowToMember(r) : null;
}

export function listMembers(goal?: string): Member[] {
  const rows = goal
    ? db.prepare("SELECT * FROM members WHERE goal = ? ORDER BY name").all(goal)
    : db.prepare("SELECT * FROM members ORDER BY name").all();
  return (rows as any[]).map(rowToMember);
}

// G1 가드: 이름/별칭으로 후보 검색 (동명이인 처리)
export function resolveMembersByName(name: string): Member[] {
  const all = listMembers();
  const q = name.trim().toLowerCase();
  return all.filter(
    (m) => m.name.toLowerCase() === q || m.name.toLowerCase().includes(q) || m.aliases.some((a) => a.toLowerCase() === q)
  );
}

// ---- Sessions ----
export function addSession(memberId: number, date: string, exercises: Exercise[], memo?: string): SessionRow {
  const info = db.prepare("INSERT INTO sessions (member_id, date, exercises, memo) VALUES (?, ?, ?, ?)")
    .run(memberId, date, JSON.stringify(exercises ?? []), memo ?? null);
  return getSessionById(Number(info.lastInsertRowid))!;
}
function getSessionById(id: number): SessionRow | null {
  const r: any = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  return r ? { id: r.id, memberId: r.member_id, date: r.date, exercises: parseJson<Exercise[]>(r.exercises, []), memo: r.memo ?? null } : null;
}
export function listSessions(memberId: number, sinceISO?: string): SessionRow[] {
  const rows = sinceISO
    ? db.prepare("SELECT * FROM sessions WHERE member_id = ? AND date >= ? ORDER BY date DESC").all(memberId, sinceISO)
    : db.prepare("SELECT * FROM sessions WHERE member_id = ? ORDER BY date DESC").all(memberId);
  return (rows as any[]).map((r) => ({ id: r.id, memberId: r.member_id, date: r.date, exercises: parseJson<Exercise[]>(r.exercises, []), memo: r.memo ?? null }));
}

// ---- Schedules ----
export function addSchedule(memberId: number, datetime: string): { id: number; memberId: number; datetime: string; status: string } {
  const info = db.prepare("INSERT INTO schedules (member_id, datetime) VALUES (?, ?)").run(memberId, datetime);
  return { id: Number(info.lastInsertRowid), memberId, datetime, status: "예정" };
}
export function listSchedulesOnDate(datePrefix: string) {
  const rows = db.prepare("SELECT s.*, m.name as member_name FROM schedules s JOIN members m ON m.id = s.member_id WHERE s.datetime LIKE ? ORDER BY s.datetime").all(datePrefix + "%");
  return rows as any[];
}

// ---- Feedback ----
export function logFeedback(memberId: number): number {
  const info = db.prepare("INSERT INTO feedback_log (member_id, sent) VALUES (?, 0)").run(memberId);
  return Number(info.lastInsertRowid);
}
export function markFeedbackSent(memberId: number): number {
  const info = db.prepare("UPDATE feedback_log SET sent = 1 WHERE member_id = ? AND sent = 0").run(memberId);
  return info.changes;
}
export function pendingFeedbackMembers(): { memberId: number; name: string; count: number }[] {
  const rows = db.prepare(`
    SELECT f.member_id as memberId, m.name as name, COUNT(*) as count
    FROM feedback_log f JOIN members m ON m.id = f.member_id
    WHERE f.sent = 0 GROUP BY f.member_id, m.name
  `).all();
  return rows as any[];
}
