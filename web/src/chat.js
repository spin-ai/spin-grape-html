import { renderMarkdown } from "./markdown.js";

const TOOL_META = {
  read: { icon: "📖", label: "读取" },
  edit: { icon: "✏️", label: "编辑" },
  write: { icon: "📝", label: "写入" },
  bash: { icon: "⌨️", label: "命令" },
  canvas_state: { icon: "🎯", label: "画布状态" },
  canvas_reload: { icon: "🔄", label: "刷新画布" },
};

function timeLabel(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function argSummary(tool) {
  const args = tool.args || {};
  switch (tool.name) {
    case "read":
    case "edit":
    case "write":
      return args.path || args.file_path || args.filePath || args.file || "";
    case "bash":
      return args.command || "";
    case "canvas_state":
      return "读取当前选中元素";
    case "canvas_reload":
      return args.file || "刷新全部画布";
    default: {
      const keys = Object.keys(args).slice(0, 3);
      return keys.map((key) => `${key}=${String(args[key]).slice(0, 40)}`).join(" ");
    }
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export class ChatView {
  constructor({ log, empty, input, form, sendButton, abortButton, hint, contextBar }) {
    this.log = log;
    this.empty = empty;
    this.input = input;
    this.form = form;
    this.sendButton = sendButton;
    this.abortButton = abortButton;
    this.hint = hint;
    this.contextBar = contextBar;
    this.nodes = new Map();
    this.items = new Map();
    this.stickToBottom = true;

    this.log.addEventListener("scroll", () => {
      const distance = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight;
      this.stickToBottom = distance < 80;
    });
  }

  reset(items = []) {
    this.log.replaceChildren();
    this.nodes.clear();
    this.items.clear();
    for (const item of items) this.upsert(item, { silent: true });
    this.#syncEmpty();
    this.scrollToEnd(true);
  }

  upsert(item, { silent = false } = {}) {
    if (!item?.id) return;
    this.items.set(item.id, item);
    let node = this.nodes.get(item.id);
    const previousScrollTop = this.log.scrollTop;

    if (!node) {
      node = this.#create(item);
      this.nodes.set(item.id, node);
      this.log.appendChild(node);
    } else {
      this.#update(node, item);
    }

    if (!silent) {
      this.#syncEmpty();
      if (this.stickToBottom) this.scrollToEnd();
      else this.log.scrollTop = previousScrollTop;
    }
  }

  appendDelta(id, delta) {
    const item = this.items.get(id);
    const node = this.nodes.get(id);
    if (!item || !node) return;
    item.text = (item.text || "") + delta;
    const body = node.querySelector(".msg-body");
    if (body) body.innerHTML = renderMarkdown(item.text);
    if (this.stickToBottom) this.scrollToEnd();
  }

  appendThinking(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.classList.add("has-thinking");
  }

  setStreaming(id, streaming) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.classList.toggle("streaming", Boolean(streaming));
  }

  notice(text, level = "info") {
    const id = `notice_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const item = { id, role: "system", level, text, createdAt: Date.now() };
    this.upsert(item);
    return item;
  }

  setBusy(busy) {
    this.sendButton.disabled = busy && false; // 忙碌时仍允许发送（会作为 steer 插入）
    this.sendButton.classList.toggle("busy", busy);
    this.abortButton.classList.toggle("hidden", !busy);
    this.hint.textContent = busy ? "Pi 正在工作 · 继续发送会插入当前任务" : "选中画布元素可获得精准上下文";
    this.input.placeholder = busy ? "插入到当前任务的补充指令…" : "描述修改，⌘↵ 发送";
  }

  setContext(context) {
    if (!context?.selector) {
      this.contextBar.classList.add("hidden");
      this.contextBar.replaceChildren();
      return;
    }
    this.contextBar.classList.remove("hidden");
    this.contextBar.replaceChildren();
    const chip = el("span", "ctx-chip");
    chip.append(el("span", "ctx-dot"));
    chip.append(el("span", "ctx-file", context.file || ""));
    chip.append(el("span", "ctx-sel", context.selector));
    const clear = el("button", "ctx-clear", "×");
    clear.type = "button";
    clear.title = "取消选中上下文";
    clear.addEventListener("click", () => this.setContext(null));
    chip.append(clear);
    this.contextBar.append(chip);
  }

  scrollToEnd(instant = false) {
    this.log.scrollTo({ top: this.log.scrollHeight, behavior: instant ? "auto" : "smooth" });
  }

  #syncEmpty() {
    this.empty.classList.toggle("hidden", this.items.size > 0);
  }

  #create(item) {
    if (item.role === "user") return this.#createUser(item);
    if (item.role === "system") return this.#createSystem(item);
    return this.#createAssistant(item);
  }

  #createUser(item) {
    const node = el("div", "msg msg-user");
    const meta = el("div", "msg-meta");
    meta.append(el("span", "msg-who", "你"), el("span", "msg-time", timeLabel(item.createdAt)));
    if (item.context?.selector) {
      const chip = el("span", "msg-ctx", item.context.selector);
      chip.title = item.context.file || "";
      meta.append(chip);
    }
    node.append(meta, el("div", "msg-body", item.text || ""));
    return node;
  }

  #createSystem(item) {
    const node = el("div", `msg msg-system level-${item.level || "info"}`);
    node.append(el("span", "sys-text", item.text || ""));
    if (item.retry) {
      const retry = el("button", "sys-retry", "重试");
      node.append(retry);
    }
    return node;
  }

  #createAssistant(item) {
    const node = el("div", "msg msg-assistant");
    node.dataset.id = item.id;

    const meta = el("div", "msg-meta");
    const avatar = el("span", "msg-avatar", "π");
    meta.append(avatar, el("span", "msg-who", "Pi"), el("span", "msg-time", timeLabel(item.createdAt)));
    const badge = el("span", "msg-badge hidden", "正在输入");
    meta.append(badge);

    const body = el("div", "msg-body md");
    const tools = el("div", "msg-tools");

    node.append(meta, body, tools);
    this.#update(node, item);
    return node;
  }

  #update(node, item) {
    if (item.role === "user") {
      const body = node.querySelector(".msg-body");
      if (body && item.text != null) body.textContent = item.text;
      return;
    }
    if (item.role === "system") return;

    const body = node.querySelector(".msg-body");
    if (body) body.innerHTML = renderMarkdown(item.text || "");

    const badge = node.querySelector(".msg-badge");
    if (badge) badge.classList.toggle("hidden", !item.streaming);
    node.classList.toggle("streaming", Boolean(item.streaming));

    const tools = node.querySelector(".msg-tools");
    if (tools) this.#renderTools(tools, item.tools || []);
  }

  #renderTools(container, tools) {
    container.replaceChildren();
    if (!tools.length) return;

    for (const tool of tools) {
      const meta = TOOL_META[tool.name] || { icon: "🛠", label: tool.name };
      const card = el("details", `tool-card status-${tool.status || "running"}`);
      const summary = el("summary", "tool-head");

      const icon = el("span", "tool-icon", meta.icon);
      const name = el("span", "tool-name", meta.label);
      const arg = el("span", "tool-arg", argSummary(tool));
      const state = el("span", "tool-state", tool.status === "running" ? "…" : tool.status === "error" ? "×" : "✓");
      if (tool.durationMs) state.title = `${Math.round(tool.durationMs)}ms`;

      summary.append(icon, name, arg, state);
      card.append(summary);

      if (tool.result) {
        const body = el("div", "tool-result");
        const pre = el("pre", null, tool.result.trim().slice(0, 2000));
        body.append(pre);
        card.append(body);
      }

      container.append(card);
    }
  }
}
