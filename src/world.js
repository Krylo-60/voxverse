// ============================================================
// Voxverse Voxel World & Spatial Hash Chunk Engine (V3.0)
// ============================================================
import * as THREE from 'three';

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
  constructor() {
    this.chunkSize = 16;
    this.worldHeightChunks = 2; // Fixed vertical height of 32 blocks (2 chunks)
    this.renderDistance = 4; // Radius of chunks to load around the player (9x9 grid horizontally)

    // Infinite Spatial Hashing
    this.chunks = new Map(); // 'cx,cy,cz' -> Uint8Array(4096)
    this.biomes = new Map(); // 'cx,cz' -> string
    this.chunkMeshes = new Map(); // 'cx,cy,cz' -> THREE.Group
    this.dirtyChunks = new Set(); // Set of dirty chunk keys
    this.loadingChunks = new Set(); // Track chunks currently requesting from worker

    // Worker initialization with standard inline syntax
    this.worker = new Worker(new URL('./world-worker.js', import.meta.url), { type: 'module' });
    this.pendingChunks = new Map(); // 'cx,cy,cz' -> callback

    // Web Worker message listener
    this.worker.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'chunkGenerated') {
        const { cx, cy, cz, voxels, biome } = payload;
        const key = `${cx},${cy},${cz}`;
        
        this.chunks.set(key, voxels);
        this.biomes.set(`${cx},${cz}`, biome);

        const callback = this.pendingChunks.get(key);
        if (callback) {
          this.pendingChunks.delete(key);
          callback();
        }
      }
    };
  }

  // Map global block coordinates to chunk coordinates
  getChunkCoords(x, y, z) {
    const cx = Math.floor(x / this.chunkSize);
    const cy = Math.floor(y / this.chunkSize);
    const cz = Math.floor(z / this.chunkSize);
    
    // Smooth modulo wrapping for negative coordinates
    const lx = ((x % this.chunkSize) + this.chunkSize) % this.chunkSize;
    const ly = ((y % this.chunkSize) + this.chunkSize) % this.chunkSize;
    const lz = ((z % this.chunkSize) + this.chunkSize) % this.chunkSize;

    return { cx, cy, cz, lx, ly, lz };
  }

  // Retrieve block ID (supports infinite horizontal bounds)
  getBlock(x, y, z) {
    // Keep strict vertical boundaries to prevent vertical overflows
    if (y < 0 || y >= this.chunkSize * this.worldHeightChunks) {
      return BLOCK_TYPES.AIR;
    }

    const { cx, cy, cz, lx, ly, lz } = this.getChunkCoords(x, y, z);
    const key = `${cx},${cy},${cz}`;
    const chunk = this.chunks.get(key);
    if (!chunk) return BLOCK_TYPES.AIR;

    const idx = lx + ly * this.chunkSize + lz * this.chunkSize * this.chunkSize;
    return chunk[idx];
  }

  getVoxel(x, y, z) {
    return this.getBlock(x, y, z);
  }

  // Set block ID in spatial map
  setBlock(x, y, z, type) {
    if (y < 0 || y >= this.chunkSize * this.worldHeightChunks) {
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
    
    // Mark current chunk and neighbors dirty
    this.dirtyChunks.add(key);
    if (lx === 0) this.dirtyChunks.add(`${cx - 1},${cy},${cz}`);
    if (lx === this.chunkSize - 1) this.dirtyChunks.add(`${cx + 1},${cy},${cz}`);
    if (ly === 0) this.dirtyChunks.add(`${cx},${cy - 1},${cz}`);
    if (ly === this.chunkSize - 1) this.dirtyChunks.add(`${cx},${cy + 1},${cz}`);
    if (lz === 0) this.dirtyChunks.add(`${cx},${cy},${cz - 1}`);
    if (lz === this.chunkSize - 1) this.dirtyChunks.add(`${cx},${cy},${cz + 1}`);

    return true;
  }

  // Find topmost solid block
  getHeight(x, z) {
    const maxY = this.chunkSize * this.worldHeightChunks - 1;
    for (let y = maxY; y >= 0; y--) {
      const block = this.getBlock(x, y, z);
      if (block !== BLOCK_TYPES.AIR && block !== BLOCK_TYPES.WATER) {
        return y;
      }
    }
    return 0;
  }

  getBiomeAt(x, z) {
    const cx = Math.floor(x / this.chunkSize);
    const cz = Math.floor(z / this.chunkSize);
    return this.biomes.get(`${cx},${cz}`) || 'canopy';
  }

  // Asynchronously request chunk from worker thread
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

  // Initial preload surounding player spawn (5x5 column grid centered on cx=1, cz=1)
  async preloadWorld(onProgress) {
    const spawnCx = 1;
    const spawnCz = 1;
    const radius = 2; // 5x5 column area
    
    const columns = [];
    for (let cx = spawnCx - radius; cx <= spawnCx + radius; cx++) {
      for (let cz = spawnCz - radius; cz <= spawnCz + radius; cz++) {
        columns.push({ cx, cz });
      }
    }

    const total = columns.length * this.worldHeightChunks;
    let loaded = 0;

    const promises = [];
    for (const col of columns) {
      for (let cy = 0; cy < this.worldHeightChunks; cy++) {
        promises.push(
          this.generateChunkAsync(col.cx, cy, col.cz).then(() => {
            loaded++;
            if (onProgress) onProgress(loaded / total);
          })
        );
      }
    }
    await Promise.all(promises);
  }

  // Dynamic spatial loading/unloading centered on player coordinates
  updateLoadedChunks(playerPos, scene, blockMaterials) {
    const playerCx = Math.floor(playerPos.x / this.chunkSize);
    const playerCz = Math.floor(playerPos.z / this.chunkSize);
    const R = this.renderDistance;

    // 1. Identify and load chunks within radius R
    for (let cx = playerCx - R; cx <= playerCx + R; cx++) {
      for (let cz = playerCz - R; cz <= playerCz + R; cz++) {
        for (let cy = 0; cy < this.worldHeightChunks; cy++) {
          const key = `${cx},${cy},${cz}`;
          
          if (!this.chunks.has(key) && !this.loadingChunks.has(key)) {
            this.loadingChunks.add(key);
            this.generateChunkAsync(cx, cy, cz).then(() => {
              this.loadingChunks.delete(key);
              // Build mesh immediately once loaded
              this.rebuildSingleChunkMesh(cx, cy, cz, scene, blockMaterials);
            });
          }
        }
      }
    }

    // 2. Unload chunks that fall outside the active radius R (Aggressive GPU Culling)
    this.chunkMeshes.forEach((group, key) => {
      const [cx, cy, cz] = key.split(',').map(Number);
      if (Math.abs(cx - playerCx) > R || Math.abs(cz - playerCz) > R) {
        scene.remove(group);
        group.traverse((child) => {
          if (child.isInstancedMesh) {
            child.dispose();
          }
        });
        this.chunkMeshes.delete(key);
        this.chunks.delete(key);
        this.biomes.delete(`${cx},${cz}`);
        this.dirtyChunks.delete(key);
      }
    });
  }

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
      if (type === BLOCK_TYPES.AIR || type === BLOCK_TYPES.WATER || type === BLOCK_TYPES.LEAVES) {
        return false;
      }
    }
    return true;
  }

  rebuildDirtyChunkMeshes(scene, materials) {
    if (this.dirtyChunks.size === 0) return;

    this.dirtyChunks.forEach(key => {
      const [cx, cy, cz] = key.split(',').map(Number);
      this.rebuildSingleChunkMesh(cx, cy, cz, scene, materials);
    });

    this.dirtyChunks.clear();
  }

  rebuildSingleChunkMesh(cx, cy, cz, scene, materials) {
    const key = `${cx},${cy},${cz}`;

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

            if (!this.isVoxelHidden(worldX, worldY, worldZ)) {
              counts[type] = (counts[type] || 0) + 1;
              visibleBlocks.push({ x, y, z, type });
            }
          }
        }
      }
    }

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

    const indices = {};
    const tempMatrix = new THREE.Matrix4();

    visibleBlocks.forEach(block => {
      const { x, y, z, type } = block;
      const idx = indices[type] || 0;
      
      tempMatrix.setPosition(x + 0.5, y + 0.5, z + 0.5);
      instancedMeshesPool[type].setMatrixAt(idx, tempMatrix);
      
      indices[type] = idx + 1;
    });

    Object.values(instancedMeshesPool).forEach(imesh => {
      imesh.instanceMatrix.needsUpdate = true;
    });

    scene.add(group);
    this.chunkMeshes.set(key, group);
  }

  // Count active GPU instances inside loaded meshes
  getGPUInstanceCount() {
    let count = 0;
    this.chunkMeshes.forEach((group) => {
      group.children.forEach((child) => {
        if (child.isInstancedMesh) {
          count += child.count;
        }
      });
    });
    return count;
  }

  clearAllMeshes(scene) {
    this.chunkMeshes.forEach(group => {
      scene.remove(group);
    });
    this.chunkMeshes.clear();
  }
}
