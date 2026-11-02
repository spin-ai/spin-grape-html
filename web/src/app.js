/* global grapesjs */
import { api, connectEvents } from "./api.js";
import { ChatView } from "./chat.js";
import {
  canvasScroll,
  createEditor,
  findComponent,
  restoreCanvasScroll,
  setCanvasContent,
  syncCanvasHead,
} from "./editor.js";
import { describeSelection, getSourceIds, setSourceIds } from "./context.js";
import { formatCss } from "./css.js";
import { containsMermaid, mergeDocument, splitDocument, stripUnusedIds, unwrapBody } from "./doc.js";

const $ = (id) => document.getElementById(id);

const els = {
  pageSelect: $("page-select"),
  newPage: $("btn-new-page"),
  statusPill: $("status-pill"),
  modelLabel: $("model-label"),
  undo: $("btn-undo"),
  redo: $("btn-redo"),
  history: $("btn-history"),
  preview: $("btn-preview"),
  export: $("btn-export"),
  save: $("btn-save"),
  deviceSwitch: $("device-switch"),
  drawer: $("drawer"),
  drawerClose: $("drawer-close"),
  drawerList: $("drawer-list"),
  drawerSub: $("drawer-sub"),
  previewOverlay: $("preview-overlay"),
  previewFrame: $("preview-frame"),
  previewClose: $("preview-close"),
  toasts: $("toasts"),
  selBar: $("sel-bar"),
  selRing: $("sel-ring"),
  selTag: $("sel-tag"),
  selForm: $("sel-form"),
  selInput: $("sel-input"),
  openUrl: $("btn-open-url"),
  openTab: $("btn-open-tab"),
  urlDialog: $("url-dialog"),
  urlForm: $("url-form"),
  urlInput: $("url-input"),
  urlStatus: $("url-status"),
  urlSubmit: $("url-submit"),
  urlClose: $("url-close"),
  urlCancel: $("url-cancel"),
  selMermaid: $("sel-mermaid"),
  mermaidDialog: $("mermaid-dialog"),
  mermaidSource: $("mermaid-source"),
  mermaidApply: $("mermaid-apply"),
  mermaidClose: $("mermaid-close"),
  mermaidCancel: $("mermaid-cancel"),
};

const state = {
  pages: [],
  current: null,
  docMeta: { lang: "zh-CN", head: "", bodyAttrs: "" },
  dirty: false,
  loading: false,
  pi: "stopped",
  piError: null,
  selection: null,
  selectionAt: 0,
  cssExtras: [],
  lastReloadAt: 0,
};

/* ------------------------------------------------------------------ *
 * 初始化
 * ------------------------------------------------------------------ */

const editor = createEditor({
  container: $("gjs"),
  blocksEl: "#blocks",
  layersEl: "#layers",
  stylesEl: "#styles-container",
  traitsEl: "#traits-container",
  onUpdate: () => {
    if (state.loading) return;
    markDirty(true);
  },
  onSelect: (component) => {
    if (!component) return;
    state.selection = describeSelection(editor, state.current);
    state.selectionAt = Date.now();
    chat.setContext(state.selection);
    showSelectionBar();
    reportCanvasState();
  },
  onDeselect: () => {
    state.selection = null;
    chat.setContext(null);
    hideSelectionBar();
    reportCanvasState();
  },
});

window.__editor = editor;

const chat = new ChatView({
  log: $("chat-log"),
  empty: $("chat-empty"),
  input: $("chat-input"),
  form: $("chat-form"),
  sendButton: $("chat-send"),
  abortButton: $("btn-abort"),
  hint: $("composer-hint"),
  contextBar: $("composer-context"),
});

/* ------------------------------------------------------------------ *
 * 文档 / 保存 / 载入
 * ------------------------------------------------------------------ */

const MERMAID_HEAD = {
  cdn: `<script type="module" data-pi-mermaid-bootstrap>
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: true, theme: "dark", securityLevel: "loose" });
</script>`,
  local: `<script src="/vendor/mermaid/mermaid.min.js" data-pi-mermaid-bootstrap></script>
<script data-pi-mermaid-bootstrap>
  mermaid.initialize({ startOnLoad: true, theme: "dark", securityLevel: "loose" });
</script>`,
};

