// ============================================================
// Voxverse — Master Game Logic & ECS Simulation Engine
// ============================================================
import * as THREE from 'three';
import { VoxelWorld, BLOCK_TYPES } from './world.js';
import { Player } from './player.js';
import { PlayerAvatar } from './avatar.js';
import { DiscordIntegration } from './discord.js';
import { Inventory } from './inventory.js';
import { MobSystem } from './mobs.js';
import { QuestSystem } from './quests.js';
import { runLoadingSequence } from './loader.js';
import { playSFX } from './sfx.js';

// Setup Clock & Timers
const clock = new THREE.Clock();
let dayTime = 0; // Tracks day/night cycle angle

// UI References
const customizerOverlay = document.getElementById('customizer-modal-overlay');
const btnOpenCustomizer = document.getElementById('btn-open-customizer');
const btnCloseCustomizer = document.getElementById('btn-close-customizer');
const btnSaveAvatar = document.getElementById('btn-save-avatar');
const hotbarSlots = document.querySelectorAll('.hotbar-slot');

// Selected Hotbar Block Type
let selectedBlockType = BLOCK_TYPES.GRASS;

// ===== THREE.JS ENGINE SETUP =====
const scene = new THREE.Scene();
scene.background = new THREE.Color('#38bdf8'); // Sky blue
scene.fog = new THREE.FogExp2('#38bdf8', 0.035);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const canvas = document.getElementById('game-canvas');

// WebGLRenderer with ACES Filmic Tone Mapping
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

// Environment Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfffbeb, 1.25);
sunLight.position.set(20, 40, 20);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 100;
const d = 25;
sunLight.shadow.camera.left = -d;
sunLight.shadow.camera.right = d;
sunLight.shadow.camera.top = d;
sunLight.shadow.camera.bottom = -d;
scene.add(sunLight);

// Glow pointlights list
const glowLights = [];

// ===== SPAWN WEB WORKER FOR PROCEDURAL NOISE =====
const worldWorker = new Worker(new URL('./world-worker.js', import.meta.url), { type: 'module' });

// Materials mapping
let blockMaterials = {};
let instancedMeshes = {};
const blockBoxGeometry = new THREE.BoxGeometry(1, 1, 1);

// XP & Levels
let xp = 0;
let level = 1;
const XP_PER_LEVEL = [0, 20, 50, 90, 140, 200, 280, 380, 500, 650, 850];

// Game State Values
let health = 100;
let hunger = 100;
let stamina = 100;
let isDead = false;
let weatherState = 'clear'; // 'clear' or 'rain'
let rainParticles = null;

// Initialize Core Subsystems
const world = new VoxelWorld();
const player = new Player(world, camera, renderer.domElement);
const avatar = new PlayerAvatar(scene);
const discord = new DiscordIntegration(player, world, scene);
const inventory = new Inventory();

// ===== POINTER LOCK OVERLAY & JOIN CASCADE =====
const blocker = document.getElementById('blocker');

window.addEventListener('click', (e) => {
  const isBlockerOrChild = e.target === blocker || (blocker && blocker.contains(e.target));
  const isWithinWindow = e.clientX >= 0 && e.clientX <= window.innerWidth &&
                         e.clientY >= 0 && e.clientY <= window.innerHeight;

  if (isBlockerOrChild && isWithinWindow) {
    canvas.focus();
    canvas.requestPointerLock();
  }
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) {
    blocker.classList.add('hidden');
  } else {
    blocker.classList.remove('hidden');
  }
});

// ===== LIGHTWEIGHT ENTITY COMPONENT SYSTEM (ECS) =====
class ECSEngine {
  constructor() {
    this.nextEntityId = 1;
    this.entities = new Set();
    this.components = new Map(); // componentName -> Map(entityId -> componentData)
    this.systems = [];
  }

  createEntity() {
    const id = this.nextEntityId++;
    this.entities.add(id);
    return id;
  }

  destroyEntity(id) {
    this.entities.delete(id);
    for (const componentMap of this.components.values()) {
      componentMap.delete(id);
    }
  }

  addComponent(id, componentName, data) {
    if (!this.components.has(componentName)) {
      this.components.set(componentName, new Map());
    }
    this.components.get(componentName).set(id, data);
  }

  getComponent(id, componentName) {
    const map = this.components.get(componentName);
    return map ? map.get(id) : null;
  }

