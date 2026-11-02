/**
 * 画布内的 Mermaid 渲染。
 *
 * 页面里保存的是普通的 <pre class="mermaid">源码</pre>（AI 和人都能直接改），
 * 画布中则由 mermaid 运行时把它渲染成 SVG。运行时脚本按需注入画布 iframe：
 *  - 本地开发不依赖外网（脚本来自 /vendor/mermaid）
 *  - 保存的页面使用 CDN 脚本，导出的 HTML 可独立打开
 */

let loader = null;
let sequence = 0;

/** 画布 iframe 被重建时调用，下次渲染重新注入运行时。 */
export function resetMermaid() {
  loader = null;
}

export function ensureMermaid(editor) {
  const frame = editor.Canvas.getFrameEl();
  const win = frame?.contentWindow;
  if (!win) return Promise.reject(new Error("画布尚未就绪"));
  if (win.mermaid) return Promise.resolve(win.mermaid);
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const doc = win.document;
    const existing = doc.querySelector("script[data-pi-mermaid-runtime]");

    if (!doc.querySelector("style[data-pi-mermaid-style]")) {
      const style = doc.createElement("style");
      style.setAttribute("data-pi-mermaid-style", "1");
      style.textContent = `
        pre.mermaid { background: transparent; text-align: center; margin: 0; overflow-x: auto; }
        pre.mermaid svg { max-width: 100%; height: auto; }
        pre.mermaid:not([data-processed]) { color: #8b93a3; font-size: 12px; }
        .mermaid-error { color: #fb7185; font-size: 12px; }
      `;
      doc.head.appendChild(style);
    }

    const finish = () => {
      try {
        win.mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "loose",
          fontFamily: "Inter, Noto Sans SC, system-ui, sans-serif",
        });
        resolve(win.mermaid);
      } catch (error) {
        reject(error);
      }
    };

    if (win.mermaid) {
      finish();
      return;
    }

    const script = existing || doc.createElement("script");
    script.setAttribute("data-pi-mermaid-runtime", "1");
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("Mermaid 运行时加载失败")), { once: true });
    if (!existing) {
      script.src = "/vendor/mermaid/mermaid.min.js";
      doc.head.appendChild(script);
    }
  });

  return loader;
}

/** 把一段 Mermaid 源码渲染进指定元素。 */
export async function renderMermaid(editor, element, source) {
  const code = String(source || "").trim();
  if (!code) {
    element.textContent = "（空 Mermaid 图表）";
    return;
  }

  const mermaid = await ensureMermaid(editor);
  const id = `pi-mermaid-${Date.now().toString(36)}-${sequence++}`;
  const { svg } = await mermaid.render(id, code);
  element.innerHTML = svg;
  element.setAttribute("data-processed", "true");
}
