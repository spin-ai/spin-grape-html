/**
 * 初始工作区模板。可以直接在画布上改，也可以让 Pi 改。
 * 约定：整页样式放在 <style> 里，页面结构放在 <body> 里，不依赖构建工具。
 */

export const DEFAULT_PAGES = {
  "index.html": `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Nebula · 让想法立刻上线</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #08090d;
    --surface: #11131b;
    --surface-2: #171a25;
    --line: rgba(255, 255, 255, 0.08);
    --text: #f4f5f7;
    --muted: #9aa3b2;
    --accent: #7c5cff;
    --accent-2: #22d3ee;
    --radius: 18px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: "Inter", "Noto Sans SC", system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; text-decoration: none; }
  .page { max-width: 1120px; margin: 0 auto; padding: 0 28px; }

  .nav { display: flex; align-items: center; justify-content: space-between; padding: 26px 0; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: 0.02em; }
  .brand-mark {
    width: 30px; height: 30px; border-radius: 9px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    box-shadow: 0 6px 20px rgba(124, 92, 255, 0.45);
  }
  .nav-links { display: flex; align-items: center; gap: 28px; color: var(--muted); font-size: 14px; }
  .nav-links a:hover { color: var(--text); }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    border: 1px solid transparent; border-radius: 12px; padding: 11px 20px;
    font-size: 14px; font-weight: 600; cursor: pointer; transition: transform 0.15s ease, box-shadow 0.2s ease;
  }
  .btn:hover { transform: translateY(-1px); }
  .btn-primary {
    color: #0b0714;
    background: linear-gradient(135deg, #a78bfa, #22d3ee);
    box-shadow: 0 10px 30px rgba(124, 92, 255, 0.35);
  }
  .btn-ghost { color: var(--text); border-color: var(--line); background: rgba(255, 255, 255, 0.03); }

  .hero { position: relative; padding: 96px 0 72px; text-align: center; overflow: hidden; }
  .hero-glow {
    position: absolute; inset: -140px 50% auto 50%; width: 720px; height: 720px;
    transform: translateX(-50%);
    background: radial-gradient(circle at center, rgba(124, 92, 255, 0.28), transparent 62%);
    pointer-events: none;
  }
  .badge {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 6px 14px; border-radius: 999px;
    border: 1px solid rgba(124, 92, 255, 0.35);
    background: rgba(124, 92, 255, 0.12);
    color: #c9bdff; font-size: 12.5px; letter-spacing: 0.06em; text-transform: uppercase;
  }
  .hero h1 {
    position: relative;
    margin: 26px auto 20px; max-width: 820px;
    font-size: 62px; line-height: 1.08; letter-spacing: -0.03em; font-weight: 800;
  }
  .hero h1 em {
    font-style: normal;
    background: linear-gradient(110deg, #c4b5fd 10%, #22d3ee 90%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .hero p { max-width: 560px; margin: 0 auto 34px; color: var(--muted); font-size: 17px; line-height: 1.7; }
  .hero-actions { display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; }
  .stats { display: flex; justify-content: center; gap: 56px; margin-top: 64px; flex-wrap: wrap; }
  .stat strong { display: block; font-size: 30px; letter-spacing: -0.02em; }
  .stat span { color: var(--muted); font-size: 13px; }

  .section { padding: 84px 0; }
  .section-head { max-width: 620px; margin-bottom: 42px; }
  .eyebrow { color: var(--accent-2); font-size: 13px; letter-spacing: 0.16em; text-transform: uppercase; }
  .section-head h2 { margin: 12px 0 14px; font-size: 38px; line-height: 1.2; letter-spacing: -0.02em; }
  .section-head p { margin: 0; color: var(--muted); line-height: 1.7; }

  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .card {
    padding: 28px; border-radius: var(--radius);
    border: 1px solid var(--line); background: linear-gradient(180deg, var(--surface), rgba(17, 19, 27, 0.55));
    transition: border-color 0.2s ease, transform 0.2s ease;
  }
  .card:hover { border-color: rgba(124, 92, 255, 0.45); transform: translateY(-3px); }
  .card-icon {
    width: 40px; height: 40px; border-radius: 12px; margin-bottom: 18px;
    display: grid; place-items: center; font-size: 19px;
    background: rgba(124, 92, 255, 0.16); border: 1px solid rgba(124, 92, 255, 0.3);
  }
  .card h3 { margin: 0 0 10px; font-size: 18px; }
  .card p { margin: 0; color: var(--muted); font-size: 14.5px; line-height: 1.7; }

  .cta {
    display: flex; align-items: center; justify-content: space-between; gap: 32px;
    padding: 44px; border-radius: 24px;
    border: 1px solid rgba(124, 92, 255, 0.28);
    background: radial-gradient(120% 160% at 0% 0%, rgba(124, 92, 255, 0.22), transparent 55%), var(--surface);
  }
  .cta h2 { margin: 0 0 10px; font-size: 30px; letter-spacing: -0.02em; }
  .cta p { margin: 0; color: var(--muted); }

  .footer { border-top: 1px solid var(--line); padding: 34px 0 46px; color: var(--muted); font-size: 13px; }
  .footer-row { display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap; }

  @media (max-width: 900px) {
    .grid { grid-template-columns: 1fr; }
    .hero h1 { font-size: 42px; }
    .cta { flex-direction: column; align-items: flex-start; }
  }
</style>
</head>
<body>
  <div class="page">
    <header class="nav">
      <div class="brand"><span class="brand-mark"></span><span class="brand-name">Nebula</span></div>
      <nav class="nav-links">
        <a href="#features">产品能力</a>
        <a href="#workflow">工作流</a>
        <a href="about.html">关于我们</a>
      </nav>
      <a class="btn btn-ghost" href="#start">开始使用</a>
    </header>

    <section id="hero" class="hero">
      <div class="hero-glow"></div>
      <span class="badge">AI-native 设计工作流</span>
      <h1>把想法说出来，<br /><em>页面就已经在那里了</em></h1>
      <p>在画布上选中任意元素，用一句话描述你想改什么。Pi 会读懂 DOM 上下文，直接改写源文件，画布实时刷新。</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="#start">免费开始</a>
        <a class="btn btn-ghost" href="#features">看看怎么用</a>
      </div>
      <div class="stats">
        <div class="stat"><strong>3.4×</strong><span>平均出稿速度提升</span></div>
        <div class="stat"><strong>12s</strong><span>从选中到改完</span></div>
        <div class="stat"><strong>0</strong><span>需要记住的 CSS 语法</span></div>
      </div>
    </section>

    <section id="features" class="section">
      <div class="section-head">
        <span class="eyebrow">Features</span>
        <h2>选中即改，指哪打哪</h2>
        <p>可视化画布负责“指哪”，Pi Agent 负责“打哪”。你只需要描述结果，不用关心选择器和属性名。</p>
      </div>
      <div class="grid">
        <article class="card">
          <div class="card-icon">🎯</div>
          <h3>精准上下文</h3>
          <p>选中元素的选择器、外层 HTML、计算样式会一起交给模型，改的永远是你指的那一块。</p>
        </article>
        <article class="card">
          <div class="card-icon">🪄</div>
          <h3>最小 diff</h3>
          <p>Pi 只做局部改写，保留 id 与 class 锚点，不会把你的页面重排成不可维护的一坨。</p>
        </article>
        <article class="card">
          <div class="card-icon">🕘</div>
          <h3>可回退</h3>
          <p>每次让 AI 动手前自动快照，任何一次改动都能一键恢复，画布随即同步。</p>
        </article>
      </div>
    </section>

    <section id="workflow" class="section">
      <div class="cta" id="start">
        <div>
          <h2>现在选一个元素试试</h2>
          <p>点击画布上的任意标题、按钮或卡片，然后描述你想要的修改。</p>
        </div>
        <a class="btn btn-primary" href="#features">开始编辑</a>
      </div>
    </section>

    <footer class="footer">
      <div class="footer-row">
        <span>© 2025 Nebula Studio · 由 GrapesJS 与 Pi Agent 驱动</span>
        <span>Made with 🧠 + 🎨</span>
      </div>
    </footer>
  </div>
</body>
</html>
`,

  "about.html": `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>关于 Nebula</title>
<style>
  :root { --bg: #08090d; --surface: #11131b; --line: rgba(255,255,255,0.08); --text: #f4f5f7; --muted: #9aa3b2; --accent: #7c5cff; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: "Inter", "Noto Sans SC", system-ui, sans-serif; }
  .page { max-width: 900px; margin: 0 auto; padding: 80px 28px; }
  .back { color: var(--muted); font-size: 14px; text-decoration: none; }
  h1 { font-size: 48px; letter-spacing: -0.03em; margin: 26px 0 18px; }
  .lede { color: var(--muted); font-size: 18px; line-height: 1.75; max-width: 640px; }
  .team { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 56px; }
  .person { padding: 24px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }
  .avatar { width: 46px; height: 46px; border-radius: 50%; margin-bottom: 14px; background: linear-gradient(135deg, #a78bfa, #22d3ee); }
  .person h3 { margin: 0 0 4px; font-size: 16px; }
  .person p { margin: 0; color: var(--muted); font-size: 13.5px; }
  .quote { margin-top: 64px; padding: 30px; border-left: 2px solid var(--accent); color: var(--muted); font-size: 17px; line-height: 1.8; }
  .diagram { margin-top: 64px; }
  .diagram h2 { margin: 0 0 18px; font-size: 26px; letter-spacing: -0.02em; }
  pre.mermaid {
    margin: 0; padding: 24px; text-align: center; overflow-x: auto;
    background: #11131b; border: 1px solid var(--line); border-radius: 16px;
  }
  pre.mermaid svg { max-width: 100%; height: auto; }
</style>
</head>
<body>
  <div class="page">
    <a class="back" href="index.html">← 返回首页</a>
    <h1>关于 Nebula</h1>
    <p class="lede">我们相信设计工具不该让人先学会写代码。Nebula 把可视化画布和语言模型接在一起，让“说出想法”成为最自然的编辑方式。</p>

    <div class="team">
      <article class="person"><div class="avatar"></div><h3>林可</h3><p>联合创始人 · 设计</p></article>
      <article class="person"><div class="avatar"></div><h3>周野</h3><p>联合创始人 · 工程</p></article>
      <article class="person"><div class="avatar"></div><h3>沈一</h3><p>产品 · 增长</p></article>
    </div>

    <div class="quote">“最好的界面是没有界面的——只要你描述得足够清楚，工具就该自己让开。”</div>

    <section class="diagram">
      <h2>它是怎么工作的</h2>
      <pre class="mermaid">flowchart LR
  UI["GrapesJS 画布"] -->|"选区 + 指令"| BR["ui-context 桥接"]
  BR --> PI["Pi RPC 会话"]
  PI -->|"read / edit"| FS["页面源文件"]
  FS --> WATCH["文件监听"]
  WATCH -->|"SSE 通知"| UI</pre>
    </section>
  </div>
</body>
</html>
`,
};

export const DEFAULT_AGENTS_MD = `# 编辑约定

- 页面是纯静态 HTML + 内联 <style>，不要引入构建步骤。
- 保持 id / class 稳定，画布依赖它们定位元素。
- 中文文案，语气克制，不使用营销感叹号。
`;
