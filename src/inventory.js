// ============================================================
// Voxverse Inventory System
// ============================================================
import { BLOCK_TYPES } from './world.js';

export const BLOCK_NAMES = {
  [BLOCK_TYPES.GRASS]:   { name: 'Grass',   icon: '🟩', color: '#22c55e' },
  [BLOCK_TYPES.DIRT]:    { name: 'Dirt',    icon: '🟫', color: '#78350f' },
  [BLOCK_TYPES.STONE]:   { name: 'Stone',   icon: '⬜', color: '#64748b' },
  [BLOCK_TYPES.WOOD]:    { name: 'Wood',    icon: '🪵', color: '#d97706' },
  [BLOCK_TYPES.LEAVES]:  { name: 'Leaves',  icon: '🌿', color: '#15803d' },
  [BLOCK_TYPES.WATER]:   { name: 'Water',   icon: '💧', color: '#3b82f6' },
  [BLOCK_TYPES.SAND]:    { name: 'Sand',    icon: '🟨', color: '#fef08a' },
  [BLOCK_TYPES.CRYSTAL]: { name: 'Crystal', icon: '💜', color: '#d946ef' },
  [BLOCK_TYPES.TORCH]:   { name: 'Torch',   icon: '🔥', color: '#f97316' },
  [BLOCK_TYPES.COAL]:    { name: 'Coal Ore', icon: '⚫', color: '#374151' },
  [BLOCK_TYPES.IRON]:    { name: 'Iron Ore', icon: '🔩', color: '#b45309' },
};

export const RECIPES = [
  {
    name: 'Torch x4',
    result: { type: BLOCK_TYPES.TORCH, count: 4 },
    ingredients: [
      { type: BLOCK_TYPES.WOOD, count: 2 },
      { type: BLOCK_TYPES.CRYSTAL, count: 1 }
    ],
    icon: '🔥'
  },
  {
    name: 'Crystal Block',
    result: { type: BLOCK_TYPES.CRYSTAL, count: 1 },
    ingredients: [
      { type: BLOCK_TYPES.STONE, count: 4 },
      { type: BLOCK_TYPES.WATER, count: 2 }
    ],
    icon: '💜'
  },
  {
    name: 'Grass x8',
    result: { type: BLOCK_TYPES.GRASS, count: 8 },
    ingredients: [
      { type: BLOCK_TYPES.DIRT, count: 4 },
      { type: BLOCK_TYPES.LEAVES, count: 2 }
    ],
    icon: '🌱'
  },
  {
    name: 'Wood x6',
    result: { type: BLOCK_TYPES.WOOD, count: 6 },
    ingredients: [
      { type: BLOCK_TYPES.LEAVES, count: 4 }
    ],
    icon: '🪵'
  },
];

export class Inventory {
  constructor() {
    // Item counts per block type
    this.items = {};
    Object.keys(BLOCK_NAMES).forEach(type => {
      this.items[type] = 0;
    });

    // Give player starter pack
    this.items[BLOCK_TYPES.GRASS] = 20;
    this.items[BLOCK_TYPES.STONE] = 10;
    this.items[BLOCK_TYPES.WOOD] = 8;
    this.items[BLOCK_TYPES.TORCH] = 4;

    this.initUI();
  }

  add(blockType, count = 1) {
    if (this.items[blockType] !== undefined) {
      this.items[blockType] += count;
      this.renderInventory();
      this.flashPickup(blockType, count);
    }
  }

  remove(blockType, count = 1) {
    if (this.items[blockType] !== undefined && this.items[blockType] >= count) {
      this.items[blockType] -= count;
      this.renderInventory();
      return true;
    }
    return false; // Not enough
  }

  has(blockType, count = 1) {
    return (this.items[blockType] || 0) >= count;
  }

