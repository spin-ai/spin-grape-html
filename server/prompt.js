/**
 * Prompt 组装：把「画布上下文」翻译成 Pi 能精准消费的结构化输入。
 *
 * 设计原则：
 *  - 系统提示负责“长期纪律”（只改选中元素、保留锚点、最小 diff）
 *  - 用户提示负责“这一次的上下文 + 指令”（<ui-context> 块）
 *  - 二者都不依赖扩展：即使扩展未加载，Pi 也能凭 read/edit 完成工作
 */

const MAX_HTML = 4000;
const MAX_TEXT = 240;

function clip(value, max) {
  if (value == null) return "";
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}\n…（已截断）` : text;
}

export function buildSystemPrompt({ siteDir, pages = [], extra = "" }) {
  const pageList = pages.length ? pages.join("、") : "index.html";
  return [
    "## 运行环境：Pi Canvas（GrapesJS 可视化编辑器）",
    "你被嵌入在一个所见即所得的 HTML 编辑器里。用户在画布上选中元素，用自然语言描述修改；",
    "你的任务是直接改写磁盘上的页面源文件，画布会自动重载你的改动。",
    "",
    `工作目录：${siteDir}`,
    `页面文件：${pageList}`,
    "",
    "### 编辑纪律（必须遵守）",
    "1. 只改用户描述的那一个元素及其必要的子元素，不要整体重写文件，不要重排格式或改缩进风格。",
    "2. 必须保留现有的 id、class、data-* 属性：它们是画布选择器的锚点，丢失会导致后续选中失效。",
    "3. 不要删除页面中的其它区块；新增样式写进文件中已有的 <style> 块，紧跟在该区块原有规则附近。",
    "4. 优先使用 edit 工具做最小 diff（精确替换一段文本），只有创建新文件时才用 write。",
    "5. 用户给出的 <ui-context> 里 outer-html 是选中元素在当前 DOM 中的真实片段，",
    "   selector / component-path 用于在源文件里定位；三者不一致时以源文件为准，先 read 再改。",
    "6. 完成后用一两句话说明改了什么（不要回贴整页 HTML）。用户看不到终端，只看画布和聊天窗口。",
    '7. 页面中的 <pre class="mermaid">…</pre> 是 Mermaid 图表源码：直接编辑其中的文本（保留缩进与语法），',
    "   画布与预览会自动重新渲染；不要把它改写成 SVG，也不要删除 data-pi-mermaid-bootstrap。",
    "8. 需要画布的实时状态（当前选中元素、页面列表、是否正在显示某页）时，调用 canvas_state 工具；",
    "   需要立即让所有打开的画布刷新时，调用 canvas_reload 工具。",
    "",
    "### 语义约定",
    "- “更大/更小”指尺寸，“更亮/更暗”指颜色明度，“更紧凑”指间距，“更现代”指字体/圆角/阴影的综合调整。",
    "- 页面是静态 HTML + 内联 <style>，不要引入构建工具；外部资源用 CDN。",
    "- 中文界面：文案保持中文，除非用户另有要求。",
    extra ? `\n### 项目补充约定\n${extra}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatUiContext(context) {
  if (!context || typeof context !== "object") return "";

  const lines = [];
  const attrs = [`file="${context.file || "index.html"}"`];
  if (context.selector) attrs.push(`selector="${context.selector}"`);
  lines.push(`<ui-context ${attrs.join(" ")}>`);

  if (context.tag) lines.push(`tag: ${context.tag}`);
  if (context.id) lines.push(`id: ${context.id}`);
  if (Array.isArray(context.classes) && context.classes.length) lines.push(`classes: ${context.classes.join(" ")}`);
  if (context.path) lines.push(`component-path: ${context.path}`);
  if (context.text) lines.push(`text: ${JSON.stringify(clip(context.text, MAX_TEXT))}`);
  if (context.computed) lines.push(`computed-style: ${context.computed}`);

  if (context.outerHTML) {
    lines.push("outer-html:", "```html", clip(context.outerHTML, MAX_HTML), "```");
  }
  if (context.parentHTML) {
    lines.push("parent-html:", "```html", clip(context.parentHTML, MAX_HTML), "```");
  }
  if (context.css) {
    lines.push("related-css:", "```css", clip(context.css, MAX_HTML), "```");
  }

  lines.push("</ui-context>");
  return lines.join("\n");
}

export function composePrompt({ message, context }) {
  const instruction = (message || "").trim();
  const block = formatUiContext(context);
  if (!block) return instruction;
  return `${block}\n\n修改需求：\n${instruction}`;
}

/** 组装 `pi --mode rpc` 的启动参数。 */
export function buildPiArgs({ extensionPath, siteDir, systemPrompt, tools, provider, model, thinking }) {
  const args = ["--no-session", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates"];

  if (extensionPath) args.push("--extension", extensionPath);
  if (systemPrompt) args.push("--append-system-prompt", systemPrompt);
  if (tools?.length) args.push("--tools", tools.join(","));
  if (provider) args.push("--provider", provider);
  if (model) args.push("--model", model);
  if (thinking) args.push("--thinking", thinking);

  // cwd 由 PiRpc 的 spawn options 指定（siteDir），这里只保留参数
  void siteDir;
  return args;
}
