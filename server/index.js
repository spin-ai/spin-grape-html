import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import { fileURLToPath } from "node:url";
import { PiRpc } from "./pi-rpc.js";
import { Workspace } from "./workspace.js";
import { buildPiArgs, buildSystemPrompt, composePrompt } from "./prompt.js";
import { fetchRemotePage, slugForUrl } from "./importer.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const EXTENSION_PATH = process.env.PI_EXTENSION || path.join(ROOT, "extensions", "canvas-bridge.ts");
const CANVAS_TOKEN = process.env.CANVAS_TOKEN || crypto.randomBytes(12).toString("hex");
const PI_TOOLS = (
  process.env.PI_TOOLS || "read,edit,write,bash,canvas_state,canvas_reload"
)
  .split(",")
  .map((tool) => tool.trim())
  .filter(Boolean);

const workspace = new Workspace(ROOT);

/* ------------------------------------------------------------------ *
 * 内存状态
 * ------------------------------------------------------------------ */

let pi = null;
let piStatus = "stopped"; // stopped | starting | idle | running
let piError = null;
let piInfo = { model: null, provider: null, thinking: null, sessionId: null, messageCount: 0 };

/** 服务端维护的对话记录，刷新页面也能恢复。 */
let chat = [];
let activeAssistantId = null;
/** 最近一条 assistant 消息：工具调用发生在这条消息的 message_end 之后，用于挂载工具卡片。 */
let lastAssistantId = null;
const sseClients = new Set();

/** 前端上报的画布状态，供扩展的 canvas_state 工具读取。 */
let canvasState = { file: "index.html", selection: null, selectionAt: null, updatedAt: 0 };

const MAX_CHAT_ITEMS = 300;
const MAX_TOOL_TEXT = 4000;

/* ------------------------------------------------------------------ *
 * SSE
 * ------------------------------------------------------------------ */

function broadcast(payload) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) res.write(frame);
}

function broadcastStatus() {
  broadcast({ type: "status", ...statusPayload() });
}

function statusPayload() {
  return {
    pi: piStatus,
    error: piError,
    model: piInfo.model,
    provider: piInfo.provider,
    thinking: piInfo.thinking,
    sessionId: piInfo.sessionId,
    canvasTokenRequired: true,
    tools: PI_TOOLS,
  };
}

/* ------------------------------------------------------------------ *
 * 对话记录
 * ------------------------------------------------------------------ */

