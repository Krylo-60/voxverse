// ============================================================
// Voxverse Web Worker — Terrain & Texture Engine (V2.0)
// ============================================================

// 2D Simplex Noise generator for procedural biome heightmaps and texturing
const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;

class SimplexNoise {
  constructor(seed = 1337) {
    this.p = new Uint8Array(256);
    // Permutation table seeded procedurally
    for (let i = 0; i < 256; i++) {
      this.p[i] = Math.floor(((Math.sin(i + seed) * 10000) % 1) * 256);
    }
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = this.p[i & 255];
      this.permMod12[i] = (this.perm[i] % 12);
    }
  }

  noise2D(xin, yin) {
    const grad3 = [
      [1, 1], [-1, 1], [1, -1], [-1, -1],
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [Math.sqrt(2)/2, Math.sqrt(2)/2], [-Math.sqrt(2)/2, Math.sqrt(2)/2],
      [Math.sqrt(2)/2, -Math.sqrt(2)/2], [-Math.sqrt(2)/2, -Math.sqrt(2)/2]
    ];

    let n0, n1, n2;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = xin - X0;
    const y0 = yin - Y0;

    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; }
    else { i1 = 0; j1 = 1; }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1.0 + 2.0 * G2;
    const y2 = y0 - 1.0 + 2.0 * G2;

    const ii = i & 255;
    const jj = j & 255;

    const gi0 = this.permMod12[ii + this.perm[jj]];
    const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1]];
    const gi2 = this.permMod12[ii + 1 + this.perm[jj + 1]];

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 < 0) n0 = 0.0;
    else {
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi0][0] * x0 + grad3[gi0][1] * y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 < 0) n1 = 0.0;
    else {
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi1][0] * x1 + grad3[gi1][1] * y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 < 0) n2 = 0.0;
    else {
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi2][0] * x2 + grad3[gi2][1] * y2);
    }

    return 70.0 * (n0 + n1 + n2);
  }
}