  removeComponent(id, componentName) {
    const map = this.components.get(componentName);
    if (map) map.delete(id);
  }

  hasComponent(id, componentName) {
    const map = this.components.get(componentName);
    return map ? map.has(id) : false;
  }

  query(requiredComponents) {
    const results = [];
    for (const id of this.entities) {
      let match = true;
      for (const comp of requiredComponents) {
        if (!this.hasComponent(id, comp)) {
          match = false;
          break;
        }
      }
      if (match) results.push(id);
    }
    return results;
  }

  addSystem(systemFn) {
    this.systems.push(systemFn);
  }

  update(dt) {
    for (const sys of this.systems) {
      sys(this, dt);
    }
  }
}

// Instantiate ECS registry
const ecs = new ECSEngine();

// Register Player as a core tracking entity in ECS
const playerEntity = ecs.createEntity();
ecs.addComponent(playerEntity, 'Player', player);
ecs.addComponent(playerEntity, 'Position', player.position);
ecs.addComponent(playerEntity, 'Velocity', player.velocity);
ecs.addComponent(playerEntity, 'Input', player.keys);

// Register ECS Systems
ecs.addSystem((registry, dt) => {
  // Player Controller System (processes inputs and tracks motion)
  const players = registry.query(['Player', 'Position', 'Velocity', 'Input']);
  players.forEach(id => {
    const pObj = registry.getComponent(id, 'Player');
    pObj.update(dt, avatar.group);

    // Synchronize ECS component coordinates with player physics results
    const pos = registry.getComponent(id, 'Position');
    const vel = registry.getComponent(id, 'Velocity');
    pos.copy(pObj.position);
    vel.copy(pObj.velocity);
  });
});
ecs.addSystem((registry, dt) => {
  // 1. Movement & Physics System
  const physicsEntities = registry.query(['Position', 'Velocity']);
  physicsEntities.forEach(id => {
    const pos = registry.getComponent(id, 'Position');
    const vel = registry.getComponent(id, 'Velocity');
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;
  });
});

ecs.addSystem((registry, dt) => {
  // 2. Render Sync System
  const renderEntities = registry.query(['Position', 'Render']);
  renderEntities.forEach(id => {
    const pos = registry.getComponent(id, 'Position');
    const render = registry.getComponent(id, 'Render');
    if (render.mesh) {
      render.mesh.position.set(pos.x, pos.y, pos.z);
    }
  });
});

ecs.addSystem((registry, dt) => {
  // 3. Creeper Countdown and Flashing System
  const creeperEntities = registry.query(['CreeperState', 'Render', 'Position']);
  creeperEntities.forEach(id => {
    const creeper = registry.getComponent(id, 'CreeperState');
    const render = registry.getComponent(id, 'Render');
    const pos = registry.getComponent(id, 'Position');

    if (creeper.isCountingDown) {
      creeper.timer -= dt;
      // White expand & flash effect
      const scale = 1.0 + (1.5 - creeper.timer) * 0.4;
      render.mesh.scale.set(scale, scale, scale);

      const bodyMat = render.mesh.children[0].material;
      bodyMat.emissive.setHex(Math.floor(Math.sin(performance.now() * 0.05) * 0.5 + 0.5) > 0.5 ? 0xffffff : 0x14532d);

      if (creeper.timer <= 0) {
        // Trigger Explosion!
        triggerCreeperExplosion(pos, id);
      }
    }
  });
});

// Quest & Mob systems setup
const quests = new QuestSystem((completedQuest) => {
  addXP(completedQuest.xpReward);
  player.addNotification(`Quest completed: ${completedQuest.title}! +${completedQuest.xpReward} XP`);
});

const mobs = new MobSystem(scene, world, player, inventory, (xpGained, mobType) => {
  addXP(xpGained);
  quests.track('mobsKilled', 1);
  player.addNotification(`☠️ Mob defeated! +${xpGained} XP`);
});

// Take Damage handler
function takeDamage(dmg, reason) {
  if (isDead) return;
  health = Math.max(0, health - dmg);
  
  // Update HUD
  document.getElementById('health-bar-fill').style.width = health + '%';
  document.getElementById('health-label').innerText = Math.round(health);

  // Play synthesized pain sound
  playSynthesizedSFX('hurt');

  if (health <= 0) {
    showDeathScreen();
  } else {
    player.addNotification(`💔 ${reason} (-${dmg} HP)`);
  }

  // Visual red vignette indicator flash
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;background:rgba(239,68,68,0.3);z-index:9998;pointer-events:none;animation:damageFlash 0.4s ease forwards;';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 400);
}

