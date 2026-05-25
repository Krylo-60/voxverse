// ============================================================
// Voxverse Quest System — Hytale-inspired objectives
// ============================================================

export const QUESTS = [
  {
    id: 'mine10',
    title: 'First Steps',
    desc: 'Mine 10 blocks',
    icon: '⛏️',
    stat: 'blocksMined',
    goal: 10,
    xpReward: 30,
    color: '#22c55e',
  },
  {
    id: 'kill5',
    title: 'Monster Hunter',
    desc: 'Defeat 5 mobs',
    icon: '⚔️',
    stat: 'mobsKilled',
    goal: 5,
    xpReward: 50,
    color: '#ef4444',
  },
  {
    id: 'place10',
    title: 'Architect',
    desc: 'Place 10 blocks',
    icon: '🏗️',
    stat: 'blocksPlaced',
    goal: 10,
    xpReward: 25,
    color: '#3b82f6',
  },
  {
    id: 'reach5',
    title: 'Adventurer',
    desc: 'Reach Level 5',
    icon: '⭐',
    stat: 'level',
    goal: 5,
    xpReward: 100,
    color: '#f59e0b',
  },
  {
    id: 'mine50',
    title: 'Strip Miner',
    desc: 'Mine 50 blocks',
    icon: '🪨',
    stat: 'blocksMined',
    goal: 50,
    xpReward: 80,
    color: '#64748b',
  },
  {
    id: 'kill20',
    title: 'Slayer',
    desc: 'Defeat 20 mobs',
    icon: '💀',
    stat: 'mobsKilled',
    goal: 20,
    xpReward: 200,
    color: '#dc2626',
  },
];

export class QuestSystem {
  constructor(onComplete) {
    this.stats = {
      blocksMined: 0,
      mobsKilled:  0,
      blocksPlaced: 0,
      level: 1,
    };
    this.completed = new Set();
    this.onComplete = onComplete; // callback(quest)
    this.activeQuests = QUESTS.slice(0, 3); // Start with first 3

    this._initUI();
  }

  _initUI() {
    // Quest toggle button
    const btn = document.createElement('button');
    btn.id = 'btn-quests';
    btn.className = 'btn-primary';
    btn.style.cssText = 'background: #f59e0b; margin-right: 8px;';
    btn.innerHTML = '📋 Quests';
    const navbar = document.querySelector('.header-controls');
    if (navbar) navbar.prepend(btn);

    // Quest panel
    const panel = document.createElement('div');
    panel.id = 'quest-panel';
    panel.innerHTML = `
      <div class="quest-header">
        <span>📋 Active Quests</span>
        <button id="btn-close-quests">&times;</button>
      </div>
      <div id="quest-list"></div>
    `;
    document.body.appendChild(panel);

    btn.addEventListener('click', () => {
      const p = document.getElementById('quest-panel');
      if (p.style.display === 'none' || !p.style.display) {
        p.style.display = 'flex';
        this._renderQuests();
        document.exitPointerLock();
      } else { p.style.display = 'none'; }
    });
    document.getElementById('btn-close-quests').addEventListener('click', () => {
      document.getElementById('quest-panel').style.display = 'none';
    });

    this._injectStyles();
    this._renderTrackerHUD();
  }

