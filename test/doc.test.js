import assert from "node:assert/strict";
import test from "node:test";
import { extractTitle, mergeDocument, splitDocument, stripUnusedIds, unwrapBody } from "../web/src/doc.js";

const SAMPLE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Demo Page</title>
<link href="https://fonts.example.com/x.css" rel="stylesheet" />
<style>
  body { color: red; }
  .hero { padding: 20px; }
</style>
</head>
<body class="dark">
  <section class="hero"><h1>Hello</h1></section>
</body>
</html>`;

test("splitDocument 抽出 head / body / css / lang", () => {
  const parts = splitDocument(SAMPLE);
  assert.equal(parts.lang, "en");
  assert.equal(parts.bodyAttrs, 'class="dark"');
  assert.match(parts.css, /\.hero \{ padding: 20px; \}/);
  assert.match(parts.body, /<h1>Hello<\/h1>/);
  assert.doesNotMatch(parts.body, /<html/);
  assert.match(parts.head, /fonts\.example\.com/);
  assert.doesNotMatch(parts.head, /<style>/);
});

test("mergeDocument 还原出完整文档", () => {
  const parts = splitDocument(SAMPLE);
  const merged = mergeDocument(parts);
  assert.match(merged, /^<!DOCTYPE html>/);
  assert.match(merged, /<html lang="en">/);
  assert.match(merged, /<body class="dark">/);
  assert.match(merged, /<style>[\s\S]*color: red[\s\S]*<\/style>/);
  assert.match(merged, /fonts\.example\.com/);

  const again = splitDocument(merged);
  assert.equal(again.css, parts.css);
  assert.equal(again.body, parts.body);
  assert.equal(again.lang, parts.lang);
});

test("mergeDocument 不重复注入 charset 与 viewport", () => {
  const merged = mergeDocument({
    lang: "zh-CN",
    head: '<meta charset="utf-8"><meta name="viewport" content="width=device-width">',
    body: "<p>hi</p>",
  });
  assert.equal(merged.match(/charset/g)?.length, 1);
  assert.equal(merged.match(/name="viewport"/g)?.length, 1);
});

test("extractTitle 提取标题", () => {
  assert.equal(extractTitle(SAMPLE), "Demo Page");
  assert.equal(extractTitle("<html></html>", "fallback"), "fallback");
});

test("空文档不会抛错", () => {
  const parts = splitDocument("");
  assert.equal(parts.body, "");
  assert.equal(parts.css, "");
  assert.match(mergeDocument(parts), /<body>\n\n<\/body>/);
});

test("unwrapBody 去掉 GrapesJS 包裹的 body", () => {
  assert.equal(unwrapBody("<body><div>x</div></body>"), "<div>x</div>");
  assert.equal(unwrapBody("<div>x</div>"), "<div>x</div>");
  assert.equal(unwrapBody(""), "");
});

test("stripUnusedIds 清理临时 id，保留源文件 id 与被 CSS 引用的 id", () => {
  const html = '<h1 id="hero">a</h1><em id="iy3li">b</em><p id="temp">c</p>';
  const css = '#temp { color: red; }';
  const out = stripUnusedIds(html, css, new Set(["hero"]));
  assert.match(out, /id="hero"/);
  assert.match(out, /id="temp"/);
  assert.doesNotMatch(out, /iy3li/);
});