const newId = () => `m_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;

function trimChat() {
  if (chat.length <= MAX_CHAT_ITEMS) return;
  chat = chat.slice(chat.length - MAX_CHAT_ITEMS);
}

function addChatItem(item) {
  chat.push(item);
  trimChat();
  broadcast({ type: "chat_item", item });
  return item;
}

function patchChatItem(id, mutate) {
  const item = chat.find((entry) => entry.id === id);
  if (!item) return null;
  mutate(item);
  broadcast({ type: "chat_item", item });
  return item;
}

function textOfToolResult(result) {
  const blocks = result?.content;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join("\n")
    .slice(0, MAX_TOOL_TEXT);
}

/** 把一条 assistant 消息的多个 content block 拼成文本。 */
function assistantText(item) {
  const blocks = item.blocks || {};
  return Object.keys(blocks)
    .map(Number)
    .sort((a, b) => a - b)
    .map((index) => blocks[index])
    .filter(Boolean)
    .join("");
}

/* ------------------------------------------------------------------ *
 * Pi 事件 → 对话记录
 * ------------------------------------------------------------------ */

function handlePiEvent(event) {
  switch (event.type) {
    case "agent_start":
      piStatus = "running";
      broadcastStatus();
      break;

    case "agent_settled":
      piStatus = "idle";
      if (lastAssistantId) {
        patchChatItem(lastAssistantId, (item) => {
          item.streaming = false;
          for (const tool of item.tools) if (tool.status === "running") tool.status = "done";
          item.text = assistantText(item);
        });
      }
      activeAssistantId = null;
      broadcastStatus();
      refreshPiInfo();
      break;

    case "message_start": {
      const message = event.message;
      if (message?.role !== "assistant") break;
      const item = addChatItem({
        id: newId(),
        role: "assistant",
        blocks: {},
        tools: [],
        thinking: "",
        text: "",
        streaming: true,
        createdAt: Date.now(),
      });
      activeAssistantId = item.id;
      lastAssistantId = item.id;
      break;
    }

    case "message_update": {
      const update = event.assistantMessageEvent;
      if (!update || !activeAssistantId) break;
      if (update.type === "text_delta") {
        const item = chat.find((entry) => entry.id === activeAssistantId);
        if (!item) break;
        item.blocks[update.contentIndex] = (item.blocks[update.contentIndex] || "") + update.delta;
        item.text = assistantText(item);
        broadcast({ type: "chat_delta", id: item.id, index: update.contentIndex, delta: update.delta });
      } else if (update.type === "text_end") {
        patchChatItem(activeAssistantId, (item) => {
          item.blocks[update.contentIndex] = update.content;
          item.text = assistantText(item);
        });
      } else if (update.type === "thinking_delta") {
        const item = chat.find((entry) => entry.id === activeAssistantId);
        if (!item) break;
        item.thinking = (item.thinking || "") + update.delta;
        broadcast({ type: "chat_thinking", id: item.id, delta: update.delta });
      } else if (update.type === "error") {
        broadcast({ type: "notice", level: "error", text: String(update.error || update.reason || "模型返回错误") });
      }
      break;
    }

    case "message_end": {
      if (event.message?.role !== "assistant" || !activeAssistantId) break;
      const usage = event.message.usage;
      patchChatItem(activeAssistantId, (item) => {
        item.streaming = false;
        item.text = assistantText(item);
        if (usage) item.usage = { input: usage.input, output: usage.output, total: usage.totalTokens };
        if (event.message.stopReason === "aborted") item.aborted = true;
      });
      activeAssistantId = null;
      break;
    }

    case "tool_execution_start": {
      const targetId = activeAssistantId || lastAssistantId;
      if (!targetId) break;
      patchChatItem(targetId, (item) => {
        item.tools.push({
          id: event.toolCallId,
          name: event.toolName,
          args: event.args,
          status: "running",
          startedAt: Date.now(),
        });
      });
      break;
    }

    case "tool_execution_end": {
      const targetId = activeAssistantId || lastAssistantId;
      if (!targetId) break;
      patchChatItem(targetId, (item) => {
        const tool = item.tools.find((entry) => entry.id === event.toolCallId);
        if (!tool) return;
        tool.status = event.isError ? "error" : "done";
        tool.durationMs = event.durationMs ?? Date.now() - (tool.startedAt || Date.now());
        tool.result = textOfToolResult(event.result);
      });
      break;
    }

    case "compaction_start":
      broadcast({ type: "notice", level: "info", text: "上下文压缩中…" });
      break;

    case "compaction_end":
      if (event.result) {
        broadcast({
          type: "notice",
          level: "info",
          text: `上下文已压缩：${Math.round((event.result.tokensBefore || 0) / 1000)}k → ${Math.round(
            (event.result.estimatedTokensAfter || 0) / 1000,
          )}k`,
        });
      }
      break;

    case "auto_retry_start":
      broadcast({ type: "notice", level: "warning", text: `模型重试中（${event.attempt}/${event.maxAttempts}）…` });
      break;

    case "extension_error":
      broadcast({ type: "notice", level: "error", text: `扩展错误：${event.error}` });
      break;

    case "entry_appended":
    case "session_info_changed":
    case "thinking_level_changed":
    case "queue_update":
    case "turn_start":
    case "turn_end":
    case "agent_end":
      break;

    default:
      break;
  }
}

async function refreshPiInfo() {
  if (!pi?.started) return;
  try {
    const state = await pi.getState();
    piInfo = {
      model: state.model?.id ?? piInfo.model,
      provider: state.model?.provider ?? piInfo.provider,
      thinking: state.thinkingLevel ?? piInfo.thinking,
      sessionId: state.sessionId ?? null,
      messageCount: state.messageCount ?? 0,
    };
    broadcastStatus();
  } catch {
    /* 查询状态失败不影响主流程 */
  }
}

/* ------------------------------------------------------------------ *
 * Pi 生命周期
 * ------------------------------------------------------------------ */

async function ensurePi() {
  if (pi?.started) return pi;

  if (pi) {
    await pi.stop().catch(() => {});
    pi = null;
  }

  piStatus = "starting";
  piError = null;
  broadcastStatus();

  const pages = (await workspace.listPages().catch(() => [])).map((page) => page.name);
  const systemPrompt = buildSystemPrompt({
    siteDir: workspace.siteDir,
    pages,
    extra: process.env.CANVAS_RULES || "",
  });
  const args = buildPiArgs({
    extensionPath: fs.existsSync(EXTENSION_PATH) ? EXTENSION_PATH : null,
    siteDir: workspace.siteDir,
    systemPrompt,
    tools: PI_TOOLS,
    provider: process.env.PI_PROVIDER || undefined,
    model: process.env.PI_MODEL || undefined,
    thinking: process.env.PI_THINKING || undefined,
  });

  const client = new PiRpc({
    bin: process.env.PI_BIN || "pi",
    cwd: workspace.siteDir,
    args,
    env: {
      PI_CANVAS_URL: `http://${HOST}:${PORT}`,
      PI_CANVAS_TOKEN: CANVAS_TOKEN,
    },
    debug: process.env.PI_DEBUG === "1",
  });

  client.on("event", handlePiEvent);
  client.on("ui", (record) => {
    if (record.method === "notify") {
      broadcast({ type: "notice", level: record.notifyType || "info", text: record.message });
    }
  });
  client.on("protocol_error", (record) => {
    broadcast({ type: "notice", level: "error", text: record.error || "Pi 协议错误" });
  });
  client.on("exit", ({ message }) => {
    pi = null;
    piStatus = "stopped";
    piError = message;
    if (lastAssistantId) {
      patchChatItem(lastAssistantId, (item) => {
        item.streaming = false;
        for (const tool of item.tools) if (tool.status === "running") tool.status = "error";
      });
      activeAssistantId = null;
      lastAssistantId = null;
    }
    broadcastStatus();
  });

  pi = client;

  try {
    await client.start();
    piStatus = "idle";
    piError = null;
    await refreshPiInfo();
    broadcastStatus();
    return client;
  } catch (error) {
    pi = null;
    piStatus = "stopped";
    piError = error.message;
    broadcastStatus();
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * 文件监听：Pi 或外部编辑器改动后，通知画布重载
 * ------------------------------------------------------------------ */

const watcherTimers = new Map();
let watcher = null;

function startWatcher() {
  watcher = fs.watch(workspace.siteDir, (eventType, filename) => {
    if (!filename || !filename.toLowerCase().endsWith(".html")) return;
    const existing = watcherTimers.get(filename);
    if (existing) clearTimeout(existing);
    watcherTimers.set(
      filename,
      setTimeout(async () => {
        watcherTimers.delete(filename);
        try {
          const stat = await fsp.stat(path.join(workspace.siteDir, filename));
          broadcast({ type: "file_changed", file: filename, mtime: stat.mtimeMs });
        } catch {
          /* 文件被删除 */
        }
      }, 140),
    );
  });
  watcher.on("error", (error) => console.error("[watch]", error.message));
}

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16mb" }));

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function requireCanvasToken(req, res, next) {
  const token = req.get("x-canvas-token") || req.query.token;
  if (token !== CANVAS_TOKEN) {
    res.status(401).json({ error: "invalid canvas token" });
    return;
  }
  next();
}

/* --- 基础状态 --- */

app.get(
  "/api/health",
  asyncRoute(async (_req, res) => {
    res.json({ ok: true, pi: piStatus, uptime: process.uptime() });
  }),
);

app.get(
  "/api/state",
  asyncRoute(async (_req, res) => {
    const pages = await workspace.listPages();
    res.json({
      pages,
      currentFile: canvasState.file || pages[0]?.name || "index.html",
      canvas: canvasState,
      pi: statusPayload(),
      chat: chat.slice(-120),
      siteDir: workspace.siteDir,
    });
  }),
);

app.get("/api/chat", (_req, res) => {
  res.json({ chat });
});

/* --- SSE --- */

app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`retry: 2000\n\n`);
  res.write(`data: ${JSON.stringify({ type: "hello", ...statusPayload() })}\n\n`);
  sseClients.add(res);

  const heartbeat = setInterval(() => res.write(`: ping\n\n`), 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

/* --- 页面读写 --- */

app.get(
  "/api/pages",
  asyncRoute(async (_req, res) => {
    res.json({ pages: await workspace.listPages() });
  }),
);

app.get(
  "/api/page/:name",
  asyncRoute(async (req, res) => {
    const page = await workspace.readPage(req.params.name);
    res.json(page);
  }),
);

app.put(
  "/api/page/:name",
  asyncRoute(async (req, res) => {
    const html = typeof req.body?.html === "string" ? req.body.html : "";
    if (!html.trim()) {
      res.status(400).json({ error: "html 不能为空" });
      return;
    }
    const result = await workspace.writePage(req.params.name, html);
    broadcast({ type: "file_changed", file: result.name, mtime: result.mtime, origin: "client" });
    res.json({ ok: true, ...result });
  }),
);

app.get(
  "/api/page/:name/versions",
  asyncRoute(async (req, res) => {
    res.json({ versions: await workspace.listVersions(req.params.name) });
  }),
);

app.get(
  "/api/page/:name/versions/:id",
  asyncRoute(async (req, res) => {
    const html = await workspace.readVersion(req.params.name, req.params.id);
    res.json({ html });
  }),
);

app.post(
  "/api/page/:name/snapshot",
  asyncRoute(async (req, res) => {
    const entry = await workspace.snapshot(req.params.name, { label: req.body?.label || "手动快照" });
    res.json({ ok: true, version: entry });
  }),
);

app.post(
  "/api/page/:name/restore",
  asyncRoute(async (req, res) => {
    const id = req.body?.id;
    const result = await workspace.restoreVersion(req.params.name, id);
    broadcast({ type: "file_changed", file: result.name, mtime: result.mtime, origin: "restore" });
    res.json({ ok: true, ...result });
  }),
);

/* --- Pi 会话 --- */

app.post(
  "/api/prompt",
  asyncRoute(async (req, res) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) {
      res.status(400).json({ error: "message 不能为空" });
      return;
    }

    const context = sanitizeContext(req.body?.context);
    const file = context?.file || canvasState.file || "index.html";

    const client = await ensurePi();

    let version = null;
    try {
      version = await workspace.snapshot(file, { label: message.slice(0, 120), source: "prompt" });
    } catch {
      /* 页面可能还不存在，忽略快照失败 */
    }

    const userItem = addChatItem({
      id: newId(),
      role: "user",
      text: message,
      context: context ? summarizeContext(context) : null,
      createdAt: Date.now(),
    });

    const streamingBehavior = piStatus === "running" ? req.body?.streamingBehavior || "steer" : undefined;

    try {
      const disposition = await client.prompt(composePrompt({ message, context }), {
        streamingBehavior,
      });
      if (disposition === "handled") {
        broadcast({ type: "notice", level: "info", text: "该消息被扩展命令处理" });
      }
      res.json({ ok: true, disposition, version, file, userItemId: userItem.id });
    } catch (error) {
      addChatItem({
        id: newId(),
        role: "system",
        level: "error",
        text: `发送失败：${error.message}`,
        createdAt: Date.now(),
      });
      throw error;
    }
  }),
);

