"""
=============================================================
  Voxverse Python SDK  (sdk.py)
  ──────────────────────────────
  A developer-friendly SDK to interact with the Voxverse
  WebSocket server.  No API keys required — just run the
  server (python server.py) and use this SDK to script bots,
  admin tools, or map editors.

  Quick-start:
      import asyncio
      from sdk import VoxverseSDK

      async def main():
          sdk = VoxverseSDK()
          await sdk.connect()

          # List online players
          players = sdk.get_players()
          print(players)

          # Send a bot message
          await sdk.send_chat("Hello from the SDK bot! 🤖")

          # Place a crystal block at (20, 10, 20)
          await sdk.set_block(20, 10, 20, block_type=8)  # 8 = CRYSTAL

          await sdk.disconnect()

      asyncio.run(main())
=============================================================
"""

import asyncio
import json
import time
import logging
import uuid
from typing import Callable, Optional

import websockets

log = logging.getLogger("voxverse.sdk")

# Block type constants matching the frontend BLOCK_TYPES enum
class BlockType:
    AIR    = 0
    GRASS  = 1
    DIRT   = 2
    STONE  = 3
    WOOD   = 4
    LEAVES = 5
    WATER  = 6
    SAND   = 7
    CRYSTAL= 8
    TORCH  = 9
    COAL   = 10
    IRON   = 11


