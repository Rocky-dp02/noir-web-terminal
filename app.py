import os
import sys
import json
import logging
import asyncio
import urllib.parse
from pathlib import Path
import requests
from starlette.applications import Starlette
from starlette.responses import JSONResponse, FileResponse
from starlette.routing import Route, WebSocketRoute, Mount
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect
import websockets

# Setup basic logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("noir-ssh-web")

# Paths
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)

# Authentication endpoints on the S2S backend
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

IBAS_LOGIN_URL = "https://ibas.s2s.ph/api/admin-login"
IBAS_SESSION_URL = "https://ibas.s2s.ph/api/session"
IBAS_OLT_LIST_URL = "https://ibas.s2s.ph/api/olt-list"
SSH_SESSION_ID_URL = "https://ms-ssh-service.s2s.ph/api/config-session-id"
WS_SSH_URL = "wss://ms-ssh-service.s2s.ph"

async def login_endpoint(request):
    try:
        body = await request.json()
        username = body.get("username")
        password = body.get("password")
        if not username or not password:
            return JSONResponse({"status": False, "message": "Username and password are required"}, status_code=400)

        # Contact S2S API
        res = requests.post(
            IBAS_LOGIN_URL,
            headers={"Content-Type": "application/json"},
            json={"username": username, "password": password},
            timeout=10
        )
        if res.status_code != 200:
            return JSONResponse({"status": False, "message": f"S2S login returned code {res.status_code}"}, status_code=res.status_code)
        
        data = res.json()
        return JSONResponse(data)
    except Exception as e:
        logger.error(f"Login error: {e}")
        return JSONResponse({"status": False, "message": str(e)}, status_code=500)

async def check_session_endpoint(request):
    try:
        token = request.headers.get("wsc-token")
        if not token:
            return JSONResponse({"status": False, "message": "Token is required"}, status_code=401)
        
        res = requests.get(
            IBAS_SESSION_URL,
            headers={"wsc-token": token, "Content-Type": "application/json"},
            timeout=10
        )
        if res.status_code != 200:
            return JSONResponse({"status": False, "message": "Session check failed"}, status_code=res.status_code)
        
        return JSONResponse(res.json())
    except Exception as e:
        logger.error(f"Session check error: {e}")
        return JSONResponse({"status": False, "message": str(e)}, status_code=500)

async def search_olt_endpoint(request):
    try:
        token = request.headers.get("wsc-token")
        query = request.query_params.get("q", "")
        if not token:
            return JSONResponse({"status": False, "message": "Token is required"}, status_code=401)
        
        url = f"{IBAS_OLT_LIST_URL}?searchVal={urllib.parse.quote(query)}"
        res = requests.get(
            url,
            headers={"wsc-token": token, "Content-Type": "application/json"},
            timeout=10
        )
        if res.status_code != 200:
            return JSONResponse({"status": False, "message": "OLT search failed"}, status_code=res.status_code)
        
        return JSONResponse(res.json())
    except Exception as e:
        logger.error(f"OLT search error: {e}")
        return JSONResponse({"status": False, "message": str(e)}, status_code=500)

async def negotiate_session_id_endpoint(request):
    try:
        token = request.headers.get("wsc-token")
        if not token:
            return JSONResponse({"status": False, "message": "Token is required"}, status_code=401)
        
        res = requests.get(
            SSH_SESSION_ID_URL,
            headers={"wsc-token": token, "Content-Type": "application/json"},
            timeout=10
        )
        if res.status_code != 200:
            return JSONResponse({"status": False, "message": "Failed to negotiate session ID"}, status_code=res.status_code)
        
        return JSONResponse(res.json())
    except Exception as e:
        logger.error(f"Session ID negotiation error: {e}")
        return JSONResponse({"status": False, "message": str(e)}, status_code=500)

async def ssh_ws_proxy(websocket: WebSocket):
    # Accept the browser's websocket connection
    await websocket.accept()
    
    # Extract query params
    token = websocket.query_params.get("token")
    session_id = websocket.query_params.get("sessionId")
    olt_name = websocket.query_params.get("oltName")
    
    if not token or not session_id or not olt_name:
        await websocket.close(code=1008, reason="Missing query parameters")
        return

    target_url = f"{WS_SSH_URL}?authorization={token}"
    ws_headers = {
        "Origin": "https://tech.s2s.ph",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
    }

    try:
        # Determine custom header parameter for compatibility across websockets versions
        import inspect
        connect_params = inspect.signature(websockets.connect).parameters
        connect_kwargs = {}
        if "additional_headers" in connect_params:
            connect_kwargs["additional_headers"] = ws_headers
        else:
            connect_kwargs["extra_headers"] = ws_headers

        # Establish websocket connection to Surf2Sawa systems
        async with websockets.connect(target_url, **connect_kwargs) as target_ws:
            logger.info(f"Connected proxy to S2S WebSocket for OLT {olt_name}")
            
            # Send initial CONNECT frame
            connect_frame = {
                "type": "CONNECT",
                "sessionId": session_id,
                "name": "IBAS-OLT",
                "searchVal": olt_name
            }
            await target_ws.send(json.dumps(connect_frame))
            
            # Helper tasks to pipe data in both directions
            async def pipe_browser_to_remote():
                try:
                    while True:
                        data = await websocket.receive_text()
                        await target_ws.send(data)
                except (WebSocketDisconnect, websockets.ConnectionClosed):
                    pass
                except Exception as e:
                    logger.error(f"Error piping browser to remote: {e}")

            async def pipe_remote_to_browser():
                try:
                    async for message in target_ws:
                        await websocket.send_text(message)
                except (WebSocketDisconnect, websockets.ConnectionClosed):
                    pass
                except Exception as e:
                    logger.error(f"Error piping remote to browser: {e}")

            # Run both workers concurrently
            await asyncio.gather(
                pipe_browser_to_remote(),
                pipe_remote_to_browser()
            )
            
    except Exception as e:
        logger.error(f"WebSocket proxy exception: {e}")
        try:
            await websocket.send_text(json.dumps({"type": "ERROR", "message": f"Proxy connection error: {str(e)}"}))
            await websocket.close(code=1011)
        except Exception:
            pass

# Serve main index.html for root path
async def index_route(request):
    return FileResponse(STATIC_DIR / "index.html")

# Routes definition
routes = [
    Route("/", index_route),
    Route("/api/login", login_endpoint, methods=["POST"]),
    Route("/api/session", check_session_endpoint, methods=["GET"]),
    Route("/api/olt-list", search_olt_endpoint, methods=["GET"]),
    Route("/api/session-id", negotiate_session_id_endpoint, methods=["GET"]),
    WebSocketRoute("/ws/ssh", ssh_ws_proxy),
    Mount("/static", app=StaticFiles(directory=STATIC_DIR), name="static")
]

middleware = [
    Middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
]

app = Starlette(debug=True, routes=routes, middleware=middleware)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
