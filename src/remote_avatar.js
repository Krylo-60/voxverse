// ============================================================
// Voxverse — Remote Player Avatar Manager
// src/remote_avatar.js
// ============================================================
// Manages Three.js blocky avatars for each remote player,
// including smooth position interpolation and nameplate labels.
// ============================================================

import * as THREE from 'three';

// Lerp speed for smooth position interpolation
const LERP_SPEED = 12.0;

export class RemoteAvatarManager {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene   = scene;
    this.avatars = new Map(); // playerId → { group, parts, label, ... }
  }

  // ──────────────────────────────────────────────────────────
  //  Public API
  // ──────────────────────────────────────────────────────────

  /**
   * Add or update a remote player avatar.
   * @param {string} id
   * @param {Object} playerData  { name, x, y, z, yaw, speed, avatar }
   */
  addOrUpdate(id, playerData) {
    if (!this.avatars.has(id)) {
      this._createAvatar(id, playerData);
    }
    const a = this.avatars.get(id);

    // Update interpolation targets
    a.targetX = playerData.x  ?? a.targetX;
    a.targetY = playerData.y  ?? a.targetY;
    a.targetZ = playerData.z  ?? a.targetZ;
    a.yaw     = playerData.yaw ?? a.yaw;
    a.speed   = playerData.speed ?? 0;
    a.name    = playerData.name ?? a.name;

    this._refreshNameplate(a);
  }

  /**
   * Remove a remote player's avatar from the scene.
   * @param {string} id
   */
  remove(id) {
    const a = this.avatars.get(id);
    if (a) {
      this.scene.remove(a.group);
      this.avatars.delete(id);
    }
  }

  /**
   * Update all remote avatars (call from the game loop).
   * @param {number} dt  - Delta time in seconds
   */
  tick(dt) {
    const now   = performance.now() / 1000;
    const alpha = Math.min(1.0, LERP_SPEED * dt); // clamped lerp factor

    this.avatars.forEach((a) => {
      // Smooth position interpolation
      a.group.position.x = THREE.MathUtils.lerp(a.group.position.x, a.targetX, alpha);
      a.group.position.y = THREE.MathUtils.lerp(a.group.position.y, a.targetY - 1.2, alpha);
      a.group.position.z = THREE.MathUtils.lerp(a.group.position.z, a.targetZ, alpha);

      // Smooth yaw rotation
      a.group.rotation.y = THREE.MathUtils.lerp(a.group.rotation.y, a.yaw, alpha * 0.7);

      // Walking animation
      this._animateAvatar(a, now, dt);
    });
  }

  /**
   * Clear all remote avatars (e.g. on disconnect).
   */
  clear() {
    this.avatars.forEach((a) => this.scene.remove(a.group));
    this.avatars.clear();
  }

  // ──────────────────────────────────────────────────────────
  //  Avatar Construction
  // ──────────────────────────────────────────────────────────

  _createAvatar(id, data) {
    const group = new THREE.Group();

    const skin  = data.avatar?.skinColor  || '#ffdbac';
    const shirt = data.avatar?.shirtColor || '#6366f1';
    const pants = data.avatar?.pantsColor || '#1c1c1c';

    const skinMat  = new THREE.MeshStandardMaterial({ color: skin,  roughness: 0.8 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.8 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.8 });
    const shoeMat  = new THREE.MeshStandardMaterial({ color: '#222222', roughness: 0.9 });

    // ── Head ──
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.6, 0.6), skinMat
    );
    head.position.y = 1.35;
    head.castShadow = true;
    group.add(head);

    // Eyes
    const eyeWhite = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const eyeBlue  = new THREE.MeshBasicMaterial({ color: '#3b82f6' });
    [[  -0.15, 'L' ], [ 0.15, 'R' ]].forEach(([ex]) => {
      const white = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.02), eyeWhite);
      white.position.set(ex, 0.05, 0.301);
      head.add(white);
      const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), eyeBlue);
      pupil.position.set(ex + (ex < 0 ? 0.03 : -0.03), 0.05, 0.302);
      head.add(pupil);
    });

    // ── Torso ──
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.9, 0.4), shirtMat
    );
    torso.position.y = 0.6;
    torso.castShadow = true;
    group.add(torso);

    // ── Arms ──
    const armGeo = new THREE.BoxGeometry(0.3, 0.9, 0.3);
    const armL   = new THREE.Mesh(armGeo, shirtMat);
    armL.position.set(-0.6, 0.6, 0);
    armL.castShadow = true;
    group.add(armL);

    const armR = new THREE.Mesh(armGeo, shirtMat);
    armR.position.set(0.6, 0.6, 0);
    armR.castShadow = true;
    group.add(armR);

    // Hand pads
    const handGeo = new THREE.BoxGeometry(0.3, 0.15, 0.3);
    const handL   = new THREE.Mesh(handGeo, skinMat);
    handL.position.y = -0.45;
    armL.add(handL);

    const handR = new THREE.Mesh(handGeo, skinMat);
    handR.position.y = -0.45;
    armR.add(handR);

    // ── Legs ──
    const legGeo = new THREE.BoxGeometry(0.35, 0.8, 0.35);
    const legL   = new THREE.Mesh(legGeo, pantsMat);
    legL.position.set(-0.22, 0.25, 0);
    legL.castShadow = true;
    group.add(legL);

    const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.38), shoeMat);
    shoeL.position.set(0, -0.42, 0.015);
    legL.add(shoeL);

    const legR = new THREE.Mesh(legGeo, pantsMat);
    legR.position.set(0.22, 0.25, 0);
    legR.castShadow = true;
    group.add(legR);

    const shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.38), shoeMat);
    shoeR.position.set(0, -0.42, 0.015);
    legR.add(shoeR);

    // ── Nameplate ──
    const nameplate = this._makeNameplate(data.name || 'Player', shirt);
    nameplate.position.y = 1.9;
    group.add(nameplate);

    // Set initial position
    group.position.set(data.x, (data.y ?? 12) - 1.2, data.z);
    group.rotation.y = data.yaw ?? 0;
    this.scene.add(group);

    this.avatars.set(id, {
      group,
      parts: { head, torso, armL, armR, legL, legR },
      nameplate,
      targetX: data.x,
      targetY: data.y ?? 12,
      targetZ: data.z,
      yaw:     data.yaw ?? 0,
      speed:   0,
      name:    data.name || 'Player',
      shirtColor: shirt,
    });
  }

  _makeNameplate(name, color = '#6366f1') {
    const canvas = document.createElement('canvas');
    canvas.width  = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Background pill
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this._roundRect(ctx, 8, 10, 240, 44, 12);
    ctx.fill();

    // Border glow
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    this._roundRect(ctx, 8, 10, 240, 44, 12);
    ctx.stroke();

    // Name text
    ctx.fillStyle   = '#ffffff';
    ctx.font        = 'bold 22px Arial, sans-serif';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 128, 32);

    const tex  = new THREE.CanvasTexture(canvas);
    const mat  = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.4, 0.35, 1);
    return sprite;
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  _refreshNameplate(a) {
    // Rebuild nameplate if name changed
    if (a._lastNameplateText !== a.name) {
      a._lastNameplateText = a.name;
      const newPlate = this._makeNameplate(a.name, a.shirtColor);
      newPlate.position.y = 1.9;
      if (a.nameplate) a.group.remove(a.nameplate);
      a.group.add(newPlate);
      a.nameplate = newPlate;
    }
  }

  // ──────────────────────────────────────────────────────────
  //  Walking Animation
  // ──────────────────────────────────────────────────────────

  _animateAvatar(a, time, dt) {
    const { head, torso, armL, armR, legL, legR } = a.parts;
    const speed = a.speed;

    // Make nameplates always face camera (billboard)
    if (a.nameplate) {
      a.nameplate.material.rotation = 0;
    }

    if (speed > 0.05) {
      const swingSpeed = 12;
      const swingRange = 0.75;
      const angle      = Math.sin(time * swingSpeed) * swingRange;

      armL.rotation.x = angle;
      armR.rotation.x = -angle;
      legL.rotation.x = -angle * 0.8;
      legR.rotation.x =  angle * 0.8;

      armL.position.z = -angle * 0.1;
      armR.position.z =  angle * 0.1;

      torso.rotation.x = 0.08;
    } else {
      // Idle breathing
      const breathe = Math.sin(time * 2) * 0.02;
      torso.position.y = 0.6 + breathe;
      head.position.y  = 1.35 + breathe * 0.7;

      const lerpBack = 0.1;
      armL.rotation.x = THREE.MathUtils.lerp(armL.rotation.x, 0, lerpBack);
      armR.rotation.x = THREE.MathUtils.lerp(armR.rotation.x, 0, lerpBack);
      legL.rotation.x = THREE.MathUtils.lerp(legL.rotation.x, 0, lerpBack);
      legR.rotation.x = THREE.MathUtils.lerp(legR.rotation.x, 0, lerpBack);
      torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, 0, lerpBack);

      armL.position.z = 0;
      armR.position.z = 0;
    }
  }
}