class VoxverseSDK:
    """
    High-level async SDK for the Voxverse multiplayer server.

    Parameters
    ----------
    url   : WebSocket server URL (default: ws://localhost:8765)
    name  : Bot/client display name shown in-game
    avatar: Dict with skin/shirt/pants colour strings
    """

    def __init__(
        self,
        url: str = "ws://localhost:8765",
        name: str = "VoxBot",
        avatar: Optional[dict] = None,
    ):
        self.url    = url
        self.name   = name
        self.avatar = avatar or {
            "skinColor":  "#ffdbac",
            "shirtColor": "#10b981",
            "pantsColor": "#1c1c1c",
            "hatType":    "none",
            "hasWings":   False,
        }

        self._ws:        Optional[websockets.WebSocketClientProtocol] = None
        self._id:        Optional[str]  = None
        self._players:   dict           = {}   # id -> player data
        self._connected: bool           = False
        self._recv_task: Optional[asyncio.Task] = None

        # Event callbacks: register with sdk.on_chat(...) etc.
        self._callbacks: dict[str, list[Callable]] = {
            "chat":          [],
            "player_joined": [],
            "player_left":   [],
            "block_changed": [],
            "welcome":       [],
            "raw":           [],
        }

    # ─────────────────────────────────────────────────────────
    #  Connection
    # ─────────────────────────────────────────────────────────

    async def connect(self, x: float = 0, y: float = 50, z: float = 0):
        """Connect to the Voxverse server and send the join handshake."""
        log.info(f"Connecting to {self.url} as '{self.name}'…")
        self._ws = await websockets.connect(self.url)
        self._connected = True

        # Send join message
        await self._send({
            "type":   "join",
            "name":   self.name,
            "avatar": self.avatar,
            "x": x, "y": y, "z": z,
            "yaw": 0.0,
        })

        # Start background receive loop
        self._recv_task = asyncio.create_task(self._receive_loop())
        log.info("Connected ✓")

    async def disconnect(self):
        """Gracefully close the connection."""
        self._connected = False
        if self._recv_task:
            self._recv_task.cancel()
        if self._ws:
            await self._ws.close()
            self._ws = None
        log.info("Disconnected.")

    # ─────────────────────────────────────────────────────────
    #  Player Info
    # ─────────────────────────────────────────────────────────

    def get_players(self) -> list[dict]:
        """Return a list of all currently online players (excluding self)."""
        return list(self._players.values())

    def get_player(self, name: str) -> Optional[dict]:
        """Return a player dict by name, or None if not found."""
        for p in self._players.values():
            if p.get("name", "").lower() == name.lower():
                return p
        return None

    def get_my_id(self) -> Optional[str]:
        """Return this SDK client's assigned player ID."""
        return self._id

    # ─────────────────────────────────────────────────────────
    #  Actions
    # ─────────────────────────────────────────────────────────

    async def send_chat(self, text: str, channel: str = "#general"):
        """
        Broadcast a chat message to all players in a channel.

        Parameters
        ----------
        text    : The message to send (max 500 chars)
        channel : Channel name, e.g. '#general', '#bot-commands'
        """
        await self._send({"type": "chat", "channel": channel, "text": text})

    async def set_block(self, x: int, y: int, z: int, block_type: int):
        """
        Place or remove a block in the shared world.

        Parameters
        ----------
        x, y, z    : World coordinates
        block_type : BlockType constant (0 = AIR to remove, 1-11 to place)

        Example
        -------
            await sdk.set_block(20, 10, 20, BlockType.CRYSTAL)
        """
        await self._send({
            "type": "block",
            "x": int(x), "y": int(y), "z": int(z),
            "blockType": int(block_type),
        })

    async def move_to(self, x: float, y: float, z: float, yaw: float = 0.0):
        """
        Update this SDK client's position in the world.
        (Other players will see this client move.)
        """
        await self._send({
            "type": "move",
            "x": x, "y": y, "z": z,
            "yaw": yaw, "speed": 0.0,
        })

    async def teleport_player(self, name: str, x: float, y: float, z: float):
        """
        Send a chat command that nudges a human player to teleport.
        (The client-side code watches for 'sdk_tp' messages.)
        """
        player = self.get_player(name)
        if not player:
            log.warning(f"teleport_player: '{name}' not found online")
            return
        await self._send({
            "type":      "sdk_teleport",
            "target_id": player["id"],
            "x": x, "y": y, "z": z,
        })

    async def build_wall(self, x1: int, y: int, z: int,
                          x2: int, block_type: int = BlockType.STONE):
        """
        Helper: place a horizontal row of blocks at fixed Y.

        Example
        -------
            await sdk.build_wall(10, 8, 15, 20, BlockType.CRYSTAL)
        """
        for bx in range(min(x1, x2), max(x1, x2) + 1):
            await self.set_block(bx, y, z, block_type)
            await asyncio.sleep(0.05)  # rate-limit

    async def build_tower(self, x: int, base_y: int, z: int,
                           height: int = 5, block_type: int = BlockType.STONE):
        """
        Helper: place a vertical column of blocks.
        """
        for dy in range(height):
            await self.set_block(x, base_y + dy, z, block_type)
            await asyncio.sleep(0.05)

    async def clear_area(self, x1: int, y1: int, z1: int,
                          x2: int, y2: int, z2: int):
        """
        Remove all blocks in a 3-D bounding box.
        """
        for bx in range(min(x1,x2), max(x1,x2)+1):
            for by in range(min(y1,y2), max(y1,y2)+1):
                for bz in range(min(z1,z2), max(z1,z2)+1):
                    await self.set_block(bx, by, bz, BlockType.AIR)
                    await asyncio.sleep(0.02)

    # ─────────────────────────────────────────────────────────
    #  Event Callbacks
    # ─────────────────────────────────────────────────────────

    def on_chat(self, fn: Callable):
        """Register a callback for incoming chat messages.
        Signature: fn(msg: dict) where msg has id, name, channel, text."""
        self._callbacks["chat"].append(fn)

    def on_player_joined(self, fn: Callable):
        """Register a callback when a new player connects.
        Signature: fn(player: dict)"""
        self._callbacks["player_joined"].append(fn)

    def on_player_left(self, fn: Callable):
        """Register a callback when a player disconnects.
        Signature: fn(id: str, name: str)"""
        self._callbacks["player_left"].append(fn)

    def on_block_changed(self, fn: Callable):
        """Register a callback when any block is modified.
        Signature: fn(x, y, z, blockType)"""
        self._callbacks["block_changed"].append(fn)

    def on_raw(self, fn: Callable):
        """Register a callback for every raw message (dict)."""
        self._callbacks["raw"].append(fn)

    # ─────────────────────────────────────────────────────────
    #  Internal
    # ─────────────────────────────────────────────────────────

    async def _send(self, data: dict):
        if self._ws and self._connected:
            await self._ws.send(json.dumps(data))

    async def _receive_loop(self):
        try:
            async for raw in self._ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                await self._dispatch(msg)
        except (websockets.exceptions.ConnectionClosedOK,
                websockets.exceptions.ConnectionClosedError):
            log.info("Server closed connection.")
            self._connected = False

    async def _dispatch(self, msg: dict):
        t = msg.get("type", "")

        # Fire raw listeners
        for fn in self._callbacks["raw"]:
            try:
                fn(msg)
            except Exception as e:
                log.error(f"on_raw callback error: {e}")

        if t == "welcome":
            self._id = msg.get("id")
            for p in msg.get("players", []):
                self._players[p["id"]] = p
            log.info(f"Got welcome as ID {self._id[:8]}… "
                     f"({len(self._players)} players online)")
            for fn in self._callbacks["welcome"]:
                fn(msg)

        elif t == "player_joined":
            p = msg.get("player", {})
            self._players[p["id"]] = p
            for fn in self._callbacks["player_joined"]:
                fn(p)

        elif t == "player_moved":
            pid = msg.get("id")
            if pid in self._players:
                self._players[pid].update({
                    "x": msg["x"], "y": msg["y"], "z": msg["z"],
                    "yaw": msg["yaw"], "speed": msg["speed"],
                })

        elif t == "player_left":
            pid = msg.get("id")
            name = msg.get("name", pid)
            self._players.pop(pid, None)
            for fn in self._callbacks["player_left"]:
                fn(pid, name)

        elif t == "chat_message":
            for fn in self._callbacks["chat"]:
                fn(msg)

        elif t == "block_changed":
            for fn in self._callbacks["block_changed"]:
                fn(msg["x"], msg["y"], msg["z"], msg["blockType"])