  // Show "+1 Crystal" floating toast
  flashPickup(blockType, count) {
    const info = BLOCK_NAMES[blockType];
    if (!info) return;
    const toast = document.createElement('div');
    toast.className = 'pickup-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 160px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15,23,42,0.85);
      border: 1px solid ${info.color};
      color: ${info.color};
      font-size: 13px;
      font-weight: 700;
      padding: 6px 14px;
      border-radius: 20px;
      z-index: 9999;
      pointer-events: none;
      animation: toastPop 1.4s cubic-bezier(.4,0,.2,1) forwards;
    `;
    toast.innerText = `+${count} ${info.icon} ${info.name}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1400);
  }

  initUI() {
    // Create inventory toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'btn-inventory';
    toggleBtn.className = 'btn-primary';
    toggleBtn.style.cssText = 'background: #f59e0b; margin-right: 8px;';
    toggleBtn.innerHTML = '🎒 Inventory';
    const navbar = document.querySelector('.header-controls');
    if (navbar) navbar.prepend(toggleBtn);

    // Create inventory panel
    const panel = document.createElement('div');
    panel.id = 'inventory-panel';
    panel.style.display = 'none';
    panel.innerHTML = `
      <div class="inv-header">
        <span>🎒 Inventory</span>
        <button id="btn-close-inv">&times;</button>
      </div>
      <div id="inv-grid"></div>
      <div class="inv-section-title">⚒️ Crafting</div>
      <div id="crafting-list"></div>
    `;
    document.body.appendChild(panel);

    toggleBtn.addEventListener('click', () => {
      const p = document.getElementById('inventory-panel');
      if (p.style.display === 'none') {
        p.style.display = 'flex';
        this.renderInventory();
        this.renderCrafting();
        document.exitPointerLock();
      } else {
        p.style.display = 'none';
      }
    });

    document.getElementById('btn-close-inv').addEventListener('click', () => {
      document.getElementById('inventory-panel').style.display = 'none';
    });

    // Inject inventory styles
    const style = document.createElement('style');
    style.textContent = `
      #inventory-panel {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 480px;
        max-height: 70vh;
        background: rgba(9, 13, 22, 0.96);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 18px;
        z-index: 5000;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0,0,0,0.6);
        backdrop-filter: blur(20px);
        animation: zoomIn 0.25s cubic-bezier(.34,1.56,.64,1);
      }
      .inv-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        background: rgba(88,101,242,0.15);
        border-bottom: 1px solid rgba(255,255,255,0.08);
        font-family: 'Outfit', sans-serif;
        font-weight: 700;
        font-size: 17px;
      }
      .inv-header button {
        background: none;
        border: none;
        color: #94a3b8;
        font-size: 22px;
        cursor: pointer;
      }
      .inv-header button:hover { color: white; }
      #inv-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        padding: 16px;
        overflow-y: auto;
      }
      .inv-slot {
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 10px;
        padding: 12px;
        display: flex;
        align-items: center;
        gap: 10px;
        transition: all 0.2s;
      }
      .inv-slot:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2); }
      .inv-slot-icon { font-size: 20px; }
      .inv-slot-info { flex: 1; }
      .inv-slot-name { font-size: 12px; font-weight: 600; color: #e2e8f0; }
      .inv-slot-count {
        font-size: 18px;
        font-weight: 800;
        font-family: 'Outfit', sans-serif;
      }
      .inv-section-title {
        padding: 8px 20px;
        font-size: 11px;
        font-weight: 700;
        color: #94a3b8;
        letter-spacing: 1px;
        border-top: 1px solid rgba(255,255,255,0.06);
        border-bottom: 1px solid rgba(255,255,255,0.06);
        background: rgba(255,255,255,0.02);
      }
      #crafting-list {
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        overflow-y: auto;
        max-height: 200px;
      }
      .craft-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 10px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .craft-row:hover { background: rgba(88,101,242,0.15); border-color: #5865F2; }
      .craft-row.can-craft { border-color: rgba(16,185,129,0.4); }
      .craft-row.can-craft:hover { background: rgba(16,185,129,0.12); }
      .craft-row.cant-craft { opacity: 0.45; cursor: not-allowed; }
      .craft-icon { font-size: 22px; }
      .craft-info { flex: 1; }
      .craft-name { font-size: 13px; font-weight: 700; color: #f8fafc; }
      .craft-cost { font-size: 11px; color: #94a3b8; margin-top: 2px; }
      .craft-btn {
        padding: 5px 12px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 700;
        border: none;
        cursor: pointer;
        background: #5865F2;
        color: white;
      }
      .craft-btn:disabled { background: #2d3748; color: #4a5568; cursor: not-allowed; }
      @keyframes toastPop {
        0%  { opacity: 0; transform: translateX(-50%) translateY(10px); }
        20% { opacity: 1; transform: translateX(-50%) translateY(0); }
        80% { opacity: 1; transform: translateX(-50%) translateY(0); }
        100%{ opacity: 0; transform: translateX(-50%) translateY(-10px); }
      }
    `;
    document.head.appendChild(style);
  }

  renderInventory() {
    const grid = document.getElementById('inv-grid');
    if (!grid) return;
    grid.innerHTML = '';
    Object.entries(BLOCK_NAMES).forEach(([type, info]) => {
      const count = this.items[type] || 0;
      const slot = document.createElement('div');
      slot.className = 'inv-slot';
      slot.innerHTML = `
        <span class="inv-slot-icon">${info.icon}</span>
        <div class="inv-slot-info">
          <div class="inv-slot-name">${info.name}</div>
          <div class="inv-slot-count" style="color:${info.color}">${count}</div>
        </div>
      `;
      grid.appendChild(slot);
    });
  }

  renderCrafting() {
    const list = document.getElementById('crafting-list');
    if (!list) return;
    list.innerHTML = '';
    RECIPES.forEach((recipe, idx) => {
      const canCraft = recipe.ingredients.every(ing => this.has(ing.type, ing.count));
      const costText = recipe.ingredients.map(ing => {
        const info = BLOCK_NAMES[ing.type];
        return `${ing.count}x ${info.icon} ${info.name}`;
      }).join(' + ');
      const resultInfo = BLOCK_NAMES[recipe.result.type];

      const row = document.createElement('div');
      row.className = `craft-row ${canCraft ? 'can-craft' : 'cant-craft'}`;
      row.innerHTML = `
        <span class="craft-icon">${recipe.icon}</span>
        <div class="craft-info">
          <div class="craft-name">${recipe.name} <span style="color:#94a3b8; font-weight:400; font-size:11px">(${resultInfo.icon} ×${recipe.result.count})</span></div>
          <div class="craft-cost">${costText}</div>
        </div>
        <button class="craft-btn" ${canCraft ? '' : 'disabled'}>Craft</button>
      `;
      if (canCraft) {
        row.querySelector('.craft-btn').addEventListener('click', () => {
          // Deduct ingredients
          recipe.ingredients.forEach(ing => this.remove(ing.type, ing.count));
          // Add result
          this.add(recipe.result.type, recipe.result.count);
          this.renderCrafting();
          this.renderInventory();
        });
      }
      list.appendChild(row);
    });
  }
}
