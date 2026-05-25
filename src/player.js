// ============================================================
// Voxverse Player Physics & Kinematics Engine (V3.0)
// ============================================================
import * as THREE from 'three';
import { BLOCK_TYPES } from './world.js';

export class Player {
  constructor(world, camera, domElement) {
    this.world = world;
    this.camera = camera;
    this.domElement = domElement;

    // Movement state vectors (Newtonian kinematics)
    this.position = new THREE.Vector3(16, 15, 16); // High starting position
    this.velocity = new THREE.Vector3();
    this.forces = new THREE.Vector3();
    this.mass = 1.0; // F = ma (m=1.0)
    
    this.yaw = 0;
    this.pitch = 0;

    // Player bounding box dimensions
    this.width = 0.6;
    this.height = 1.75;
    this.depth = 0.6;

    // Physics toggles
    this.isGrounded = false;
    this.flyMode = false;
    this.cameraMode = 'first'; // 'first' or 'third'

    // Smooth Third-Person camera position interpolation
    this.smoothedCameraPos = new THREE.Vector3();

    // Key states
    this.keys = {
      KeyW: false, KeyA: false, KeyS: false, KeyD: false,
      Space: false, ShiftLeft: false, ControlLeft: false
    };

    this.isSprinting = false;
    this.isSneaking = false;
    this._lastWPress = 0;

    this.initInput();
  }

  initInput() {
    // Keyboard inputs explicitly bound to the global 'document' context
    document.addEventListener('keydown', (e) => {
      const code = e.code === 'Space' ? 'Space' : e.code;
      if (this.keys.hasOwnProperty(code)) {
        this.keys[code] = true;
      }

      // Toggle Fly: 'F' key
      if (e.code === 'KeyF' && document.pointerLockElement === this.domElement) {
        this.flyMode = !this.flyMode;
        this.velocity.set(0, 0, 0);
        this.addNotification(`Fly Mode: ${this.flyMode ? 'ON ✈️' : 'OFF 🦶'}`);
      }

      // Camera: 'V' or 'F5' keys
      if ((e.code === 'F5' || e.code === 'KeyV') && document.pointerLockElement === this.domElement) {
        e.preventDefault();
        this.cameraMode = this.cameraMode === 'first' ? 'third' : 'first';
        this.addNotification(`Camera: ${this.cameraMode === 'first' ? '👁️ First Person' : '🎥 Third Person'}`);
      }

      // Double-Tap W to sprint
      if (e.code === 'KeyW') {
        const now = Date.now();
        if (now - this._lastWPress < 280 && !this.flyMode) {
          this.isSprinting = true;
          this.addNotification('🏃 Sprinting active!');
        }
        this._lastWPress = now;
      }
    });

    document.addEventListener('keyup', (e) => {
      const code = e.code === 'Space' ? 'Space' : e.code;
      if (this.keys.hasOwnProperty(code)) {
        this.keys[code] = false;
      }
      if (code === 'KeyW') this.isSprinting = false;
      if (code === 'ControlLeft') this.isSprinting = false;
    });

    // Reset controls on pointer lock disengagement to prevent drift/paralysis
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.domElement) {
        Object.keys(this.keys).forEach(k => this.keys[k] = false);
        this.isSprinting = false;
        this.isSneaking = false;
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.domElement) return;

      const sensitivity = 0.0022;
      this.yaw -= e.movementX * sensitivity;
      this.pitch -= e.movementY * sensitivity;

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

  // Bounding box query
  collidesAt(pos) {
    const minX = Math.floor(pos.x - this.width / 2);
    const maxX = Math.floor(pos.x + this.width / 2);
    const minY = Math.floor(pos.y - 0.05);
    const maxY = Math.floor(pos.y + this.height);
    const minZ = Math.floor(pos.z - this.depth / 2);
    const maxZ = Math.floor(pos.z + this.depth / 2);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const block = this.world.getVoxel(x, y, z);
          if (block !== BLOCK_TYPES.AIR && block !== BLOCK_TYPES.WATER) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // Check if player is currently in water
  isInWater() {
    const px = Math.floor(this.position.x);
    const py = Math.floor(this.position.y + 0.15); // check lower torso
    const pz = Math.floor(this.position.z);
    return this.world.getVoxel(px, py, pz) === BLOCK_TYPES.WATER;
  }

  update(dt, avatarGroup) {
    const inWater = this.isInWater();
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).normalize();
    const right   = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).normalize();

    // Reset forces loop (F = ma)
    this.forces.set(0, 0, 0);

    // Apply keyboard force multipliers based on state
    let inputForceMag = 35.0; // base force
    if (this.flyMode) {
      inputForceMag = 65.0;
    } else if (inWater) {
      inputForceMag = 20.0; // Drag of water reduces force effectiveness
    } else if (this.isSprinting) {
      inputForceMag = 55.0;
    } else if (this.isSneaking) {
      inputForceMag = 15.0;
    }

    const inputDir = new THREE.Vector3();
    if (this.keys.KeyW) inputDir.add(forward);
    if (this.keys.KeyS) inputDir.sub(forward);
    if (this.keys.KeyD) inputDir.add(right);
    if (this.keys.KeyA) inputDir.sub(right);

