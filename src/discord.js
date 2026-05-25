// ============================================================
// Voxverse Discord HUD & Spatial Voice Integration (V2.0)
// ============================================================
import * as THREE from 'three';
import { BLOCK_TYPES } from './world.js';
import { playSFX, playSpatialVoiceChime, updateAudioListener } from './sfx.js';

export class DiscordIntegration {
  constructor(player, world, scene) {
    this.player = player;
    this.world = world;
    this.scene = scene;

    // Call status flags
    this.isMuted = false;
    this.isDeafened = false;
    this.activeVoiceChannel = null; // null, 'lounge', or 'proximity'

    // Mic waveform visualizer variables
    this.micStream = null;
    this.analyser = null;
    this.dataArray = null;
    this.animationFrameId = null;

    // Simulated Discord user database
    this.bots = [
      { name: 'Steve', avatar: '🟩', color: '#10b981', inVoice: false, posX: 12, posZ: 12, mesh: null },
      { name: 'Robloxian', avatar: '🟥', color: '#ef4444', inVoice: false, posX: 22, posZ: 22, mesh: null },
      { name: 'HytaleQuest', avatar: '🟨', color: '#f59e0b', inVoice: false, posX: 14, posZ: 18, mesh: null }
    ];

    // Log messages mapped to text channels
    this.chatLogs = {
      '#general': [
        { user: 'Steve', msg: 'Hey guys! Welcome to Voxverse!', time: '12:05 PM', avatar: '🟩' },
        { user: 'Robloxian', msg: 'This avatar editor is clean. I changed my wings to cyan.', time: '12:06 PM', avatar: '🟥' },
        { user: 'HytaleQuest', msg: 'Has anyone seen the glowing crystal at coordinates (15, 12)?', time: '12:08 PM', avatar: '🟨' }
      ],
      '#announcements': [
        { user: 'VoxverseBot', msg: 'Welcome to the alpha build! Press V to toggle camera, F to toggle Fly mode.', time: '12:00 PM', avatar: '🤖' }
      ],
      '#vox-builds': [
        { user: 'Steve', msg: 'Check out the tree I spawned near x=8, z=8!', time: '12:15 PM', avatar: '🟩' }
      ],
      '#bot-commands': [
        { user: 'ConsoleBot', msg: 'Voxel command-line CLI loaded. Type /spawn zombie, /weather rain, or /give crystal to execute scripts.', time: '12:00 PM', avatar: '🤖' }
      ]
    };

    this.currentChannel = '#general';

    this.spawnNPCMeshes();
    this.initUI();
  }

