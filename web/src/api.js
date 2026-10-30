/** 与本地服务通信的薄封装。 */

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export const api = {
  state: () => request("/api/state"),
  chat: () => request("/api/chat"),
  pages: () => request("/api/pages"),
  page: (name) => request(`/api/page/${encodeURIComponent(name)}`),
  savePage: (name, html) =>
    request(`/api/page/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify({ html }),
    }),
  snapshot: (name, label) =>
    request(`/api/page/${encodeURIComponent(name)}/snapshot`, {
      method: "POST",
      body: JSON.stringify({ label }),
    }),
  versions: (name) => request(`/api/page/${encodeURIComponent(name)}/versions`),
  version: (name, id) => request(`/api/page/${encodeURIComponent(name)}/versions/${id}`),
  restore: (name, id) =>
    request(`/api/page/${encodeURIComponent(name)}/restore`, {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  prompt: (payload) =>
    request("/api/prompt", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  abort: () => request("/api/abort", { method: "POST" }),
  reset: () => request("/api/session/reset", { method: "POST" }),
  restart: () => request("/api/pi/restart", { method: "POST" }),
  reportCanvas: (payload) =>
    request("/api/canvas/state", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

/** 订阅服务端事件流；返回一个关闭函数。 */
export function connectEvents({ onEvent, onOpen, onError } = {}) {
  const source = new EventSource("/api/events");

  source.onopen = () => onOpen?.();
  source.onerror = () => onError?.(source.readyState);
  source.onmessage = (message) => {
    if (!message.data) return;
    try {
      onEvent?.(JSON.parse(message.data));
    } catch {
      /* 忽略坏帧 */
    }
  };

  return () => source.close();
}
