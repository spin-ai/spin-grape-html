/* global grapesjs */
import { parseCss } from "./css.js";

const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const BRAND = "linear-gradient(135deg,#a78bfa,#22d3ee)";
const MUTED = "rgba(154,163,178,0.92)";
const LINE = "1px solid rgba(255,255,255,0.08)";

const BLOCKS = [
  {
    id: "section-split",
    label: "两栏区块",
    category: "布局",
    media: svg('<rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/>'),
    content: `<section style="max-width:1120px;margin:0 auto;padding:64px 28px;display:grid;grid-template-columns:1.05fr .95fr;gap:36px;align-items:center">
  <div>
    <p style="margin:0 0 12px;color:#22d3ee;font-size:12.5px;letter-spacing:.16em;text-transform:uppercase">Section</p>
    <h2 style="margin:0 0 14px;font-size:36px;line-height:1.2;letter-spacing:-.02em;color:#f4f5f7">一个清晰的标题</h2>
    <p style="margin:0 0 24px;color:${MUTED};font-size:15.5px;line-height:1.75">在这里写一段说明文字，讲清楚这个区块要传达的价值。保持简短、具体。</p>
    <a href="#" style="display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border-radius:12px;background:${BRAND};color:#0b0714;font-weight:600;font-size:14px;text-decoration:none">了解更多</a>
  </div>
  <div style="min-height:280px;border-radius:20px;border:${LINE};background:linear-gradient(135deg,rgba(124,92,255,.38),rgba(34,211,238,.16))"></div>
</section>`,
  },
  {
    id: "feature-grid",
    label: "三列特性",
    category: "布局",
    media: svg('<rect x="3" y="4" width="5.5" height="16" rx="1.5"/><rect x="9.5" y="4" width="5.5" height="16" rx="1.5"/><rect x="16" y="4" width="5" height="16" rx="1.5"/>'),
    content: `<section style="max-width:1120px;margin:0 auto;padding:64px 28px">
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px">
    <article style="padding:26px;border-radius:18px;border:${LINE};background:#11131b">
      <div style="width:38px;height:38px;border-radius:12px;margin-bottom:16px;display:flex;align-items:center;justify-content:center;background:rgba(124,92,255,.16);border:1px solid rgba(124,92,255,.3);font-size:18px">✦</div>
      <h3 style="margin:0 0 8px;font-size:17px;color:#f4f5f7">特性一</h3>
      <p style="margin:0;color:${MUTED};font-size:14px;line-height:1.7">用一句话说清楚它解决了什么问题。</p>
    </article>
    <article style="padding:26px;border-radius:18px;border:${LINE};background:#11131b">
      <div style="width:38px;height:38px;border-radius:12px;margin-bottom:16px;display:flex;align-items:center;justify-content:center;background:rgba(34,211,238,.14);border:1px solid rgba(34,211,238,.3);font-size:18px">◎</div>
      <h3 style="margin:0 0 8px;font-size:17px;color:#f4f5f7">特性二</h3>
      <p style="margin:0;color:${MUTED};font-size:14px;line-height:1.7">用一句话说清楚它带来了什么收益。</p>
    </article>
    <article style="padding:26px;border-radius:18px;border:${LINE};background:#11131b">
      <div style="width:38px;height:38px;border-radius:12px;margin-bottom:16px;display:flex;align-items:center;justify-content:center;background:rgba(244,114,182,.14);border:1px solid rgba(244,114,182,.3);font-size:18px">◇</div>
      <h3 style="margin:0 0 8px;font-size:17px;color:#f4f5f7">特性三</h3>
      <p style="margin:0;color:${MUTED};font-size:14px;line-height:1.7">用一句话说清楚它为什么值得信任。</p>
    </article>
  </div>
</section>`,
  },
  {
    id: "cta-banner",
    label: "行动号召",
    category: "布局",
    media: svg('<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 12h6"/>'),
    content: `<section style="max-width:1120px;margin:0 auto;padding:56px 28px">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:28px;padding:40px;border-radius:24px;border:1px solid rgba(124,92,255,.28);background:radial-gradient(120% 160% at 0% 0%,rgba(124,92,255,.24),transparent 55%),#11131b">
    <div>
      <h2 style="margin:0 0 8px;font-size:28px;letter-spacing:-.02em;color:#f4f5f7">准备好了吗？</h2>
      <p style="margin:0;color:${MUTED};font-size:14.5px">一句话说明下一步行动。</p>
    </div>
    <a href="#" style="padding:12px 22px;border-radius:12px;background:${BRAND};color:#0b0714;font-weight:700;font-size:14px;text-decoration:none;white-space:nowrap">立即开始</a>
  </div>
</section>`,
  },
  {
    id: "heading",
    label: "标题",
    category: "文本",
    media: svg('<path d="M5 6v12M12 6v12M5 12h7M17 9h2v9"/>'),
    content: `<h2 style="margin:0 0 16px;color:#f4f5f7;font-size:34px;line-height:1.25;letter-spacing:-.02em;max-width:720px">在这里写一个标题</h2>`,
  },
  {
    id: "paragraph",
    label: "段落",
    category: "文本",
    media: svg('<path d="M4 6h16M4 11h16M4 16h10"/>'),
    content: `<p style="margin:0 0 16px;color:${MUTED};font-size:15.5px;line-height:1.8;max-width:640px">在这里写一段正文。把话说完，不要留半句。好的文案通常比它看上去的要短。</p>`,
  },
  {
    id: "quote",
    label: "引用",
    category: "文本",
    media: svg('<path d="M9 7H5v6h4v-2H7c0-1.5.5-2.5 2-3zM19 7h-4v6h4v-2h-2c0-1.5.5-2.5 2-3z"/>'),
    content: `<blockquote style="margin:0;padding:22px 26px;border-left:2px solid #7c5cff;color:${MUTED};font-size:16.5px;line-height:1.8;max-width:680px">一句值得被引用的话，通常只需要一行。</blockquote>`,
  },
  {
    id: "button",
    label: "按钮",
    category: "基础",
    media: svg('<rect x="3" y="8" width="18" height="8" rx="4"/>'),
    content: `<a href="#" style="display:inline-flex;align-items:center;justify-content:center;padding:11px 22px;border-radius:12px;background:${BRAND};color:#0b0714;font-weight:600;font-size:14px;text-decoration:none">按钮文字</a>`,
  },
  {
    id: "badge",
    label: "徽章",
    category: "基础",
    media: svg('<rect x="4" y="9" width="16" height="6" rx="3"/>'),
    content: `<span style="display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;border:1px solid rgba(124,92,255,.35);background:rgba(124,92,255,.12);color:#c9bdff;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase">New</span>`,
  },
  {
    id: "divider",
    label: "分隔线",
    category: "基础",
    media: svg('<path d="M4 12h16"/>'),
    content: `<div style="height:1px;background:rgba(255,255,255,.12);margin:32px 0"></div>`,
  },
  {
    id: "panel",
    label: "内容卡片",
    category: "基础",
    media: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 9h10M7 13h6"/>'),
    content: `<div style="padding:28px;border-radius:18px;border:${LINE};background:#11131b;max-width:520px">
  <h3 style="margin:0 0 10px;color:#f4f5f7;font-size:18px">卡片标题</h3>
  <p style="margin:0;color:${MUTED};font-size:14.5px;line-height:1.7">卡片里的说明文字。用来承载一组相关信息。</p>
</div>`,
  },
];