// Hook damage listener
window.addEventListener('mob-attack', (e) => {
  takeDamage(e.detail.damage, `${e.detail.mobType} attacked you!`);
});

// XP leveling handler
function addXP(amount) {
  xp += amount;
  const nextXP = XP_PER_LEVEL[Math.min(level, XP_PER_LEVEL.length - 1)] || 999;
  if (xp >= nextXP && level < 10) {
    xp -= nextXP;
    level++;
    quests.setLevel(level);
    playSynthesizedSFX('levelUp');
    player.addNotification(`🌟 Level Up! You are now Level ${level}!`);
    if (window.confetti) window.confetti({ particleCount: 80, spread: 90, origin: { y: 0.6 } });
  }
  const next = XP_PER_LEVEL[Math.min(level, XP_PER_LEVEL.length - 1)] || 999;
  quests._updateXPHud(xp, level, next);
  updateRichPresence();
}

// ===== DEATH & RESPAWN SCREEN =====
function showDeathScreen() {
  if (isDead) return;
  isDead = true;
  document.exitPointerLock();

  let screen = document.getElementById('death-screen');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'death-screen';
    screen.innerHTML = `
      <div id="death-box">
        <div class="death-title">💀 YOU DIED</div>
        <div class="death-sub">Your durability cracked...</div>
        <button id="btn-respawn">⟳ Respawn</button>
      </div>
    `;
    document.body.appendChild(screen);
    document.getElementById('btn-respawn').addEventListener('click', respawnPlayer);
  }
  screen.style.display = 'flex';
}

function respawnPlayer() {
  health = 100;
  hunger = 100;
  stamina = 100;
  isDead = false;
  player.position.set(16, 12, 16);
  player.velocity.set(0, 0, 0);

  // Reset HUD bars
  document.getElementById('health-bar-fill').style.width = '100%';
  document.getElementById('health-label').innerText = '100';
  document.getElementById('hunger-bar-fill').style.width = '100%';
  document.getElementById('hunger-label').innerText = '100';

  const screen = document.getElementById('death-screen');
  if (screen) screen.style.display = 'none';

  renderer.domElement.requestPointerLock();
  player.addNotification('Respawned at peaks coordinates!');
}

// ===== HUNGER & STAMINA CYCLE =====
function tickPlayerHUD(dt) {
  if (isDead) return;

  // Slowly deplete hunger
  hunger = Math.max(0, hunger - dt * 0.4);
  const hungerFill = document.getElementById('hunger-bar-fill');
  if (hungerFill) hungerFill.style.width = hunger + '%';
  const hungerLabel = document.getElementById('hunger-label');
  if (hungerLabel) hungerLabel.innerText = Math.round(hunger);

  // Starvation damage
  if (hunger <= 0) {
    takeDamage(dt * 3, 'Starvation');
  }

  // Stamina recover or deplete when sprinting
  const horizontalSpeed = player.getHorizontalSpeed();
  if (player.isSprinting && horizontalSpeed > 0) {
    stamina = Math.max(0, stamina - dt * 18);
    if (stamina <= 0) player.isSprinting = false; // cancel sprint
  } else {
    stamina = Math.min(100, stamina + dt * 10);
  }

  const staminaFill = document.getElementById('stamina-bar-fill');
  if (staminaFill) staminaFill.style.width = stamina + '%';
  const staminaLabel = document.getElementById('stamina-label');
  if (staminaLabel) staminaLabel.innerText = Math.round(stamina);
}

// ===== WEAVE CHUNKS & FRUSTUM CULLING =====
const frustum = new THREE.Frustum();
const projScreenMatrix = new THREE.Matrix4();

function updateFrustumCulling() {
  // Update camera matrix
  camera.updateMatrixWorld();
  projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreenMatrix);

  // Check chunk bounding boxes against camera view frustum
  world.chunkMeshes.forEach((group, key) => {
    const [cx, cy, cz] = key.split(',').map(Number);
    const sz = world.chunkSize;
    const box = new THREE.Box3(
      new THREE.Vector3(cx * sz, cy * sz, cz * sz),
      new THREE.Vector3((cx + 1) * sz, (cy + 1) * sz, (cz + 1) * sz)
    );
    group.visible = frustum.intersectsBox(box);
  });
}

