export const welcomeHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark light">
  <title>Revvie API</title>
  <style>
    :root {
      --bg: #0c0c0d;
      --text: #e8e8ea;
      --muted: #85858c;
      --line: #1f1f22;
      --accent: #ff1d2d;
      --ok: #3ecf8e;
      --warn: #e5a50a;
    }
    @media (prefers-color-scheme: light) {
      :root { --bg: #fafafa; --text: #18181b; --muted: #70707a; --line: #e6e6e9; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: var(--bg);
      color: var(--text);
      font: 15px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    main { width: 100%; max-width: 360px; }
    h1 { font-size: 15px; font-weight: 600; letter-spacing: 0.01em; }
    h1 span { color: var(--accent); }
    p { margin-top: 6px; color: var(--muted); }
    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 28px;
      padding-top: 16px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 13px;
    }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
    .status[data-state="ok"] .dot { background: var(--ok); }
    .status[data-state="warn"] .dot { background: var(--warn); }
    nav { display: flex; gap: 20px; margin-top: 16px; font-size: 13px; }
    a { color: var(--text); text-decoration: none; border-bottom: 1px solid var(--line); padding-bottom: 1px; }
    a:hover { border-color: var(--muted); }
    a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  </style>
</head>
<body>
  <main>
    <h1>Revvie<span>.</span> API</h1>
    <p>Backend for the Revvie rider app and web.</p>

    <div class="status" id="status" data-state="">
      <span class="dot"></span>
      <span id="status-text">Checking status…</span>
    </div>

    <nav>
      <a href="/api-docs">Reference</a>
      <a href="/api-docs.json">OpenAPI</a>
      <a href="/health">Health</a>
    </nav>
  </main>

  <script>
    // Reflect the real health check instead of claiming everything is fine.
    fetch("/health", { headers: { accept: "application/json" } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        var s = (res.body && res.body.status) || (res.ok ? "ok" : "down");
        var el = document.getElementById("status");
        var text = document.getElementById("status-text");
        if (s === "ok") { el.dataset.state = "ok"; text.textContent = "Operational"; }
        else if (s === "degraded") { el.dataset.state = "warn"; text.textContent = "Degraded"; }
        else { el.dataset.state = "warn"; text.textContent = "Unavailable"; }
      })
      .catch(function () { document.getElementById("status-text").textContent = "Status unavailable"; });
  </script>
</body>
</html>
`;