app.post(
  "/api/abort",
  asyncRoute(async (_req, res) => {
    if (pi?.started) await pi.abort();
    res.json({ ok: true });
  }),
);

app.post(
  "/api/session/reset",
  asyncRoute(async (_req, res) => {
    if (pi?.started) await pi.newSession();
    chat = [];
    activeAssistantId = null;
    lastAssistantId = null;
    broadcast({ type: "chat_reset" });
    await refreshPiInfo();
    res.json({ ok: true });
  }),
);

app.post(
  "/api/pi/restart",
  asyncRoute(async (_req, res) => {
    if (pi) {
      await pi.stop().catch(() => {});
      pi = null;
    }
    piStatus = "stopped";
    chat = [];
    activeAssistantId = null;
    lastAssistantId = null;
    broadcast({ type: "chat_reset" });
    await ensurePi();
    res.json({ ok: true });
  }),
);

/* --- URL 导入 --- */

app.post(
  "/api/import-url",
  asyncRoute(async (req, res) => {
    const rawUrl = req.body?.url;
    const result = await fetchRemotePage(rawUrl);

    const existing = new Set((await workspace.listPages()).map((page) => page.name));
    const base = slugForUrl(new URL(result.url));
    let name = base;
    let counter = 2;
    while (existing.has(name)) {
      name = base.replace(/\.html$/i, `-${counter}.html`);
      counter += 1;
    }

    await workspace.writePage(name, result.html);
    broadcast({ type: "pages_changed" });
    res.json({
      ok: true,
      page: name,
      title: result.title,
      url: result.url,
      warnings: result.warnings,
      bytes: result.bytes,
    });
  }),
);