const MERMAID_STYLE = `pre.mermaid { background: transparent; text-align: center; margin: 0; }
pre.mermaid svg { max-width: 100%; height: auto; }`;

/**
 * 按需把 Mermaid 运行时写进 head：
 *  - 保存 / 导出用 CDN，HTML 可以独立打开
 *  - 应用内预览用本地 /vendor，离线也能出图
 * 已有的 bootstrap 会被替换，避免重复注入。
 */
function headWithMermaid(head, bodyHtml, runtime) {
  const cleaned = String(head || "").replace(
    /<script\b[^>]*data-pi-mermaid-bootstrap[^>]*>[\s\S]*?<\/script>\s*/gi,
    "",
  );
  if (!containsMermaid(bodyHtml)) return cleaned;
  return `${cleaned}\n${MERMAID_HEAD[runtime] || MERMAID_HEAD.cdn}\n<style data-pi-mermaid-bootstrap>\n${MERMAID_STYLE}\n</style>`;
}

function buildHtml({ mermaidRuntime = "cdn" } = {}) {
  const css = formatCss(
    [editor.getCss({ avoidProtected: true }), ...state.cssExtras].filter(Boolean).join("\n"),
  );
  const body = stripUnusedIds(unwrapBody(editor.getHtml()), css, getSourceIds());
  const head = headWithMermaid(state.docMeta.head, body, mermaidRuntime);

  return mergeDocument({
    lang: state.docMeta.lang,
    head,
    bodyAttrs: state.docMeta.bodyAttrs,
    body,
    css,
  });
}

async function savePage({ silent = false } = {}) {
  if (!state.current) return null;
  const result = await api.savePage(state.current, buildHtml());
  markDirty(false);
  if (!silent) toast(`已保存 ${state.current}`, "success");
  return result;
}

async function loadPage(name, { selector = null, scrollTop = 0, quiet = false } = {}) {
  if (!name) return;
  const page = await api.page(name);
  const parts = splitDocument(page.html);

  state.loading = true;
  state.current = name;
  state.docMeta = { lang: parts.lang, head: parts.head, bodyAttrs: parts.bodyAttrs };

  setSourceIds(parts.body);
  state.cssExtras = setCanvasContent(editor, { body: parts.body, css: parts.css });
  syncCanvasHead(editor, parts.head);
  restoreCanvasScroll(editor, scrollTop);
  markDirty(false);

  // setComponents 触发的 update 可能是异步的，等两帧再解除 loading
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      state.loading = false;
      editor.UndoManager.clear();
    }),
  );

  els.pageSelect.value = name;
  updateDocumentTitle();

  if (selector) {
    const component = findComponent(editor, selector);
    if (component) editor.select(component);
    else hideSelectionBar();
  } else {
    editor.select(undefined);
    hideSelectionBar();
  }

  if (!quiet) reportCanvasState();
}

async function refreshPages({ keepCurrent = true } = {}) {
  const { pages } = await api.pages();
  state.pages = pages;
  const currentValue = keepCurrent ? state.current : pages[0]?.name;

  els.pageSelect.replaceChildren();
  for (const page of pages) {
    const option = document.createElement("option");
    option.value = page.name;
    option.textContent = page.title ? `${page.name} · ${page.title}` : page.name;
    els.pageSelect.append(option);
  }
  if (currentValue && pages.some((page) => page.name === currentValue)) {
    els.pageSelect.value = currentValue;
  }
  updateDocumentTitle();
}

function markDirty(dirty) {
  state.dirty = Boolean(dirty);
  els.save.classList.toggle("dirty", state.dirty);
  updateDocumentTitle();
}

function updateDocumentTitle() {
  const page = state.pages.find((entry) => entry.name === state.current);
  const prefix = state.dirty ? "• " : "";
  document.title = `${prefix}${page?.title || state.current || "Pi Canvas"} · Pi Canvas`;
}

