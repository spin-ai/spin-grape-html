import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_AGENTS_MD, DEFAULT_PAGES } from "./templates.js";

const PAGE_RE = /^[a-z0-9][a-z0-9_-]*\.html$/i;

export function assertPageName(name) {
  if (typeof name !== "string" || !PAGE_RE.test(name)) {
    throw Object.assign(new Error(`非法页面名：${name}`), { status: 400 });
  }
  return name;
}

export function pageTitle(html, fallback = "未命名页面") {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || "");
  const title = match?.[1]?.trim();
  return title || fallback;
}

export class Workspace {
  constructor(root) {
    this.root = root;
    this.siteDir = path.join(root, "site");
    this.historyDir = path.join(root, "data", "history");
  }

  async init() {
    await fs.mkdir(this.siteDir, { recursive: true });
    await fs.mkdir(this.historyDir, { recursive: true });

    for (const [name, html] of Object.entries(DEFAULT_PAGES)) {
      const file = path.join(this.siteDir, name);
      try {
        await fs.access(file);
      } catch {
        await fs.writeFile(file, html, "utf8");
      }
    }

    const agents = path.join(this.siteDir, "AGENTS.md");
    try {
      await fs.access(agents);
    } catch {
      await fs.writeFile(agents, DEFAULT_AGENTS_MD, "utf8");
    }
  }

  pagePath(name) {
    return path.join(this.siteDir, assertPageName(name));
  }

  async listPages() {
    const entries = await fs.readdir(this.siteDir, { withFileTypes: true });
    const pages = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".html")) continue;
      const file = path.join(this.siteDir, entry.name);
      const [stat, html] = await Promise.all([fs.stat(file), fs.readFile(file, "utf8")]);
      pages.push({
        name: entry.name,
        title: pageTitle(html, entry.name),
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
    return pages.sort((a, b) => a.name.localeCompare(b.name));
  }

  async readPage(name) {
    const html = await fs.readFile(this.pagePath(name), "utf8");
    const stat = await fs.stat(this.pagePath(name));
    return { name: assertPageName(name), html, mtime: stat.mtimeMs };
  }

  async writePage(name, html) {
    const file = this.pagePath(name);
    await fs.writeFile(file, html, "utf8");
    const stat = await fs.stat(file);
    return { name: assertPageName(name), mtime: stat.mtimeMs, size: stat.size };
  }

  #dir(name) {
    return path.join(this.historyDir, assertPageName(name).replace(/\.html$/i, ""));
  }

  #index(name) {
    return path.join(this.#dir(name), "index.jsonl");
  }

  async #readIndex(name) {
    try {
      const raw = await fs.readFile(this.#index(name), "utf8");
      return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /** 快照当前页面内容，返回版本条目。 */
  async snapshot(name, { label = "手动快照", source = "manual" } = {}) {
    const page = await this.readPage(name);
    const dir = this.#dir(name);
    await fs.mkdir(dir, { recursive: true });

    const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
    await fs.writeFile(path.join(dir, `${id}.html`), page.html, "utf8");

    const entry = { id, label: label.slice(0, 200), source, createdAt: Date.now(), size: page.html.length };
    await fs.appendFile(this.#index(name), `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  }

  async listVersions(name) {
    const entries = await this.#readIndex(name);
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  }

  async readVersion(name, id) {
    if (!/^[a-z0-9-]+$/i.test(String(id))) {
      throw Object.assign(new Error("非法版本 id"), { status: 400 });
    }
    const file = path.join(this.#dir(name), `${id}.html`);
    try {
      return await fs.readFile(file, "utf8");
    } catch {
      throw Object.assign(new Error("版本不存在"), { status: 404 });
    }
  }

  /** 恢复历史版本（恢复前先给当前内容留一份快照）。 */
  async restoreVersion(name, id) {
    const html = await this.readVersion(name, id);
    await this.snapshot(name, { label: "恢复前的自动快照", source: "auto" });
    return this.writePage(name, html);
  }
}
