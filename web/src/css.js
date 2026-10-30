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

/**
 * 把 GrapesJS 序列化出的紧凑 CSS 排版成多行，便于阅读、diff 和 Pi 做精确 edit。
 * 只调整空白（并补齐结尾分号），不改变任何声明或顺序。
 */
export function formatCss(css) {
  const source = String(css || "").trim();
  if (!source) return "";

  const pad = (level) => "  ".repeat(level);
  const stack = [];
  let out = "";
  let indent = 0;
  let quote = null;
  let paren = 0;
  let state = "prelude";
  let boundary = 0;

  const newline = () => {
    out = out.replace(/\s+$/, "");
    if (!out.endsWith("\n")) out += "\n";
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quote) {
      out += char;
      if (char === "\\") {
        out += source[i + 1] ?? "";
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      continue;
    }

    if (char === "(") {
      paren += 1;
      out += char;
      continue;
    }
    if (char === ")") {
      paren = Math.max(0, paren - 1);
      out += char;
      continue;
    }

    if (paren === 0 && char === "{") {
      const prelude = out.slice(boundary).trim();
      stack.push(state);
      state = /^@media\b/i.test(prelude) ? "prelude" : "declarations";
      out = `${out.replace(/\s+$/, "")} {\n`;
      indent += 1;
      out += pad(indent);
      boundary = out.length;
      continue;
    }

    if (paren === 0 && char === "}") {
      // 补齐最后一条声明的分号
      if (state === "declarations" && !/[;{]$/.test(out.trim())) out = `${out.replace(/\s+$/, "")};`;
      newline();
      indent = Math.max(0, indent - 1);
      out += `${pad(indent)}}\n`;
      if (indent === 0) out += "\n";
      state = stack.pop() ?? "prelude";
      boundary = out.length;
      continue;
    }

    if (paren === 0 && char === ";") {
      out += `;\n${pad(indent)}`;
      boundary = out.length;
      continue;
    }

    if (char === ":") {
      out = out.replace(/\s+$/, "");
      out += state === "declarations" ? ": " : ":";
      continue;
    }

    if (char === "\n" || char === "\r" || char === "\t") continue;

    if (char === " ") {
      const previous = out[out.length - 1];
      if (previous && previous !== " " && previous !== "\n" && previous !== "{") out += " ";
      continue;
    }

    out += char;
  }

  return `${out.replace(/\s+$/, "")}\n`;
}
