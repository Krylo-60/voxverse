// ============================================================
// Voxverse Web Worker — Terrain & Texture Engine (V4.0)
// ============================================================

// High-precision 3D Perlin Noise class for caves, strata, and noise octaves
class PerlinNoise3D {
  constructor(seed = 1337) {
    this.p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      this.p[i] = Math.floor(((Math.sin(i + seed) * 10000) % 1) * 256);
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = this.p[i & 255];
    }
  }

  fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  lerp(t, a, b) {
    return a + t * (b - a);
  }

  grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  noise3D(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);

    const u = this.fade(x);
    const v = this.fade(y);
    const w = this.fade(z);

    const A = this.perm[X] + Y;
    const AA = this.perm[A] + Z;
    const AB = this.perm[A + 1] + Z;
    const B = this.perm[X + 1] + Y;
    const BA = this.perm[B] + Z;
    const BB = this.perm[B + 1] + Z;

    return this.lerp(w, this.lerp(v, this.lerp(u, this.grad(this.perm[AA], x, y, z),
                                                  this.grad(this.perm[BA], x - 1, y, z)),
                                      this.lerp(u, this.grad(this.perm[AB], x, y - 1, z),
                                                  this.grad(this.perm[BB], x - 1, y - 1, z))),
                         this.lerp(v, this.lerp(u, this.grad(this.perm[AA + 1], x, y, z - 1),
                                                  this.grad(this.perm[BA + 1], x - 1, y, z - 1)),
                                      this.lerp(u, this.grad(this.perm[AB + 1], x, y - 1, z - 1),
                                                  this.grad(this.perm[BB + 1], x - 1, y - 1, z - 1))));
  }

  fBm(x, y, z, octaves = 4, persistence = 0.5, lacunarity = 2.0) {
    let total = 0;
    let frequency = 1.0;
    let amplitude = 1.0;
    let maxValue = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.noise3D(x * frequency, y * frequency, z * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return total / maxValue;
  }
}

const perlin = new PerlinNoise3D(4242);

// High-precision wrapping to prevent floating-point precision loss at massive coordinates (+/- 30,000,000)
const wrapCoord = (v) => {
  const maxRange = 65536; // Large enough power of 2 to fit seamless biomes
  return ((v % maxRange) + maxRange) % maxRange;
};