// Rebuild meshes facade
function rebuildWorldMesh() {
  world.rebuildDirtyChunkMeshes(scene, blockMaterials);
  updateCrystalLights();
}

function updateCrystalLights() {
  glowLights.forEach(light => scene.remove(light));
  glowLights.length = 0;

  for (let x = 0; x < world.width; x++) {
    for (let y = 0; y < world.height; y++) {
      for (let z = 0; z < world.depth; z++) {
        const block = world.getBlock(x, y, z);
        if (block === BLOCK_TYPES.CRYSTAL) {
          const light = new THREE.PointLight('#d946ef', 1.8, 8);
          light.position.set(x + 0.5, y + 0.5, z + 0.5);
          scene.add(light);
          glowLights.push(light);
        } else if (block === BLOCK_TYPES.TORCH) {
          const light = new THREE.PointLight('#f97316', 1.6, 6);
          light.position.set(x + 0.5, y + 0.5, z + 0.5);
          scene.add(light);
          glowLights.push(light);
        }
      }
    }
  }
}

// ===== WEB AUDIO API SYNTHESIZER ENGINE =====
function playSynthesizedSFX(type) {
  playSFX(type);
}

// ===== INVENTORY & DURABILITY SYSTEM =====
function updateDurabilityUI() {
  const slots = document.querySelectorAll('.hotbar-slot');
  slots.forEach((slot, idx) => {
    const durabilityBar = slot.querySelector('.durability-bar');
    if (durabilityBar) {
      // Simulate durability values (torches and crystals have durability)
      const isTool = idx >= 7; 
      const durValue = isTool ? 75 : 100;
      durabilityBar.style.width = durValue + '%';
      durabilityBar.style.background = durValue > 50 ? '#10b981' : durValue > 20 ? '#fbbf24' : '#ef4444';
    }
  });
}

// ===== DISCORD INTEGRATION: BOT COMMANDS & RICH PRESENCE =====
function updateRichPresence() {
  const statusLabel = document.getElementById('rp-status-text');
  const substatusLabel = document.getElementById('rp-substatus-text');
  if (statusLabel) {
    statusLabel.innerText = `Level ${level} - Exploring Peaks`;
  }
  if (substatusLabel) {
    substatusLabel.innerText = `Mined: ${quests.stats.blocksMined || 0} · Defeated: ${quests.stats.mobsKilled || 0}`;
  }
}

// Listen for CLI command executes dispatched from discord.js
window.addEventListener('voxverse-command', (e) => {
  const { action, type, state, item, qty } = e.detail;
  if (action === 'spawn') {
    mobs.spawnMob(type);
  } else if (action === 'weather') {
    toggleWeather(state);
  } else if (action === 'time') {
    dayTime = (state === 'day') ? 0 : Math.PI;
  } else if (action === 'give') {
    inventory.add(item, qty);
    updateDurabilityUI();
  }
});

// Toggle weather system (Rain particles)
function toggleWeather(state) {
  weatherState = state;
  if (state === 'rain') {
    if (!rainParticles) {
      const pGeo = new THREE.BufferGeometry();
      const count = 400;
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count * 3; i += 3) {
        positions[i] = Math.random() * 40 - 20;
        positions[i+1] = Math.random() * 20 + 5;
        positions[i+2] = Math.random() * 40 - 20;
      }
      pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const pMat = new THREE.PointsMaterial({ color: '#60a5fa', size: 0.15, transparent: true, opacity: 0.6 });
      rainParticles = new THREE.Points(pGeo, pMat);
      scene.add(rainParticles);
    }
  } else {
    if (rainParticles) {
      scene.remove(rainParticles);
      rainParticles = null;
    }
  }
}

// ===== MINECRAFT-STYLE KEYBINDS =====
let hudVisible = true;
let f3Visible = false;

