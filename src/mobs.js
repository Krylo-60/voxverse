// ============================================================
// Voxverse Mob System — Minecraft-style AI entities
// ============================================================
import * as THREE from 'three';
import { BLOCK_TYPES } from './world.js';

const MOB_TYPES = {
  SLIME:   { name: 'Slime',   color: '#4ade80', emissive: '#166534', hp: 20, speed: 2.5, damage: 5,  size: 0.7, xp: 8,  drop: BLOCK_TYPES.CRYSTAL },
  ZOMBIE:  { name: 'Zombie',  color: '#6b7280', emissive: '#374151', hp: 40, speed: 2.0, damage: 10, size: 0.9, xp: 15, drop: BLOCK_TYPES.STONE },
  CREEPER: { name: 'Creeper', color: '#22c55e', emissive: '#14532d', hp: 30, speed: 3.0, damage: 25, size: 0.8, xp: 20, drop: BLOCK_TYPES.LEAVES },
};
const MOB_TYPE_KEYS = Object.keys(MOB_TYPES);

export class MobSystem {
  constructor(scene, world, player, inventory, onKill) {
    this.scene     = scene;
    this.world     = world;
    this.player    = player;
    this.inventory = inventory;
    this.onKill    = onKill; // callback(xp, dropType)
    this.mobs      = [];
    this.maxMobs   = 12;
    this.spawnTimer = 0;
    this.attackCooldowns = new WeakMap();

    this._initAttackListener();
  }

  _makeMobMesh(type, def) {
    const geo  = new THREE.BoxGeometry(def.size, def.size, def.size);
    const eyes = new THREE.BoxGeometry(def.size * 0.18, def.size * 0.18, def.size * 0.05);

    const mat  = new THREE.MeshStandardMaterial({
      color:         def.color,
      emissive:      def.emissive,
      emissiveIntensity: 0.4,
      roughness: 0.8,
    });
    const eyeMat = new THREE.MeshStandardMaterial({ color: '#dc2626', emissive: '#dc2626', emissiveIntensity: 1 });

    const body  = new THREE.Mesh(geo, mat);
    const eyeL  = new THREE.Mesh(eyes, eyeMat);
    const eyeR  = new THREE.Mesh(eyes, eyeMat);
    eyeL.position.set(-def.size * 0.2, def.size * 0.15, def.size / 2);
    eyeR.position.set( def.size * 0.2, def.size * 0.15, def.size / 2);

    const group = new THREE.Group();
    group.add(body, eyeL, eyeR);

    // Floating name label (CSS-based, not Three.js sprite for simplicity)
    return group;
  }

  spawnMob() {
    if (this.mobs.length >= this.maxMobs) return;

    const typeKey = MOB_TYPE_KEYS[Math.floor(Math.random() * MOB_TYPE_KEYS.length)];
    const def     = MOB_TYPES[typeKey];

    // Pick a random surface position near player
    const px = Math.floor(this.player.position.x);
    const pz = Math.floor(this.player.position.z);
    const angle  = Math.random() * Math.PI * 2;
    const dist   = 12 + Math.random() * 8;
    const spawnX = Math.max(1, Math.min(this.world.width  - 2, px + Math.round(Math.cos(angle) * dist)));
    const spawnZ = Math.max(1, Math.min(this.world.depth  - 2, pz + Math.round(Math.sin(angle) * dist)));
    const spawnY = this.world.getHeight(spawnX, spawnZ) + 1;

    // Don't spawn in water or outside world
    if (this.world.getBlock(spawnX, Math.max(0, spawnY - 1), spawnZ) === BLOCK_TYPES.WATER) return;

    const mesh = this._makeMobMesh(typeKey, def);
    mesh.position.set(spawnX + 0.5, spawnY, spawnZ + 0.5);
    mesh.castShadow = true;
    this.scene.add(mesh);

    const mob = {
      mesh,
      type: typeKey,
      def,
      hp:      def.hp,
      maxHp:   def.hp,
      vel:     new THREE.Vector3(),
      wander:  { timer: 0, targetX: spawnX, targetZ: spawnZ },
      alive:   true,
      bobPhase: Math.random() * Math.PI * 2,
    };
    this.mobs.push(mob);
    this._makeHealthBar(mob);
  }