/** 在新标签页打开已保存的页面（真实 URL，可直接分享/调试）。 */
app.get("/preview/:name", (req, res, next) => {
  try {
    workspace.assertPageName(req.params.name);
  } catch (error) {
    next(error);
    return;
  }
  res.sendFile(workspace.pagePath(req.params.name), { headers: { "cache-control": "no-store" } });
});

/* --- 画布状态（前端上报 / 扩展读取） --- */

app.post("/api/canvas/state", (req, res) => {
  const file = typeof req.body?.file === "string" ? req.body.file : canvasState.file;
  const selection = req.body?.selection ?? null;
  canvasState = {
    file: file || canvasState.file,
    selection,
    selectionAt: selection ? Date.now() : canvasState.selectionAt,
    updatedAt: Date.now(),
  };
  res.json({ ok: true });
});

app.get("/api/canvas/state", requireCanvasToken, (_req, res) => {
  res.json({
    file: canvasState.file,
    selection: canvasState.selection,
    selectionAt: canvasState.selectionAt,
    updatedAt: canvasState.updatedAt,
    siteDir: workspace.siteDir,
  });
});

app.get(
  "/api/canvas/pages",
  requireCanvasToken,
  asyncRoute(async (_req, res) => {
    res.json({ pages: await workspace.listPages() });
  }),
);