window.addEventListener('keydown', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;

  // Hotbar 1-9 selectors
  const keyNum = parseInt(e.key);
  if (keyNum >= 1 && keyNum <= 9) {
    hotbarSlots.forEach(s => s.classList.remove('active'));
    hotbarSlots[keyNum - 1].classList.add('active');
    selectedBlockType = parseInt(hotbarSlots[keyNum - 1].dataset.block);
  }

  // F1 - Toggle HUD
  if (e.key === 'F1') {
    e.preventDefault();
    hudVisible = !hudVisible;
    document.getElementById('app-overlay').style.display = hudVisible ? 'grid' : 'none';
    document.getElementById('player-hud').style.display = hudVisible ? 'flex' : 'none';
  }

  // F3 - Toggle Debug Screen
  if (e.key === 'F3') {
    e.preventDefault();
    f3Visible = !f3Visible;
    document.getElementById('f3-overlay').style.display = f3Visible ? 'flex' : 'none';
  }

  // Tab - Show Stats
  if (e.key === 'Tab') {
    e.preventDefault();
    showStatsPanel(true);
  }

  // H - Keybinds help
  if (e.key.toLowerCase() === 'h') {
    e.preventDefault();
    toggleHelpPanel();
  }

  // R - Eat food
  if (e.key.toLowerCase() === 'r') {
    hunger = Math.min(100, hunger + 25);
    player.addNotification('🍖 Ate golden apple! restored hunger.');
    playSynthesizedSFX('levelUp');
  }

  // Q - Drop item
  if (e.key.toLowerCase() === 'q') {
    if (inventory.has(selectedBlockType, 1)) {
      inventory.remove(selectedBlockType, 1);
      player.addNotification('🗑️ Dropped item from hotbar.');
      playSynthesizedSFX('break');
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Tab') {
    showStatsPanel(false);
  }
});

function showStatsPanel(visible) {
  let statsEl = document.getElementById('stats-overlay');
  if (!statsEl) {
    statsEl = document.createElement('div');
    statsEl.id = 'stats-overlay';
    statsEl.innerHTML = `
      <div class="stats-title">🏆 PLAYER STATISTICS</div>
      <div class="stats-grid">
        <div class="stats-row"><span>Mined Blocks</span><span id="stat-mined">0</span></div>
        <div class="stats-row"><span>Mobs Defeated</span><span id="stat-killed">0</span></div>
        <div class="stats-row"><span>Level Completed</span><span id="stat-level">1</span></div>
      </div>
    `;
    document.body.appendChild(statsEl);
  }
  
  if (visible) {
    document.getElementById('stat-mined').innerText = quests.stats.blocksMined || 0;
    document.getElementById('stat-killed').innerText = quests.stats.mobsKilled || 0;
    document.getElementById('stat-level').innerText = level;
    statsEl.style.display = 'block';
  } else {
    statsEl.style.display = 'none';
  }
}

function toggleHelpPanel() {
  let helpEl = document.getElementById('keybinds-panel');
  if (!helpEl) {
    helpEl = document.createElement('div');
    helpEl.id = 'keybinds-panel';
    helpEl.innerHTML = `
      <div class="kb-header">
        <span>⌨️ Keybinds & Help</span>
        <button onclick="this.closest('#keybinds-panel').style.display='none'">&times;</button>
      </div>
      <div class="kb-grid">
        <div class="kb-section">Movement</div>
        <div class="kb-row"><span class="kb-key">WASD</span><span class="kb-val">Walk</span></div>
        <div class="kb-row"><span class="kb-key">Ctrl + W</span><span class="kb-val">Sprint</span></div>
        <div class="kb-row"><span class="kb-key">Space</span><span class="kb-val">Jump / Fly Up</span></div>
        <div class="kb-row"><span class="kb-key">Shift</span><span class="kb-val">Sneak / Fly Down</span></div>
        <div class="kb-section">Engine Controls</div>
        <div class="kb-row"><span class="kb-key">F1</span><span class="kb-val">Toggle HUD overlay</span></div>
        <div class="kb-row"><span class="kb-key">F3</span><span class="kb-val">Toggle Debug layout</span></div>
        <div class="kb-row"><span class="kb-key">Tab</span><span class="kb-val">Hold to view stats</span></div>
        <div class="kb-row"><span class="kb-key">H</span><span class="kb-val">Toggle Keybind list</span></div>
        <div class="kb-row"><span class="kb-key">R</span><span class="kb-val">Eat food</span></div>
        <div class="kb-row"><span class="kb-key">Q</span><span class="kb-val">Drop hotbar item</span></div>
      </div>
    `;
    document.body.appendChild(helpEl);
  }
  helpEl.style.display = helpEl.style.display === 'none' ? 'flex' : 'none';
}