/* ------------------------------------------------------------------ *
 * 状态 / 提示
 * ------------------------------------------------------------------ */

const STATUS_TEXT = {
  stopped: "Pi 未连接",
  starting: "Pi 启动中",
  idle: "Pi 就绪",
  running: "Pi 工作中",
};

function applyStatus(payload = {}) {
  if (payload.pi) state.pi = payload.pi;
  if ("error" in payload) state.piError = payload.error;

  els.statusPill.dataset.state = state.pi;
  els.statusPill.querySelector(".pill-label").textContent = STATUS_TEXT[state.pi] || state.pi;

  const model = payload.provider && payload.model ? `${payload.provider} / ${payload.model}` : "";
  els.modelLabel.textContent = model;
  els.modelLabel.classList.toggle("hidden", !model);

  chat.setBusy(state.pi === "running");
  $("btn-start-pi").classList.toggle("hidden", state.pi !== "stopped");
}

function toast(text, level = "info", { action = null, timeout = 4200 } = {}) {
  const node = document.createElement("div");
  node.className = `toast level-${level}`;
  node.append(Object.assign(document.createElement("span"), { textContent: text }));

  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      action.onClick?.();
      node.remove();
    });
    node.append(button);
  }

  els.toasts.append(node);
  setTimeout(() => node.classList.add("leaving"), timeout);
  setTimeout(() => node.remove(), timeout + 300);
}

/* ------------------------------------------------------------------ *
 * 选中浮层
 * ------------------------------------------------------------------ */

function isMermaidSelection() {
  return state.selection?.tag === "pre" && (state.selection?.classes || []).includes("mermaid");
}

function showSelectionBar() {
  if (!state.selection) return;
  els.selTag.textContent = state.selection.selector || state.selection.tag || "";
  els.selMermaid.classList.toggle("hidden", !isMermaidSelection());
  els.selBar.classList.remove("hidden");
  els.selRing.classList.remove("hidden");
  positionSelectionBar();
}

function hideSelectionBar() {
  els.selBar.classList.add("hidden");
  els.selRing.classList.add("hidden");
  els.selForm.classList.add("hidden");
}

function positionSelectionBar() {
  const selected = editor.getSelected?.();
  if (!selected) return;
  let element = null;
  try {
    element = selected.getEl?.();
  } catch {
    element = null;
  }
  const frame = editor.Canvas.getFrameEl();
  if (!element || !frame) {
    hideSelectionBar();
    return;
  }

  const rect = element.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  const scale = frame.offsetWidth ? frameRect.width / frame.offsetWidth : 1;

  const left = frameRect.left + rect.left * scale;
  const top = frameRect.top + rect.top * scale;
  const width = Math.max(rect.width * scale, 8);
  const height = Math.max(rect.height * scale, 8);

  els.selRing.style.left = `${left}px`;
  els.selRing.style.top = `${top}px`;
  els.selRing.style.width = `${width}px`;
  els.selRing.style.height = `${height}px`;

  const barWidth = els.selBar.offsetWidth || 300;
  const barHeight = els.selBar.offsetHeight || 42;
  const barLeft = Math.min(Math.max(10, left), window.innerWidth - barWidth - 12);
  const above = top - barHeight - 10;
  // 顶部空间不足时放到元素下方，底部不足则贴住视口
  const barTop = above > 60 ? above : Math.min(top + height + 10, window.innerHeight - barHeight - 12);
  els.selBar.style.left = `${barLeft}px`;
  els.selBar.style.top = `${Math.max(58, barTop)}px`;
}

function startSelectionLoop() {
  setInterval(() => {
    if (els.selBar.classList.contains("hidden")) return;
    positionSelectionBar();
  }, 350);

  window.addEventListener("resize", positionSelectionBar);
  editor.on("canvas:frame:load", () => {
    const frame = editor.Canvas.getFrameEl();
    try {
      frame?.contentWindow?.addEventListener("scroll", positionSelectionBar, { passive: true, capture: true });
    } catch {
      /* 跨域/未就绪 */
    }
  });
}