// Procedurally generate high-fidelity raw pixel arrays (64x64 RGBA)
function generateProceduralTexture(type, sz = 64) {
  const pixels = new Uint8ClampedArray(sz * sz * 4);

  const setPixel = (x, y, r, g, b, a = 255) => {
    if (x < 0 || x >= sz || y < 0 || y >= sz) return;
    const offset = (y * sz + x) * 4;
    pixels[offset]     = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;
    pixels[offset + 3] = a;
  };

  const getNoise = (x, y, scale) => {
    return (perlin.noise3D(x * scale, y * scale, 0.5) + 1) / 2;
  };

  if (type === 'grassTop') {
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const n = getNoise(x, y, 0.08);
        let r = 22, g = 197, b = 94; // base #22c55e
        if (n > 0.6) { r = 21; g = 128; b = 61; }
        else if (n < 0.35) { r = 74; g = 222; b = 128; }
        const bladeVal = Math.sin(x * 0.4) * Math.cos(y * 0.1);
        if (bladeVal > 0.4) {
          r = Math.max(0, r - 30);
          g = Math.min(255, g + 20);
        }
        setPixel(x, y, r, g, b);
      }
    }
  }

  else if (type === 'dirt') {
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const n = getNoise(x, y, 0.12);
        let r = 120, g = 53, b = 15; // base #78350f
        if (n > 0.7) { r = 92; g = 40; b = 14; }
        else if (n < 0.3) { r = 138; g = 82; b = 32; }
        const pebble = getNoise(x + 10, y + 20, 0.45);
        if (pebble > 0.8) {
          r = 100; g = 100; b = 100;
        }
        setPixel(x, y, r, g, b);
      }
    }
  }

  else if (type === 'stone') {
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const n = getNoise(x, y, 0.07);
        let r = 100, g = 116, b = 139; // base #64748b
        if (n > 0.65) { r = 71; g = 85; b = 105; }
        else if (n < 0.35) { r = 124; g = 143; b = 163; }
        const crack = Math.sin(x * 0.15 + y * 0.15) * Math.cos(x * 0.05 - y * 0.1);
        if (Math.abs(crack) < 0.02 && n > 0.4) {
          r = 40; g = 40; b = 40;
        }
        setPixel(x, y, r, g, b);
      }
    }
  }

  else if (type === 'wood') {
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const ring = (Math.sin(y * 0.4 + 1.2) + Math.cos(x * 0.1) * 0.2 + 1) / 2;
        const brightness = 0.75 + ring * 0.25;
        const r = Math.floor(139 * brightness);
        const g = Math.floor(92 * brightness);
        const b = Math.floor(26 * brightness);
        setPixel(x, y, r, g, b);
      }
    }
  }

  else if (type === 'leaves') {
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const n = getNoise(x, y, 0.15);
        let r = 22, g = 163, b = 74;
        let a = 255;
        if (n > 0.7) { r = 20; g = 84; b = 45; }
        else if (n < 0.22) {
          r = 0; g = 0; b = 0; a = 0;
        }
        setPixel(x, y, r, g, b, a);
      }
    }
  }

  else if (type === 'water') {
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const wave = Math.sin(x * 0.15) * Math.cos(y * 0.15);
        let r = 29, g = 78, b = 216;
        if (wave > 0.6) { r = 96; g = 165; b = 250; }
        else if (wave < -0.6) { r = 30; g = 58; b = 138; }
        setPixel(x, y, r, g, b, 200);
      }
    }
  }

  else if (type === 'sand') {
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const n = getNoise(x, y, 0.25);
        let r = 253, g = 230, b = 138;
        if (n > 0.8) { r = 245; g = 158; b = 11; }
        else if (n < 0.2) { r = 254; g = 243; b = 199; }
        setPixel(x, y, r, g, b);
      }
    }
  }

  else if (type === 'crystal') {
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const distToCenter = Math.sqrt((x - sz/2)**2 + (y - sz/2)**2);
        const facet = Math.sin(x * 0.2) * Math.cos(y * 0.2);
        let r = 217, g = 70, b = 239;
        if (facet > 0.3) { r = 250; g = 232; b = 255; }
        else if (distToCenter > 24) { r = 112; g = 26; b = 117; }
        setPixel(x, y, r, g, b, 220);
      }
    }
  }

  else if (type === 'torch') {
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        let r = 92, g = 64, b = 0;
        if (y < 20) {
          const distToFlame = Math.sqrt((x - sz/2)**2 + (y - 10)**2);
          if (distToFlame < 8) {
            r = 234; g = 88; b = 12;
            if (distToFlame < 4) { r = 250; g = 204; b = 21; }
          } else {
            setPixel(x, y, 0, 0, 0, 0);
            continue;
          }
        }
        setPixel(x, y, r, g, b);
      }
    }
  }

  else if (type === 'coal') {
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const n = getNoise(x, y, 0.15);
        let r = 100, g = 116, b = 139;
        if (n > 0.6) {
          r = 24; g = 24; b = 27;
        }
        setPixel(x, y, r, g, b);
      }
    }
  }

  else if (type === 'iron') {
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const n = getNoise(x, y, 0.18);
        let r = 100, g = 116, b = 139;
        if (n > 0.65) {
          r = 180; g = 83; b = 9;
        }
        setPixel(x, y, r, g, b);
      }
    }
  }

  return pixels;
}