// ===== SPECTACULAR CREEPER BLAST FX =====
function triggerCreeperExplosion(pos, creeperId) {
  // Synthesize explosion blast sound
  playSynthesizedSFX('break');

  // Spawn visual blast particles
  const count = 30;
  const pGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const pMat = new THREE.MeshBasicMaterial({ color: '#f97316' });
  const group = new THREE.Group();
  
  for (let i = 0; i < count; i++) {
    const p = new THREE.Mesh(pGeo, pMat);
    p.position.set((Math.random()-0.5)*2, (Math.random()-0.5)*2, (Math.random()-0.5)*2);
    group.add(p);
  }
  group.position.copy(pos);
  scene.add(group);
  setTimeout(() => scene.remove(group), 800);

  // Destruct blocks in 3-block radius
  const rx = Math.floor(pos.x);
  const ry = Math.floor(pos.y);
  const rz = Math.floor(pos.z);
  const rad = 3;

  for (let x = rx - rad; x <= rx + rad; x++) {
    for (let y = ry - rad; y <= ry + rad; y++) {
      for (let z = rz - rad; z <= rz + rad; z++) {
        const dx = x - pos.x;
        const dy = y - pos.y;
        const dz = z - pos.z;
        if (dx*dx + dy*dy + dz*dz <= rad*rad) {
          world.setBlock(x, y, z, BLOCK_TYPES.AIR);
        }
      }
    }
  }

  // Redraw terrain chunks
  rebuildWorldMesh();

  // Damage player if inside blast range
  const pDist = player.position.distanceTo(pos);
  if (pDist < 5.0) {
    takeDamage(Math.floor((5.0 - pDist) * 15), 'Creeper Detonation');
  }

  // Remove Creeper entity from ECS and mob list
  ecs.destroyEntity(creeperId);
  mobs.mobs = mobs.mobs.filter(m => m.mesh !== creeperId);
}

// Raycasting selector box geometry
const selectorGeo = new THREE.BoxGeometry(1.02, 1.02, 1.02);
const selectorMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.8 });
const selectorBox = new THREE.Mesh(selectorGeo, selectorMat);
scene.add(selectorBox);

const raycaster = new THREE.Raycaster();
let intersectBlock = null;
let emptyPlacePos = null;

function updateRaycastSelection() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const targets = [];
  world.chunkMeshes.forEach(group => {
    group.children.forEach(child => {
      if (child.isInstancedMesh) {
        targets.push(child);
      }
    });
  });

  const intersects = raycaster.intersectObjects(targets);

  if (intersects.length > 0 && intersects[0].distance < 6.0) {
    const intersect = intersects[0];
    const normal = intersect.face.normal;
    const targetX = Math.floor(intersect.point.x - normal.x * 0.1);
    const targetY = Math.floor(intersect.point.y - normal.y * 0.1);
    const targetZ = Math.floor(intersect.point.z - normal.z * 0.1);

    intersectBlock = new THREE.Vector3(targetX, targetY, targetZ);
    selectorBox.position.set(targetX + 0.5, targetY + 0.5, targetZ + 0.5);
    selectorBox.visible = true;

    const placeX = targetX + Math.round(normal.x);
    const placeY = targetY + Math.round(normal.y);
    const placeZ = targetZ + Math.round(normal.z);
    emptyPlacePos = new THREE.Vector3(placeX, placeY, placeZ);
  } else {
    intersectBlock = null;
    emptyPlacePos = null;
    selectorBox.visible = false;
  }
}

// Global Voxel Placement / Break listener
window.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;

  if (e.button === 0 && intersectBlock) {
    // Left Click: Break block
    const bType = world.getBlock(intersectBlock.x, intersectBlock.y, intersectBlock.z);
    if (bType !== BLOCK_TYPES.AIR) {
      world.setBlock(intersectBlock.x, intersectBlock.y, intersectBlock.z, BLOCK_TYPES.AIR);
      playSynthesizedSFX('break');
      inventory.add(bType, 1);
      quests.track('blocksMined', 1);
      addXP(1);
      rebuildWorldMesh();
    }
  } 
  else if (e.button === 2 && emptyPlacePos) {
    // Right Click: Place block
    if (!inventory.has(selectedBlockType, 1)) {
      player.addNotification(`Mine some blocks first!`);
      return;
    }
    world.setBlock(emptyPlacePos.x, emptyPlacePos.y, emptyPlacePos.z, selectedBlockType);
    inventory.remove(selectedBlockType, 1);
    quests.track('blocksPlaced', 1);
    rebuildWorldMesh();
  }
});