export function createEditor({ container, blocksEl, layersEl, stylesEl, traitsEl, onUpdate, onSelect, onDeselect }) {
  const editor = grapesjs.init({
    container,
    height: "100%",
    width: "100%",
    fromElement: false,
    storageManager: false,
    panels: { defaults: [] },
    showOffsets: true,
    noticeOnUnload: false,
    undoManager: { trackSelection: true },
    deviceManager: {
      devices: [
        { id: "desktop", name: "桌面", width: "" },
        { id: "tablet", name: "平板", width: "834px", widthMedia: "992px" },
        { id: "mobile", name: "手机", width: "390px", widthMedia: "575px" },
      ],
    },
    selectorManager: { componentFirst: true },
    canvas: { styles: [], scripts: [] },
    blockManager: {
      appendTo: blocksEl,
      blocks: BLOCKS,
    },
    layerManager: { appendTo: layersEl },
    traitManager: { appendTo: traitsEl },
    styleManager: { 
      appendTo: stylesEl,
      sectors: [
        {
          name: "布局",
          open: true,
          properties: [
            "display",
            "flex-direction",
            "justify-content",
            "align-items",
            "gap",
            "grid-template-columns",
            "width",
            "max-width",
            "height",
            "min-height",
            "margin",
            "padding",
          ],
        },
        {
          name: "排版",
          open: true,
          properties: [
            "font-family",
            "font-size",
            "font-weight",
            "line-height",
            "letter-spacing",
            "text-align",
            "text-transform",
            "color",
          ],
        },
        {
          name: "外观",
          open: false,
          properties: [
            "background-color",
            "background-image",
            "background-size",
            "background-position",
            "border",
            "border-radius",
            "box-shadow",
            "opacity",
          ],
        },
        {
          name: "定位",
          open: false,
          properties: ["position", "top", "right", "bottom", "left", "z-index", "overflow"],
        },
      ],
    },
  });

  editor.on("update", () => onUpdate?.());
  editor.on("component:selected", (component) => onSelect?.(component));
  editor.on("component:deselected", () => onDeselect?.());
  editor.on("canvas:frame:load", () => onSelect?.(editor.getSelected()));

  return editor;
}

