import assert from "node:assert/strict";
import test from "node:test";
import { buildPiArgs, buildSystemPrompt, composePrompt, formatUiContext } from "../server/prompt.js";

const context = {
  file: "index.html",
  selector: "section#hero > h1.title",
  tag: "h1",
  id: "",
  classes: ["title"],
  path: "body > section#hero > h1.title",
  text: "把想法说出来",
  computed: "font-size: 62px; color: rgb(244, 245, 247)",
  outerHTML: '<h1 class="title">把想法说出来</h1>',
  parentHTML: '<section id="hero"><h1 class="title">把想法说出来</h1></section>',
  css: ".title { font-size: 62px; }",
};

test("formatUiContext 生成结构化上下文块", () => {
  const block = formatUiContext(context);
  assert.match(block, /^<ui-context file="index\.html" selector="section#hero > h1\.title">/);
  assert.match(block, /component-path: body > section#hero > h1\.title/);
  assert.match(block, /```html\n<h1 class="title">/);
  assert.match(block, /```css\n\.title \{ font-size: 62px; \}/);
  assert.match(block, /<\/ui-context>$/);
});

test("composePrompt 把上下文与指令拼在一起", () => {
  const prompt = composePrompt({ message: "标题更大一点", context });
  assert.match(prompt, /^<ui-context/);
  assert.match(prompt, /修改需求：\n标题更大一点$/);
});

test("无上下文时 composePrompt 退化为纯指令", () => {
  assert.equal(composePrompt({ message: "  整页换配色  ", context: null }), "整页换配色");
  assert.equal(formatUiContext(null), "");
});

test("上下文里的超长内容会被截断", () => {
  const block = formatUiContext({ ...context, outerHTML: "x".repeat(9000) });
  assert.match(block, /已截断/);
  assert.ok(block.length < 6000);
});

test("buildSystemPrompt 包含编辑纪律", () => {
  const prompt = buildSystemPrompt({ siteDir: "/tmp/site", pages: ["index.html", "about.html"] });
  assert.match(prompt, /只改用户描述的那一个元素/);
  assert.match(prompt, /保留现有的 id、class/);
  assert.match(prompt, /canvas_state/);
  assert.match(prompt, /about\.html/);
});

test("buildPiArgs 组装启动参数", () => {
  const args = buildPiArgs({
    extensionPath: "/repo/extensions/canvas-bridge.ts",
    systemPrompt: "SYS",
    tools: ["read", "edit", "canvas_state"],
    provider: "deepseek",
    model: "deepseek-chat",
  });
  assert.deepEqual(args.slice(0, 5), ["--no-session", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates"]);
  assert.ok(args.includes("--extension"));
  assert.ok(args.includes("--append-system-prompt"));
  assert.equal(args[args.indexOf("--tools") + 1], "read,edit,canvas_state");
  assert.equal(args[args.indexOf("--provider") + 1], "deepseek");
  assert.equal(args[args.indexOf("--model") + 1], "deepseek-chat");
});