// Update F3 Screen Overlay details
function updateF3Overlay() {
  const fpsLabel = document.getElementById('f3-fps');
  const posLabel = document.getElementById('f3-pos');
  const chunkLabel = document.getElementById('f3-chunk');
  const biomeLabel = document.getElementById('f3-biome');
  const facingLabel = document.getElementById('f3-facing');
  const entitiesLabel = document.getElementById('f3-entities');

  if (!f3Visible) return;

  const p = player.position;

  // Calculate FPS (mock average for display stability)
  const fps = Math.round(1 / clock.getDelta() || 60);
  if (fpsLabel) fpsLabel.innerText = `FPS: ${Math.min(fps, 60)}`;
  
  if (posLabel) posLabel.innerText = `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`;
  if (chunkLabel) chunkLabel.innerText = `Chunk: ${Math.floor(p.x/16)}, ${Math.floor(p.y/16)}, ${Math.floor(p.z/16)}`;
  if (biomeLabel) biomeLabel.innerText = `Biome: ${world.getBiomeAt(p.x, p.z)}`;
  if (facingLabel) {
    const facing = ['South','West','North','East'][Math.round(((player.yaw / (Math.PI*2)) * 4 + 8)) % 4];
    facingLabel.innerText = `Facing: ${facing}`;
  }
  if (entitiesLabel) {
    entitiesLabel.innerText = `Entities: ${mobs.mobs.length + 1}`;
  }
}

// Window resizing handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Day/Night sky illumination transitions
function updateDayNightCycle(dt) {
  dayTime += dt * 0.05; // orbit speed
  const sunY = Math.sin(dayTime);
  const sunZ = Math.cos(dayTime);
  sunLight.position.set(0, sunY * 40, sunZ * 40);

  // Transition sky background and directional lighting intensity
  if (sunY > 0) {
    scene.background.set('#38bdf8'); // Day blue
    scene.fog.color.set('#38bdf8');
    sunLight.intensity = 1.25 * sunY;
  } else {
    scene.background.set('#0b0f19'); // Dark night
    scene.fog.color.set('#0b0f19');
    sunLight.intensity = 0.05;
  }
}

// Rain particle animations
function updateRain(dt) {
  if (!rainParticles) return;
  const positions = rainParticles.geometry.attributes.position.array;
  for (let i = 1; i < positions.length; i += 3) {
    positions[i] -= dt * 15; // fall speed
    if (positions[i] < 0) {
      positions[i] = Math.random() * 20 + 5; // reset top
    }
  }
  rainParticles.geometry.attributes.position.needsUpdate = true;
}

// ===== START LOADING PIPELINE =====
worldWorker.postMessage({ type: 'generateTextures' });

