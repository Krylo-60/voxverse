// ============================================================
// Voxverse Player Physics & Camera collision Engine (V2.0)
// ============================================================
import * as THREE from 'three';
import { BLOCK_TYPES } from './world.js';

export class Player {
  constructor(world, camera, domElement) {
    this.world = world;
    this.camera = camera;
    this.domElement = domElement;

    // Movement state vectors
    this.position = new THREE.Vector3(16, 12, 16); // Start high to prevent clipping initial terrain
    this.velocity = new THREE.Vector3();
    this.acceleration = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    // Player physical bounding box dimensions
    this.width = 0.6;
    this.height = 1.7;
    this.depth = 0.6;

    // Physics toggles
    this.isGrounded = false;
    this.flyMode = false;
    this.cameraMode = 'first'; // 'first' or 'third'

    // Key states
    this.keys = {
      KeyW: false, KeyA: false, KeyS: false, KeyD: false,
      Space: false, ShiftLeft: false, ControlLeft: false
    };

    // Sprint / sneak states
    this.isSprinting = false;
    this.isSneaking  = false;
    this._lastWPress  = 0; // Minecraft-style double-tap W sprint detection

    this.initInput();
  }

  initInput() {
    window.addEventListener('keydown', (e) => {
      const code = e.code === 'Space' ? 'Space' : e.code;
      if (this.keys.hasOwnProperty(code)) {
        this.keys[code] = true;
      }

      // Fly Mode: Key 'F'
      if (e.code === 'KeyF' && document.pointerLockElement) {
        this.flyMode = !this.flyMode;
        this.velocity.set(0, 0, 0);
        this.addNotification(`Fly Mode: ${this.flyMode ? 'ON ✈️' : 'OFF 🦶'}`);
      }

      // Camera: Key 'V' or 'F5'
      if ((e.code === 'F5' || e.code === 'KeyV') && document.pointerLockElement) {
        e.preventDefault();
        this.cameraMode = this.cameraMode === 'first' ? 'third' : 'first';
        this.addNotification(`Camera: ${this.cameraMode === 'first' ? '👁️ First Person' : '🎥 Third Person'}`);
      }

      // Double W to Sprint
      if (e.code === 'KeyW') {
        const now = Date.now();
        if (now - this._lastWPress < 280 && !this.flyMode) {
          this.isSprinting = true;
          this.addNotification('🏃 Sprinting active!');
        }
        this._lastWPress = now;
      }
    });

    window.addEventListener('keyup', (e) => {
      const code = e.code === 'Space' ? 'Space' : e.code;
      if (this.keys.hasOwnProperty(code)) {
        this.keys[code] = false;
      }
      if (e.code === 'KeyW') this.isSprinting = false;
      if (e.code === 'ControlLeft') this.isSprinting = false;
    });

    // Pointer Lock mouse look listeners
    this.domElement.addEventListener('click', () => {
      if (document.pointerLockElement !== this.domElement) {
        this.domElement.requestPointerLock();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.domElement) return;

      const sensitivity = 0.0022;
      this.yaw -= e.movementX * sensitivity;
      this.pitch -= e.movementY * sensitivity;

      // Limit pitch to prevent looking past zenith/nadir
      const limit = Math.PI / 2.05;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    });
  }

