/**
 * 页面文档 ↔ 画布模型的转换。
 *
 * 约定：工作区里的页面是“完整 HTML 文档”。画布只编辑 body 内容和 <style>，
 * 其余 head 内容（字体、meta、外链脚本）原样保留。
 *
 * 纯字符串处理，不依赖 DOM，方便在 Node 里直接单测。
 */

export function splitDocument(raw) {
  const html = typeof raw === "string" ? raw : "";
  const styles = [];
  const styleRe = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = styleRe.exec(html))) {
    styles.push({ attrs: match[1] || "", css: match[2] || "" });
  }
  const css = styles.map((style) => style.css.trim()).filter(Boolean).join("\n\n");

  const bodyMatch = /<body\b([^>]*)>([\s\S]*?)<\/body>/i.exec(html);
  const body = bodyMatch ? bodyMatch[2].trim() : "";
  const bodyAttrs = bodyMatch ? (bodyMatch[1] || "").trim() : "";

  const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html);
  const head = (headMatch ? headMatch[1] : "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .trim();

  const langMatch = /<html\b[^>]*\blang=["']([^"']+)["']/i.exec(html);

  return {
    lang: langMatch?.[1] || "zh-CN",
    head,
    bodyAttrs,
    body,
    css,
    styleCount: styles.length,
  };
}

export function mergeDocument({ lang = "zh-CN", head = "", bodyAttrs = "", body = "", css = "" }) {
  const headParts = [];
  const cleanedHead = head
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<meta[^>]+charset[^>]*>/gi, "")
    .replace(/<meta[^>]+name=["']viewport["'][^>]*>/gi, "")
    .trim();

  headParts.push('<meta charset="utf-8" />');
  headParts.push('<meta name="viewport" content="width=device-width, initial-scale=1" />');
  if (cleanedHead) headParts.push(cleanedHead);

  const cssBlock = css.trim() ? `\n<style>\n${css.trim()}\n</style>\n` : "\n";
  const attrs = bodyAttrs ? ` ${bodyAttrs}` : "";

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
${headParts.join("\n")}
${cssBlock}</head>
<body${attrs}>
${body.trim()}
</body>
</html>
`;
}

/** GrapesJS 的 getHtml() 会带上外层 <body>，写入文档前需要剥掉。 */
export function unwrapBody(html) {
  const match = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(String(html || ""));
  return (match ? match[1] : String(html || "")).trim();
}

/** 标题提取，用于页面下拉框。 */
export function extractTitle(html, fallback = "未命名页面") {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || "");
  return (match?.[1] || fallback).trim() || fallback;
}