worldWorker.onmessage = function(e) {
  const { type, textures } = e.data;
  if (type === 'texturesGenerated') {
    
    // Convert Web Worker pixel buffers into Three.js textures
    const materials = {};
    for (const [key, pixels] of Object.entries(textures)) {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      const imgData = new ImageData(pixels, 64, 64);
      ctx.putImageData(imgData, 0, 0);

      const tex = new THREE.CanvasTexture(canvas);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      materials[key] = tex;
    }

    // Assign composite grass textures
    const grassSideCanvas = document.createElement('canvas');
    grassSideCanvas.width = 64; grassSideCanvas.height = 64;
    const gCtx = grassSideCanvas.getContext('2d');
    
    // Dirt base
    const dirtCanvas = document.createElement('canvas');
    dirtCanvas.width = 64; dirtCanvas.height = 64;
    dirtCanvas.getContext('2d').putImageData(new ImageData(textures.dirt, 64, 64), 0, 0);
    gCtx.drawImage(dirtCanvas, 0, 0);

    // Green strip top
    gCtx.fillStyle = '#16a34a';
    gCtx.fillRect(0, 0, 64, 18);
    for (let x = 0; x < 64; x++) {
      if (Math.random() > 0.4) {
        gCtx.fillStyle = '#15803d';
        gCtx.fillRect(x, 18, 1, Math.floor(Math.random() * 5));
      }
    }
    const grassSideTex = new THREE.CanvasTexture(grassSideCanvas);
    grassSideTex.magFilter = THREE.NearestFilter;
    grassSideTex.minFilter = THREE.NearestFilter;

    // Map block materials dictionary
    const grassMats = [
      new THREE.MeshStandardMaterial({ map: grassSideTex, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ map: grassSideTex, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ map: materials.grassTop, roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ map: materials.dirt, roughness: 0.95 }),
      new THREE.MeshStandardMaterial({ map: grassSideTex, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ map: grassSideTex, roughness: 0.9 })
    ];

    blockMaterials = {
      [BLOCK_TYPES.GRASS]:   grassMats,
      [BLOCK_TYPES.DIRT]:    new THREE.MeshStandardMaterial({ map: materials.dirt, roughness: 0.95 }),
      [BLOCK_TYPES.STONE]:   new THREE.MeshStandardMaterial({ map: materials.stone, roughness: 0.8 }),
      [BLOCK_TYPES.WOOD]:    new THREE.MeshStandardMaterial({ map: materials.wood, roughness: 0.85 }),
      [BLOCK_TYPES.LEAVES]:  new THREE.MeshStandardMaterial({ map: materials.leaves, roughness: 0.9, transparent: true, opacity: 0.88 }),
      [BLOCK_TYPES.WATER]:   new THREE.MeshStandardMaterial({ map: materials.water, roughness: 0.1, transparent: true, opacity: 0.7 }),
      [BLOCK_TYPES.SAND]:    new THREE.MeshStandardMaterial({ map: materials.sand, roughness: 0.98 }),
      [BLOCK_TYPES.CRYSTAL]: new THREE.MeshStandardMaterial({ map: materials.crystal, roughness: 0.1, emissive: '#d946ef', emissiveIntensity: 0.8 }),
      [BLOCK_TYPES.TORCH]:   new THREE.MeshStandardMaterial({ map: materials.torch, roughness: 0.5, emissive: '#ea580c', emissiveIntensity: 1.0 }),
      [BLOCK_TYPES.COAL]:    new THREE.MeshStandardMaterial({ map: materials.coal, roughness: 0.85 }),
      [BLOCK_TYPES.IRON]:    new THREE.MeshStandardMaterial({ map: materials.iron, roughness: 0.8 })
    };

    // Load initial inventory slots
    inventory.add(BLOCK_TYPES.GRASS, 30);
    inventory.add(BLOCK_TYPES.DIRT, 30);
    inventory.add(BLOCK_TYPES.STONE, 30);
    inventory.add(BLOCK_TYPES.WOOD, 20);
    inventory.add(BLOCK_TYPES.CRYSTAL, 10);
    inventory.add(BLOCK_TYPES.TORCH, 15);
    inventory.add(BLOCK_TYPES.COAL, 10);
    inventory.add(BLOCK_TYPES.IRON, 10);
    updateDurabilityUI();

    // Trigger Minecraft loader UI countdown transitions
    const initGame = async () => {
      // 1. Asynchronously generate chunk terrain map grids
      await world.preloadWorld();

      // 2. Build local meshes
      rebuildWorldMesh();

      // 3. Spawn first zombie
      mobs.spawnMob();
      
      // 4. Resolve loader ready promise
      if (initGame._resolveReady) {
        initGame._resolveReady();
      }

      // 5. Start main tick
      animate();
    };

    runLoadingSequence(initGame);
  }
};

// Prevent context menu
window.addEventListener('contextmenu', e => e.preventDefault());

// ===== MASTER ECS TICK GAME LOOP =====
function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.1); // clamp frame-drops

  // 1. Tick Player Physics & camera movements (now handled by ECS System)

  // 2. Tick Mob systems
  mobs.update(dt, camera);

  // 3. Tick HUD stats & Day Night cycles
  tickPlayerHUD(dt);
  updateDayNightCycle(dt);

  // 4. Tick weather rain particle arrays
  updateRain(dt);

  // 5. Tick ECS Engine registry
  ecs.update(dt);

  // 5b. Update Player Avatar animations
  if (avatar && player) {
    avatar.tick(performance.now() / 1000, player.getHorizontalSpeed(), !player.isGrounded && !player.flyMode);
  }

  // 6. Draw raycasting selector targeting
  updateRaycastSelection();

  // 7. Update F3 overlay layouts
  updateF3Overlay();

  // 8. Discord visual proximity triggers
  discord.tick(performance.now() / 1000);

  // Render Three.js viewport
  renderer.render(scene, camera);
}