  // Create 3D voxel-like bodies for bots in the scene
  spawnNPCMeshes() {
    this.bots.forEach(bot => {
      const group = new THREE.Group();

      // Colored torso
      const bodyMat = new THREE.MeshStandardMaterial({ color: bot.color, roughness: 0.8 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.4), bodyMat);
      body.position.y = 0.45;
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      // Head
      const headMat = new THREE.MeshStandardMaterial({ color: '#ffe4c4', roughness: 0.8 });
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), headMat);
      head.position.y = 1.15;
      head.castShadow = true;
      group.add(head);

      // Nameplate canvas texture sprite
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.fillRect(0, 0, 128, 64);
      ctx.fillStyle = bot.color;
      ctx.font = '22px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(bot.name, 64, 40);

      const texture = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: texture });
      const nameplate = new THREE.Sprite(spriteMat);
      nameplate.position.y = 1.6;
      nameplate.scale.set(1.1, 0.55, 1);
      group.add(nameplate);

      // Y positioning aligned to heightmap
      const y = this.world.getHeight(bot.posX, bot.posZ) + 0.15;
      group.position.set(bot.posX, y, bot.posZ);

      this.scene.add(group);
      bot.mesh = group;
    });
  }

  initUI() {
    // 1. Text channel triggers
    const channels = document.querySelectorAll('.channel-item.text');
    channels.forEach(ch => {
      ch.addEventListener('click', () => {
        channels.forEach(c => c.classList.remove('active'));
        ch.classList.add('active');
        const name = ch.dataset.channel;
        this.currentChannel = name;
        this.renderChatHistory();
        document.getElementById('current-channel-header').innerText = name.replace('#', '');
        
        playSFX('chat');
      });
    });

    // 2. Voice channel triggers
    const voiceChannels = document.querySelectorAll('.channel-item.voice');
    voiceChannels.forEach(vch => {
      vch.addEventListener('click', () => {
        const voice = vch.dataset.voice;
        if (this.activeVoiceChannel === voice) {
          this.leaveVoice();
        } else {
          if (this.activeVoiceChannel) this.leaveVoice();
          this.joinVoice(voice, vch);
        }
      });
    });

    // 3. User panel buttons
    const muteBtn = document.getElementById('discord-mute-btn');
    const deafenBtn = document.getElementById('discord-deafen-btn');

    muteBtn.addEventListener('click', () => {
      this.isMuted = !this.isMuted;
      playSFX(this.isMuted ? 'hurt' : 'chat');
      muteBtn.classList.toggle('active', this.isMuted);
      muteBtn.innerHTML = this.isMuted ? '🎙️❌' : '🎙️';
      this.updateVoiceRing();
    });

    deafenBtn.addEventListener('click', () => {
      this.isDeafened = !this.isDeafened;
      playSFX(this.isDeafened ? 'hurt' : 'chat');
      deafenBtn.classList.toggle('active', this.isDeafened);
      deafenBtn.innerHTML = this.isDeafened ? '🎧❌' : '🎧';
    });

    // 4. Input messaging CLI mapping
    const chatInput = document.getElementById('discord-chat-input');
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && chatInput.value.trim() !== '') {
        const text = chatInput.value.trim();
        chatInput.value = '';
        this.sendChatMessage('You', text, '💎');

        if (text.startsWith('/')) {
          this.executeConsoleCommand(text);
        } else {
          this.processBotReply(text);
        }
      }
    });

    this.renderChatHistory();
  }

  // Parse chat developer console commands
  executeConsoleCommand(commandText) {
    const parts = commandText.split(' ');
    const cmd = parts[0].toLowerCase();

    playSFX('chat');

    if (cmd === '/spawn') {
      const mobType = parts[1] ? parts[1].toUpperCase() : 'ZOMBIE';
      window.dispatchEvent(new CustomEvent('voxverse-command', {
        detail: { action: 'spawn', type: mobType }
      }));
      this.sendChatMessage('ConsoleBot', `Executing CLI: Spawning ${mobType}...`, '🤖');
    } 
    
    else if (cmd === '/weather') {
      const state = parts[1] ? parts[1].toLowerCase() : 'clear';
      window.dispatchEvent(new CustomEvent('voxverse-command', {
        detail: { action: 'weather', state }
      }));
      this.sendChatMessage('ConsoleBot', `Executing CLI: Weather set to ${state}`, '🤖');
    } 
    
    else if (cmd === '/time') {
      const state = parts[2] ? parts[2].toLowerCase() : 'day';
      window.dispatchEvent(new CustomEvent('voxverse-command', {
        detail: { action: 'time', state }
      }));
      this.sendChatMessage('ConsoleBot', `Executing CLI: Time set to ${state}`, '🤖');
    } 
    
    else if (cmd === '/give') {
      window.dispatchEvent(new CustomEvent('voxverse-command', {
        detail: { action: 'give', item: BLOCK_TYPES.CRYSTAL, qty: 5 }
      }));
      this.sendChatMessage('ConsoleBot', `Executing CLI: Added 5 Crystals to hotbar.`, '🤖');
    } 
    
    else {
      this.sendChatMessage('ConsoleBot', `Invalid command. Try /spawn, /weather, /time, /give`, '🤖');
    }
  }

  // Populate messages logs
  renderChatHistory() {
    const box = document.getElementById('chat-messages');
    box.innerHTML = '';
    const logs = this.chatLogs[this.currentChannel] || [];

    logs.forEach(msg => {
      const row = document.createElement('div');
      row.className = 'chat-message';
      row.innerHTML = `
        <div class="user-avatar">${msg.avatar}</div>
        <div class="message-body">
          <div class="message-meta">
            <span class="username">${msg.user}</span>
            <span class="timestamp">${msg.time}</span>
          </div>
          <div class="message-content">${msg.msg.replace(/\n/g, '<br>')}</div>
        </div>
      `;
      box.appendChild(row);
    });

    box.scrollTop = box.scrollHeight;
  }

  sendChatMessage(user, msg, avatar) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (!this.chatLogs[this.currentChannel]) {
      this.chatLogs[this.currentChannel] = [];
    }
    this.chatLogs[this.currentChannel].push({ user, msg, time, avatar });
    this.renderChatHistory();

    if (user !== 'You') {
      playSFX('chat');
    }
  }

  joinVoice(channelId, element) {
    this.activeVoiceChannel = channelId;
    element.classList.add('connected');
    
    // Play localized join synth chime
    playSpatialVoiceChime(this.player.position, 'join');

    const voiceList = document.getElementById(`voice-users-${channelId}`);
    voiceList.innerHTML = '';

    document.getElementById('voice-status-banner').style.display = 'flex';
    document.getElementById('voice-banner-channel').innerText = channelId === 'lounge' ? 'Lounge Call' : 'Proximity voice';

    const userRow = document.createElement('div');
    userRow.className = 'voice-user-row';
    userRow.id = 'voice-user-self';
    userRow.innerHTML = `<span class="voice-avatar" id="voice-avatar-self">💎</span> <span class="voice-name">You (Local)</span>`;
    voiceList.appendChild(userRow);

    this.startMicVisualizer();

    // Trigger bots to join call
    this.bots.forEach((bot, idx) => {
      if (channelId === 'lounge') {
        setTimeout(() => {
          if (this.activeVoiceChannel === 'lounge') {
            bot.inVoice = true;
            playSpatialVoiceChime(bot.mesh.position, 'join');
            const botRow = document.createElement('div');
            botRow.className = 'voice-user-row';
            botRow.id = `voice-user-${bot.name}`;
            botRow.innerHTML = `<span class="voice-avatar" id="voice-avatar-${bot.name}" style="background:${bot.color}">${bot.avatar}</span> <span class="voice-name">${bot.name}</span>`;
            voiceList.appendChild(botRow);
          }
        }, 800 + idx * 1000);
      }
    });
  }

  leaveVoice() {
    if (!this.activeVoiceChannel) return;

    playSpatialVoiceChime(this.player.position, 'leave');

    document.querySelectorAll('.channel-item.voice').forEach(c => c.classList.remove('connected'));
    document.querySelectorAll('.voice-users-list').forEach(l => l.innerHTML = '');
    document.getElementById('voice-status-banner').style.display = 'none';

    this.activeVoiceChannel = null;
    this.bots.forEach(bot => bot.inVoice = false);

    this.stopMicVisualizer();
  }

  // Hook into client mic
  async startMicVisualizer() {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const ctx = getAudioContext();
      const source = ctx.createMediaStreamSource(this.micStream);
      
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 64;
      source.connect(this.analyser);

      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.drawWaveform();
    } catch (err) {
      console.warn("Using simulated waveform visualizer.");
      this.drawSimulatedWaveform();
    }
  }

  stopMicVisualizer() {
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null;
    }
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    const canvas = document.getElementById('mic-visualizer-canvas');
    if (canvas) {
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  // Draw real mic frequency stream
  drawWaveform() {
    if (!this.activeVoiceChannel) return;
    this.animationFrameId = requestAnimationFrame(() => this.drawWaveform());

    this.analyser.getByteFrequencyData(this.dataArray);
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i];
    }
    const vol = sum / this.dataArray.length;
    this.updateVoiceRing(vol);

    const canvas = document.getElementById('mic-visualizer-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const sliceWidth = w / this.dataArray.length;
    let x = 0;

    for (let i = 0; i < this.dataArray.length; i++) {
      const v = this.dataArray[i] / 128.0;
      const y = (v * h) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.stroke();
  }

  drawSimulatedWaveform() {
    if (!this.activeVoiceChannel) return;
    this.animationFrameId = requestAnimationFrame(() => this.drawSimulatedWaveform());

    const canvas = document.getElementById('mic-visualizer-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 3;
    ctx.beginPath();

    const time = Date.now() * 0.012;
    let speakingVol = 0;
    if (Math.sin(time * 0.15) > 0.45) {
      speakingVol = 10 + Math.sin(time) * 8;
    }
    this.updateVoiceRing(speakingVol);

    const pts = 24;
    const step = w / pts;
    for (let i = 0; i < pts; i++) {
      const sine = Math.sin(i * 0.4 + time) * Math.cos(i * 0.1 + time * 1.3);
      const amp = speakingVol > 0 ? speakingVol * (0.3 + Math.random()*0.4) : 1;
      const y = h/2 + sine * amp;
      if (i === 0) ctx.moveTo(0, y);
      else ctx.lineTo(i * step, y);
    }
    ctx.stroke();
  }

  updateVoiceRing(vol = 0) {
    const ring = document.getElementById('voice-avatar-self');
    if (!ring) return;

    if (vol > 5 && !this.isMuted && !this.isDeafened) {
      ring.style.boxShadow = '0 0 12px #10b981, inset 0 0 0 2.5px #10b981';
      ring.style.transform = 'scale(1.08)';
    } else {
      ring.style.boxShadow = 'none';
      ring.style.transform = 'none';
    }
  }

  // Generate replies
  processBotReply(text) {
    const msg = text.toLowerCase();
    const typing = document.getElementById('discord-typing-status');
    const bot = this.bots[Math.floor(Math.random() * this.bots.length)];

    setTimeout(() => {
      typing.style.display = 'block';
      typing.innerText = `${bot.name} is typing...`;
    }, 300);

    setTimeout(() => {
      typing.style.display = 'none';
      let reply = '';
      if (msg.includes('hello') || msg.includes('hi')) {
        reply = `Hello! Exploring elements? 🧱`;
      } else if (msg.includes('spawn') || msg.includes('build')) {
        reply = `Spawning magic portal at peaks center! 🌀`;
        this.spawnMagicStructure();
      } else if (msg.includes('hytale')) {
        reply = `Procedural canvas texturing here runs on Workers!`;
      } else {
        reply = `Nice! Try \`/spawn zombie\` or \`/weather rain\` in #bot-commands.`;
      }
      this.sendChatMessage(bot.name, reply, bot.avatar);
    }, 1800);
  }

  spawnMagicStructure() {
    const px = 16;
    const pz = 16;
    const by = this.world.getHeight(px, pz) + 1;

    for (let y = by; y < by + 4; y++) {
      this.world.setBlock(px - 2, y, pz, BLOCK_TYPES.STONE);
      this.world.setBlock(px + 2, y, pz, BLOCK_TYPES.STONE);
    }
    for (let x = px - 2; x <= px + 2; x++) {
      this.world.setBlock(x, by + 4, pz, BLOCK_TYPES.STONE);
      this.world.setBlock(x, by, pz, BLOCK_TYPES.STONE);
    }
    for (let y = by + 1; y <= by + 3; y++) {
      for (let x = px - 1; x <= px + 1; x++) {
        this.world.setBlock(x, y, pz, BLOCK_TYPES.CRYSTAL);
      }
    }

    // Force chunk mesh update
    this.world.dirtyChunks.add(`${Math.floor(px/16)},${Math.floor(by/16)},${Math.floor(pz/16)}`);
    window.dispatchEvent(new CustomEvent('voxverse-world-update'));

    if (window.confetti) {
      window.confetti({ particleCount: 70, spread: 60 });
    }
  }

  // Update proximity metrics and apply spatial panner node calculations
  tick(time) {
    // Spatial Audio Listener coordinates update matching player/camera vectors
    updateAudioListener(this.player.position, this.player.camera);

    if (this.activeVoiceChannel !== 'proximity') return;

    const voiceList = document.getElementById('voice-users-proximity');
    if (!voiceList) return;

    this.bots.forEach(bot => {
      if (!bot.mesh) return;

      const dist = this.player.position.distanceTo(bot.mesh.position);
      const proximityThreshold = 14.0; // Distance in blocks for proximity chat

      if (dist < proximityThreshold && !bot.inVoice) {
        // NPC enters Proximity range and joins call
        bot.inVoice = true;
        playSpatialVoiceChime(bot.mesh.position, 'join');

        const botRow = document.createElement('div');
        botRow.className = 'voice-user-row proximity-node';
        botRow.id = `voice-user-proximity-${bot.name}`;
        botRow.innerHTML = `
          <span class="voice-avatar" id="voice-avatar-proximity-${bot.name}" style="background:${bot.color}">${bot.avatar}</span> 
          <span class="voice-name">${bot.name} <span class="dist-badge">${Math.round(dist)}m</span></span>
        `;
        voiceList.appendChild(botRow);
      } 
      
      else if (dist >= proximityThreshold && bot.inVoice) {
        // NPC walks out of proximity range
        bot.inVoice = false;
        playSpatialVoiceChime(bot.mesh.position, 'leave');
        const node = document.getElementById(`voice-user-proximity-${bot.name}`);
        if (node) node.remove();
      } 
      
      else if (bot.inVoice) {
        // Update live distance display reading
        const node = document.getElementById(`voice-user-proximity-${bot.name}`);
        if (node) {
          const badge = node.querySelector('.dist-badge');
          if (badge) badge.innerText = `${Math.round(dist)}m`;
        }

        // Pulse Discord avatar ring outline brighter as distance gets closer
        const avatarRing = document.getElementById(`voice-avatar-proximity-${bot.name}`);
        if (avatarRing) {
          const isSpeaking = Math.sin(time * 3 + bot.name.length) > 0.45;
          if (isSpeaking) {
            // Proximity glow scaling calculation
            const intensity = Math.max(0, 1.0 - dist / proximityThreshold); // 1.0 (very close) to 0.0 (far)
            const glowSize = Math.round(4 + intensity * 16);
            avatarRing.style.boxShadow = `0 0 ${glowSize}px rgba(16, 185, 129, ${0.4 + intensity * 0.6}), inset 0 0 0 2px #10b981`;
            avatarRing.style.transform = `scale(${1.0 + intensity * 0.08})`;

            // Play procedural spatial chime chimes depending on distance
            if (Math.random() > 0.94) {
              playSpatialVoiceChime(bot.mesh.position, 'speech');
            }
          } else {
            avatarRing.style.boxShadow = 'none';
            avatarRing.style.transform = 'none';
          }
        }
      }
    });
  }
}

// Global AudioContext wrapper helper
function getAudioContext() {
  const ctx = playSFX && playSFX('break') ? null : null; // stub
  return playSFX.name ? window.__audioContext || (window.__audioContext = new (window.AudioContext || window.webkitAudioContext)()) : null;
}