  addNotification(text) {
    const chatContainer = document.getElementById('chat-messages');
    if (!chatContainer) return;
    
    const msg = document.createElement('div');
    msg.className = 'chat-message system';
    msg.innerHTML = `
      <span class="timestamp">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> 
      <span class="message-content" style="color: #38bdf8; font-weight: bold;">[SYSTEM] ${text}</span>
    `;
    chatContainer.appendChild(msg);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  // Check if player bounding box collides with solid voxels
  collidesAt(pos) {
    const minX = Math.floor(pos.x - this.width / 2);
    const maxX = Math.floor(pos.x + this.width / 2);
    const minY = Math.floor(pos.y - 0.05); // Include check slightly below feet
    const maxY = Math.floor(pos.y + this.height);
    const minZ = Math.floor(pos.z - this.depth / 2);
    const maxZ = Math.floor(pos.z + this.depth / 2);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          // Query voxel from chunk entries
          const block = this.world.getVoxel(x, y, z);
          if (block !== BLOCK_TYPES.AIR && block !== BLOCK_TYPES.WATER) {
            return true; // Collision!
          }
        }
      }
    }
    return false;
  }

  update(dt, avatarGroup) {
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).normalize();
    const right   = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).normalize();

    // Sprint checks (Ctrl key or double W)
    if (this.keys.ControlLeft && this.keys.KeyW && !this.flyMode) {
      this.isSprinting = true;
    }
    if (!this.keys.KeyW) {
      this.isSprinting = false;
    }

    // Sneaking slower speed & crouched camera
    this.isSneaking = this.keys.ShiftLeft && !this.flyMode;

    // Movement speed modulators: sneak 3, walk 8, sprint 14, fly 20
    let speed = 8;
    if (this.flyMode)          speed = 20;
    else if (this.isSprinting) speed = 14;
    else if (this.isSneaking)  speed = 3;

    // Apply movement accelerations
    this.acceleration.set(0, 0, 0);
    if (this.keys.KeyW) this.acceleration.add(forward);
    if (this.keys.KeyS) this.acceleration.sub(forward);
    if (this.keys.KeyD) this.acceleration.add(right);
    if (this.keys.KeyA) this.acceleration.sub(right);

    this.acceleration.normalize().multiplyScalar(speed);

    // Apply physics
    if (this.flyMode) {
      this.velocity.x = this.acceleration.x;
      this.velocity.z = this.acceleration.z;
      if (this.keys.Space) {
        this.velocity.y = speed * 0.7;
      } else if (this.keys.ShiftLeft) {
        this.velocity.y = -speed * 0.7;
      } else {
        this.velocity.y = 0;
      }
    } else {
      // Gravity
      this.velocity.y -= 23 * dt;
      this.velocity.x = this.acceleration.x;
      this.velocity.z = this.acceleration.z;

      // Jump
      if (this.keys.Space && this.isGrounded && !this.isSneaking) {
        this.velocity.y = 7.8;
        this.isGrounded = false;
        this.isSprinting = false;
      }
    }

    // Resolve Axis-Aligned AABB collisions
    const nextPos = this.position.clone();

    // 1. Resolve X collision
    nextPos.x += this.velocity.x * dt;
    if (this.collidesAt(nextPos)) {
      nextPos.x = this.position.x;
      this.velocity.x = 0;
    } else {
      this.position.x = nextPos.x;
    }

    // 2. Resolve Z collision
    nextPos.z += this.velocity.z * dt;
    if (this.collidesAt(nextPos)) {
      nextPos.z = this.position.z;
      this.velocity.z = 0;
    } else {
      this.position.z = nextPos.z;
    }

    // 3. Resolve Y collision
    nextPos.y += this.velocity.y * dt;
    if (this.collidesAt(nextPos)) {
      if (this.velocity.y < 0) {
        this.isGrounded = true;
      }
      nextPos.y = this.position.y;
      this.velocity.y = 0;
    } else {
      this.position.y = nextPos.y;
      if (!this.flyMode) {
        this.isGrounded = false;
      }
    }

    // Void fallback coordinates
    if (this.position.y < -15) {
      this.position.set(16, 12, 16);
      this.velocity.set(0, 0, 0);
      this.addNotification("Respawned! Fell into the deep void.");
    }

    // Sync Avatar positioning
    if (avatarGroup) {
      avatarGroup.position.copy(this.position);
      avatarGroup.rotation.y = this.yaw;
      avatarGroup.visible = (this.cameraMode === 'third');
    }

    // View FOV modifiers based on sprinting
    const targetFov = this.isSprinting ? 87 : 75;
    if (this.camera.fov !== targetFov) {
      this.camera.fov += (targetFov - this.camera.fov) * 0.12;
      this.camera.updateProjectionMatrix();
    }

    // Camera Collision loop check
    const headHeight = this.isSneaking ? 1.05 : 1.45;
    const playerHead = this.position.clone().add(new THREE.Vector3(0, headHeight, 0));

    if (this.cameraMode === 'first') {
      this.camera.position.copy(playerHead);
      const lookTarget = new THREE.Vector3(0, 0, -1)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw)
        .add(this.camera.position);

      this.camera.lookAt(lookTarget);
    } else {
      // Third Person orbit with block culling collision check
      const cameraOffset = new THREE.Vector3(0, 0.4, 3.6)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), -this.pitch * 0.45)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

      const targetCameraPos = playerHead.clone().add(cameraOffset);
      let finalCameraPos = targetCameraPos.clone();

      // Check points along vector from head to desired position
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const checkPoint = playerHead.clone().lerp(targetCameraPos, t);
        const voxel = this.world.getVoxel(Math.floor(checkPoint.x), Math.floor(checkPoint.y), Math.floor(checkPoint.z));
        
        if (voxel !== BLOCK_TYPES.AIR && voxel !== BLOCK_TYPES.WATER) {
          // Collision! Set camera slightly back towards the head to prevent clipping
          const backStep = Math.max(0, i - 1.5) / steps;
          finalCameraPos = playerHead.clone().lerp(targetCameraPos, backStep);
          break;
        }
      }

      this.camera.position.copy(finalCameraPos);
      const lookTarget = this.position.clone().add(new THREE.Vector3(0, headHeight * 0.85, 0));
      this.camera.lookAt(lookTarget);
    }
  }

  getHorizontalSpeed() {
    return Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
  }
}
