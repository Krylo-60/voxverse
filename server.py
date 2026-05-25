"""
=============================================================
  Voxverse Multiplayer Game Server  (server.py)
  ─────────────────────────────────────────────
  Pure Python · asyncio + websockets · No API keys required

  Run:   python server.py
  Port:  ws://localhost:8765
=============================================================
"""

import asyncio
import json
import uuid
import time
import logging
import os
from collections import defaultdict
from typing import Optional

import websockets

# ─────────────────────────────────────────────────────────────
#  Logging
# ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  [%(levelname)s]  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("voxverse")

# ─────────────────────────────────────────────────────────────
#  Global State
# ─────────────────────────────────────────────────────────────
# Render sets PORT env var; locally we default to 8765
# Render requires binding to 0.0.0.0 (all interfaces)
HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", 8765))
LOCAL_PORT = 8765  # for display purposes when running locally

# players[player_id] = { ws, name, x, y, z, yaw, speed, avatar, joined_at }
players: dict = {}

# block_changes — list of {x, y, z, blockType} applied since server start
block_changes: list = []

# chat_history — last 50 messages per channel
chat_history: dict = defaultdict(list)
CHAT_HISTORY_MAX = 50

# ─────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────

async def broadcast(message: dict, exclude_id: Optional[str] = None):
    """Send a JSON message to all connected players (optionally skip one)."""
    payload = json.dumps(message)
    tasks = []
    for pid, pdata in list(players.items()):
        if pid == exclude_id:
            continue
        try:
            tasks.append(pdata["ws"].send(payload))
        except Exception:
            pass
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def send_to(player_id: str, message: dict):
    """Send a JSON message to one specific player."""
    pdata = players.get(player_id)
    if pdata:
        try:
            await pdata["ws"].send(json.dumps(message))
        except Exception as exc:
            log.warning(f"send_to {player_id} failed: {exc}")


def player_summary(pid: str) -> dict:
    """Return a JSON-safe snapshot of a player's public state."""
    p = players[pid]
    return {
        "id":     pid,
        "name":   p["name"],
        "x":      p["x"],
        "y":      p["y"],
        "z":      p["z"],
        "yaw":    p["yaw"],
        "speed":  p["speed"],
        "avatar": p["avatar"],
    }

# ─────────────────────────────────────────────────────────────
#  Message Handlers
# ─────────────────────────────────────────────────────────────

async def handle_join(pid: str, data: dict):
    """Player sends their name + avatar on first connect."""
    players[pid]["name"]   = data.get("name", f"Player_{pid[:4]}")
    players[pid]["avatar"] = data.get("avatar", {})
    players[pid]["x"]      = data.get("x", 16.0)
    players[pid]["y"]      = data.get("y", 12.0)
    players[pid]["z"]      = data.get("z", 16.0)
    players[pid]["yaw"]    = data.get("yaw", 0.0)
    players[pid]["speed"]  = 0.0

    name = players[pid]["name"]
    log.info(f"JOIN  {name} ({pid[:8]}…)  total={len(players)}")

    # Send the new player their ID + the current world state
    await send_to(pid, {
        "type":          "welcome",
        "id":            pid,
        "players":       [player_summary(p) for p in players if p != pid],
        "block_changes": block_changes,
        "chat_history":  {ch: msgs for ch, msgs in chat_history.items()},
        "server_time":   time.time(),
    })

    # Tell everyone else about the new player
    await broadcast({
        "type":   "player_joined",
        "player": player_summary(pid),
    }, exclude_id=pid)


async def handle_move(pid: str, data: dict):
    """Player sends their new position/yaw every ~50 ms."""
    players[pid]["x"]     = data.get("x", players[pid]["x"])
    players[pid]["y"]     = data.get("y", players[pid]["y"])
    players[pid]["z"]     = data.get("z", players[pid]["z"])
    players[pid]["yaw"]   = data.get("yaw", players[pid]["yaw"])
    players[pid]["speed"] = data.get("speed", 0.0)

    await broadcast({
        "type":  "player_moved",
        "id":    pid,
        "x":     players[pid]["x"],
        "y":     players[pid]["y"],
        "z":     players[pid]["z"],
        "yaw":   players[pid]["yaw"],
        "speed": players[pid]["speed"],
    }, exclude_id=pid)


