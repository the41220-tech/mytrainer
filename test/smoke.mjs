// 스모크 테스트: 빌드된 서버를 stdio로 띄우고 MCP 핸드셰이크 + 주요 툴 호출을 검증.
// newline-delimited JSON-RPC로 직접 통신한다.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

const DB = join(process.cwd(), "smoke-test.db");
for (const ext of ["", "-wal", "-shm", "-journal"]) { try { rmSync(DB + ext); } catch {} }

const child = spawn("node", ["dist/index.js"], { env: { ...process.env, TRAINERZIP_DB_PATH: DB }, stdio: ["pipe", "pipe", "inherit"] });

let buf = "";
const pending = new Map();
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});

let idc = 0;
function rpc(method, params) {
  const id = ++idc;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => reject(new Error("timeout: " + method)), 8000);
  });
}
function notify(method, params) { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"); }
const callText = (r) => r?.result?.content?.map((c) => c.text).join("\n") ?? JSON.stringify(r?.error ?? r);

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1.0" } });
  check("initialize", !!init.result?.serverInfo, init.result?.serverInfo?.name);
  notify("notifications/initialized", {});

  const tools = await rpc("tools/list", {});
  const names = (tools.result?.tools ?? []).map((t) => t.name);
  check("tools/list 14개", names.length === 14, `${names.length}개: ${names.join(",")}`);

  const noConsent = await rpc("tools/call", { name: "register_member", arguments: { name: "김민지", consent: false } });
  check("동의 없이 등록 거부(G4)", callText(noConsent).includes("보류"));

  const reg = await rpc("tools/call", { name: "register_member", arguments: { name: "김민지", consent: true, goal: "감량", injuries: ["무릎"], regSessionsLeft: 2 } });
  check("회원 등록", callText(reg).includes("등록 완료"), callText(reg));

  const reg2 = await rpc("tools/call", { name: "register_member", arguments: { name: "김민지", consent: true, goal: "증량" } });
  check("동명이인 등록", callText(reg2).includes("등록 완료"));

  const amb = await rpc("tools/call", { name: "generate_routine", arguments: { memberName: "김민지" } });
  check("동명이인 모호 처리(G1)", callText(amb).includes("후보가"), callText(amb));

  const routine = await rpc("tools/call", { name: "generate_routine", arguments: { memberId: 1, focus: "하체" } });
  const routineText = callText(routine);
  const mainPart = routineText.split("⚠️")[0];
  check("루틴 초안 생성", routineText.includes("루틴 초안"));
  check("무릎 부상 → 메인에 바벨 스쿼트 없음(G6)", !mainPart.includes("바벨 스쿼트"));
  check("제외 목록에 바벨 스쿼트 표기", (routineText.split("⚠️")[1] ?? "").includes("바벨 스쿼트"));

  await rpc("tools/call", { name: "log_session", arguments: { memberId: 1, exercises: [{ name: "레그 프레스", weight: 80, sets: 4, reps: 10 }, { name: "레그 컬", weight: 30, sets: 3, reps: 12 }] } });
  const stats = await rpc("tools/call", { name: "progress_stats", arguments: { memberId: 1, period: "month" } });
  const statsText = callText(stats);
  check("진척 통계 실계산(볼륨 4280)", statsText.replace(/,/g, "").includes("4280"), statsText.split("\n").find((l) => l.includes("볼륨")) || "");

  const fb = await rpc("tools/call", { name: "draft_feedback", arguments: { memberId: 1, tone: "친근" } });
  check("피드백 초안(복붙)", callText(fb).includes("복붙용"));

  const brief = await rpc("tools/call", { name: "get_my_briefing", arguments: {} });
  check("브리핑: 미발송 피드백 노출(G3)", callText(brief).includes("김민지"), callText(brief).split("\n").find((l)=>l.includes("미발송")) || "");

  const status = await rpc("tools/call", { name: "get_my_status", arguments: {} });
  check("상태: 회원 2명", callText(status).includes("등록 회원: 2명"));

  child.kill();
  for (const ext of ["", "-wal", "-shm", "-journal"]) { try { rmSync(DB + ext); } catch {} }
  console.log(failures === 0 ? "\n🎉 ALL PASS" : `\n💥 ${failures} FAIL`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); child.kill(); process.exit(1); });
