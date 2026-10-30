/** 极简 Markdown 渲染：只覆盖模型回答里真正会用到的语法。 */

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, "$1<em>$2</em>");
  out = out.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_, label, href) => `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`,
  );
  return out;
}

export function renderMarkdown(source) {
  const text = String(source || "").replace(/\r\n/g, "\n");
  const blocks = [];
  const lines = text.split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    const fence = /^```([\w-]*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1];
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        `<pre class="md-code"><code${lang ? ` data-lang="${escapeHtml(lang)}"` : ""}>${escapeHtml(
          code.join("\n"),
        )}</code></pre>`,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length + 2;
      blocks.push(`<h${level} class="md-h">${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (index < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[index])) {
        items.push(`<li>${inline(lines[index].replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>`);
        index += 1;
      }
      blocks.push(`<${ordered ? "ol" : "ul"} class="md-list">${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote class="md-quote">${inline(quote.join(" "))}</blockquote>`);
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^```/.test(lines[index]) &&
      !/^(#{1,4})\s+/.test(lines[index]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(`<p>${inline(paragraph.join("\n")).replace(/\n/g, "<br />")}</p>`);
  }

  return blocks.join("");
}
