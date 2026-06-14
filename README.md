# Noir OLT SSH Web Console (Modern JS Stack)

A beautiful, premium web-based SSH terminal emulator for managing **Surf2Sawa Optical Line Terminals (OLTs)**, built on a modern JavaScript architecture.

---

## 🏗️ Architecture Design & Flow

Due to web browser security constraints (CORS policies and browser restrictions on WebSocket handshakes preventing custom `Origin` headers), the browser cannot directly interface with S2S remote backend systems. 

This application uses a split frontend/backend architecture:

```
[ Web Browser Client ] (Vite + React SPA, live WebSocket traffic drawer, responsive layouts)
         │
         ├─ Secure HTTPS Requests (Login, OLT list searches)
         ├─ Secure WSS WebSocket Tunnel
         ▼
[ Secure Node.js Gateway ] (Express + ws proxy running on Render/Railway/Fly.io or localhost)
         │
         ├─ Injects custom headers (Origin: https://tech.s2s.ph)
         ├─ Performs authentication session checks
         ▼
[ Surf2Sawa Remote Services ] (https://ibas.s2s.ph and wss://ms-ssh-service.s2s.ph)
```

---

## 📂 File Directory

* **`src/`**: Modern React single-page application dashboard featuring responsive layouts, custom terminal character emulation, real-time command histories, and a live frame monitor.
* **`backend/`**: Express Node.js application containing routing for authentication, session verification, OLT registry search proxying, and bidirectional WebSocket stream proxying.
* **`vercel.json`**: Vercel rewrite configuration for routing all SPA request routes to the main index.html.

---

## 🚀 Getting Started

### 1. Local Development

To run the application locally on your machine:

#### Step A: Run the Backend Gateway
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies and start the server:
   ```bash
   npm install
   npm start
   ```
   *The gateway will start listening on [http://127.0.0.1:8000](http://127.0.0.1:8000).*

#### Step B: Run the Frontend console
1. Open a new terminal tab in the root directory:
   ```bash
   npm install
   npm run dev
   ```
   *Open the URL in your browser (usually [http://localhost:5173](http://localhost:5173) or [http://localhost:3000](http://localhost:3000)).*

2. In the login prompt, enter your Surf2Sawa credentials. The **Noir Gateway URL** should remain set to `http://127.0.0.1:8000` (the local port).

---

## 📦 Production Deployment

To host this application in a fully online, secure production environment:

### 1. Deploy the Frontend (Vercel)
1. Commit and push the repository to GitHub.
2. Log in to Vercel and import the project.
3. Vercel will automatically detect **Vite** and configure the build settings. Click **Deploy**.
4. Configure your custom domain (e.g. `https://www.rockydp.com/`).

### 2. Deploy the Backend (Render / Railway / Fly.io)
Deploy the `backend` folder to a service that supports persistent Node.js servers and WebSockets (like Render or Railway):
1. In your deployment dashboard (e.g., Render), create a new **Web Service**.
2. Select the repository and set the **Root Directory** to `backend`.
3. Set the **Build Command** to `npm install` and **Start Command** to `npm start`.
4. Render will provide a secure HTTPS/WSS URL (e.g. `https://your-backend.onrender.com`).

### 3. Usage in Production
1. Visit your Vercel-hosted URL (`https://www.rockydp.com/`).
2. In the **Noir Gateway URL (Proxy)** input field, paste the secure backend URL (e.g. `https://your-backend.onrender.com`).
3. Enter your S2S admin credentials and log in. All HTTP/WebSocket requests will be routed securely over HTTPS/WSS!