const simplex = new SimplexNoise(4242);

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
    return (simplex.noise2D(x * scale, y * scale) + 1) / 2;
  };

  if (type === 'grassTop') {
    // Grass Blades & Moss patches
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const n = getNoise(x, y, 0.08);
        let r = 22, g = 197, b = 94; // base #22c55e
        if (n > 0.6) { r = 21; g = 128; b = 61; } // dark moss #15803d
        else if (n < 0.35) { r = 74; g = 222; b = 128; } // light grass #4ade80

        // Vertical Blade Wisps Overlay
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
    // Rich earthy soil & pebble structures
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const n = getNoise(x, y, 0.12);
        let r = 120, g = 53, b = 15; // base #78350f
        if (n > 0.7) { r = 92; g = 40; b = 14; } // dark dirt
        else if (n < 0.3) { r = 138; g = 82; b = 32; } // light brown

        // Pebble fragments math overlay
        const pebble = getNoise(x + 10, y + 20, 0.45);
        if (pebble > 0.8) {
          r = 100; g = 100; b = 100; // Grey pebbles
        }
        setPixel(x, y, r, g, b);
      }
    }
  }

  else if (type === 'stone') {
    // Crack lines and rocky slate
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const n = getNoise(x, y, 0.07);
        let r = 100, g = 116, b = 139; // base #64748b
        if (n > 0.65) { r = 71; g = 85; b = 105; }
        else if (n < 0.35) { r = 124; g = 143; b = 163; }

        // Crack lines math
        const crack = Math.sin(x * 0.15 + y * 0.15) * Math.cos(x * 0.05 - y * 0.1);
        if (Math.abs(crack) < 0.02 && n > 0.4) {
          r = 40; g = 40; b = 40; // Dark granite cracks
        }
        setPixel(x, y, r, g, b);
      }
    }
  }

  else if (type === 'wood') {
    // Horizontal wood ring grains
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
    // Organic leaf cluster layered shapes (with alpha values)
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const n = getNoise(x, y, 0.15);
        let r = 22, g = 163, b = 74; // base green
        let a = 255;
        
        if (n > 0.7) { r = 20; g = 84; b = 45; } // deep shade
        else if (n < 0.22) {
          r = 0; g = 0; b = 0; a = 0; // leaf cutouts (culling pixels)
        }
        setPixel(x, y, r, g, b, a);
      }
    }
  }

  else if (type === 'water') {
    // Wave ripples and water sparkles
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const wave = Math.sin(x * 0.15 + performance.now() * 0.002) * Math.cos(y * 0.15);
        let r = 29, g = 78, b = 216; // base blue #1d4ed8
        if (wave > 0.6) { r = 96; g = 165; b = 250; } // cyan waves
        else if (wave < -0.6) { r = 30; g = 58; b = 138; } // dark water
        setPixel(x, y, r, g, b, 200);
      }
    }
  }

  else if (type === 'sand') {
    // Volcanic sand / gold dust granules
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const n = getNoise(x, y, 0.25);
        let r = 253, g = 230, b = 138; // base #fde68a
        if (n > 0.8) { r = 245; g = 158; b = 11; } // gold granule
        else if (n < 0.2) { r = 254; g = 243; b = 199; }
        setPixel(x, y, r, g, b);
      }
    }
  }

  else if (type === 'crystal') {
    // Faceted geometric sparkle vectors
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const distToCenter = Math.sqrt((x - sz/2)**2 + (y - sz/2)**2);
        const facet = Math.sin(x * 0.2) * Math.cos(y * 0.2);
        let r = 217, g = 70, b = 239; // base pink #d946ef
        
        if (facet > 0.3) { r = 250; g = 232; b = 255; } // high light reflection
        else if (distToCenter > 24) { r = 112; g = 26; b = 117; } // dark boundary
        setPixel(x, y, r, g, b, 220);
      }
    }
  }

  else if (type === 'torch') {
    // Flame core colors
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        let r = 92, g = 64, b = 0; // wood rod base
        if (y < 20) {
          // Flame glow top
          const distToFlame = Math.sqrt((x - sz/2)**2 + (y - 10)**2);
          if (distToFlame < 8) {
            r = 234; g = 88; b = 12; // Orange flame core
            if (distToFlame < 4) { r = 250; g = 204; b = 21; } // Yellow center
          } else {
            r = 0; g = 0; b = 0; // Transparent surrounding pixels
            setPixel(x, y, r, g, b, 0);
            continue;
          }
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
      torch:    generateProceduralTexture('torch')
    };

    // Return as high-performance Transferable Objects
    const buffers = Object.values(textures).map(tex => tex.buffer);
    self.postMessage({ type: 'texturesGenerated', textures }, buffers);
  }

  else if (type === 'generateChunk') {
    const { cx, cy, cz } = payload;
    const chunkSize = 16;
    const voxels = new Uint8Array(chunkSize * chunkSize * chunkSize);
    
    // Procedurally compute Biome at this chunk column using simplex noise
    const biomeVal = (simplex.noise2D(cx * 0.12, cz * 0.12) + 1) / 2; // 0.0 to 1.0
    let biome = 'canopy'; // Default leafy rolling hills
    if (biomeVal > 0.68) {
      biome = 'peaks'; // High craggy peaks
    } else if (biomeVal < 0.32) {
      biome = 'sand'; // Dry volcanic sand plains
    }

    // Populate voxel coordinate matrix (16x16x16)
    for (let x = 0; x < chunkSize; x++) {
      for (let z = 0; z < chunkSize; z++) {
        const worldX = cx * chunkSize + x;
        const worldZ = cz * chunkSize + z;

        // Custom noise variables depending on biome
        let heightScale = 0.05;
        let baseHeight = 6;
        let amp = 5;

        if (biome === 'peaks') {
          heightScale = 0.09;
          baseHeight = 12;
          amp = 11;
        } else if (biome === 'sand') {
          heightScale = 0.03;
          baseHeight = 4;
          amp = 2;
        }

        const heightVal = simplex.noise2D(worldX * heightScale, worldZ * heightScale);
        const finalHeight = Math.floor(baseHeight + heightVal * amp);

        for (let y = 0; y < chunkSize; y++) {
          const worldY = cy * chunkSize + y;
          let block = 0; // Air

          if (worldY < finalHeight - 2) {
            block = 3; // Stone
          } else if (worldY < finalHeight) {
            block = (biome === 'sand') ? 7 : 2; // Sand or Dirt
          } else if (worldY === finalHeight) {
            if (biome === 'peaks') {
              // Place random crystals on peaks
              block = (Math.random() > 0.95) ? 8 : 3;
            } else if (biome === 'sand') {
              block = 7; // Sand
            } else {
              block = 1; // Grass
            }
          } else if (worldY < 5 && biome !== 'peaks') {
            block = 6; // Water layer
          }

          // Compute 1D chunk coordinate index
          const idx = x + y * chunkSize + z * chunkSize * chunkSize;
          voxels[idx] = block;
        }
      }
    }

    // Spawn elemental structure accents (trees/crystals) inside chunk bounds
    // Trees spawn randomly in Canopy biome
    if (biome === 'canopy' && cy === 0) {
      const treeX = 8 + Math.floor(Math.sin(cx) * 4);
      const treeZ = 8 + Math.floor(Math.cos(cz) * 4);
      const treeIdx = treeX + 0 * chunkSize + treeZ * chunkSize * chunkSize; // base check
      
      // Safe check bounds
      if (treeX > 2 && treeX < 13 && treeZ > 2 && treeZ < 13) {
        const heightVal = simplex.noise2D((cx * chunkSize + treeX) * 0.05, (cz * chunkSize + treeZ) * 0.05);
        const baseH = Math.floor(6 + heightVal * 5);
        
        // Spawn wood columns
        for (let ty = baseH + 1; ty <= baseH + 4; ty++) {
          if (ty >= cy * chunkSize && ty < (cy + 1) * chunkSize) {
            const yOffset = ty - cy * chunkSize;
            voxels[treeX + yOffset * chunkSize + treeZ * chunkSize * chunkSize] = 4; // Wood
          }
        }
        // Spawn leaves crown
        for (let ty = baseH + 3; ty <= baseH + 5; ty++) {
          if (ty >= cy * chunkSize && ty < (cy + 1) * chunkSize) {
            const yOffset = ty - cy * chunkSize;
            for (let lx = treeX - 1; lx <= treeX + 1; lx++) {
              for (let lz = treeZ - 1; lz <= treeZ + 1; lz++) {
                if (voxels[lx + yOffset * chunkSize + lz * chunkSize * chunkSize] === 0) {
                  voxels[lx + yOffset * chunkSize + lz * chunkSize * chunkSize] = 5; // Leaves
                }
              }
            }
          }
        }
      }
    }

    // Transfer raw voxel Uint8Array buffers back to main thread
    self.postMessage({ type: 'chunkGenerated', payload: { cx, cy, cz, voxels, biome } }, [voxels.buffer]);
  }
};
