#!/usr/bin/env node
// 나만의 근력 AI — Streamable HTTP 전송 (PlayMCP/카카오 클라우드 배포용).
// 다중 사용자 격리: 요청 헤더의 Key/Token → 사용자별 DB. stateless(POST /mcp).
import express, { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { openStore } from "./store.js";
import { buildServer } from "./mytrainer.js";

const KEY_HEADER = (process.env.MYTRAINER_KEY_HEADER ?? "x-api-key").toLowerCase();
const REQUIRE_KEY = (process.env.MYTRAINER_REQUIRE_KEY ?? "false") === "true"; // 공개(다중 사용자) 시 true 권장

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req: Request, res: Response) => {
  try { openStore({}).getProfile(); res.json({ ok: true, db: "ok", server: "mytrainer", transport: "streamable-http", multiTenant: REQUIRE_KEY }); }
  catch (e) { console.error("health DB error:", e); res.status(503).json({ ok: false, db: "error" }); }
});

app.post("/mcp", async (req: Request, res: Response) => {
  const userKey = (typeof req.headers[KEY_HEADER] === "string" ? (req.headers[KEY_HEADER] as string) : "").trim();
  if (REQUIRE_KEY && !userKey) {
    res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: `Unauthorized: '${KEY_HEADER}' 헤더(사용자 키)가 필요합니다.` }, id: null });
    return;
  }
  try {
    const store = openStore(userKey ? { key: userKey } : {}); // DB 오픈 실패도 여기서 잡음
    const server = buildServer(store);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("MCP request error:", e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});

const notAllowed = (_req: Request, res: Response) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
app.get("/mcp", notAllowed);
app.delete("/mcp", notAllowed);

const PORT = Number(process.env.PORT ?? 3000);
const srv = app.listen(PORT, () => console.error(`mytrainer Streamable HTTP :${PORT} (POST /mcp) · 헤더 ${KEY_HEADER} · 다중사용자 ${REQUIRE_KEY ? "ON" : "OFF"}`));
srv.on("error", (e) => { console.error("서버 기동 실패(포트 점유 등):", e); process.exit(1); });
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
