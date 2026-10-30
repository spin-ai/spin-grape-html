/**
 * 从画布选区提取“结构化 UI 上下文”。
 * 这份上下文是“选中即改”的核心：模型不需要猜用户指的是哪个元素。
 */

const COMPUTED_PROPS = [
  "display",
  "position",
  "width",
  "height",
  "margin",
  "padding",
  "gap",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "color",
  "background-color",
  "border",
  "border-radius",
  "box-shadow",
];

/** 源文件里出现过的 id 集合：GrapesJS 会为样式生成临时 id，不能当作定位依据。 */
let sourceIds = new Set();

export function setSourceIds(html) {
  sourceIds = new Set(
    [...String(html || "").matchAll(/\bid=["']([^"']+)["']/gi)].map((match) => match[1]),
  );
}

const isSourceId = (id) => Boolean(id) && sourceIds.has(id);

/** 当前页面的源文件 id 集合（保存时用于清理临时 id）。 */
export function getSourceIds() {
  return sourceIds;
}

/** 复制一份 DOM，去掉 GrapesJS 临时生成的 id，避免误导模型。 */
function sanitizeClone(element) {
  const clone = element.cloneNode(true);
  if (clone.id && !isSourceId(clone.id)) clone.removeAttribute("id");
  for (const node of clone.querySelectorAll("[id]")) {
    if (!isSourceId(node.id)) node.removeAttribute("id");
  }
  return clone;
}

const clip = (value, max) => {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export function cssPath(element) {
  if (!element || element.nodeType !== 1) return "";
  const doc = element.ownerDocument;
  const escape = (value) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value);
  const parts = [];
  let node = element;

  while (node && node.nodeType === 1 && node !== doc.body && node !== doc.documentElement) {
    let part = node.tagName.toLowerCase();
    if (isSourceId(node.id)) {
      parts.unshift(`${part}#${escape(node.id)}`);
      break;
    }
    const classes = Array.from(node.classList || []).filter((name) => !/^(gjs|is-|no-)/.test(name));
    if (classes.length) {
      part += `.${classes.slice(0, 2).map(escape).join(".")}`;
      parts.unshift(part);
      // class 已经足够定位时停止向上，选择器更短更稳定
      if (classes.length >= 2) break;
    } else {
      const siblings = node.parentElement
        ? Array.from(node.parentElement.children).filter((child) => child.tagName === node.tagName)
        : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      parts.unshift(part);
    }
    node = node.parentElement;
  }

  return parts.join(" > ");
}

function componentPath(component) {
  const parts = [];
  let node = component;
  let guard = 0;
  while (node && guard < 20) {
    guard += 1;
    const name = typeof node.getName === "function" ? node.getName() : "";
    if (!name || name === "body") break;
    let part = name;
    const attrs = (typeof node.getAttributes === "function" && node.getAttributes()) || {};
    if (isSourceId(attrs.id)) part += `#${attrs.id}`;
    else if (attrs.class) {
      const classes = String(attrs.class)
        .split(/\s+/)
        .filter((cls) => cls && !/^(gjs|is-|no-)/.test(cls))
        .slice(0, 2);
      if (classes.length) part += `.${classes.join(".")}`;
    }
    parts.unshift(part);
    node = typeof node.parent === "function" ? node.parent() : null;
  }
  return ["body", ...parts].join(" > ");
}

function relatedCss(editor, element) {
  const classes = Array.from(element.classList || []).filter((name) => !/^(gjs|is-|no-)/.test(name));
  const tokens = [...classes.map((name) => `.${name}`), element.id ? `#${element.id}` : null].filter(Boolean);
  const tag = element.tagName.toLowerCase();

  let rules = [];
  try {
    rules = editor.Css.getRules() || [];
  } catch {
    return "";
  }

  const matched = [];
  for (const rule of rules) {
    if (typeof rule.getSelectorsString !== "function") continue;
    let selectors = "";
    try {
      selectors = rule.getSelectorsString() || "";
    } catch {
      continue;
    }
    if (!selectors) continue;
    const hit = tokens.length ? tokens.some((token) => selectors.includes(token)) : selectors.includes(tag);
    if (!hit) continue;

    const style = rule.getStyle ? rule.getStyle() : {};
    const declaration = Object.entries(style || {})
      .map(([prop, value]) => `${prop}: ${value}`)
      .join("; ");
    if (declaration) matched.push(`${selectors} { ${declaration} }`);
    if (matched.length >= 10) break;
  }

  return matched.join("\n");
}

export function describeSelection(editor, file) {
  const selected = editor.getSelected?.();
  if (!selected) return null;

  let element = null;
  try {
    element = selected.getEl?.();
  } catch {
    element = null;
  }
  if (!element || element.nodeType !== 1) return null;

  const doc = element.ownerDocument;
  const view = doc.defaultView;
  const computed = {};
  if (view) {
    const style = view.getComputedStyle(element);
    for (const prop of COMPUTED_PROPS) {
      const value = style.getPropertyValue(prop);
      if (value && value !== "none" && value !== "normal" && value !== "auto") computed[prop] = value;
    }
  }

  const classes = Array.from(element.classList || []).filter((name) => !/^(gjs|is-|no-)/.test(name));
  const parent = element.parentElement;

  const safe = sanitizeClone(element);

  return {
    file,
    selector: cssPath(element),
    tag: element.tagName.toLowerCase(),
    id: isSourceId(element.id) ? element.id : "",
    classes,
    path: componentPath(selected),
    text: clip((element.textContent || "").replace(/\s+/g, " ").trim(), 240),
    computed: Object.entries(computed)
      .map(([prop, value]) => `${prop}: ${value}`)
      .join("; "),
    outerHTML: clip(safe.outerHTML, 4000),
    parentHTML: parent && parent !== doc.body ? clip(sanitizeClone(parent).outerHTML, 3000) : "",
    css: clip(relatedCss(editor, element), 3000),
  };
}
