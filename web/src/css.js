/**
 * 把 CSS 文本解析成 GrapesJS 能安全接收的规则对象。
 *
 * 为什么不用 editor.setStyle(css)？GrapesJS 解析 CSS 文本时会对声明做类型推断，
 * 像 `background: var(--bg)`、`border: 1px solid var(--line)`、`padding: var(--pad)`
 * 这类值会被直接丢掉（0.22 的已知行为），导致画布与导出文件都失真。
 *
 * 改为自己解析成 { selectors, style: {prop: value} }，再用 editor.Css.setRule() 写入：
 * 值原样保留，var() / 简写 / 自定义属性都安全；@media 也保留。
 * @font-face / @keyframes / @supports 等暂时不参与编辑，原样留存并在导出时补回。
 */

/** 跳过注释与字符串。返回新的索引。 */
function skipTrivia(css, index) {
  const length = css.length;
  let i = index;
  while (i < length) {
    const char = css[i];
    if (char === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? length : end + 2;
      continue;
    }
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

function findBlockEnd(css, start) {
  let depth = 1;
  let quote = null;
  let i = start;
  while (i < css.length) {
    const char = css[i];
    if (quote) {
      if (char === "\\") i += 2;
      else {
        if (char === quote) quote = null;
        i += 1;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      i += 1;
      continue;
    }
    if (char === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return css.length;
}

/** 去掉注释，但保留引号内的内容。 */
function stripComments(css) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < css.length) {
    const char = css[i];
    if (quote) {
      out += char;
      if (char === "\\") {
        out += css[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      i += 1;
      continue;
    }
    if (char === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

/** 解析声明块为 { prop: value }，保留 var()、括号与引号中的分号。 */
export function parseDeclarations(rawBody) {
  const body = stripComments(rawBody);
  const style = {};
  let depth = 0;
  let quote = null;
  let start = 0;
  const chunks = [];

  const push = (end) => {
    const chunk = body.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
  };

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(body.length);

  for (const chunk of chunks) {
    const colon = chunk.indexOf(":");
    if (colon === -1) continue;
    const prop = chunk.slice(0, colon).trim();
    const value = chunk.slice(colon + 1).trim();
    if (!prop || !value) continue;
    style[prop.startsWith("--") ? prop : prop.toLowerCase()] = value;
  }
  return style;
}

function parseInto(css, atRule, rules, rawAtRules) {
  let i = 0;
  while (i < css.length) {
    i = skipTrivia(css, i);
    if (i >= css.length) break;

    // 读 prelude，直到 { 或 ;
    let quote = null;
    let depth = 0;
    const preludeStart = i;
    while (i < css.length) {
      const char = css[i];
      if (quote) {
        if (char === "\\") i += 2;
        else {
          if (char === quote) quote = null;
          i += 1;
        }
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        i += 1;
        continue;
      }
      if (char === "/" && css[i + 1] === "*") {
        const end = css.indexOf("*/", i + 2);
        i = end === -1 ? css.length : end + 2;
        continue;
      }
      if (char === "(") depth += 1;
      else if (char === ")") depth = Math.max(0, depth - 1);
      else if (depth === 0 && (char === "{" || char === ";")) break;
      i += 1;
    }

    const prelude = css.slice(preludeStart, i).trim();
    if (!prelude) {
      i += 1;
      continue;
    }

    if (css[i] === ";") {
      if (prelude.startsWith("@")) rawAtRules.push(`${prelude};`);
      i += 1;
      continue;
    }

    if (css[i] !== "{") break;
    const end = findBlockEnd(css, i + 1);
    const body = css.slice(i + 1, end);
    i = end + 1;

    if (prelude.startsWith("@")) {
      const media = /^@media\b([\s\S]*)$/i.exec(prelude);
      if (media && !atRule) {
        const params = media[1].trim();
        parseInto(body, { type: "media", params }, rules, rawAtRules);
      } else {
        rawAtRules.push(`${prelude}{${body}}`);
      }
      continue;
    }

    const style = parseDeclarations(body);
    if (!Object.keys(style).length) continue;
    rules.push({ selectors: prelude.replace(/\s+/g, " "), style, atRule });
  }
}

/**
 * @returns {{ rules: Array<{selectors: string, style: Record<string,string>, atRule: {type:string,params:string}|null}>, rawAtRules: string[] }}
 */
export function parseCss(css) {
  const rules = [];
  const rawAtRules = [];
  parseInto(String(css || ""), null, rules, rawAtRules);
  return { rules, rawAtRules };
}
