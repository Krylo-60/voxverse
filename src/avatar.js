import * as THREE from 'three';

export class PlayerAvatar {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    
    // Customization state
    this.state = {
      skinColor: '#ffdbac',    // Human skin tone
      shirtColor: '#2b5c8f',   // Blue shirt
      pantsColor: '#1c1c1c',   // Dark grey pants
      hatType: 'none',         // none, wizard, crown, bunny
      hasWings: false          // back wings
    };

    // Body parts
    this.parts = {};
    this.hatMesh = null;
    this.wingsMesh = null;
    this.wingL = null;
    this.wingR = null;

    this.build();
    this.scene.add(this.group);
  }

  // Build the blocky character parts (Roblox/Minecraft proportions)
  build() {
    // Clear any existing children
    while(this.group.children.length > 0) { 
      this.group.remove(this.group.children[0]); 
    }

    const skinMat = new THREE.MeshStandardMaterial({ color: this.state.skinColor, roughness: 0.8 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: this.state.shirtColor, roughness: 0.8 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: this.state.pantsColor, roughness: 0.8 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: '#222222', roughness: 0.9 });

    // Head (8x8x8 pixels equivalent)
    const headGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 1.35;
    head.castShadow = true;
    head.receiveShadow = true;
    this.group.add(head);
    this.parts.head = head;

    // Face details (Minecraft eyes)
    const eyeMatL = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const eyeMatR = new THREE.MeshBasicMaterial({ color: '#3b82f6' }); // Blue pupils
    
    // Left Eye
    const eyeLBg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.02), eyeMatL);
    eyeLBg.position.set(-0.15, 0.05, 0.301);
    head.add(eyeLBg);
    const eyeLPupil = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), eyeMatR);
    eyeLPupil.position.set(-0.12, 0.05, 0.302);
    head.add(eyeLPupil);

    // Right Eye
    const eyeRBg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.02), eyeMatL);
    eyeRBg.position.set(0.15, 0.05, 0.301);
    head.add(eyeRBg);
    const eyeRPupil = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), eyeMatR);
    eyeRPupil.position.set(0.18, 0.05, 0.302);
    head.add(eyeRPupil);

    // Torso (8x12x4 equivalent)
    const torsoGeo = new THREE.BoxGeometry(0.8, 0.9, 0.4);
    const torso = new THREE.Mesh(torsoGeo, shirtMat);
    torso.position.y = 0.6;
    torso.castShadow = true;
    torso.receiveShadow = true;
    this.group.add(torso);
    this.parts.torso = torso;

    // Left Arm (4x12x4 equivalent)
    const armGeo = new THREE.BoxGeometry(0.3, 0.9, 0.3);
    
    const armL = new THREE.Mesh(armGeo, shirtMat);
    armL.position.set(-0.6, 0.6, 0);
    armL.castShadow = true;
    armL.receiveShadow = true;
    this.group.add(armL);
    this.parts.armL = armL;

    // Hand skin colored bottom part
    const handLGeo = new THREE.BoxGeometry(0.3, 0.15, 0.3);
    const handL = new THREE.Mesh(handLGeo, skinMat);
    handL.position.y = -0.45;
    armL.add(handL);

    // Right Arm
    const armR = new THREE.Mesh(armGeo, shirtMat);
    armR.position.set(0.6, 0.6, 0);
    armR.castShadow = true;
    armR.receiveShadow = true;
    this.group.add(armR);
    this.parts.armR = armR;

    const handR = new THREE.Mesh(handLGeo, skinMat);
    handR.position.y = -0.45;
    armR.add(handR);

    // Left Leg
    const legGeo = new THREE.BoxGeometry(0.35, 0.8, 0.35);
    
    const legL = new THREE.Mesh(legGeo, pantsMat);
    legL.position.set(-0.22, 0.25, 0);
    legL.castShadow = true;
    legL.receiveShadow = true;
    this.group.add(legL);
    this.parts.legL = legL;

    // Shoe
    const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.38), shoeMat);
    shoeL.position.set(0, -0.42, 0.015);
    legL.add(shoeL);

    // Right Leg
    const legR = new THREE.Mesh(legGeo, pantsMat);
    legR.position.set(0.22, 0.25, 0);
    legR.castShadow = true;
    legR.receiveShadow = true;
    this.group.add(legR);
    this.parts.legR = legR;

    const shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.38), shoeMat);
    shoeR.position.set(0, -0.42, 0.015);
    legR.add(shoeR);

    // Attachments
    this.buildHat();
    this.buildWings();
  }

  buildHat() {
    if (this.state.hatType === 'none') return;

    this.hatMesh = new THREE.Group();

    if (this.state.hatType === 'wizard') {
      // Wide purple brim
      const brimMat = new THREE.MeshStandardMaterial({ color: '#4b2e83', roughness: 0.8 });
      const brimGeo = new THREE.CylinderGeometry(0.65, 0.65, 0.05, 16);
      const brim = new THREE.Mesh(brimGeo, brimMat);
      brim.position.y = 0.3;
      this.hatMesh.add(brim);

      // Pointy wizard cone
      const coneGeo = new THREE.ConeGeometry(0.4, 0.8, 16);
      const cone = new THREE.Mesh(coneGeo, brimMat);
      cone.position.y = 0.7;
      this.hatMesh.add(cone);

      // Gold band
      const goldMat = new THREE.MeshStandardMaterial({ color: '#ffd700', metalness: 0.6, roughness: 0.2 });
      const bandGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.08, 16);
      const band = new THREE.Mesh(bandGeo, goldMat);
      band.position.y = 0.35;
      this.hatMesh.add(band);
    } 
    else if (this.state.hatType === 'crown') {
      // Golden Cylinder with spiked look
      const goldMat = new THREE.MeshStandardMaterial({ color: '#ffd700', metalness: 0.8, roughness: 0.1 });
      const baseGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.15, 8, 1, true); // Open cylinder
      const base = new THREE.Mesh(baseGeo, goldMat);
      base.position.y = 0.38;
      this.hatMesh.add(base);

      // Spikes
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.15, 4), goldMat);
        spike.position.set(Math.cos(angle) * 0.38, 0.48, Math.sin(angle) * 0.38);
        spike.rotation.y = -angle;
        spike.rotation.z = -0.1;
        this.hatMesh.add(spike);
      }

      // Red lining inside
      const velvetMat = new THREE.MeshStandardMaterial({ color: '#b22222', roughness: 0.9 });
      const velvet = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2), velvetMat);
      velvet.position.y = 0.32;
      this.hatMesh.add(velvet);
    } 
    else if (this.state.hatType === 'bunny') {
      const earMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 });
      const pinkMat = new THREE.MeshStandardMaterial({ color: '#ffb6c1', roughness: 0.8 });

      // Left Ear
      const leftEar = new THREE.Group();
      const earLOuter = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.08), earMat);
      const earLInner = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.04), pinkMat);
      earLInner.position.z = 0.021;
      leftEar.add(earLOuter);
      leftEar.add(earLInner);
      leftEar.position.set(-0.15, 0.45, 0);
      leftEar.rotation.z = -0.15;
      leftEar.rotation.x = -0.1;
      this.hatMesh.add(leftEar);

      // Right Ear
      const rightEar = new THREE.Group();
      const earROuter = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.08), earMat);
      const earRInner = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.04), pinkMat);
      earRInner.position.z = 0.021;
      rightEar.add(earROuter);
      rightEar.add(earRInner);
      rightEar.position.set(0.15, 0.45, 0);
      rightEar.rotation.z = 0.15;
      rightEar.rotation.x = -0.1;
      this.hatMesh.add(rightEar);
    }

    // Attach hat group to the Head mesh so it rotates and moves with it
    this.parts.head.add(this.hatMesh);
  }

  buildWings() {
    if (!this.state.hasWings) return;

    this.wingsMesh = new THREE.Group();
    this.wingsMesh.position.set(0, 0.6, -0.22); // Attach to torso back

    const wingMat = new THREE.MeshStandardMaterial({ 
      color: '#06b6d4', 
      roughness: 0.3, 
      transparent: true, 
      opacity: 0.75,
      side: THREE.DoubleSide 
    });

    // Left Wing
    this.wingL = new THREE.Group();
    const wingLBlade = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.04), wingMat);
    wingLBlade.position.x = -0.45; // Pivot point on edge
    this.wingL.add(wingLBlade);
    this.wingL.rotation.y = 0.3; // Default angle
    this.wingsMesh.add(this.wingL);

    // Right Wing
    this.wingR = new THREE.Group();
    const wingRBlade = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.04), wingMat);
    wingRBlade.position.x = 0.45; // Pivot point on edge
    this.wingR.add(wingRBlade);
    this.wingR.rotation.y = -0.3; // Default angle
    this.wingsMesh.add(this.wingR);

    this.group.add(this.wingsMesh);
  }

  // Call this to update customization state dynamically
  updateCustomization(newState) {
    this.state = { ...this.state, ...newState };
    this.build();
  }

  // Animation cycle for walking and idling
  tick(time, velocity = 0, isJumping = false) {
    // Left/Right arm and leg swinging when walking (Roblox/Minecraft style)
    if (velocity > 0.05) {
      const swingSpeed = 12;
      const swingRange = 0.75;
      const angle = Math.sin(time * swingSpeed) * swingRange;

      this.parts.armL.rotation.x = angle;
      this.parts.armR.rotation.x = -angle;
      this.parts.legL.rotation.x = -angle * 0.8;
      this.parts.legR.rotation.x = angle * 0.8;

      // Arms pivot points adjustments
      this.parts.armL.position.z = -angle * 0.1;
      this.parts.armR.position.z = angle * 0.1;

      // Make character lean forward slightly while walking
      this.parts.torso.rotation.x = 0.08;
    } else {
      // Idle breathing effect
      const breathe = Math.sin(time * 2) * 0.02;
      this.parts.torso.position.y = 0.6 + breathe;
      this.parts.head.position.y = 1.35 + breathe * 0.7;

      // Return limbs to neutral
      this.parts.armL.rotation.x = THREE.MathUtils.lerp(this.parts.armL.rotation.x, 0, 0.1);
      this.parts.armR.rotation.x = THREE.MathUtils.lerp(this.parts.armR.rotation.x, 0, 0.1);
      this.parts.legL.rotation.x = THREE.MathUtils.lerp(this.parts.legL.rotation.x, 0, 0.1);
      this.parts.legR.rotation.x = THREE.MathUtils.lerp(this.parts.legR.rotation.x, 0, 0.1);
      this.parts.torso.rotation.x = THREE.MathUtils.lerp(this.parts.torso.rotation.x, 0, 0.1);
      
      this.parts.armL.position.z = 0;
      this.parts.armR.position.z = 0;
    }

    // Jump poses
    if (isJumping) {
      // Lift arms up and legs back
      this.parts.armL.rotation.x = THREE.MathUtils.lerp(this.parts.armL.rotation.x, -Math.PI / 3, 0.2);
      this.parts.armR.rotation.x = THREE.MathUtils.lerp(this.parts.armR.rotation.x, -Math.PI / 3, 0.2);
      this.parts.legL.rotation.x = THREE.MathUtils.lerp(this.parts.legL.rotation.x, 0.3, 0.2);
      this.parts.legR.rotation.x = THREE.MathUtils.lerp(this.parts.legR.rotation.x, 0.3, 0.2);
    }

    // Wings flapping animation
    if (this.state.hasWings && this.wingL && this.wingR) {
      const flapSpeed = velocity > 0.05 ? 18 : 3;
      const flapRange = velocity > 0.05 ? 0.6 : 0.15;
      const flapAngle = Math.sin(time * flapSpeed) * flapRange;

      this.wingL.rotation.y = 0.4 + flapAngle;
      this.wingR.rotation.y = -0.4 - flapAngle;

      // Gentle flapping up/down tilt
      this.wingsMesh.rotation.x = Math.sin(time * flapSpeed) * 0.08;
    }
  }
}