  _injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      #quest-panel {
        position: fixed; top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: 400px; max-height: 70vh;
        background: rgba(9,13,22,0.97);
        border: 1px solid rgba(245,158,11,0.3);
        border-radius: 18px;
        display: flex; flex-direction: column;
        overflow: hidden;
        box-shadow: 0 0 60px rgba(245,158,11,0.2), 0 24px 48px rgba(0,0,0,0.6);
        backdrop-filter: blur(20px);
        z-index: 5000;
        animation: zoomIn 0.25s cubic-bezier(.34,1.56,.64,1);
      }
      .quest-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 16px 20px;
        background: rgba(245,158,11,0.1);
        border-bottom: 1px solid rgba(255,255,255,0.07);
        font-family: 'Outfit', sans-serif;
        font-weight: 700; font-size: 16px;
      }
      .quest-header button { background:none; border:none; color:#94a3b8; font-size:22px; cursor:pointer; }
      .quest-header button:hover { color:white; }
      #quest-list { padding: 14px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
      .quest-row {
        padding: 14px; border-radius: 12px;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.07);
        display: flex; flex-direction: column; gap: 6px;
        transition: all 0.2s;
      }
      .quest-row.done { border-color: rgba(16,185,129,0.4); background: rgba(16,185,129,0.06); }
      .quest-row-top { display: flex; align-items: center; gap: 10px; }
      .quest-icon { font-size: 22px; }
      .quest-title { font-weight: 700; font-size: 14px; flex: 1; }
      .quest-reward { font-size: 11px; color: #f59e0b; font-weight: 600; }
      .quest-desc { font-size: 11px; color: #94a3b8; }
      .quest-prog-track { height: 5px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; }
      .quest-prog-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }
      .quest-prog-label { font-size: 10px; color: #64748b; text-align: right; }
      .quest-complete-badge {
        font-size: 10px; font-weight: 700; padding: 2px 8px;
        background: #10b981; border-radius: 4px; color: white;
      }
      /* Quest tracker HUD (small, always-visible bottom-left) */
      #quest-tracker {
        position: fixed; bottom: 140px; left: 10px;
        z-index: 200; pointer-events: none;
        display: flex; flex-direction: column; gap: 4px;
        max-width: 180px;
      }
      .tracker-item {
        background: rgba(9,13,22,0.75);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 8px; padding: 5px 10px;
        font-size: 11px; color: #e2e8f0;
        backdrop-filter: blur(8px);
      }
      .tracker-item.done { border-color: rgba(16,185,129,0.5); color: #86efac; }
      /* XP / Level Bar */
      #xp-hud {
        position: fixed; bottom: 120px; left: 50%;
        transform: translateX(-50%);
        z-index: 200; pointer-events: none;
        display: flex; flex-direction: column; align-items: center; gap: 2px;
      }
      #xp-bar-track {
        width: 200px; height: 6px;
        background: rgba(0,0,0,0.5);
        border-radius: 3px; overflow: hidden;
        border: 1px solid rgba(255,255,255,0.08);
      }
      #xp-bar-fill {
        height: 100%; border-radius: 3px;
        background: linear-gradient(90deg, #5865F2, #a78bfa);
        box-shadow: 0 0 8px #5865F2;
        transition: width 0.5s cubic-bezier(.4,0,.2,1);
      }
      #xp-label {
        font-size: 11px; font-weight: 700;
        color: #a78bfa; font-family: 'Outfit', sans-serif;
        letter-spacing: 1px;
      }
      /* Quest completion toast */
      .quest-toast {
        position: fixed; top: 80px; left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, rgba(245,158,11,0.2), rgba(15,23,42,0.95));
        border: 1px solid #f59e0b;
        border-radius: 14px; padding: 12px 20px;
        z-index: 9999; pointer-events: none;
        font-family: 'Outfit', sans-serif;
        text-align: center;
        animation: toastSlideDown 3s cubic-bezier(.4,0,.2,1) forwards;
      }
      .quest-toast-title { font-size: 11px; color: #f59e0b; font-weight: 700; letter-spacing: 1px; }
      .quest-toast-name  { font-size: 16px; font-weight: 800; color: #fef3c7; margin-top: 2px; }
      .quest-toast-xp   { font-size: 12px; color: #a78bfa; margin-top: 4px; }
      @keyframes toastSlideDown {
        0%   { opacity: 0; transform: translateX(-50%) translateY(-20px); }
        15%  { opacity: 1; transform: translateX(-50%) translateY(0); }
        75%  { opacity: 1; transform: translateX(-50%) translateY(0); }
        100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
      }
      /* Mob health bars */
      .mob-healthbar { display: flex; flex-direction: column; align-items: center; gap: 2px; }
      .mob-name { font-size: 10px; font-weight: 700; color: #f8fafc; text-shadow: 0 0 6px rgba(0,0,0,0.9); }
      .mob-bar-track { width: 50px; height: 4px; background: rgba(0,0,0,0.6); border-radius: 2px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); }
      .mob-bar-fill { height: 100%; border-radius: 2px; transition: width 0.2s; }
    `;
    document.head.appendChild(s);
  }

  _renderTrackerHUD() {
    let tracker = document.getElementById('quest-tracker');
    if (!tracker) {
      tracker = document.createElement('div');
      tracker.id = 'quest-tracker';
      document.body.appendChild(tracker);
    }

    // XP bar
    let xpHud = document.getElementById('xp-hud');
    if (!xpHud) {
      xpHud = document.createElement('div');
      xpHud.id = 'xp-hud';
      xpHud.innerHTML = `
        <div id="xp-label">⭐ LV 1 — 0 / 20 XP</div>
        <div id="xp-bar-track"><div id="xp-bar-fill" style="width:0%"></div></div>
      `;
      document.body.appendChild(xpHud);
    }
  }

  _renderQuests() {
    const list = document.getElementById('quest-list');
    if (!list) return;
    list.innerHTML = '';
    this.activeQuests.forEach(q => {
      const prog  = Math.min(q.goal, this.stats[q.stat] || 0);
      const done  = this.completed.has(q.id);
      const pct   = Math.round(prog / q.goal * 100);
      const row   = document.createElement('div');
      row.className = 'quest-row' + (done ? ' done' : '');
      row.innerHTML = `
        <div class="quest-row-top">
          <span class="quest-icon">${q.icon}</span>
          <span class="quest-title" style="color:${q.color}">${q.title}</span>
          ${done ? '<span class="quest-complete-badge">✓ Done</span>' : `<span class="quest-reward">+${q.xpReward} XP</span>`}
        </div>
        <div class="quest-desc">${q.desc}</div>
        <div class="quest-prog-track">
          <div class="quest-prog-fill" style="width:${pct}%; background:${q.color}"></div>
        </div>
        <div class="quest-prog-label">${prog} / ${q.goal}</div>
      `;
      list.appendChild(row);
    });
  }

  _updateTrackerHUD() {
    const tracker = document.getElementById('quest-tracker');
    if (!tracker) return;
    tracker.innerHTML = '';
    this.activeQuests.slice(0, 3).forEach(q => {
      const prog = Math.min(q.goal, this.stats[q.stat] || 0);
      const done = this.completed.has(q.id);
      const div  = document.createElement('div');
      div.className = 'tracker-item' + (done ? ' done' : '');
      div.innerHTML = `${q.icon} ${q.title}: ${done ? '✓' : `${prog}/${q.goal}`}`;
      tracker.appendChild(div);
    });
  }

  _updateXPHud(xp, level, nextLevelXp) {
    const fill  = document.getElementById('xp-bar-fill');
    const label = document.getElementById('xp-label');
    if (fill)  fill.style.width  = Math.min(100, xp / nextLevelXp * 100) + '%';
    if (label) label.innerText   = `⭐ LV ${level} — ${xp} / ${nextLevelXp} XP`;
  }

  track(stat, amount = 1) {
    if (this.stats[stat] !== undefined) {
      this.stats[stat] += amount;
    } else {
      this.stats[stat] = amount;
    }
    this._checkCompletion();
    this._updateTrackerHUD();
  }

  setLevel(level) {
    this.stats.level = level;
    this._checkCompletion();
    this._updateTrackerHUD();
  }

  _checkCompletion() {
    this.activeQuests.forEach(q => {
      if (this.completed.has(q.id)) return;
      const val = this.stats[q.stat] || 0;
      if (val >= q.goal) {
        this.completed.add(q.id);
        this._showQuestToast(q);
        if (this.onComplete) this.onComplete(q);
        // Unlock next quest
        const nextIdx = QUESTS.findIndex(x => !this.activeQuests.includes(x) && !this.completed.has(x.id));
        if (nextIdx !== -1) this.activeQuests.push(QUESTS[nextIdx]);
      }
    });
  }

  _showQuestToast(q) {
    const toast = document.createElement('div');
    toast.className = 'quest-toast';
    toast.innerHTML = `
      <div class="quest-toast-title">🎉 QUEST COMPLETE</div>
      <div class="quest-toast-name">${q.icon} ${q.title}</div>
      <div class="quest-toast-xp">+${q.xpReward} XP awarded</div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3100);
  }
}
