export const welcomeHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Revvie API</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #080808;
      --primary: #e50000;
      --teal: #0091ff;
      --green: #7dff00;
    }
    
    body {
      font-family: 'Josefin Sans', sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background-color: var(--bg);
      background-image: 
        radial-gradient(circle at 15% 50%, rgba(229, 0, 0, 0.05), transparent 25%),
        radial-gradient(circle at 85% 30%, rgba(0, 145, 255, 0.05), transparent 25%);
      color: #ffffff;
      overflow: hidden;
    }
    
    .container {
      text-align: center;
      padding: 3rem;
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 24px;
      background: rgba(17, 17, 17, 0.6);
      backdrop-filter: blur(12px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05);
      max-width: 450px;
      width: 90%;
      position: relative;
      animation: floatUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      transform: translateY(20px);
      opacity: 0;
    }

    @keyframes floatUp {
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }
    
    h1 {
      color: var(--primary);
      margin: 0 0 0.5rem 0;
      font-size: 3.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      text-transform: uppercase;
      text-shadow: 0 0 20px rgba(229, 0, 0, 0.3);
    }
    
    p {
      color: #888;
      font-size: 1.15rem;
      margin-bottom: 0;
      line-height: 1.5;
    }
    
    .status-wrapper {
      margin: 2rem 0;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.6rem 1.25rem;
      border-radius: 9999px;
      background-color: rgba(125, 255, 0, 0.08);
      border: 1px solid rgba(125, 255, 0, 0.2);
      color: var(--green);
      font-weight: 600;
      font-size: 0.95rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    
    .dot {
      display: block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--green);
      box-shadow: 0 0 12px var(--green);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(125, 255, 0, 0.4); }
      70% { box-shadow: 0 0 0 8px rgba(125, 255, 0, 0); }
      100% { box-shadow: 0 0 0 0 rgba(125, 255, 0, 0); }
    }
    
    .links {
      margin-top: 2.5rem;
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
    }
    
    a {
      color: var(--teal);
      text-decoration: none;
      font-weight: 600;
      padding: 0.85rem 1.5rem;
      border: 1px solid rgba(0, 145, 255, 0.2);
      border-radius: 12px;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      background-color: rgba(0, 145, 255, 0.03);
      position: relative;
      overflow: hidden;
    }
    
    a:hover {
      background-color: rgba(0, 145, 255, 0.1);
      border-color: var(--teal);
      transform: translateY(-2px);
      box-shadow: 0 4px 15px rgba(0, 145, 255, 0.15);
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Revvie</h1>
    <p>Core API Services</p>
    
    <div class="status-wrapper">
      <div class="status">
        <span class="dot"></span>
        Operational
      </div>
    </div>

    <div class="links">
      <a href="/health">System Health</a>
      <a href="/api-docs">API Reference</a>
    </div>
  </div>
</body>
</html>
`;