app.post("/api/canvas/reload", requireCanvasToken, (req, res) => {
  const file = typeof req.body?.file === "string" ? req.body.file : canvasState.file;
  const selector = typeof req.body?.selector === "string" ? req.body.selector : null;
  broadcast({ type: "canvas_reload", file, selector });
  res.json({ ok: true, file, selector });
});

/* --- 静态资源 --- */

app.use("/vendor/grapesjs", express.static(path.join(ROOT, "node_modules", "grapesjs", "dist"), { maxAge: "1h" }));
app.use("/vendor/mermaid", express.static(path.join(ROOT, "node_modules", "mermaid", "dist"), { maxAge: "1h" }));
app.use(express.static(path.join(ROOT, "web"), { extensions: ["html"] }));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) res.status(404).json({ error: "not found" });
  else res.sendFile(path.join(ROOT, "web", "index.html"));
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  if (status >= 500) console.error("[server]", error);
  res.status(status).json({ error: error.message || "internal error" });
});

/* ------------------------------------------------------------------ *
 * 上下文清洗
 * ------------------------------------------------------------------ */

function sanitizeContext(raw) {
  if (!raw || typeof raw !== "object") return null;
  const str = (value, max) => (typeof value === "string" ? value.slice(0, max) : undefined);
  const selection = {
    file: str(raw.file, 120),
    selector: str(raw.selector, 400),
    tag: str(raw.tag, 40),
    id: str(raw.id, 120),
    classes: Array.isArray(raw.classes) ? raw.classes.slice(0, 12).map((c) => String(c).slice(0, 80)) : [],
    path: str(raw.path, 400),
    text: str(raw.text, 600),
    computed: str(raw.computed, 800),
    outerHTML: str(raw.outerHTML, 6000),
    parentHTML: str(raw.parentHTML, 6000),
    css: str(raw.css, 6000),
  };
  if (!selection.selector && !selection.outerHTML) return null;
  return selection;
}

function summarizeContext(context) {
  return {
    file: context.file,
    selector: context.selector,
    tag: context.tag,
  };
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */

await workspace.init();
startWatcher();

const server = app.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`;
  console.log(`\n  Pi Canvas  ${base}`);
  console.log(`  workspace  ${workspace.siteDir}`);
  console.log(`  pi tools   ${PI_TOOLS.join(", ")}`);
  console.log(`  canvas tkn ${CANVAS_TOKEN.slice(0, 8)}…（扩展通过 PI_CANVAS_TOKEN 使用）\n`);
});

// 预热 Pi：让第一次点击“发送”不用等进程启动
ensurePi().catch((error) => {
  console.error(`[pi] 启动失败：${error.message.split("\n")[0]}`);
  console.error("[pi] 检查 `pi` 是否在 PATH 中，以及模型凭据是否已配置（pi auth）");
});

async function shutdown(signal) {
  console.log(`\n[${signal}] 正在关闭…`);
  server.close();
  watcher?.close();
  await pi?.stop().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
