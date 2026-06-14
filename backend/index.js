const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Endpoints on the S2S backend
const IBAS_LOGIN_URL = "https://ibas.s2s.ph/api/admin-login";
const IBAS_SESSION_URL = "https://ibas.s2s.ph/api/session";
const IBAS_OLT_LIST_URL = "https://ibas.s2s.ph/api/olt-list";
const SSH_SESSION_ID_URL = "https://ms-ssh-service.s2s.ph/api/config-session-id";
const WS_SSH_URL = "wss://ms-ssh-service.s2s.ph";

// API: Login proxy
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ status: false, message: "Username and password are required" });
    }

    const response = await fetch(IBAS_LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ status: false, message: `S2S login returned code ${response.status}: ${errText}` });
    }

    const data = await response.json();
    return res.json(data);
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

// API: Session verification check proxy
app.get('/api/session', async (req, res) => {
  try {
    const token = req.headers['wsc-token'];
    if (!token) {
      return res.status(401).json({ status: false, message: "Token is required" });
    }

    const response = await fetch(IBAS_SESSION_URL, {
      method: 'GET',
      headers: {
        'wsc-token': token,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ status: false, message: "Session check failed" });
    }

    const data = await response.json();
    return res.json(data);
  } catch (error) {
    console.error("Session check error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

// API: OLT registry search proxy
app.get('/api/olt-list', async (req, res) => {
  try {
    const token = req.headers['wsc-token'];
    const query = req.query.q || '';
    if (!token) {
      return res.status(401).json({ status: false, message: "Token is required" });
    }

    const url = `${IBAS_OLT_LIST_URL}?searchVal=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'wsc-token': token,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ status: false, message: "OLT search failed" });
    }

    const data = await response.json();
    return res.json(data);
  } catch (error) {
    console.error("OLT search error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

// API: Session ID negotiation proxy
app.get('/api/session-id', async (req, res) => {
  try {
    const token = req.headers['wsc-token'];
    if (!token) {
      return res.status(401).json({ status: false, message: "Token is required" });
    }

    const response = await fetch(SSH_SESSION_ID_URL, {
      method: 'GET',
      headers: {
        'wsc-token': token,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ status: false, message: "Failed to negotiate session ID" });
    }

    const data = await response.json();
    return res.json(data);
  } catch (error) {
    console.error("Session ID negotiation error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
});

// Create HTTP server to integrate Express and WebSocket server
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === '/ws/ssh') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// WebSocket Connection Handler
wss.on('connection', (browserWs, request) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const token = url.searchParams.get('token');
  const sessionId = url.searchParams.get('sessionId');
  const oltName = url.searchParams.get('oltName');

  if (!token || !sessionId || !oltName) {
    browserWs.close(1008, "Missing query parameters");
    return;
  }

  const targetUrl = `${WS_SSH_URL}?authorization=${encodeURIComponent(token)}`;
  const wsHeaders = {
    "Origin": "https://tech.s2s.ph",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
  };

  console.log(`[Proxy] Connecting to S2S for OLT ${oltName}...`);

  // Establish connection to S2S remote service
  const targetWs = new WebSocket(targetUrl, {
    headers: wsHeaders
  });

  let targetOpened = false;

  targetWs.on('open', () => {
    targetOpened = true;
    console.log(`[Proxy] Connected to S2S server. Sending CONNECT frame...`);
    // Send initial CONNECT frame
    const connectFrame = {
      type: "CONNECT",
      sessionId: sessionId,
      name: "IBAS-OLT",
      searchVal: oltName
    };
    targetWs.send(JSON.stringify(connectFrame));
  });

  targetWs.on('message', (data) => {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(data.toString());
    }
  });

  targetWs.on('close', (code, reason) => {
    console.log(`[Proxy] S2S remote connection closed. Code: ${code}, Reason: ${reason}`);
    browserWs.close(1000, "Remote connection closed");
  });

  targetWs.on('error', (err) => {
    console.error("[Proxy] S2S remote connection error:", err);
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({ type: "ERROR", message: `Remote proxy connection error: ${err.message}` }));
    }
    browserWs.close(1011);
  });

  // Pipe browser to S2S remote
  browserWs.on('message', (message) => {
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(message.toString());
    }
  });

  browserWs.on('close', () => {
    console.log(`[Proxy] Browser client disconnected.`);
    if (targetWs.readyState === WebSocket.CONNECTING || targetWs.readyState === WebSocket.OPEN) {
      try {
        targetWs.send(JSON.stringify({ type: "DISCONNECT" }));
        targetWs.close();
      } catch (e) {}
    }
  });

  browserWs.on('error', (err) => {
    console.error("[Proxy] Browser WebSocket error:", err);
  });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Gateway] Node proxy server listening on port ${PORT}`);
});