/* ------------------------------------------------------------------ *
 * 画布状态上报（供扩展的 canvas_state 工具读取）
 * ------------------------------------------------------------------ */

let reportTimer = null;
function reportCanvasState() {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    api
      .reportCanvas({ file: state.current, selection: state.selection })
      .catch(() => {});
  }, 250);
}

/* ------------------------------------------------------------------ *
 * 对话
 * ------------------------------------------------------------------ */

function currentContext() {
  if (!state.selection) return null;
  return state.selection;
}

async function sendPrompt(text, context = currentContext()) {
  const message = (text || "").trim();
  if (!message) return;
  if (!state.current) {
    toast("还没有打开页面", "warning");
    return;
  }

  try {
    if (state.dirty) await savePage({ silent: true });
    await api.prompt({
      message,
      context,
      streamingBehavior: state.pi === "running" ? "steer" : undefined,
    });
  } catch (error) {
    chat.notice(`发送失败：${error.message}`, "error");
    toast(error.message, "error");
  }
}

chat.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = chat.input.value;
  chat.input.value = "";
  await sendPrompt(text);
});

els.selForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.selInput.value;
  els.selInput.value = "";
  els.selForm.classList.add("hidden");
  await sendPrompt(text, state.selection);
});

chat.input.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    chat.form.requestSubmit();
  }
});

/* ------------------------------------------------------------------ *
 * 事件流
 * ------------------------------------------------------------------ */

connectEvents({
  onOpen: () => applyStatus({ pi: state.pi }),
  onEvent: (event) => {
    switch (event.type) {
      case "hello":
      case "status":
        applyStatus(event);
        break;

      case "chat_item":
        chat.upsert(event.item);
        break;

      case "chat_delta":
        chat.appendDelta(event.id, event.delta);
        break;

      case "chat_thinking":
        chat.appendThinking(event.id);
        break;

      case "chat_reset":
        chat.reset([]);
        break;

      case "notice":
        chat.notice(event.text, event.level || "info");
        break;

      case "file_changed":
        handleFileChanged(event);
        break;

      case "canvas_reload":
        handleCanvasReload(event);
        break;

      case "pages_changed":
        refreshPages().catch(() => {});
        break;

      default:
        break;
    }
  },
});

let reloadQueued = false;
async function handleFileChanged(event) {
  if (event.origin === "client") return;
  if (event.file !== state.current) {
    refreshPages().catch(() => {});
    return;
  }

  if (state.dirty) {
    toast(`磁盘上的 ${event.file} 已更新，但画布有未保存改动`, "warning", {
      action: { label: "载入磁盘版本", onClick: () => reloadFromDisk({ force: true }) },
    });
    return;
  }
  await reloadFromDisk();
}

async function handleCanvasReload(event) {
  if (event.file && event.file !== state.current) {
    await loadPage(event.file, { selector: event.selector || null });
    await refreshPages();
    return;
  }
  await reloadFromDisk({ selector: event.selector || null });
}

async function reloadFromDisk({ force = false, selector = null } = {}) {
  if (!state.current) return;
  if (state.dirty && !force) return;
  if (reloadQueued) return;
  reloadQueued = true;

  const now = Date.now();
  if (now - state.lastReloadAt < 120) {
    setTimeout(() => {
      reloadQueued = false;
      reloadFromDisk({ force: true, selector });
    }, 150);
    return;
  }
  state.lastReloadAt = now;

  const scrollTop = canvasScroll(editor);
  const target = selector || state.selection?.selector || null;
  try {
    await loadPage(state.current, { selector: target, scrollTop, quiet: true });
  } catch (error) {
    toast(`重新载入失败：${error.message}`, "error");
  } finally {
    reloadQueued = false;
  }
}

/* ------------------------------------------------------------------ *
 * 顶栏动作
 * ------------------------------------------------------------------ */