// Global Message Hub Coordinator
self.onmessage = function(e) {
  const { type, payload } = e.data;

  if (type === 'generateTextures') {
    const textures = {
      grassTop: generateProceduralTexture('grassTop'),
      dirt:     generateProceduralTexture('dirt'),
      stone:    generateProceduralTexture('stone'),
      wood:     generateProceduralTexture('wood'),
      leaves:   generateProceduralTexture('leaves'),
      water:    generateProceduralTexture('water'),
      sand:     generateProceduralTexture('sand'),
      crystal:  generateProceduralTexture('crystal'),
      torch:    generateProceduralTexture('torch'),
      coal:     generateProceduralTexture('coal'),
      iron:     generateProceduralTexture('iron')
    };

    const buffers = Object.values(textures).map(tex => tex.buffer);
    self.postMessage({ type: 'texturesGenerated', textures }, buffers);
  }

  else if (type === 'generateChunk') {
    const { cx, cy, cz } = payload;
    const chunkSize = 16;
    const voxels = new Uint8Array(chunkSize * chunkSize * chunkSize);
    
    // Wrapped chunk coordinates for deterministic biome tracking
    const wcx = ((cx % 4096) + 4096) % 4096;
    const wcz = ((cz % 4096) + 4096) % 4096;

    // Determine biome column-wise using 2D wrapped noise
    const biomeVal = (perlin.noise3D(wcx * 0.1, 0.5, wcz * 0.1) + 1) / 2;
    let biome = 'canopy';
    if (biomeVal > 0.68) {
      biome = 'peaks';
    } else if (biomeVal < 0.32) {
      biome = 'sand';
    }

    // 3D Density generation loop
    for (let x = 0; x < chunkSize; x++) {
      for (let z = 0; z < chunkSize; z++) {
        const worldX = cx * chunkSize + x;
        const worldZ = cz * chunkSize + z;

        // Apply high-precision wrapping to eliminate noise vertex jitter
        const wx = wrapCoord(worldX);
        const wz = wrapCoord(worldZ);

        for (let y = 0; y < chunkSize; y++) {
          const worldY = cy * chunkSize + y;

          // 3D Fractal noise density field calculation using high-precision wrapped coordinates
          const nVal = perlin.fBm(wx * 0.035, worldY * 0.05, wz * 0.035, 4, 0.5, 2.0);
          
          const baseline = (worldY - 14) / 8;
          const density = nVal - baseline;

          let block = 0; // default Air

          if (density > 0) {
            const densityAbove = perlin.fBm(wx * 0.035, (worldY + 1) * 0.05, wz * 0.035, 4, 0.5, 2.0) - ((worldY + 1) - 14) / 8;
            const densityTwoAbove = perlin.fBm(wx * 0.035, (worldY + 2) * 0.05, wz * 0.035, 4, 0.5, 2.0) - ((worldY + 2) - 14) / 8;

            if (densityAbove <= 0) {
              if (biome === 'sand') {
                block = 7; // Sand
              } else if (biome === 'peaks') {
                block = (Math.random() > 0.94) ? 8 : 3; // Stone or Crystal
              } else {
                block = 1; // Grass
              }
            } else if (densityTwoAbove <= 0) {
              block = (biome === 'sand') ? 7 : 2; // Sand or Dirt
            } else {
              block = 3; // Stone base

              // Ore vein spawning using high-precision wrapped coordinates
              if (worldY >= 4 && worldY <= 22) {
                const coalNoise = perlin.noise3D(wx * 0.22, worldY * 0.22, wz * 0.22);
                if (coalNoise > 0.55) {
                  block = 10; // Coal Ore
                }
              }
              if (worldY >= 2 && worldY <= 15) {
                const ironNoise = perlin.noise3D(wx * 0.25, worldY * 0.25, wz * 0.25);
                if (ironNoise > 0.6) {
                  block = 11; // Iron Ore
                }
              }
              if (worldY >= 1 && worldY <= 10) {
                const crystalNoise = perlin.noise3D(wx * 0.28, worldY * 0.28, wz * 0.28);
                if (crystalNoise > 0.65) {
                  block = 8; // Crystal block
                }
              }
            }
          } else {
            if (worldY < 5 && biome !== 'peaks') {
              block = 6; // Water
            }
          }

          const idx = x + y * chunkSize + z * chunkSize * chunkSize;
          voxels[idx] = block;
        }
      }
    }

    // Decorate structural passes: Spawning deterministic trees within bounds
    if (biome === 'canopy' && cy === 0) {
      const treeX = 8 + Math.floor(Math.sin(wcx * 15.3) * 4);
      const treeZ = 8 + Math.floor(Math.cos(wcz * 22.7) * 4);

      if (treeX > 2 && treeX < 13 && treeZ > 2 && treeZ < 13) {
        let surfaceY = -1;
        for (let y = chunkSize - 1; y >= 0; y--) {
          const idx = treeX + y * chunkSize + treeZ * chunkSize * chunkSize;
          if (voxels[idx] === 1) { // Grass surface found!
            surfaceY = y;
            break;
          }
        }

        if (surfaceY !== -1 && surfaceY < chunkSize - 7) {
          const height = 5;
          for (let ty = surfaceY + 1; ty <= surfaceY + height; ty++) {
            const tIdx = treeX + ty * chunkSize + treeZ * chunkSize * chunkSize;
            voxels[tIdx] = 4; // Wood Trunk
          }

          for (let ly = surfaceY + height - 2; ly <= surfaceY + height + 1; ly++) {
            const rad = (ly === surfaceY + height + 1) ? 1 : 2;
            for (let lx = treeX - rad; lx <= treeX + rad; lx++) {
              for (let lz = treeZ - rad; lz <= treeZ + rad; lz++) {
                if (lx === treeX && lz === treeZ && ly <= surfaceY + height) continue;
                const lIdx = lx + ly * chunkSize + lz * chunkSize * chunkSize;
                if (voxels[lIdx] === 0) {
                  voxels[lIdx] = 5; // Leaves
                }
              }
            }
          }
        }
      }
    }

    self.postMessage({ type: 'chunkGenerated', payload: { cx, cy, cz, voxels, biome } }, [voxels.buffer]);
  }
};
