import assert from "node:assert/strict";
import test from "node:test";
import { formatCss, parseCss, parseDeclarations } from "../web/src/css.js";

test("parseCss 保留 var() 与简写值", () => {
  const { rules } = parseCss(`
    :root { --bg: #08090d; --line: rgba(255,255,255,.08); }
    body { background: var(--bg); border: 1px solid var(--line); padding: 0 24px; }
  `);
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0].selectors, ":root");
  assert.equal(rules[0].style["--bg"], "#08090d");
  assert.equal(rules[1].style.background, "var(--bg)");
  assert.equal(rules[1].style.border, "1px solid var(--line)");
  assert.equal(rules[1].style.padding, "0 24px");
});

test("parseCss 解析 @media 并保留参数", () => {
  const { rules } = parseCss(`
    @media (max-width: 900px) {
      .hero h1 { font-size: 42px; }
    }
  `);
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].atRule, { type: "media", params: "(max-width: 900px)" });
  assert.equal(rules[0].selectors, ".hero h1");
  assert.equal(rules[0].style["font-size"], "42px");
});

test("parseCss 把 @keyframes / @font-face / @import 原样保留", () => {
  const { rules, rawAtRules } = parseCss(`
    @import url("https://fonts.example.com/a.css");
    @font-face { font-family: X; src: url(https://x.test/a.woff2); }
    @keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
    .spin { animation: spin 1s linear infinite; }
  `);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].style.animation, "spin 1s linear infinite");
  assert.equal(rawAtRules.length, 3);
  assert.match(rawAtRules[0], /@import/);
  assert.match(rawAtRules[1], /@font-face/);
  assert.match(rawAtRules[2], /@keyframes spin/);
});

test("parseDeclarations 处理引号、括号与注释里的分号", () => {
  const style = parseDeclarations(`
    background-image: url("data:image/svg+xml;base64,AAA");
    content: "a;b";
    /* ; not a separator */
    color: red;
  `);
  assert.equal(style["background-image"], 'url("data:image/svg+xml;base64,AAA")');
  assert.equal(style.content, '"a;b"');
  assert.equal(style.color, "red");
});

test("parseCss 容忍多余空白与空规则", () => {
  const { rules } = parseCss("   .a {  }   .b{color:blue}   ");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].selectors, ".b");
});

test("parseCss 兼容逗号选择器与伪类", () => {
  const { rules } = parseCss(".a:hover, .b > .c::after { color: var(--text); }");
  assert.equal(rules[0].selectors, ".a:hover, .b > .c::after");
  assert.equal(rules[0].style.color, "var(--text)");
});

test("formatCss 只调整空白，不丢声明", () => {
  const input = ':root{--bg:#08090d;}body{background:var(--bg);border:1px solid var(--line);}@media (max-width: 900px){.a{margin:0 auto}}';
  const output = formatCss(input);
  assert.match(output, /^:root \{\n  --bg: #08090d;\n\}\n/m);
  assert.match(output, /  background: var\(--bg\);/);
  assert.match(output, /@media \(max-width: 900px\) \{\n  \.a \{\n    margin: 0 auto;\n  \}\n\}/);
  const normalize = (value) => value.replace(/\s+/g, "").replace(/;}/g, "}");
  assert.equal(normalize(output), normalize(input));
  assert.equal(formatCss(""), "");
});
