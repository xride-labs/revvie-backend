export const welcomeHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Revvie Core API</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #030305;
      --bg-glass: rgba(10, 10, 15, 0.4);
      --border: rgba(255, 255, 255, 0.08);
      --accent: #E50000;
      --accent-glow: rgba(229, 0, 0, 0.5);
      --text-main: #FFFFFF;
      --text-muted: #8A8F98;
      --status-ok: #00FF88;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background-color: var(--bg);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
      position: relative;
    }

    /* Dynamic mesh gradient background */
    .bg-mesh {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      z-index: 0;
      background: radial-gradient(circle at 15% 50%, rgba(229, 0, 0, 0.08), transparent 40%),
                  radial-gradient(circle at 85% 30%, rgba(0, 145, 255, 0.08), transparent 40%),
                  radial-gradient(circle at 50% 100%, rgba(0, 255, 136, 0.05), transparent 40%);
      filter: blur(60px);
      animation: breathe 10s ease-in-out infinite alternate;
    }

    @keyframes breathe {
      0% { transform: scale(1); opacity: 0.8; }
      100% { transform: scale(1.1); opacity: 1; }
    }
    
    .container {
      position: relative;
      z-index: 1;
      text-align: center;
      padding: 3.5rem;
      border: 1px solid var(--border);
      border-radius: 32px;
      background: var(--bg-glass);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.1);
      max-width: 480px;
      width: 90%;
      animation: floatUp 1s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      transform: translateY(30px);
      opacity: 0;
    }

    @keyframes floatUp {
      to { transform: translateY(0); opacity: 1; }
    }
    
    .logo-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      border-radius: 20px;
      background: linear-gradient(135deg, rgba(229, 0, 0, 0.2), rgba(229, 0, 0, 0.05));
      border: 1px solid rgba(229, 0, 0, 0.3);
      box-shadow: 0 0 32px var(--accent-glow);
      margin-bottom: 1.5rem;
    }

    .logo-badge svg {
      width: 32px;
      height: 32px;
      fill: var(--accent);
    }
    
    h1 {
      margin: 0 0 0.5rem 0;
      font-size: 2.75rem;
      font-weight: 800;
      letter-spacing: -0.04em;
      background: linear-gradient(180deg, #FFFFFF 0%, rgba(255, 255, 255, 0.7) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    
    p.subtitle {
      color: var(--text-muted);
      font-size: 1.125rem;
      font-weight: 500;
      letter-spacing: -0.01em;
      margin-bottom: 2.5rem;
    }
    
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.5rem 1rem 0.5rem 0.75rem;
      border-radius: 100px;
      background: rgba(0, 255, 136, 0.08);
      border: 1px solid rgba(0, 255, 136, 0.2);
      color: var(--status-ok);
      font-weight: 600;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 2.5rem;
      transition: all 0.3s ease;
    }
    
    .status-badge:hover {
      background: rgba(0, 255, 136, 0.12);
      border-color: rgba(0, 255, 136, 0.3);
      box-shadow: 0 0 20px rgba(0, 255, 136, 0.1);
    }
    
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--status-ok);
      box-shadow: 0 0 8px var(--status-ok);
      animation: pulse-animation 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }

    @keyframes pulse-animation {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); box-shadow: 0 0 16px var(--status-ok); }
    }
    
    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }
    
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--text-main);
      text-decoration: none;
      font-weight: 600;
      font-size: 0.95rem;
      padding: 1rem 1.5rem;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.03);
      transition: all 0.2s ease;
    }
    
    .btn:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.2);
      transform: translateY(-2px);
    }
    
    .btn-primary {
      background: var(--accent);
      border-color: var(--accent);
      color: white;
    }
    
    .btn-primary:hover {
      background: #ff1a1a;
      border-color: #ff1a1a;
      box-shadow: 0 8px 24px var(--accent-glow);
    }
  </style>
</head>
<body>
  <div class="bg-mesh"></div>
  
  <div class="container">
    <div class="logo-badge">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 15.5C4 17.433 5.567 19 7.5 19C9.433 19 11 17.433 11 15.5C11 13.567 9.433 12 7.5 12C5.567 12 4 13.567 4 15.5ZM7.5 13.5C8.60457 13.5 9.5 14.3954 9.5 15.5C9.5 16.6046 8.60457 17.5 7.5 17.5C6.39543 17.5 5.5 16.6046 5.5 15.5C5.5 14.3954 6.39543 13.5 7.5 13.5Z"/>
        <path d="M13 15.5C13 17.433 14.567 19 16.5 19C18.433 19 20 17.433 20 15.5C20 13.567 18.433 12 16.5 12C14.567 12 13 13.567 13 15.5ZM16.5 13.5C17.6046 13.5 18.5 14.3954 18.5 15.5C18.5 16.6046 17.6046 17.5 16.5 17.5C15.3954 17.5 14.5 16.6046 14.5 15.5C14.5 14.3954 15.3954 13.5 16.5 13.5Z"/>
        <path d="M10 7L13.5 12H16.5L14 6.5C13.5 5.5 12.5 5 11.5 5H6V6.5H11.5L10 9H6.5C5.5 9 4.7 9.6 4.3 10.5L3.5 12.5H5L5.5 10.5H10V7Z"/>
      </svg>
    </div>
    
    <h1>Revvie</h1>
    <p class="subtitle">Core API Infrastructure</p>
    
    <div class="status-badge">
      <span class="pulse-dot"></span>
      All Systems Operational
    </div>
    
    <div class="actions">
      <a href="/health" class="btn">System Health</a>
      <a href="/api-docs" class="btn btn-primary">API Reference</a>
    </div>
  </div>
</body>
</html>
`;