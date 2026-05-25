// ============================================================
// Voxverse Voxel World & Chunk Renderer Engine (V2.0)
// ============================================================
import * as THREE from 'three';

// Block types enumeration
export const BLOCK_TYPES = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  WOOD: 4,
  LEAVES: 5,
  WATER: 6,
  SAND: 7,
  CRYSTAL: 8,
  TORCH: 9,
  COAL: 10,
  IRON: 11
};

const blockBoxGeometry = new THREE.BoxGeometry(1, 1, 1);

export class VoxelWorld {
  constructor(width = 64, height = 32, depth = 64) {
    this.width = width;
    this.height = height;
    this.depth = depth;
    this.chunkSize = 16;

    // Spatial hash grids
    this.chunks = new Map(); // 'cx,cy,cz' -> Uint8Array(4096)
    this.biomes = new Map(); // 'cx,cz' -> string
    this.chunkMeshes = new Map(); // 'cx,cy,cz' -> THREE.Group
    this.dirtyChunks = new Set(); // Set of dirty chunk keys

    // Dedicated background chunk builder Web Worker
    this.worker = new Worker(new URL('./world-worker.js', import.meta.url), { type: 'module' });
    this.pendingChunks = new Map(); // 'cx,cy,cz' -> callback

    // Listen for Web Worker chunk generation messages
    this.worker.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'chunkGenerated') {
        const { cx, cy, cz, voxels, biome } = payload;
        const key = `${cx},${cy},${cz}`;
        
        this.chunks.set(key, voxels);
        this.biomes.set(`${cx},${cz}`, biome);
        this.dirtyChunks.add(key);

        const callback = this.pendingChunks.get(key);
        if (callback) {
          this.pendingChunks.delete(key);
          callback();
        }
      }
    };
  }

  // Map global block coordinates to chunk indexing
  getChunkCoords(x, y, z) {
    const cx = Math.floor(x / this.chunkSize);
    const cy = Math.floor(y / this.chunkSize);
    const cz = Math.floor(z / this.chunkSize);
    
    // JavaScript modulo operator behaves weirdly with negatives, wrap around
    const lx = ((x % this.chunkSize) + this.chunkSize) % this.chunkSize;
    const ly = ((y % this.chunkSize) + this.chunkSize) % this.chunkSize;
    const lz = ((z % this.chunkSize) + this.chunkSize) % this.chunkSize;

    return { cx, cy, cz, lx, ly, lz };
  }

  // Get block ID at global coordinates
  getBlock(x, y, z) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height || z < 0 || z >= this.depth) {
      return BLOCK_TYPES.AIR;
    }

    const { cx, cy, cz, lx, ly, lz } = this.getChunkCoords(x, y, z);
    const key = `${cx},${cy},${cz}`;
    const chunk = this.chunks.get(key);
    if (!chunk) return BLOCK_TYPES.AIR;

    const idx = lx + ly * this.chunkSize + lz * this.chunkSize * this.chunkSize;
    return chunk[idx];
  }

  // getVoxel alias for backward/forward compatibility
  getVoxel(x, y, z) {
    return this.getBlock(x, y, z);
  }

  // Place block ID at global coordinates
  setBlock(x, y, z, type) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height || z < 0 || z >= this.depth) {
      return false;
    }

    const { cx, cy, cz, lx, ly, lz } = this.getChunkCoords(x, y, z);
    const key = `${cx},${cy},${cz}`;
    let chunk = this.chunks.get(key);
    
    if (!chunk) {
      chunk = new Uint8Array(this.chunkSize * this.chunkSize * this.chunkSize);
      this.chunks.set(key, chunk);
    }

    const idx = lx + ly * this.chunkSize + lz * this.chunkSize * this.chunkSize;
    chunk[idx] = type;
    
    // Mark current chunk as dirty
    this.dirtyChunks.add(key);

    // Mark neighbor chunks as dirty if block sits on boundary edges
    if (lx === 0) this.dirtyChunks.add(`${cx - 1},${cy},${cz}`);
    if (lx === this.chunkSize - 1) this.dirtyChunks.add(`${cx + 1},${cy},${cz}`);
    if (ly === 0) this.dirtyChunks.add(`${cx},${cy - 1},${cz}`);
    if (ly === this.chunkSize - 1) this.dirtyChunks.add(`${cx},${cy + 1},${cz}`);
    if (lz === 0) this.dirtyChunks.add(`${cx},${cy},${cz - 1}`);
    if (lz === this.chunkSize - 1) this.dirtyChunks.add(`${cx},${cy},${cz + 1}`);

    return true;
  }

  // Get peak height at x, z column
  getHeight(x, z) {
    for (let y = this.height - 1; y >= 0; y--) {
      const block = this.getBlock(x, y, z);
      if (block !== BLOCK_TYPES.AIR && block !== BLOCK_TYPES.WATER) {
        return y;
      }
    }
    return 0;
  }

  // Query biome type at x, z column
  getBiomeAt(x, z) {
    const cx = Math.floor(x / this.chunkSize);
    const cz = Math.floor(z / this.chunkSize);
    return this.biomes.get(`${cx},${cz}`) || 'canopy';
  }

  // Query background worker for chunk procedural terrain data
  generateChunkAsync(cx, cy, cz) {
    const key = `${cx},${cy},${cz}`;
    return new Promise((resolve) => {
      if (this.chunks.has(key)) {
        resolve();
        return;
      }
      this.pendingChunks.set(key, resolve);
      this.worker.postMessage({ type: 'generateChunk', payload: { cx, cy, cz } });
    });
  }

  // Pre-load all chunks during loading phase
  async preloadWorld(onProgress) {
    const totalChunksX = Math.ceil(this.width / this.chunkSize);
    const totalChunksY = Math.ceil(this.height / this.chunkSize);
    const totalChunksZ = Math.ceil(this.depth / this.chunkSize);
    const total = totalChunksX * totalChunksY * totalChunksZ;
    let loaded = 0;

    const promises = [];
    for (let cx = 0; cx < totalChunksX; cx++) {
      for (let cy = 0; cy < totalChunksY; cy++) {
        for (let cz = 0; cz < totalChunksZ; cz++) {
          promises.push(
            this.generateChunkAsync(cx, cy, cz).then(() => {
              loaded++;
              if (onProgress) onProgress(loaded / total);
            })
          );
        }
      }
    }
    await Promise.all(promises);
  }

  // Voxel Hidden Face culling filter check
  // Returns true if a block at x,y,z is completely surrounded by opaque blocks
  isVoxelHidden(x, y, z) {
    const neighbors = [
      [x + 1, y, z],
      [x - 1, y, z],
      [x, y + 1, z],
      [x, y - 1, z],
      [x, y, z + 1],
      [x, y, z - 1]
    ];

    for (const [nx, ny, nz] of neighbors) {
      const type = this.getBlock(nx, ny, nz);
      // Exposure if neighbor is AIR or transparent (water, leaves)
      if (type === BLOCK_TYPES.AIR || type === BLOCK_TYPES.WATER || type === BLOCK_TYPES.LEAVES) {
        return false;
      }
    }
    return true; // Block is hidden inside terrain
  }

  // Recompile dirty chunks using optimized draw calls
  rebuildDirtyChunkMeshes(scene, materials) {
    if (this.dirtyChunks.size === 0) return;

    this.dirtyChunks.forEach(key => {
      const [cx, cy, cz] = key.split(',').map(Number);
      
      // Check boundaries
      if (cx < 0 || cx >= Math.ceil(this.width / this.chunkSize) ||
          cy < 0 || cy >= Math.ceil(this.height / this.chunkSize) ||
          cz < 0 || cz >= Math.ceil(this.depth / this.chunkSize)) {
        return;
      }

      this.rebuildSingleChunkMesh(cx, cy, cz, scene, materials);
    });

    this.dirtyChunks.clear();
  }

  // Compile individual chunk mesh Group containing InstancedMeshes
  rebuildSingleChunkMesh(cx, cy, cz, scene, materials) {
    const key = `${cx},${cy},${cz}`;

    // Clear old chunk group meshes from scene
    const oldGroup = this.chunkMeshes.get(key);
    if (oldGroup) {
      scene.remove(oldGroup);
      oldGroup.traverse(child => {
        if (child.dispose) child.dispose();
      });
    }

    const chunk = this.chunks.get(key);
    if (!chunk) return;

    const group = new THREE.Group();
    group.position.set(cx * this.chunkSize, cy * this.chunkSize, cz * this.chunkSize);
    
    // 1. Scan and count blocks, culling completely hidden interior voxels
    const counts = {};
    const visibleBlocks = [];

    for (let x = 0; x < this.chunkSize; x++) {
      for (let y = 0; y < this.chunkSize; y++) {
        for (let z = 0; z < this.chunkSize; z++) {
          const idx = x + y * this.chunkSize + z * this.chunkSize * this.chunkSize;
          const type = chunk[idx];

          if (type !== BLOCK_TYPES.AIR) {
            const worldX = cx * this.chunkSize + x;
            const worldY = cy * this.chunkSize + y;
            const worldZ = cz * this.chunkSize + z;

            // Apply hidden voxel face-culling optimization check
            if (!this.isVoxelHidden(worldX, worldY, worldZ)) {
              counts[type] = (counts[type] || 0) + 1;
              visibleBlocks.push({ x, y, z, type });
            }
          }
        }
      }
    }

    // 2. Instantiate Three.js InstancedMesh for each block type in this chunk
    const instancedMeshesPool = {};
    Object.keys(counts).forEach(typeKey => {
      const type = parseInt(typeKey);
      const count = counts[type];
      const mat = materials[type];
      
      const imesh = new THREE.InstancedMesh(blockBoxGeometry, mat, count);
      imesh.castShadow = true;
      imesh.receiveShadow = true;
      
      group.add(imesh);
      instancedMeshesPool[type] = imesh;
    });

    // 3. Populate matrix offsets relative to Chunk group center
    const indices = {};
    const tempMatrix = new THREE.Matrix4();

    visibleBlocks.forEach(block => {
      const { x, y, z, type } = block;
      const idx = indices[type] || 0;
      
      // Set localized offset position
      tempMatrix.setPosition(x + 0.5, y + 0.5, z + 0.5);
      instancedMeshesPool[type].setMatrixAt(idx, tempMatrix);
      
      indices[type] = idx + 1;
    });

    // 4. Update instance arrays
    Object.values(instancedMeshesPool).forEach(imesh => {
      imesh.instanceMatrix.needsUpdate = true;
    });

    scene.add(group);
    this.chunkMeshes.set(key, group);
  }

  // Clear all meshes
  clearAllMeshes(scene) {
    this.chunkMeshes.forEach(group => {
      scene.remove(group);
    });
    this.chunkMeshes.clear();
  }
}
