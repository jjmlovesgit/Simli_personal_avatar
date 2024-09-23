from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketState
import asyncio
import uvicorn
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = FastAPI()

# Configure CORS - if you need it...
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500"],  # Allow your frontend origin
    allow_credentials=True,
    allow_methods=["*"],  # Allow all HTTP methods (GET, POST, etc.)
    allow_headers=["*"],  # Allow all headers
)

# API to retrieve Simli API key and face ID from .env
@app.get("/api/keys")
async def get_keys():
    api_key = os.getenv("SIMLI_API_KEY")
    face_id = os.getenv("SIMLI_FACE_ID")
    return {"api_key": api_key, "face_id": face_id}

# WebSocket endpoint for handling incoming audio streams
@app.websocket("/")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("WebSocket connection established on server")
    
    try:
        # FFMPEG command for resampling audio to 16kHz mono
        decodeTask = await asyncio.subprocess.create_subprocess_exec(
            "ffmpeg", "-i", "pipe:0", "-f", "s16le", "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le", "-",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE
        )

        while websocket.client_state == WebSocketState.CONNECTED:
            data = await websocket.receive_bytes()  # Receive audio data from client
            print(f"Received {len(data)} bytes of audio data")
            
            # Send data to ffmpeg for resampling
            decodeTask.stdin.write(data)
            await decodeTask.stdin.drain()  # Ensure the data is flushed properly

    except WebSocketDisconnect:
        print("WebSocket disconnected")
    finally:
        # Clean up the WebSocket connection
        await websocket.close()

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8081)
