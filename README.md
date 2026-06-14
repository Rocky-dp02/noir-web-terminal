# Noir OLT SSH Web Console

This is a beautiful, native web-based SSH terminal emulator for managing **Surf2Sawa Optical Line Terminals (OLTs)**, transitioning the terminal-based command execution framework to a modern Web interface.

---

## 🏗️ Architecture Design & Flow

Due to web browser security constraints (CORS policies and restriction of setting the `Origin` header on standard WebSocket handshakes), the browser cannot directly interface with S2S remote backend systems. 

This application uses a local high-performance **Starlette + WebSockets** Python gateway server to proxy requests securely:

```
[ Web Browser Client ] (Vanilla JS, CSS Grid, Live Telemetry Monitor)
        │
        ├─ HTTP POST/GET (Login, OLT Searches)
        ├─ Local WebSocket (Tunnel)
        ▼
[ Local Python Gateway ] (webpage/app.py on localhost:8000)
        │
        ├─ Injects custom headers (Origin: https://tech.s2s.ph)
        ├─ Performs authentication token verification
        ▼
[ Surf2Sawa Remote Services ] (https://ibas.s2s.ph and wss://ms-ssh-service.s2s.ph)
```

---

## 📂 File Directory

* **`app.py`**: Starlette web application server containing request routing, token session validation, OLT registry search proxy, and WebSocket bidirectional stream proxying.
* **`static/index.html`**: Premium single page application dashboard styled in custom Noir dark-slate theme featuring responsive layouts, login card overlays, OLT registries, command histories, quick keys, and a live frame monitor.

---

## 🚀 Getting Started

### 1. Launching the Web Server
Execute the server using the project's activated Python virtual environment:

```bash
./.venv/bin/python webpage/app.py
```

*The server will start listening on [http://127.0.0.1:8000](http://127.0.0.1:8000).*

### 2. Using the Dashboard
1. Open your browser and navigate to `http://127.0.0.1:8000`.
2. Enter your S2S account credentials (defaults are preloaded in the login screen for validation testing) and click **Authenticate**.
3. Once authenticated, search or choose an OLT from the left panel registry list.
4. Click **Connect Shell** to launch the interactive WebSocket session.
5. Enter commands directly in the prompt or click **Quick keys** for instant execution.
6. Review exchange payloads in real-time using the **WebSocket Traffic Monitor** at the bottom of the screen.
