// ============================================================
// Voxverse — Client-Side Multiplayer WebSocket Hub
// src/multiplayer.js
// ============================================================
// WS URL: set VITE_WS_URL in .env.local for local dev,
//         or in Vercel dashboard for production.
// ============================================================

// Reads from Vite env (VITE_WS_URL) or falls back to localhost
const WS_URL        = import.meta.env.VITE_WS_URL || 'ws://localhost:8765';
const MOVE_INTERVAL = 50;   // ms between position broadcasts

export class MultiplayerClient {
  /**
   * @param {Object} opts
   * @param {import('./player.js').Player}       opts.player
   * @param {import('./world.js').VoxelWorld}    opts.world
   * @param {Function}                           opts.onBlockChange
   * @param {Function}                           opts.onChatMessage
   * @param {Function}                           opts.onPlayerJoined
   * @param {Function}                           opts.onPlayerLeft
   * @param {Function}                           opts.onConnected
   * @param {Function}                           opts.onDisconnected
   */
  constructor(opts = {}) {
    this.player         = opts.player;
    this.world          = opts.world;
    this.onBlockChange  = opts.onBlockChange  || (() => {});
    this.onChatMessage  = opts.onChatMessage  || (() => {});
    this.onPlayerJoined = opts.onPlayerJoined || (() => {});
    this.onPlayerLeft   = opts.onPlayerLeft   || (() => {});
    this.onConnected    = opts.onConnected    || (() => {});
    this.onDisconnected = opts.onDisconnected || (() => {});

    this.ws          = null;
    this.myId        = null;
    this.myName      = 'Player';
    this.myAvatar    = {};
    this.connected   = false;
    this.reconnecting = false;

    // Remote player cache: id → {x, y, z, yaw, speed, name, avatar}
    this.remotePlayers = new Map();

    // Move broadcast interval handle
    this._moveInterval = null;
  }

  // ──────────────────────────────────────────────────────────
  //  Public API
  // ──────────────────────────────────────────────────────────

  /**
   * Connect to the Voxverse WebSocket server.
   * @param {string} name   - Player display name
   * @param {Object} avatar - Avatar customization object
   */
  connect(name, avatar = {}) {
    this.myName   = name   || 'Player';
    this.myAvatar = avatar || {};

    this._openSocket();
  }

  disconnect() {
    clearInterval(this._moveInterval);
    this._moveInterval = null;
    this.reconnecting  = false;
    if (this.ws) {
      this.ws.close(1000, 'User disconnected');
      this.ws = null;
    }
    this.connected = false;
    this._updateStatusDot('offline');
  }

  /**
   * Broadcast a block change to all other players.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} blockType  - BLOCK_TYPES value (0 = AIR = remove)
   */
  sendBlockChange(x, y, z, blockType) {
    this._send({ type: 'block', x, y, z, blockType });
  }

  /**
   * Send a chat message to a channel.
   * @param {string} text
   * @param {string} channel
   */
  sendChat(text, channel = '#general') {
    this._send({ type: 'chat', channel, text });
  }

  /**
   * Returns true if this client is connected.
   */
  isConnected() {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Returns the live remotePlayers Map.
   */
  getRemotePlayers() {
    return this.remotePlayers;
  }

  // ──────────────────────────────────────────────────────────
  //  Internal — WebSocket Lifecycle
  // ──────────────────────────────────────────────────────────

  _openSocket() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
    }

    this._updateStatusDot('connecting');

    try {
      this.ws = new WebSocket(WS_URL);
    } catch (err) {
      console.warn('[Multiplayer] WebSocket construction failed:', err);
      this._scheduleReconnect();
      return;
    }

