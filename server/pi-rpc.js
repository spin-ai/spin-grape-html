/**
 * PiRpc — 一个符合 Pi RPC 协议的极简客户端。
 *
 * Pi 以 `--mode rpc` 启动后，通过 stdin/stdout 交换 JSONL 记录：
 *   - 客户端写入 `command`（prompt / abort / get_state / new_session ...）
 *   - Pi 返回 `response`（带 id 关联）
 *   - Pi 持续推送会话事件（message_update / tool_execution_* / agent_settled ...）
 *
 * 文档：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md
 *
 * 注意：这里不使用 readline —— Node 的 readline 会把 U+2028 / U+2029 当作换行，
 * 而它们在 JSON 字符串里是合法字符。我们只按 LF 切分。
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

const DEFAULT_TIMEOUT = 30_000;

export class PiRpc extends EventEmitter {
  #child = null;
  #buffer = "";
  #seq = 0;
  #pending = new Map();
  #stderr = "";
  #stopping = false;

  constructor({ bin = process.env.PI_BIN || "pi", cwd, args = [], env = {}, debug = false } = {}) {
    super();
    this.bin = bin;
    this.cwd = cwd;
    this.args = args;
    this.env = env;
    this.debug = debug;
  }

  get started() {
    return this.#child !== null;
  }

  get stderr() {
    return this.#stderr;
  }

  /**
   * 启动子进程，并用一次 get_state 往返确认 RPC 通道已经可用。
   */
  async start() {
    if (this.#child) return;

    this.#stopping = false;
    this.#buffer = "";
    this.#stderr = "";

    const args = ["--mode", "rpc", ...this.args];
    const child = spawn(this.bin, args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.#onData(chunk));

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.#stderr = (this.#stderr + chunk).slice(-32_000);
      if (this.debug) process.stderr.write(`[pi] ${chunk}`);
      this.emit("stderr", chunk);
    });

    child.on("error", (error) => {
      if (this.#child === child) this.#failAll(new Error(`Pi 进程错误：${error.message}`));
    });

    child.on("exit", (code, signal) => {
      if (this.#child !== child) return;
      this.#child = null;
      const detail = this.#stderr.trim().split("\n").slice(-6).join("\n");
      const message = `Pi 进程已退出（code=${code} signal=${signal}）${detail ? `\n${detail}` : ""}`;
      this.#failAll(new Error(message));
      this.emit("exit", { code, signal, message });
    });

    child.stdin.on("error", (error) => {
      this.#failAll(new Error(`Pi stdin 错误：${error.message}`));
    });

    // 用一次真实往返确认进程可用（spawn 成功不代表 Pi 内部初始化成功）
    await this.request("get_state", {}, 20_000);
    this.emit("ready");
  }

  /** 发送一条命令并等待匹配 id 的 response。 */
  request(type, payload = {}, timeout = DEFAULT_TIMEOUT) {
    const id = `req_${++this.#seq}`;
    const record = { id, type, ...payload };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`等待 ${type} 响应超时（${timeout}ms）`));
      }, timeout);

      this.#pending.set(id, {
        resolve: (response) => {
          clearTimeout(timer);
          if (response.success === false) reject(new Error(response.error || `${type} 执行失败`));
          else resolve(response.data);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this.#write(record, (error) => {
        if (!error) return;
        const pending = this.#pending.get(id);
        this.#pending.delete(id);
        pending?.reject(error);
      });
    });
  }

  /** 发送 prompt。running 时由调用方决定 steer / followUp。 */
  async prompt(message, { streamingBehavior, images } = {}) {
    const data = await this.request("prompt", { message, streamingBehavior, images }, 60_000);
    return data?.disposition ?? "started";
  }

  async abort() {
    await this.request("abort", {}, 120_000);
  }

  async newSession() {
    return this.request("new_session");
  }

  async getState() {
    return this.request("get_state");
  }

  async getMessages() {
    const data = await this.request("get_messages");
    return data?.messages ?? [];
  }

  async getSessionStats() {
    return this.request("get_session_stats");
  }

  /** 关闭 stdin 让 Pi 有序退出，超时后强制结束。 */
  async stop() {
    const child = this.#child;
    if (!child) return;
    this.#stopping = true;
    this.#failAll(new Error("Pi 会话已关闭"));

    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        child.stdin.end();
      } catch {
        child.kill("SIGTERM");
      }
    });

    this.#child = null;
  }

  #write(record, onError) {
    const child = this.#child;
    if (!child || !child.stdin?.writable) {
      onError?.(new Error("Pi 进程未运行"));
      return;
    }
    try {
      child.stdin.write(`${JSON.stringify(record)}\n`, "utf8", (error) => onError?.(error));
    } catch (error) {
      onError?.(error);
    }
  }

  #onData(chunk) {
    this.#buffer += chunk;
    let index;
    while ((index = this.#buffer.indexOf("\n")) !== -1) {
      let line = this.#buffer.slice(0, index);
      this.#buffer = this.#buffer.slice(index + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      this.#onLine(line);
    }
  }

  #onLine(line) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      if (this.debug) process.stderr.write(`[pi-rpc] 非 JSON 行：${line.slice(0, 200)}\n`);
      return;
    }

    if (record.type === "response") {
      const pending = record.id ? this.#pending.get(record.id) : null;
      if (!pending) {
        // 没有 id 的错误响应（例如命令 JSON 解析失败）
        this.emit("protocol_error", record);
        return;
      }
      this.#pending.delete(record.id);
      pending.resolve(record);
      return;
    }

    // 扩展 UI 子协议：对话框类请求必须应答，否则 Pi 会一直等待。
    if (record.type === "extension_ui_request") {
      this.#handleUiRequest(record);
      return;
    }

    this.emit("event", record);
  }

  #handleUiRequest(record) {
    const dialogs = new Set(["select", "confirm", "input", "editor"]);
    if (dialogs.has(record.method)) {
      this.#write({ type: "extension_ui_response", id: record.id, cancelled: true });
      this.emit("ui_cancelled", record);
      return;
    }
    this.emit("ui", record);
  }

  #failAll(error) {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}
