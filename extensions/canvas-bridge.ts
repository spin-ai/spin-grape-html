/**
 * Pi Canvas 桥接扩展
 * ------------------------------------------------------------------
 * 给 Pi 装上两只“感官/手脚”：
 *   - canvas_state  : 读取画布实时状态（当前页面、选中元素的选择器/DOM/样式、页面列表）
 *   - canvas_reload : 让所有打开的画布立即刷新（例如你改了别的地方想马上看到）
 *
 * 这两个工具通过本地 HTTP 与编辑器服务通信：
 *   PI_CANVAS_URL   http://127.0.0.1:8787
 *   PI_CANVAS_TOKEN 服务启动时生成的令牌
 *
 * 扩展本身不碰文件；文件的读写仍然由 Pi 的 read / edit / write 完成，
 * 这样“改哪里”和“怎么改”各自职责清晰。
 */
import { Type } from "@earendil-works/pi-ai";

const BASE = (process.env.PI_CANVAS_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const TOKEN = process.env.PI_CANVAS_TOKEN || "";
const TIMEOUT_MS = 8000;

type CanvasSelection = {
  file?: string;
  selector?: string;
  tag?: string;
  id?: string;
  classes?: string[];
  path?: string;
  text?: string;
  computed?: string;
  outerHTML?: string;
  parentHTML?: string;
  css?: string;
};

type CanvasStatePayload = {
  file?: string;
  selection?: CanvasSelection | null;
  selectionAt?: number | null;
  updatedAt?: number;
  siteDir?: string;
};

type PageInfo = { name: string; title: string; size: number; mtime: number };

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
};

async function request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${pathname}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-canvas-token": TOKEN,
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `无法连接画布服务 ${BASE}：${error instanceof Error ? error.message : String(error)}。` +
        "编辑器可能已关闭；仍然可以直接用 read/edit 修改工作目录里的 HTML 文件。",
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`画布服务返回 ${response.status}：${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function clip(value: unknown, max: number): string {
  if (value == null) return "";
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}\n…（已截断）` : text;
}

function formatState(state: CanvasStatePayload, pages: PageInfo[]): string {
  const lines: string[] = [];
  const selection = state.selection;

  lines.push(`画布工作目录：${state.siteDir || "(未知)"}`);
  lines.push(`当前打开：${state.file || "(未知)"}`);
  lines.push(
    `页面列表：${pages.length ? pages.map((page) => `${page.name}（${page.title}）`).join("、") : "(空)"}`,
  );
  lines.push("");

  if (!selection) {
    lines.push("当前没有选中元素。用户可能想让你改整页，先 read 当前页面再决定。");
    return lines.join("\n");
  }

  lines.push("当前选中元素：");
  if (selection.selector) lines.push(`- selector: ${selection.selector}`);
  if (selection.tag) lines.push(`- tag: ${selection.tag}`);
  if (selection.id) lines.push(`- id: ${selection.id}`);
  if (selection.classes?.length) lines.push(`- classes: ${selection.classes.join(" ")}`);
  if (selection.path) lines.push(`- component-path: ${selection.path}`);
  if (selection.text) lines.push(`- text: ${JSON.stringify(clip(selection.text, 200))}`);
  if (selection.computed) lines.push(`- computed-style: ${clip(selection.computed, 600)}`);
  if (selection.outerHTML) {
    lines.push("- outer-html:", "```html", clip(selection.outerHTML, 3000), "```");
  }
  if (selection.css) {
    lines.push("- related-css:", "```css", clip(selection.css, 2000), "```");
  }
  lines.push("");
  lines.push("提示：这些信息只是快照。真正要改的文件请先 read，再按 selector/outer-html 定位后做最小 edit。");
  return lines.join("\n");
}

/** Pi 注入的 ExtensionAPI 子集（避免本地依赖整个 coding-agent 包）。 */
type CanvasBridgeApi = {
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    promptSnippet?: string;
    promptGuidelines?: string[];
    parameters: unknown;
    annotations?: Record<string, boolean>;
    execute: (...args: any[]) => Promise<ToolResult>;
  }): void;
  on(
    event: string,
    handler: (event: any, ctx: { mode?: string; ui: { setStatus(key: string, text?: string): void } }) => void | Promise<void>,
  ): void;
};

export default function canvasBridge(pi: CanvasBridgeApi) {
  pi.registerTool({
    name: "canvas_state",
    label: "Canvas State",
    description:
      "读取可视化画布的实时状态：当前打开的页面、用户选中的元素（CSS 选择器、标签、class、outerHTML、计算样式）以及页面列表。当用户说“这个元素/这里/选中的地方”或需要确认画布当前状态时调用。",
    promptSnippet: "canvas_state: 读取画布当前选中的元素与页面列表",
    promptGuidelines: [
      "用户提到“选中的元素 / 这里 / 这个按钮”时，先调用 canvas_state 拿到 selector 与 outerHTML，再用 read + edit 精准修改。",
      "canvas_state 只提供上下文，不会修改任何文件。",
    ],
    parameters: Type.Object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async execute() {
      const [state, pages] = await Promise.all([
        request<CanvasStatePayload>("/api/canvas/state"),
        request<{ pages: PageInfo[] }>("/api/canvas/pages"),
      ]);
      return {
        content: [{ type: "text", text: formatState(state, pages.pages ?? []) }],
        details: { state, pages: pages.pages ?? [] },
      };
    },
  });

  pi.registerTool({
    name: "canvas_reload",
    label: "Canvas Reload",
    description:
      "让所有打开的浏览器画布重新从磁盘加载页面 HTML/CSS。改动完成后画布通常会自动刷新；当你改动了被多个页面共享的资源，或需要强制刷新时调用。",
    promptSnippet: "canvas_reload: 强制所有画布从磁盘重新加载",
    parameters: Type.Object({
      file: Type.Optional(Type.String({ description: "要刷新后显示的页面文件名，例如 index.html" })),
      selector: Type.Optional(
        Type.String({ description: "刷新后重新选中的 CSS 选择器（可选），便于用户继续修改同一元素" }),
      ),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async execute(_toolCallId: string, params: { file?: string; selector?: string }) {
      const result = await request<{ ok: boolean; file?: string }>("/api/canvas/reload", {
        method: "POST",
        body: JSON.stringify({ file: params.file, selector: params.selector }),
      });
      return {
        content: [
          {
            type: "text",
            text: `已通知画布刷新${result.file ? `：${result.file}` : ""}${params.selector ? `（重选 ${params.selector}）` : ""}`,
          },
        ],
        details: result,
      };
    },
  });

  // 会话启动时不做网络请求：服务可能在 Pi 之后启动，等工具调用时再连。
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode === "rpc") ctx.ui.setStatus("canvas-bridge", "canvas 已连接");
  });
}