    if (inputDir.lengthSq() > 0) {
      inputDir.normalize().multiplyScalar(inputForceMag);
      this.forces.add(inputDir);
    }

    // Apply Environment Forces (Gravity, Friction, Viscosity, Drag)
    if (this.flyMode) {
      // 3D air viscosity
      const dragCoeff = 4.0;
      const dragForce = this.velocity.clone().multiplyScalar(-dragCoeff);
      this.forces.add(dragForce);

      // Flying vertical controls
      if (this.keys.Space) {
        this.forces.y += inputForceMag * 0.75;
      } else if (this.keys.ShiftLeft) {
        this.forces.y -= inputForceMag * 0.75;
      }
    } else {
      // Gravity
      const gravityAcc = inWater ? -8.0 : -22.0; // less gravity in water
      this.forces.y += gravityAcc * this.mass;

      // Viscous Drag / Surface Friction
      let frictionCoeff = 5.0; // Default ground traction friction
      if (inWater) {
        frictionCoeff = 8.0; // High liquid viscosity
      } else if (!this.isGrounded) {
        frictionCoeff = 0.8; // Air resistance is low
      } else if (this.isSprinting) {
        frictionCoeff = 3.5; // lower friction when sprinting to conserve forward slide
      }

      // Apply horizontal friction force
      const horizVelocity = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
      const frictionForce = horizVelocity.multiplyScalar(-frictionCoeff);
      this.forces.x += frictionForce.x;
      this.forces.z += frictionForce.z;

      // Jump impulse
      if (this.keys.Space && (this.isGrounded || inWater) && !this.isSneaking) {
        const jumpImpulse = inWater ? 4.5 : 7.6;
        this.velocity.y = jumpImpulse;
        this.isGrounded = false;
      }
    }

    // Integrate forces: a = F/m, v = v + a*dt
    const acc = this.forces.clone().multiplyScalar(1.0 / this.mass);
    this.velocity.addScaledVector(acc, dt);

    // Terminal velocity caps
    let maxSpeed = 7.5;
    if (this.flyMode)          maxSpeed = 18.0;
    else if (this.isSprinting) maxSpeed = 12.5;
    else if (this.isSneaking)  maxSpeed = 2.8;
    else if (inWater)          maxSpeed = 3.8;

    const horizSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
    if (horizSpeed > maxSpeed) {
      const scale = maxSpeed / horizSpeed;
      this.velocity.x *= scale;
      this.velocity.z *= scale;
    }

    // Kinematics Resolution: Axis-Separated Diagonal Sliding Collision Checks
    const nextPos = this.position.clone();

    // 1. Resolve X axis movement (allows sliding along Z-walls)
    nextPos.x += this.velocity.x * dt;
    if (this.collidesAt(nextPos)) {
      nextPos.x = this.position.x;
      this.velocity.x = 0; // stop X momentum, conserving Z
    } else {
      this.position.x = nextPos.x;
    }

    // 2. Resolve Z axis movement (allows sliding along X-walls)
    nextPos.z += this.velocity.z * dt;
    if (this.collidesAt(nextPos)) {
      nextPos.z = this.position.z;
      this.velocity.z = 0; // stop Z momentum, conserving X
    } else {
      this.position.z = nextPos.z;
    }

    // 3. Resolve Y axis movement (gravity / jumping)
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

    // Deep void reset
    if (this.position.y < -15) {
      this.position.set(16, 15, 16);
      this.velocity.set(0, 0, 0);
      this.addNotification("Respawned! Fell into the void.");
    }

    // Sync avatar meshes
    if (avatarGroup) {
      avatarGroup.position.copy(this.position);
      avatarGroup.rotation.y = this.yaw;
      avatarGroup.visible = (this.cameraMode === 'third');
    }

    // Sprinting FOV
    const targetFov = this.isSprinting && horizSpeed > 1 ? 87 : 75;
    if (this.camera.fov !== targetFov) {
      this.camera.fov += (targetFov - this.camera.fov) * 0.12;
      this.camera.updateProjectionMatrix();
    }

    // Camera Collision resolving with Interpolation follow path
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
      // Third Person orbit camera with block obstacle culling
      const cameraOffset = new THREE.Vector3(0, 0.4, 3.6)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), -this.pitch * 0.45)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

      const targetCameraPos = playerHead.clone().add(cameraOffset);
      let finalCameraPos = targetCameraPos.clone();

      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const checkPoint = playerHead.clone().lerp(targetCameraPos, t);
        const voxel = this.world.getVoxel(Math.floor(checkPoint.x), Math.floor(checkPoint.y), Math.floor(checkPoint.z));
        
        if (voxel !== BLOCK_TYPES.AIR && voxel !== BLOCK_TYPES.WATER) {
          const backStep = Math.max(0, i - 1.5) / steps;
          finalCameraPos = playerHead.clone().lerp(targetCameraPos, backStep);
          break;
        }
      }

      // Smoothly interpolate camera movement for fluid follow path
      this.smoothedCameraPos.lerp(finalCameraPos, 0.18);
      this.camera.position.copy(this.smoothedCameraPos);

      const lookTarget = this.position.clone().add(new THREE.Vector3(0, headHeight * 0.85, 0));
      this.camera.lookAt(lookTarget);
    }
  }

  getHorizontalSpeed() {
    return Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
  }
}