async def handle_block(pid: str, data: dict):
    """Player breaks or places a block — relay to all + persist."""
    change = {
        "x":         int(data["x"]),
        "y":         int(data["y"]),
        "z":         int(data["z"]),
        "blockType": int(data["blockType"]),
        "by":        pid,
    }
    # Keep only last 2000 block changes to avoid memory growth
    block_changes.append(change)
    if len(block_changes) > 2000:
        block_changes.pop(0)

    await broadcast({
        "type":      "block_changed",
        "id":        pid,
        "x":         change["x"],
        "y":         change["y"],
        "z":         change["z"],
        "blockType": change["blockType"],
    }, exclude_id=pid)


async def handle_chat(pid: str, data: dict):
    """Player sends a chat message — relay to all."""
    channel = data.get("channel", "#general")
    text    = str(data.get("text", ""))[:500]  # cap length
    name    = players[pid]["name"]
    avatar  = players[pid].get("avatar", {})

    msg_record = {
        "id":      pid,
        "name":    name,
        "avatar":  avatar,
        "channel": channel,
        "text":    text,
        "time":    time.strftime("%I:%M %p"),
    }

    # Store in history
    chat_history[channel].append(msg_record)
    if len(chat_history[channel]) > CHAT_HISTORY_MAX:
        chat_history[channel].pop(0)

    log.info(f"CHAT  [{channel}] {name}: {text}")

    await broadcast({"type": "chat_message", **msg_record})


# ─────────────────────────────────────────────────────────────
#  Main Connection Handler
# ─────────────────────────────────────────────────────────────

async def connection_handler(websocket):
    """Entry point for each new WebSocket connection."""
    pid = str(uuid.uuid4())

    players[pid] = {
        "ws":        websocket,
        "name":      f"Player_{pid[:4]}",
        "x":         16.0, "y": 12.0, "z": 16.0,
        "yaw":       0.0,  "speed": 0.0,
        "avatar":    {},
        "joined_at": time.time(),
    }

    log.info(f"CONN  New connection {pid[:8]}…  total={len(players)}")

    try:
        async for raw in websocket:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = data.get("type", "")

            if msg_type == "join":
                await handle_join(pid, data)
            elif msg_type == "move":
                await handle_move(pid, data)
            elif msg_type == "block":
                await handle_block(pid, data)
            elif msg_type == "chat":
                await handle_chat(pid, data)
            else:
                log.debug(f"Unknown message type '{msg_type}' from {pid[:8]}")

    except websockets.exceptions.ConnectionClosedOK:
        pass
    except websockets.exceptions.ConnectionClosedError as exc:
        log.warning(f"Connection error {pid[:8]}: {exc}")
    finally:
        # Clean up disconnected player
        name = players.pop(pid, {}).get("name", pid[:8])
        log.info(f"DISC  {name} ({pid[:8]}…)  total={len(players)}")

        await broadcast({
            "type": "player_left",
            "id":   pid,
            "name": name,
        })


# ─────────────────────────────────────────────────────────────
#  Server Stats (printed every 30 s)
# ─────────────────────────────────────────────────────────────

async def stats_loop():
    while True:
        await asyncio.sleep(30)
        log.info(
            f"STATS  online={len(players)}  "
            f"block_changes={len(block_changes)}  "
            f"chat_msgs={sum(len(v) for v in chat_history.values())}"
        )


# ─────────────────────────────────────────────────────────────
#  Entry Point
# ─────────────────────────────────────────────────────────────

async def main():
    display_host = "localhost" if HOST == "0.0.0.0" else HOST
    display_port = os.environ.get("PORT", LOCAL_PORT)
    log.info(f"Voxverse WebSocket Server  ws://{display_host}:{display_port}")
    log.info("   Press Ctrl+C to stop.")

    async with websockets.serve(connection_handler, HOST, PORT):
        asyncio.create_task(stats_loop())
        await asyncio.Future()   # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Server stopped.")