  _makeHealthBar(mob) {
    const bar = document.createElement('div');
    bar.className = 'mob-healthbar';
    bar.innerHTML = `
      <div class="mob-name">${mob.def.name}</div>
      <div class="mob-bar-track"><div class="mob-bar-fill"></div></div>
    `;
    bar.style.cssText = `
      position: fixed; z-index: 600; pointer-events: none;
      display: flex; flex-direction: column; align-items: center; gap: 2px;
      transform: translateX(-50%);
    `;
    document.body.appendChild(bar);
    mob._hpBar = bar;
    this._updateHealthBar(mob);
  }

  _updateHealthBar(mob) {
    if (!mob._hpBar) return;
    const pct = Math.max(0, mob.hp / mob.maxHp * 100);
    const fill = mob._hpBar.querySelector('.mob-bar-fill');
    if (fill) {
      fill.style.width = pct + '%';
      fill.style.background = pct > 60 ? '#10b981' : pct > 30 ? '#f59e0b' : '#ef4444';
    }
    mob._hpBar.style.display = mob.alive ? 'flex' : 'none';
  }

  _projectToScreen(worldPos, camera) {
    const v = worldPos.clone().project(camera);
    return {
      x: ( v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      visible: v.z < 1,
    };
  }

  _initAttackListener() {
    // Left-click to attack mobs within reach
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (document.pointerLockElement == null) return;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(0, 0), this.player.camera);

      const meshes = this.mobs.filter(m => m.alive).map(m => m.mesh.children[0]); // body mesh
      const hits   = raycaster.intersectObjects(meshes);
      if (hits.length > 0 && hits[0].distance < 5) {
        const bodyMesh = hits[0].object;
        const mob = this.mobs.find(m => m.mesh.children[0] === bodyMesh);
        if (mob) this.damageMob(mob, 15);
      }
    });
  }

  damageMob(mob, dmg) {
    mob.hp -= dmg;
    // Flash red
    mob.mesh.children[0].material.emissive.setHex(0xef4444);
    setTimeout(() => {
      if (mob.mesh.children[0]) mob.mesh.children[0].material.emissive.set(mob.def.emissive);
    }, 150);

    this._updateHealthBar(mob);
    if (mob.hp <= 0) this._killMob(mob);
  }

  _killMob(mob) {
    mob.alive = false;
    this.scene.remove(mob.mesh);
    if (mob._hpBar) { mob._hpBar.remove(); mob._hpBar = null; }

    // Drop item
    this.inventory.add(mob.def.drop, 1 + Math.floor(Math.random() * 3));

    // Callback for XP + quest tracking
    if (this.onKill) this.onKill(mob.def.xp, mob.type);

    // Death particles (just a quick flash)
    this._spawnDeathParticles(mob.mesh.position.clone(), mob.def.color);

    // Remove from array
    this.mobs = this.mobs.filter(m => m !== mob);
  }

  _spawnDeathParticles(pos, color) {
    const count = 8;
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 });
    const geo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const particles = [];
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(geo, mat);
      p.position.copy(pos);
      p._vel = new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        Math.random() * 4,
        (Math.random() - 0.5) * 4
      );
      this.scene.add(p);
      particles.push(p);
    }
    let t = 0;
    const tick = () => {
      t += 0.016;
      particles.forEach(p => {
        p.position.addScaledVector(p._vel, 0.016);
        p._vel.y -= 10 * 0.016;
        p.material.opacity = Math.max(0, 1 - t * 2);
        p.material.transparent = true;
      });
      if (t < 0.8) requestAnimationFrame(tick);
      else particles.forEach(p => this.scene.remove(p));
    };
    requestAnimationFrame(tick);
  }

  update(dt, camera) {
    // Spawn new mobs periodically
    this.spawnTimer += dt;
    if (this.spawnTimer > 6 && this.mobs.length < this.maxMobs) {
      this.spawnMob();
      this.spawnTimer = 0;
    }

    const playerPos = this.player.position;
    const time = performance.now() / 1000;

    this.mobs.forEach(mob => {
      if (!mob.alive) return;

      const distToPlayer = mob.mesh.position.distanceTo(playerPos);
      const chasing      = distToPlayer < 8;

      // === AI movement ===
      let moveX = 0, moveZ = 0;

      if (chasing) {
        // Chase player
        const dx = playerPos.x - mob.mesh.position.x;
        const dz = playerPos.z - mob.mesh.position.z;
        const len = Math.sqrt(dx*dx + dz*dz) || 1;
        moveX = (dx / len) * mob.def.speed;
        moveZ = (dz / len) * mob.def.speed;
        mob.mesh.rotation.y = Math.atan2(dx, dz);
      } else {
        // Wander
        mob.wander.timer -= dt;
        if (mob.wander.timer <= 0) {
          const a = Math.random() * Math.PI * 2;
          mob.wander.targetX = mob.mesh.position.x + Math.cos(a) * 4;
          mob.wander.targetZ = mob.mesh.position.z + Math.sin(a) * 4;
          mob.wander.timer   = 2 + Math.random() * 3;
        }
        const dx = mob.wander.targetX - mob.mesh.position.x;
        const dz = mob.wander.targetZ - mob.mesh.position.z;
        const len = Math.sqrt(dx*dx + dz*dz) || 1;
        if (len > 0.5) {
          moveX = (dx / len) * mob.def.speed * 0.5;
          moveZ = (dz / len) * mob.def.speed * 0.5;
          mob.mesh.rotation.y = Math.atan2(dx, dz);
        }
      }

      mob.mesh.position.x += moveX * dt;
      mob.mesh.position.z += moveZ * dt;

      // Clamp to world bounds
      mob.mesh.position.x = Math.max(0.5, Math.min(this.world.width  - 0.5, mob.mesh.position.x));
      mob.mesh.position.z = Math.max(0.5, Math.min(this.world.depth  - 0.5, mob.mesh.position.z));

      // Snap Y to ground
      const gx = Math.floor(mob.mesh.position.x);
      const gz = Math.floor(mob.mesh.position.z);
      const gy = this.world.getHeight(gx, gz) + 1;
      mob.mesh.position.y += (gy - mob.mesh.position.y) * 0.2;

      // Bob/bounce animation
      mob.bobPhase += dt * (chasing ? 8 : 3);
      mob.mesh.children[0].position.y = Math.abs(Math.sin(mob.bobPhase)) * 0.1;
      mob.mesh.scale.setScalar(1 + Math.abs(Math.sin(mob.bobPhase)) * 0.05);

      // Attack player on contact
      if (distToPlayer < 1.2) {
        const now = performance.now();
        const last = this.attackCooldowns.get(mob) || 0;
        if (now - last > 1500) {
          this.attackCooldowns.set(mob, now);
          // Signal damage to main.js via custom event
          window.dispatchEvent(new CustomEvent('mob-attack', { detail: { damage: mob.def.damage, mobType: mob.type } }));
        }
      }

      // Update floating health bar screen position
      if (mob._hpBar) {
        const labelPos = mob.mesh.position.clone();
        labelPos.y += mob.def.size * 0.8;
        const screen = this._projectToScreen(labelPos, camera);
        if (screen.visible) {
          mob._hpBar.style.left = screen.x + 'px';
          mob._hpBar.style.top  = screen.y + 'px';
          mob._hpBar.style.display = 'flex';
        } else {
          mob._hpBar.style.display = 'none';
        }
      }
    });
  }
}
