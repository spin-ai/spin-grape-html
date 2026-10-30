/**
 * 从 URL 导入页面。
 *
 * 目标不是做一个通用爬虫，而是把“外部页面”变成画布可编辑的本地页面：
 *  - 移除 <script>（避免远端脚本接管画布，也避免 CSP 冲突）
 *  - 把相对 URL 改成绝对 URL（图片、字体、样式表还能正常显示）
 *  - 限制大小与超时，失败时给出可读的错误
 */

const MAX_BYTES = 6 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 PiCanvas/1.0";

const SKIP_URL = /^(#|data:|blob:|javascript:|mailto:|tel:|about:)/i;

export function validateUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    throw Object.assign(new Error("URL 格式不正确，需要以 http:// 或 https:// 开头"), { status: 400 });
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw Object.assign(new Error("只支持 http / https 地址"), { status: 400 });
  }
  return url;
}

/** 由 URL 生成合法的页面文件名，例如 https://example.com/pricing → example-com-pricing.html */
export function slugForUrl(url) {
  const base = `${url.hostname}${url.pathname}`
    .toLowerCase()
    .replace(/\/+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "imported-page"}.html`;
}

function absolutizeAttributeValues(html, base) {
  return html
    .replace(
      /\b(href|src|poster|action|data-src|data-bg)=(["'])([^"']*)\2/gi,
      (match, attr, quote, value) => {
        if (!value || SKIP_URL.test(value)) return match;
        try {
          return `${attr}=${quote}${new URL(value, base).href}${quote}`;
        } catch {
          return match;
        }
      },
    )
    .replace(/\bsrcset=(["'])([^"']*)\1/gi, (match, quote, value) => {
      const next = value
        .split(",")
        .map((part) => {
          const [candidate, ...descriptor] = part.trim().split(/\s+/);
          if (!candidate || SKIP_URL.test(candidate)) return part.trim();
          try {
            return [new URL(candidate, base).href, ...descriptor].join(" ");
          } catch {
            return part.trim();
          }
        })
        .filter(Boolean)
        .join(", ");
      return `srcset=${quote}${next}${quote}`;
    });
}

function absolutizeCssUrls(css, base) {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, value) => {
    if (!value || SKIP_URL.test(value)) return match;
    try {
      return `url(${quote}${new URL(value, base).href}${quote})`;
    } catch {
      return match;
    }
  });
}

export function normalizeImportedHtml(raw, base) {
  const warnings = [];
  let html = raw;

  const scriptCount = (html.match(/<script\b/gi) || []).length;
  if (scriptCount) {
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    warnings.push(`移除了 ${scriptCount} 个 <script>（远端脚本不会在画布中执行）`);
  }

  const cspCount = (html.match(/http-equiv=["']?content-security-policy/gi) || []).length;
  if (cspCount) {
    html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "");
    warnings.push("移除了 CSP meta 标签");
  }

  html = html.replace(/<base\b[^>]*>/gi, "");

  // style 块里的相对 url() 也要绝对化
  html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_match, attrs, css) => {
    return `<style${attrs}>${absolutizeCssUrls(css, base)}</style>`;
  });

  // 内联 style="..." 里的 url()
  html = html.replace(/\bstyle=(["'])([^"']*)\1/gi, (match, quote, css) => {
    return `style=${quote}${absolutizeCssUrls(css, base)}${quote}`;
  });

  html = absolutizeAttributeValues(html, base);

  // SRI 会阻止资源加载（我们可能改写了 URL 或跨域）
  html = html.replace(/\s+integrity=(["'])[^"']*\1/gi, "");

  return { html, warnings };
}

export async function fetchRemotePage(rawUrl, { fetchImpl = fetch } = {}) {
  const url = validateUrl(rawUrl);
  let response;
  try {
    response = await fetchImpl(url, {
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const message = error?.name === "TimeoutError" ? `请求超时（>${TIMEOUT_MS / 1000}s）` : error.message;
    throw Object.assign(new Error(`抓取失败：${message}`), { status: 502 });
  }

  if (!response.ok) {
    throw Object.assign(new Error(`目标站点返回 ${response.status} ${response.statusText}`), { status: 502 });
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType && !/text\/html|application\/xhtml|text\/plain|application\/xml/i.test(contentType)) {
    throw Object.assign(new Error(`该 URL 不是 HTML 页面（Content-Type: ${contentType}）`), { status: 415 });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    throw Object.assign(new Error(`页面过大（${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB，上限 6 MB）`), {
      status: 413,
    });
  }

  const raw = buffer.toString("utf8");
  const finalUrl = response.url || url.href;
  const { html, warnings } = normalizeImportedHtml(raw, finalUrl);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() || url.hostname;

  if (!/<body\b/i.test(html)) {
    warnings.push("页面没有 <body>，可能依赖前端渲染，导入结果可能不完整");
  }

  return {
    url: finalUrl,
    title,
    html,
    warnings,
    bytes: buffer.byteLength,
  };
}