/** 把页面 head 里的字体/meta 同步进画布 iframe（画布只渲染 body）。 */
export function syncCanvasHead(editor, head) {
  const doc = editor.Canvas.getDocument();
  if (!doc) return;
  doc.querySelectorAll("[data-pi-head]").forEach((node) => node.remove());
  if (!head) return;

  const template = doc.createElement("template");
  template.innerHTML = head;
  for (const node of Array.from(template.content.children)) {
    if (!["LINK", "META", "TITLE", "SCRIPT"].includes(node.tagName)) continue;
    const clone = node.cloneNode(true);
    clone.setAttribute("data-pi-head", "1");
    doc.head.appendChild(clone);
  }
}

/**
 * 载入页面到画布。
 * CSS 不走 editor.setStyle（会丢 var() / 简写），而是解析成规则对象后用 setRule 写入。
 * @returns {string[]} 暂不参与编辑的 at-rule（@font-face/@keyframes...），导出时补回
 */
export function setCanvasContent(editor, { body, css }) {
  editor.setComponents(body || '<section style="padding:80px;text-align:center;color:#8b93a3">空页面</section>');

  const { rules, rawAtRules } = parseCss(css);
  editor.Css.clear();
  for (const rule of rules) {
    const opts = rule.atRule
      ? { atRuleType: rule.atRule.type, atRuleParams: rule.atRule.params }
      : undefined;
    try {
      editor.Css.setRule(rule.selectors, rule.style, opts);
    } catch {
      /* 极端选择器解析失败时跳过，避免整页载入中断 */
    }
  }
  return rawAtRules;
}

export function canvasScroll(editor) {
  try {
    return editor.Canvas.getBody()?.scrollTop || 0;
  } catch {
    return 0;
  }
}

export function restoreCanvasScroll(editor, top) {
  requestAnimationFrame(() => {
    try {
      const body = editor.Canvas.getBody();
      if (body) body.scrollTop = top;
    } catch {
      /* 画布可能还没准备好 */
    }
  });
}

export function findComponent(editor, selector) {
  if (!selector) return null;
  try {
    return editor.getWrapper()?.find(selector)?.[0] || null;
  } catch {
    return null;
  }
}