# ─────────────────────────────────────────────────────────────
#  CLI Demo — run `python sdk.py` to see a quick demo
# ─────────────────────────────────────────────────────────────

async def _demo():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s")

    sdk = VoxverseSDK(name="SDK-Demo-Bot")

    # Register callbacks
    sdk.on_chat(lambda m: print(f"  💬 [{m['channel']}] {m['name']}: {m['text']}"))
    sdk.on_player_joined(lambda p: print(f"  ✅ {p['name']} joined"))
    sdk.on_player_left(lambda pid, n: print(f"  ❌ {n} left"))

    try:
        await sdk.connect()
    except OSError:
        print("\n  ⚠️  Could not connect — is server.py running?\n"
              "     Start it with:  python server.py\n")
        return

    # Show who is online
    players = sdk.get_players()
    print(f"\n👥 Players online: {len(players)}")
    for p in players:
        print(f"   • {p['name']}  @ ({p['x']:.1f}, {p['y']:.1f}, {p['z']:.1f})")

    # Send a greeting
    await sdk.send_chat("🤖 SDK bot connected! Type /help for commands.")

    # Build a small crystal tower near spawn
    print("\n🏗️  Building a crystal tower at (30, 8, 30)…")
    base_y = 8
    await sdk.build_tower(30, base_y, 30, height=6, block_type=BlockType.CRYSTAL)
    print("   Tower built!")

    # Listen for 10 seconds then exit
    print("\n⏳ Listening for 10 seconds…  (Press Ctrl+C to exit early)\n")
    try:
        await asyncio.sleep(10)
    except asyncio.CancelledError:
        pass

    await sdk.send_chat("👋 SDK bot signing off!")
    await sdk.disconnect()
    print("\nDone.")


if __name__ == "__main__":
    asyncio.run(_demo())