    this.ws.addEventListener('open', () => this._onOpen());
    this.ws.addEventListener('message', (e) => this._onMessage(e));
    this.ws.addEventListener('close', (e) => this._onClose(e));
    this.ws.addEventListener('error', () => this._onError());
  }

  _onOpen() {
    this.connected   = true;
    this.reconnecting = false;
    this._updateStatusDot('online');
    console.log('[Multiplayer] Connected to', WS_URL);

    // Send join handshake with name + avatar
    this._send({
      type:   'join',
      name:   this.myName,
      avatar: this.myAvatar,
      x: this.player?.position.x ?? 16,
      y: this.player?.position.y ?? 12,
      z: this.player?.position.z ?? 16,
      yaw: this.player?.yaw ?? 0,
    });

    // Start periodic position broadcast
    this._moveInterval = setInterval(() => this._broadcastMove(), MOVE_INTERVAL);

    this.onConnected();
  }

  _onClose(e) {
    this.connected = false;
    clearInterval(this._moveInterval);
    this._moveInterval = null;
    this._updateStatusDot('offline');
    console.log('[Multiplayer] Disconnected:', e.code, e.reason);

    this.onDisconnected();

    // Auto-reconnect unless intentional close
    if (e.code !== 1000) {
      this._scheduleReconnect();
    }
  }

  _onError() {
    // Error always followed by close — handled there
    this._updateStatusDot('offline');
  }

  _scheduleReconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this._updateStatusDot('connecting');
    console.log('[Multiplayer] Reconnecting in 5 s…');
    setTimeout(() => {
      if (this.reconnecting) {
        this._openSocket();
      }
    }, 5000);
  }

  // ──────────────────────────────────────────────────────────
  //  Internal — Message Dispatch
  // ──────────────────────────────────────────────────────────

  _onMessage(event) {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'welcome':       this._handleWelcome(msg);       break;
      case 'player_joined': this._handlePlayerJoined(msg);  break;
      case 'player_moved':  this._handlePlayerMoved(msg);   break;
      case 'player_left':   this._handlePlayerLeft(msg);    break;
      case 'block_changed': this._handleBlockChanged(msg);  break;
      case 'chat_message':  this._handleChatMessage(msg);   break;
      case 'sdk_teleport':  this._handleSDKTeleport(msg);   break;
    }
  }

  _handleWelcome(msg) {
    this.myId = msg.id;
    console.log(`[Multiplayer] My ID: ${this.myId}`);

    // Register existing players
    (msg.players || []).forEach(p => {
      this.remotePlayers.set(p.id, { ...p, targetX: p.x, targetY: p.y, targetZ: p.z });
      this.onPlayerJoined(p);
    });

    // Apply block changes that happened before we joined
    (msg.block_changes || []).forEach(bc => {
      this.world?.setBlock(bc.x, bc.y, bc.z, bc.blockType);
    });
    if (msg.block_changes?.length > 0) {
      this.onBlockChange(null, null, null, null); // trigger mesh rebuild
    }

    this._updateOnlineCount();
  }

  _handlePlayerJoined(msg) {
    const p = msg.player;
    if (p.id === this.myId) return;

    this.remotePlayers.set(p.id, { ...p, targetX: p.x, targetY: p.y, targetZ: p.z });
    this._updateOnlineCount();
    this.onPlayerJoined(p);
    this._addSystemMessage(`🟢 ${p.name} joined the server`);
  }

  _handlePlayerMoved(msg) {
    const p = this.remotePlayers.get(msg.id);
    if (!p) return;

    // Store as interpolation target
    p.targetX = msg.x;
    p.targetY = msg.y;
    p.targetZ = msg.z;
    p.yaw     = msg.yaw;
    p.speed   = msg.speed;
  }

  _handlePlayerLeft(msg) {
    const p = this.remotePlayers.get(msg.id);
    const name = p?.name ?? msg.name;

    this.remotePlayers.delete(msg.id);
    this._updateOnlineCount();
    this.onPlayerLeft(msg.id, name);
    this._addSystemMessage(`🔴 ${name} left the server`);
  }

  _handleBlockChanged(msg) {
    if (msg.id === this.myId) return; // ignore our own echoed changes
    this.world?.setBlock(msg.x, msg.y, msg.z, msg.blockType);
    this.onBlockChange(msg.x, msg.y, msg.z, msg.blockType);
  }

  _handleChatMessage(msg) {
    if (msg.id === this.myId) return; // don't show our own messages twice
    this.onChatMessage(msg);
  }

  _handleSDKTeleport(msg) {
    // Only act if this message targets us
    if (msg.target_id !== this.myId) return;
    if (this.player) {
      this.player.position.set(msg.x, msg.y, msg.z);
      this.player.velocity.set(0, 0, 0);
      this._addSystemMessage(`🌀 SDK teleported you to (${msg.x}, ${msg.y}, ${msg.z})`);
    }
  }

  // ──────────────────────────────────────────────────────────
  //  Internal — Position Broadcast
  // ──────────────────────────────────────────────────────────

  _broadcastMove() {
    if (!this.isConnected() || !this.player) return;

    this._send({
      type:  'move',
      x:     this.player.position.x,
      y:     this.player.position.y,
      z:     this.player.position.z,
      yaw:   this.player.yaw,
      speed: this.player.getHorizontalSpeed?.() ?? 0,
    });
  }

  // ──────────────────────────────────────────────────────────
  //  Internal — Utilities
  // ──────────────────────────────────────────────────────────

  _send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  _updateOnlineCount() {
    const count  = this.remotePlayers.size + 1; // +1 for self
    const badge  = document.getElementById('mp-online-count');
    if (badge) badge.textContent = `👥 ${count} online`;

    const sidebar = document.getElementById('discord-online-indicator');
    if (sidebar) {
      sidebar.textContent = `🟢 ${count} node${count !== 1 ? 's' : ''} online`;
    }
  }

  _updateStatusDot(status) {
    const dot = document.getElementById('mp-status-dot');
    if (!dot) return;

    const styles = {
      online:     { bg: '#10b981', title: 'Multiplayer: Connected'   },
      connecting: { bg: '#f59e0b', title: 'Multiplayer: Connecting…' },
      offline:    { bg: '#ef4444', title: 'Multiplayer: Disconnected' },
    };
    const s = styles[status] || styles.offline;
    dot.style.background = s.bg;
    dot.title            = s.title;
  }

  _addSystemMessage(text) {
    const box = document.getElementById('chat-messages');
    if (!box) return;

    const msg = document.createElement('div');
    msg.className = 'chat-message system mp-system';
    msg.innerHTML = `
      <span class="user-avatar">🌐</span>
      <div class="message-body">
        <div class="message-meta">
          <span class="username" style="color:#94a3b8">System</span>
          <span class="timestamp">${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
        </div>
        <div class="message-content" style="color:#64748b;font-style:italic">${text}</div>
      </div>
    `;
    box.appendChild(msg);
    box.scrollTop = box.scrollHeight;
  }
}