els.pageSelect.addEventListener("change", async () => {
  const next = els.pageSelect.value;
  if (!next || next === state.current) return;
  try {
    if (state.dirty) await savePage({ silent: true });
    hideSelectionBar();
    state.selection = null;
    chat.setContext(null);
    await loadPage(next);
  } catch (error) {
    toast(error.message, "error");
  }
});

els.newPage.addEventListener("click", async () => {
  const name = window.prompt("新页面文件名（例如 pricing.html）", "page.html");
  if (!name) return;
  if (!/^[a-z0-9][a-z0-9_-]*\.html$/i.test(name)) {
    toast("文件名只能包含字母、数字、- 和 _，并以 .html 结尾", "warning");
    return;
  }
  try {
    if (state.dirty) await savePage({ silent: true });
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name.replace(/\.html$/i, "")}</title>
<style>
  body { margin: 0; background: #08090d; color: #f4f5f7; font-family: "Inter", "Noto Sans SC", system-ui, sans-serif; }
  .page { max-width: 960px; margin: 0 auto; padding: 80px 28px; }
  h1 { font-size: 44px; letter-spacing: -0.03em; margin: 0 0 16px; }
  p { color: #9aa3b2; font-size: 17px; line-height: 1.75; max-width: 620px; }
</style>
</head>
<body>
  <div class="page">
    <h1>新页面</h1>
    <p>从左侧拖入区块开始搭建，或选中元素让 Pi 帮你改。</p>
  </div>
</body>
</html>
`;
    await api.savePage(name, html);
    await refreshPages();
    await loadPage(name);
    toast(`已创建 ${name}`, "success");
  } catch (error) {
    toast(error.message, "error");
  }
});

els.openUrl.addEventListener("click", () => openUrlDialog());
els.openTab.addEventListener("click", async () => {
  if (!state.current) return;
  try {
    if (state.dirty) await savePage({ silent: true });
    window.open(`/preview/${encodeURIComponent(state.current)}`, "_blank", "noopener");
  } catch (error) {
    toast(error.message, "error");
  }
});

els.urlClose.addEventListener("click", () => closeUrlDialog());
els.urlCancel.addEventListener("click", () => closeUrlDialog());
els.urlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    els.urlForm.requestSubmit();
  }
});

els.urlForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = els.urlInput.value.trim();
  if (!url) {
    setUrlStatus("请输入要打开的 URL", "error");
    return;
  }

  els.urlSubmit.disabled = true;
  setUrlStatus("正在抓取页面…首次加载可能需要几秒", "pending");

  try {
    if (state.dirty) await savePage({ silent: true });
    const result = await api.importUrl(url);
    await refreshPages();
    await loadPage(result.page);
    closeUrlDialog();

    const warning = result.warnings?.[0];
    toast(
      `已导入 ${result.page}（${(result.bytes / 1024).toFixed(0)} KB）${warning ? ` · ${warning}` : ""}`,
      warning ? "warning" : "success",
    );
    chat.notice(`已从 ${result.url} 导入为新页面 ${result.page}。现在可以选中元素让 Pi 修改。`, "info");
  } catch (error) {
    setUrlStatus(error.message, "error");
  } finally {
    els.urlSubmit.disabled = false;
  }
});

els.save.addEventListener("click", () => savePage().catch((error) => toast(error.message, "error")));
els.undo.addEventListener("click", () => editor.UndoManager.undo());
els.redo.addEventListener("click", () => editor.UndoManager.redo());

els.export.addEventListener("click", () => {
  const blob = new Blob([buildHtml()], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = state.current || "page.html";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

els.preview.addEventListener("click", () => {
  els.previewFrame.srcdoc = buildHtml({ mermaidRuntime: "local" });
  els.previewOverlay.classList.remove("hidden");
});

els.previewClose.addEventListener("click", () => {
  els.previewOverlay.classList.add("hidden");
  els.previewFrame.srcdoc = "";
});

els.deviceSwitch.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-device]");
  if (!button) return;
  editor.setDevice(button.dataset.device);
  for (const sibling of els.deviceSwitch.querySelectorAll("button")) {
    sibling.classList.toggle("active", sibling === button);
  }
});

function selectedMermaidComponent() {
  const component = editor.getSelected?.();
  if (!component) return null;
  return component.get?.("type") === "mermaid" ? component : null;
}

function openMermaidDialog() {
  const component = selectedMermaidComponent();
  if (!component) {
    toast("请先选中一个 Mermaid 图表", "warning");
    return;
  }
  els.mermaidSource.value = component.get("mermaidSource") || "";
  els.mermaidDialog.classList.remove("hidden");
  requestAnimationFrame(() => els.mermaidSource.focus());
}

function closeMermaidDialog() {
  els.mermaidDialog.classList.add("hidden");
}

els.mermaidApply.addEventListener("click", () => {
  const component = selectedMermaidComponent();
  if (!component) {
    closeMermaidDialog();
    return;
  }
  const source = els.mermaidSource.value.trim();
  if (!source) {
    toast("Mermaid 源码不能为空", "warning");
    return;
  }
  component.set("mermaidSource", source);
  closeMermaidDialog();
  toast("图表已更新", "success");
});

els.mermaidClose.addEventListener("click", () => closeMermaidDialog());
els.mermaidCancel.addEventListener("click", () => closeMermaidDialog());
els.mermaidDialog.addEventListener("click", (event) => {
  if (event.target === els.mermaidDialog) closeMermaidDialog();
});
els.mermaidSource.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    els.mermaidApply.click();
  }
});

function openUrlDialog() {
  els.urlDialog.classList.remove("hidden");
  setUrlStatus("", null);
  els.urlInput.value = "";
  requestAnimationFrame(() => els.urlInput.focus());
}

function closeUrlDialog() {
  els.urlDialog.classList.add("hidden");
  els.urlSubmit.disabled = false;
}

function setUrlStatus(text, tone) {
  els.urlStatus.textContent = text || "";
  els.urlStatus.className = "dialog-status";
  if (!text) els.urlStatus.classList.add("hidden");
  else if (tone) els.urlStatus.classList.add(tone);
}

els.urlDialog.addEventListener("click", (event) => {
  if (event.target === els.urlDialog) closeUrlDialog();
});

els.history.addEventListener("click", () => openDrawer());
els.drawerClose.addEventListener("click", () => els.drawer.classList.add("hidden"));

$("btn-abort").addEventListener("click", async () => {
  try {
    await api.abort();
    toast("已请求停止", "info");
  } catch (error) {
    toast(error.message, "error");
  }
});

$("btn-reset").addEventListener("click", async () => {
  try {
    await api.reset();
    chat.reset([]);
    toast("已开启新会话", "success");
  } catch (error) {
    toast(error.message, "error");
  }
});

$("btn-start-pi").addEventListener("click", async () => {
  try {
    toast("正在启动 Pi…", "info");
    await api.restart();
  } catch (error) {
    toast(`启动失败：${error.message}`, "error");
  }
});

$("chat-empty").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-prompt]");
  if (!button) return;
  sendPrompt(button.dataset.prompt);
});

/* ------------------------------------------------------------------ *
 * 历史抽屉
 * ------------------------------------------------------------------ */

async function openDrawer() {
  els.drawer.classList.remove("hidden");
  els.drawerSub.textContent = state.current ? `页面：${state.current}` : "";
  els.drawerList.replaceChildren(
    Object.assign(document.createElement("div"), { className: "drawer-empty", textContent: "载入中…" }),
  );

  try {
    const { versions } = await api.versions(state.current);
    els.drawerList.replaceChildren();
    if (!versions.length) {
      const empty = document.createElement("div");
      empty.className = "drawer-empty";
      empty.textContent = "还没有历史版本。每次让 Pi 修改前都会自动快照。";
      els.drawerList.append(empty);
      return;
    }

    for (const version of versions) {
      const row = document.createElement("div");
      row.className = "history-row";

      const main = document.createElement("div");
      main.className = "history-main";
      const time = new Date(version.createdAt).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      main.append(
        Object.assign(document.createElement("span"), { className: "history-time", textContent: time }),
        Object.assign(document.createElement("span"), {
          className: "history-label",
          textContent: version.label || "(无描述)",
        }),
        Object.assign(document.createElement("span"), {
          className: "history-size",
          textContent: `${(version.size / 1024).toFixed(1)} KB`,
        }),
      );

      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "history-restore";
      restore.textContent = "恢复";
      restore.addEventListener("click", async () => {
        restore.disabled = true;
        try {
          await api.restore(state.current, version.id);
          await reloadFromDisk({ force: true });
          toast("已恢复该版本", "success");
        } catch (error) {
          toast(error.message, "error");
        } finally {
          restore.disabled = false;
        }
      });

      row.append(main, restore);
      els.drawerList.append(row);
    }
  } catch (error) {
    els.drawerList.textContent = `读取历史失败：${error.message}`;
  }
}

/* ------------------------------------------------------------------ *
 * 选中浮层动作
 * ------------------------------------------------------------------ */

els.selBar.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;

  if (action === "edit") {
    els.selForm.classList.remove("hidden");
    els.selInput.focus();
  } else if (action === "ask") {
    els.selForm.classList.add("hidden");
    els.selBar.classList.add("hidden");
    els.selRing.classList.add("hidden");
    chat.input.focus();
    chat.input.placeholder = `描述对 ${state.selection?.selector || "选中元素"} 的修改…`;
  } else if (action === "mermaid") {
    openMermaidDialog();
    els.selForm.classList.add("hidden");
  } else if (action === "style") {
    const button = document.querySelector('[data-panel="styles"]');
    button?.click();
    els.selForm.classList.add("hidden");
  } else if (action === "close") {
    editor.select(undefined);
  }
});

/* ------------------------------------------------------------------ *
 * 侧栏标签
 * ------------------------------------------------------------------ */

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    const panel = tab.dataset.panel;
    const group = tab.closest(".sidebar");
    for (const sibling of group.querySelectorAll(".tab")) {
      sibling.classList.toggle("active", sibling === tab);
    }
    for (const pane of group.querySelectorAll(".panel")) {
      pane.classList.toggle("active", pane.dataset.panel === panel);
    }
  });
}

/* ------------------------------------------------------------------ *
 * 快捷键
 * ------------------------------------------------------------------ */

document.addEventListener("keydown", (event) => {
  const meta = event.metaKey || event.ctrlKey;

  if (meta && event.key.toLowerCase() === "s") {
    event.preventDefault();
    els.save.click();
    return;
  }

  if (event.key === "Escape") {
    if (!els.mermaidDialog.classList.contains("hidden")) {
      closeMermaidDialog();
      return;
    }
    if (!els.urlDialog.classList.contains("hidden")) {
      closeUrlDialog();
      return;
    }
    if (!els.previewOverlay.classList.contains("hidden")) {
      els.previewClose.click();
      return;
    }
    if (!els.selForm.classList.contains("hidden")) {
      els.selForm.classList.add("hidden");
      return;
    }
    if (!els.drawer.classList.contains("hidden")) {
      els.drawer.classList.add("hidden");
    }
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */

async function boot() {
  startSelectionLoop();

  try {
    const data = await api.state();
    state.pages = data.pages;
    applyStatus(data.pi);

    els.pageSelect.replaceChildren();
    for (const page of data.pages) {
      const option = document.createElement("option");
      option.value = page.name;
      option.textContent = page.title ? `${page.name} · ${page.title}` : page.name;
      els.pageSelect.append(option);
    }

    const target = data.currentFile || data.pages[0]?.name;
    if (!target) {
      chat.notice("工作区里还没有页面", "warning");
      return;
    }

    await loadPage(target);
    chat.reset(data.chat || []);
    chat.setBusy(data.pi?.pi === "running");

    if (data.pi?.error) {
      chat.notice(`Pi 未就绪：${data.pi.error.split("\n")[0]}`, "error");
    }
  } catch (error) {
    chat.notice(`初始化失败：${error.message}`, "error");
    toast(error.message, "error");
  }
}

boot();
