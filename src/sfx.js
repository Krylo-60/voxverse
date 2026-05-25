// ============================================================
// Voxverse Procedural SFX & Spatial Audio Synthesis Engine
// ============================================================
import * as THREE from 'three';

let audioCtx = null;

export function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// Update the 3D Audio Listener coordinates & orientation
export function updateAudioListener(playerPosition, camera) {
  const ctx = getAudioContext();
  const listener = ctx.listener;

  // Retrieve camera look vectors
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();

  if (listener.positionX) {
    // Modern Web Audio API spec
    listener.positionX.setValueAtTime(playerPosition.x, ctx.currentTime);
    listener.positionY.setValueAtTime(playerPosition.y, ctx.currentTime);
    listener.positionZ.setValueAtTime(playerPosition.z, ctx.currentTime);

    listener.forwardX.setValueAtTime(forward.x, ctx.currentTime);
    listener.forwardY.setValueAtTime(forward.y, ctx.currentTime);
    listener.forwardZ.setValueAtTime(forward.z, ctx.currentTime);

    listener.upX.setValueAtTime(up.x, ctx.currentTime);
    listener.upY.setValueAtTime(up.y, ctx.currentTime);
    listener.upZ.setValueAtTime(up.z, ctx.currentTime);
  } else {
    // Legacy support
    listener.setPosition(playerPosition.x, playerPosition.y, playerPosition.z);
    listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }
}

// Procedurally play audio effect
export function playSFX(type) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  if (type === 'break') {
    // Voxel Break: Low-pass filtered random noise burst
    const bufferSize = ctx.sampleRate * 0.15; // 150ms
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2.0 - 1.0;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(380, now);
    filter.frequency.exponentialRampToValueAtTime(10, now + 0.15);

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.4, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    noiseSource.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    noiseSource.start(now);
  }

  else if (type === 'hurt') {
    // Player Hurt: Sudden square wave dropping exponentially
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.16);

    gainNode.gain.setValueAtTime(0.25, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.16);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc.start(now);
    osc.stop(now + 0.17);
  }

  else if (type === 'levelUp') {
    // Level Up: C-major major arpeggio sweeps (C4 -> E4 -> G4 -> C5)
    const arpeggio = [261.63, 329.63, 392.00, 523.25];
    
    arpeggio.forEach((frequency, index) => {
      const noteTime = now + index * 0.08;
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(frequency, noteTime);

      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.setValueAtTime(0.2, noteTime);
      gainNode.gain.exponentialRampToValueAtTime(0.002, noteTime + 0.24);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc.start(noteTime);
      osc.stop(noteTime + 0.28);
    });
  }

  else if (type === 'chat') {
    // Chat Notification chime
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(580, now);
    osc.frequency.setValueAtTime(880, now + 0.06);

    gainNode.gain.setValueAtTime(0.12, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.22);
  }
}

// Procedural spatial voice sound chimes for close-by bots
export function playSpatialVoiceChime(botPosition, type) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const panner = ctx.createPanner();

  // Configure HRTF spatial culling
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1;
  panner.maxDistance = 25;
  panner.rollOffFactor = 1.5;

  panner.positionX.setValueAtTime(botPosition.x, now);
  panner.positionY.setValueAtTime(botPosition.y, now);
  panner.positionZ.setValueAtTime(botPosition.z, now);

  osc.type = 'sine';
  if (type === 'join') {
    osc.frequency.setValueAtTime(350, now);
    osc.frequency.setValueAtTime(450, now + 0.08);
  } else if (type === 'leave') {
    osc.frequency.setValueAtTime(450, now);
    osc.frequency.setValueAtTime(300, now + 0.08);
  } else {
    // Speech chime bubbles
    const pitch = 200 + Math.random() * 200;
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.setValueAtTime(pitch * 1.5, now + 0.06);
  }

  gainNode.gain.setValueAtTime(0.15, now);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

  osc.connect(gainNode);
  gainNode.connect(panner);
  panner.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.25);
}
