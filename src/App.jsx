import React, { useState, useEffect, useRef, useCallback } from 'react';

export default function App() {
  // Config & State
  const [token, setToken] = useState(localStorage.getItem('wsc_token') || null);
  const [proxyUrl, setProxyUrl] = useState(() => {
    const saved = localStorage.getItem('wsc_proxy_url');
    if (saved) return saved;
    // Default: if port is 5173 (Vite default dev) or not 8000, default to http://127.0.0.1:8000
    return window.location.port !== '8000' ? 'http://127.0.0.1:8000' : window.location.origin;
  });
  
  const [autoConfig, setAutoConfig] = useState(() => {
    return localStorage.getItem('wsc_auto_config') !== 'false';
  });

  const [olts, setOlts] = useState([]);
  const [selectedOlt, setSelectedOlt] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Connection & Terminal State
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [terminalMode, setTerminalMode] = useState(''); // 'User Mode', 'Privilege Mode', 'Config Mode'
  const [terminalInput, setTerminalInput] = useState('');
  
  // History and logs
  const [commandHistory, setCommandHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [debugLogs, setDebugLogs] = useState([]);

  // Form Inputs
  const [usernameInput, setUsernameInput] = useState('test@2.com');
  const [passwordInput, setPasswordInput] = useState('Ragnarok01');
  const [proxyUrlInput, setProxyUrlInput] = useState(proxyUrl);
  const [showMixedContentWarning, setShowMixedContentWarning] = useState(false);

  // Refs
  const sshWsRef = useRef(null);
  const terminalOutputRef = useRef(null);
  const debugLogGridRef = useRef(null);
  const autoConfigAttemptsRef = useRef({ enable: 0, config: 0 });
  const currentLineElementRef = useRef(null);

  // Derived endpoints
  const getEndpoints = useCallback((urlToUse) => {
    const apiBase = urlToUse.replace(/\/$/, "");
    const wsProtocol = apiBase.startsWith("https") ? "wss:" : "ws:";
    const wsHost = apiBase.replace(/^https?:\/\//, "");
    return {
      apiBase,
      wsUrl: `${wsProtocol}//${wsHost}/ws/ssh`
    };
  }, []);

  // Check Mixed Content Warning on inputs
  useEffect(() => {
    if (window.location.protocol === 'https:' && (proxyUrlInput.startsWith('http://') || !proxyUrlInput.startsWith('https://'))) {
      setShowMixedContentWarning(true);
    } else {
      setShowMixedContentWarning(false);
    }
  }, [proxyUrlInput]);

  // Sync state to localstorage
  useEffect(() => {
    localStorage.setItem('wsc_proxy_url', proxyUrl);
  }, [proxyUrl]);

  useEffect(() => {
    localStorage.setItem('wsc_auto_config', autoConfig);
  }, [autoConfig]);

  // Verify token on load if exists
  useEffect(() => {
    if (token) {
      verifySession();
    }
  }, [token]);

  const verifySession = async () => {
    const endpoints = getEndpoints(proxyUrl);
    try {
      const res = await fetch(`${endpoints.apiBase}/api/session`, {
        headers: { "wsc-token": token }
      });
      const data = await res.json();
      if (res.status === 200 && data.status) {
        initDashboard();
      } else {
        handleLogout();
      }
    } catch (err) {
      // In case local proxy is down or CORS block
      console.error("Session verification failed", err);
    }
  };

  const initDashboard = () => {
    searchOlts('');
  };

  const handleLogout = () => {
    disconnectSsh();
    setToken(null);
    localStorage.removeItem('wsc_token');
    setOlts([]);
    setSelectedOlt(null);
  };

  // Login handler
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setIsAuthenticating(true);
    setLoginError('');

    // Update settings proxyUrl state
    setProxyUrl(proxyUrlInput);

    const endpoints = getEndpoints(proxyUrlInput);

    try {
      const res = await fetch(`${endpoints.apiBase}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usernameInput, password: passwordInput })
      });
      const data = await res.json();
      
      if (res.status === 200 && data.status) {
        setToken(data.data.token);
        localStorage.setItem("wsc_token", data.data.token);
        // Load initial OLT registry
        searchOlts('', data.data.token);
      } else {
        setLoginError(data.message || "Invalid credentials");
      }
    } catch (err) {
      console.error(err);
      setLoginError("Failed to connect to proxy server. Ensure your local gateway is running.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Search OLT registry
  const searchOlts = async (query, customToken) => {
    const activeToken = customToken || token;
    if (!activeToken) return;

    setSearchLoading(true);
    const endpoints = getEndpoints(proxyUrl);
    try {
      const res = await fetch(`${endpoints.apiBase}/api/olt-list?q=${encodeURIComponent(query)}`, {
        headers: { "wsc-token": activeToken }
      });
      const data = await res.json();
      if (res.status === 200 && data.status) {
        setOlts(data.data.oltList || []);
      } else {
        setOlts([]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSearchLoading(false);
    }
  };

  // Debouncing OLT Search Query changes
  useEffect(() => {
    if (!token) return;
    const timeout = setTimeout(() => {
      searchOlts(searchQuery);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  // Debug monitor frame logging
  const logDebug = useCallback((direction, payload) => {
    const time = new Date().toLocaleTimeString();
    setDebugLogs((prev) => [
      ...prev,
      { time, direction, payload }
    ]);
    
    // Auto scroll debug log window
    setTimeout(() => {
      if (debugLogGridRef.current) {
        debugLogGridRef.current.scrollTop = debugLogGridRef.current.scrollHeight;
      }
    }, 50);
  }, []);

  // Write content to terminal container directly to emulate character streams accurately
  const appendTerminalOutput = useCallback((text, className = "") => {
    if (!terminalOutputRef.current) return;

    // If starting on a fresh styled line, reset current line builder
    if (className) {
      currentLineElementRef.current = null;
    }

    const lines = text.split(/\r\n|\n/);

    lines.forEach((lineText, idx) => {
      if (idx > 0) {
        currentLineElementRef.current = null;
      }

      if (!currentLineElementRef.current) {
        currentLineElementRef.current = document.createElement("span");
        if (className) {
          currentLineElementRef.current.className = className;
        }
        terminalOutputRef.current.appendChild(currentLineElementRef.current);
      }

      // Handle carriage return \r (reset line content)
      if (lineText.includes('\r')) {
        const parts = lineText.split('\r');
        lineText = parts[parts.length - 1];
        currentLineElementRef.current.textContent = "";
      }

      // Handle backspaces \b
      if (lineText.includes('\b')) {
        for (let char of lineText) {
          if (char === '\b') {
            if (currentLineElementRef.current.textContent.length > 0) {
              currentLineElementRef.current.textContent = currentLineElementRef.current.textContent.slice(0, -1);
            }
          } else {
            currentLineElementRef.current.textContent += char;
          }
        }
      } else {
        currentLineElementRef.current.textContent += lineText;
      }

      // Append newline element if not the last item in split array
      if (idx < lines.length - 1) {
        terminalOutputRef.current.appendChild(document.createElement("br"));
      }
    });

    terminalOutputRef.current.scrollTop = terminalOutputRef.current.scrollHeight;
  }, []);

  // Dynamic Terminal Prompt Elevation Detector
  const updateTerminalMode = useCallback((lastLineText) => {
    if (!selectedOlt) {
      setTerminalMode('');
      return;
    }

    // Ensure this prompt corresponds to the selected OLT name
    if (!lastLineText.includes(selectedOlt.oltName)) {
      return;
    }

    let mode = '';
    const isHuawei = selectedOlt.type?.toUpperCase().includes('HUAWEI');
    const isZte = selectedOlt.type?.toUpperCase().includes('ZTE');

    if (lastLineText.endsWith('(config)#')) {
      mode = 'Config Mode';
    } else if (lastLineText.endsWith('#') || lastLineText.endsWith('>#')) {
      mode = 'Privilege Mode';

      // Reactive Auto-Config: elevate Privilege -> Config
      if (autoConfig && (isHuawei || isZte) && autoConfigAttemptsRef.current.config < 1) {
        autoConfigAttemptsRef.current.config++;
        const configCmd = isZte ? "configure terminal" : "config";
        setTimeout(() => {
          appendTerminalOutput(`\n[Auto] Privilege mode detected. Entering config mode (${configCmd})...`, "system-msg");
          sendTerminalCommand(configCmd, false);
        }, 600);
      }
    } else if (lastLineText.endsWith('>')) {
      mode = 'User Mode';

      // Reactive Auto-Config: elevate User -> Privilege
      if (autoConfig && (isHuawei || isZte) && autoConfigAttemptsRef.current.enable < 1) {
        autoConfigAttemptsRef.current.enable++;
        setTimeout(() => {
          appendTerminalOutput("\n[Auto] User mode detected. Elevating prompt...", "system-msg");
          sendTerminalCommand("enable", false);
        }, 600);
      }
    }

    if (mode) {
      setTerminalMode(mode);
    }
  }, [selectedOlt, autoConfig, appendTerminalOutput]);

  // Connect SSH session
  const connectSsh = async () => {
    if (!selectedOlt) return;
    const endpoints = getEndpoints(proxyUrl);
    
    // Clear terminal screen and reset state
    if (terminalOutputRef.current) {
      terminalOutputRef.current.innerHTML = "";
    }
    currentLineElementRef.current = null;
    autoConfigAttemptsRef.current = { enable: 0, config: 0 };
    setTerminalMode('');
    setIsConnecting(true);

    appendTerminalOutput(`*** Initiating SSH credentials lookup for OLT ${selectedOlt.oltName}...`, "system-msg");

    try {
      appendTerminalOutput(`*** Negotiating secure session ID...`, "system-msg");
      const res = await fetch(`${endpoints.apiBase}/api/session-id`, {
        headers: { "wsc-token": token }
      });
      const data = await res.json();

      if (res.status !== 200 || !data.status) {
        throw new Error(data.message || "Failed to get session ID");
      }

      const sessionId = data.data.sessionId;
      appendTerminalOutput(`*** Session ID verified: [${sessionId}]`, "system-msg");
      appendTerminalOutput(`*** Opening socket gateway pipeline...`, "system-msg");

      // WebSocket Proxy Gateway Setup
      const wsUrl = `${endpoints.wsUrl}?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}&oltName=${encodeURIComponent(selectedOlt.oltName)}`;

      logDebug("OUT", { type: "CONNECT", sessionId, oltName: selectedOlt.oltName });
      
      const socket = new WebSocket(wsUrl);
      sshWsRef.current = socket;

      socket.onopen = () => {
        appendTerminalOutput(`*** WebSocket gateway open. Waiting for target terminal...`, "system-msg");
      };

      socket.onmessage = (e) => {
        try {
          const frame = JSON.parse(e.data);
          logDebug("IN", frame);

          if (frame.type === "SERVER_LINE") {
            appendTerminalOutput(frame.message);
            updateTerminalMode(frame.message);
          } else if (frame.type === "CONNECTION") {
            if (frame.connection) {
              appendTerminalOutput(`\n*** Connected to SSH Session for ${selectedOlt.oltName} ***`, "connection-msg");
              appendTerminalOutput(`*** (Type 'disconnect' or 'back' to exit, keys/commands are live) ***\n`, "system-msg");
              setIsConnected(true);
              setIsConnecting(false);
            } else {
              appendTerminalOutput(`\n*** Disconnected by remote SSH host ***\n`, "system-msg");
              disconnectSsh();
            }
          } else if (frame.type === "ERROR") {
            appendTerminalOutput(`\n*** Remote Shell Error: ${frame.message} ***\n`, "error-msg");
            disconnectSsh();
          }
        } catch (err) {
          appendTerminalOutput(e.data);
        }
      };

      socket.onclose = () => {
        appendTerminalOutput(`\n*** WebSocket connection closed ***\n`, "system-msg");
        disconnectSsh();
      };

      socket.onerror = (err) => {
        console.error(err);
        appendTerminalOutput(`\n*** WebSocket error occurred ***\n`, "error-msg");
        disconnectSsh();
      };

    } catch (err) {
      appendTerminalOutput(`\n*** Connection failed: ${err.message} ***\n`, "error-msg");
      setIsConnecting(false);
      setIsConnected(false);
    }
  };

  const disconnectSsh = () => {
    if (sshWsRef.current) {
      try {
        sshWsRef.current.send(JSON.stringify({ type: "DISCONNECT" }));
        logDebug("OUT", { type: "DISCONNECT" });
        sshWsRef.current.close();
      } catch (e) {}
      sshWsRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    setTerminalMode('');
    currentLineElementRef.current = null;
  };

  // Send terminal user commands
  const sendTerminalCommand = (command, addToHistory = true) => {
    if (!sshWsRef.current || sshWsRef.current.readyState !== WebSocket.OPEN) {
      appendTerminalOutput("\n*** Error: Terminal is offline ***", "error-msg");
      return;
    }

    if (addToHistory) {
      appendTerminalOutput(`\nnoir ❯ ${command}`, "user-cmd-msg");
      setCommandHistory((prev) => [...prev, command]);
      setHistoryIndex(-1);
    }

    const trimmed = command.trim().toLowerCase();
    if (trimmed === "disconnect" || trimmed === "back" || trimmed === "exit") {
      disconnectSsh();
      return;
    }

    const payload = {
      type: "USER_LINE",
      command: command
    };

    sshWsRef.current.send(JSON.stringify(payload));
    logDebug("OUT", payload);
  };

  // Handle Command Line Submit
  const handleTerminalInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      const cmd = terminalInput.trim();
      if (cmd) {
        sendTerminalCommand(cmd);
        setTerminalInput('');
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        let nextIdx = historyIndex;
        if (nextIdx === -1) {
          nextIdx = commandHistory.length - 1;
        } else if (nextIdx > 0) {
          nextIdx--;
        }
        setHistoryIndex(nextIdx);
        setTerminalInput(commandHistory[nextIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        if (historyIndex !== -1 && historyIndex < commandHistory.length - 1) {
          const nextIdx = historyIndex + 1;
          setHistoryIndex(nextIdx);
          setTerminalInput(commandHistory[nextIdx]);
        } else {
          setHistoryIndex(-1);
          setTerminalInput('');
        }
      }
    }
  };

  // Quick keys click handler
  const handleQuickKeyClick = (cmd) => {
    if (isConnected) {
      appendTerminalOutput(`\n${cmd}`, "user-cmd-msg");
      sendTerminalCommand(cmd, false);
    }
  };

  return (
    <>
      {/* Header bar */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-logo">N</div>
          <div className="brand-name">Noir OLT SSH Console</div>
          <span className="brand-tag">v3.0</span>
        </div>
        <div className="header-status-panel">
          <div className="status-item">
            <span 
              className={`status-indicator ${
                isConnected ? 'active' : isConnecting ? 'connecting' : ''
              }`}
            ></span>
            <span>
              {isConnected ? 'Shell Connected' : isConnecting ? 'Connecting' : token ? 'Active' : 'Disconnected'}
            </span>
          </div>
          {token && (
            <button className="btn-logout" onClick={handleLogout}>
              Logout
            </button>
          )}
        </div>
      </header>

      {/* Main dashboard content */}
      <div className="app-body">
        
        {/* Sidebar */}
        <div className="sidebar">
          <div className="search-container">
            <div className="search-input-wrapper">
              <input 
                type="text" 
                placeholder="Search OLT name or IP..." 
                disabled={!token}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchLoading && <div className="search-loader"></div>}
            </div>
          </div>
          <div className="sidebar-title">OLT Registry</div>
          <div className="olt-list">
            {!token ? (
              <div className="no-results">Authenticate to load OLT list</div>
            ) : olts.length === 0 ? (
              <div className="no-results">No matches found</div>
            ) : (
              olts.map((olt) => (
                <div 
                  key={olt.id} 
                  className={`olt-item ${selectedOlt?.id === olt.id ? 'selected' : ''}`}
                  onClick={() => {
                    if (!isConnected && !isConnecting) {
                      setSelectedOlt(olt);
                    }
                  }}
                >
                  <div className="olt-item-header">
                    <span className="olt-name">{olt.oltName || 'Unknown OLT'}</span>
                    {olt.type && (
                      <span className={`olt-badge ${olt.type.toLowerCase()}`}>
                        {olt.type}
                      </span>
                    )}
                  </div>
                  <div className="olt-ip">{olt.oltIp || '0.0.0.0'}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Console Container */}
        <div className="console-panel">
          
          {/* Console Header details */}
          <div className="console-header">
            <div className="console-details">
              <div className="console-olt-name">
                {selectedOlt ? selectedOlt.oltName : 'No OLT Selected'}
              </div>
              {selectedOlt && (
                <div className="console-olt-ip">
                  {selectedOlt.oltIp}
                </div>
              )}
              {terminalMode && (
                <div className={`mode-badge ${terminalMode.toLowerCase().replace(' ', '-')}`}>
                  <span className={`mode-indicator ${terminalMode.toLowerCase().replace(' ', '-')}`}></span>
                  {terminalMode}
                </div>
              )}
            </div>
            
            <div className="console-controls">
              <label className="auto-config-label">
                <input 
                  type="checkbox" 
                  checked={autoConfig}
                  onChange={(e) => setAutoConfig(e.target.checked)}
                />
                Auto-Config Mode
              </label>
              {isConnected ? (
                <button 
                  className="btn btn-secondary" 
                  onClick={disconnectSsh}
                >
                  Disconnect
                </button>
              ) : (
                <button 
                  className="btn btn-primary" 
                  disabled={!selectedOlt || isConnecting}
                  onClick={connectSsh}
                >
                  {isConnecting ? 'Connecting...' : 'Connect Shell'}
                </button>
              )}
            </div>
          </div>

          {/* Terminal output viewport */}
          <div className="terminal-container">
            <div 
              className="terminal-output" 
              id="terminal-output-container" 
              ref={terminalOutputRef}
            >
              <div className="system-msg">
                Welcome to Noir OLT SSH Terminal Client. Select an OLT from the left panel and click 'Connect Shell'.
              </div>
            </div>
            <div className="terminal-input-line">
              <span className="terminal-prompt">noir ❯</span>
              <input 
                type="text" 
                className="terminal-input"
                placeholder={isConnected ? "Type command here..." : "Offline. Connect shell first."}
                disabled={!isConnected}
                value={terminalInput}
                onChange={(e) => setTerminalInput(e.target.value)}
                onKeyDown={handleTerminalInputKeyDown}
              />
            </div>
          </div>

          {/* Quick command keys */}
          <div className="terminal-toolbar">
            <span className="toolbar-label">Quick keys:</span>
            <button 
              className="key-btn" 
              disabled={!isConnected}
              onClick={() => handleQuickKeyClick('disconnect')}
            >
              disconnect
            </button>
            <button 
              className="key-btn" 
              disabled={!isConnected}
              onClick={() => handleQuickKeyClick('back')}
            >
              back
            </button>
            <button 
              className="key-btn" 
              disabled={!isConnected}
              onClick={() => handleQuickKeyClick('help')}
            >
              help
            </button>
            <button 
              className="key-btn" 
              disabled={!isConnected}
              onClick={() => handleQuickKeyClick('show interface gpon')}
            >
              show port
            </button>
            <button 
              className="key-btn" 
              disabled={!isConnected}
              onClick={() => handleQuickKeyClick('show onu status')}
            >
              show onu status
            </button>
          </div>

          {/* Live Websocket frames log monitor */}
          <div className="debug-drawer">
            <div className="debug-header">
              <div className="debug-title">WebSocket Traffic Monitor (Live)</div>
              <button 
                className="key-btn" 
                style={{ fontSize: '0.65rem', padding: '0.15rem 0.45rem' }}
                onClick={() => setDebugLogs([])}
              >
                Clear Logs
              </button>
            </div>
            <div className="debug-grid" ref={debugLogGridRef}>
              {debugLogs.length === 0 ? (
                <div className="system-msg" style={{ fontSize: '0.75rem' }}>
                  Waiting for socket operations...
                </div>
              ) : (
                debugLogs.map((log, i) => (
                  <div key={i} className="debug-row">
                    <span className="debug-time">[{log.time}]</span>
                    <span className={`debug-direction ${log.direction.toLowerCase()}`}>
                      {log.direction === 'IN' ? '◀ IN' : '▶ OUT'}
                    </span>
                    <span className="debug-payload">
                      {JSON.stringify(log.payload)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

      </div>

      {/* Login Card Screen */}
      {!token && (
        <div className="login-overlay">
          <div className="login-card">
            <div className="login-header">
              <h2 className="login-title">Noir Systems</h2>
              <p className="login-desc">Sign in with your S2S IBAS administrator account</p>
            </div>
            
            {showMixedContentWarning && (
              <div className="login-warning">
                <strong>⚠️ Mixed Content Warning:</strong> You are accessing this site via HTTPS ({window.location.hostname}). Modern browsers block insecure HTTP/WS requests from HTTPS sites to local gateways.
                <br/><br/>
                To resolve this, please run your gateway server locally and visit:
                <a 
                  href="http://127.0.0.1:8000" 
                  style={{ color: 'var(--primary)', textDecoration: 'underline', fontWeight: 600, marginLeft: '4px' }}
                >
                  http://127.0.0.1:8000
                </a>
              </div>
            )}

            {loginError && <div className="login-error">{loginError}</div>}

            <form onSubmit={handleLoginSubmit}>
              <div className="form-group">
                <label className="form-label">Username / Email</label>
                <input 
                  type="text" 
                  className="form-input"
                  required 
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  placeholder="name@domain.com"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input 
                  type="password" 
                  className="form-input"
                  required 
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Noir Gateway URL (Proxy)</label>
                <input 
                  type="text" 
                  className="form-input"
                  required 
                  value={proxyUrlInput}
                  onChange={(e) => setProxyUrlInput(e.target.value)}
                  placeholder="http://127.0.0.1:8000"
                />
              </div>
              <button 
                type="submit" 
                className="btn btn-primary btn-login"
                disabled={isAuthenticating}
              >
                {isAuthenticating ? 'Authenticating...' : 'Authenticate'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
