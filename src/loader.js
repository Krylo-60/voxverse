// ============================================================
// Voxverse — Minecraft-style World Loading Screen
// ============================================================

const SPLASH_TEXTS = [
  'Now with 100% more voxels!',
  'Grass blocks not included',
  'Totally not Minecraft!',
  'Where are my diamonds?',
  'Creepers are just shy',
  'Built different 🏗️',
  'Fog? What fog?',
  'Loading at the speed of light!',
  'Trees were harmed in this generation',
  'Crafting table not found',
  'Have you tried turning it off and on?',
  'Steve left the game',
  'Herobrine was here',
  '64 blocks = 1 stack',
  'My world, my rules',
  'This is fine 🔥',
  'Powered by Three.js magic',
  'Don\'t dig straight down!',
];

const STAGES = [
  { pct:  3, text: 'Loading resources...'        },
  { pct: 12, text: 'Initializing renderer...'    },
  { pct: 22, text: 'Compiling shaders...'        },
  { pct: 35, text: 'Generating terrain...'       },
  { pct: 48, text: 'Carving caves...'            },
  { pct: 58, text: 'Growing trees...'            },
  { pct: 67, text: 'Placing crystals...'         },
  { pct: 74, text: 'Filling oceans...'           },
  { pct: 82, text: 'Spawning mobs...'            },
  { pct: 89, text: 'Building world mesh...'      },
  { pct: 95, text: 'Lighting the world...'       },
  { pct: 99, text: 'Almost there...'             },
  { pct:100, text: 'Welcome to Voxverse! 🌍'     },
];

// ---- Animated block-grid background ----
function startLoadingBackground() {
  const canvas = document.getElementById('loading-bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const COLS = [
    '#1a3a2a','#1e4a30','#16302a','#152e24',   // greens
    '#2d1a0a','#3a200c','#251408',             // browns
    '#2a2a2a','#1f1f1f','#353535',             // grays
    '#0d1b2a','#0a1520','#0f1e30',             // dark blues
  ];

  let blocks = [];
  let W, H;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    buildGrid();
  }

  function buildGrid() {
    blocks = [];
    const sz = 48;
    const cols = Math.ceil(W / sz) + 2;
    const rows = Math.ceil(H / sz) + 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        blocks.push({
          x: c * sz,
          y: r * sz,
          sz,
          col: COLS[Math.floor(Math.random() * COLS.length)],
          alpha: 0.4 + Math.random() * 0.5,
          pulse: Math.random() * Math.PI * 2,
          speed: 0.3 + Math.random() * 0.4,
        });
      }
    }
  }

  resize();
  window.addEventListener('resize', resize);

  let running = true;
  let t = 0;

  function draw() {
    if (!running) return;
    t += 0.016;
    ctx.clearRect(0, 0, W, H);

    // Deep dark gradient
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0,   '#020a14');
    bg.addColorStop(0.5, '#040d18');
    bg.addColorStop(1,   '#020810');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Draw blocks with subtle pulse
    blocks.forEach(b => {
      b.pulse += b.speed * 0.016;
      const a = b.alpha * (0.7 + 0.3 * Math.sin(b.pulse));
      ctx.globalAlpha = a;
      ctx.fillStyle = b.col;
      ctx.fillRect(b.x, b.y, b.sz - 1, b.sz - 1);

      // Thin highlight on top/left (gives 3D bevel feel)
      ctx.globalAlpha = a * 0.4;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(b.x, b.y, b.sz - 1, 1);
      ctx.fillRect(b.x, b.y, 1, b.sz - 1);
    });

    // Vignette
    const vig = ctx.createRadialGradient(W/2, H/2, H*0.2, W/2, H/2, H*0.85);
    vig.addColorStop(0,   'rgba(0,0,0,0)');
    vig.addColorStop(1,   'rgba(0,0,0,0.85)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    requestAnimationFrame(draw);
  }

  draw();
  return () => { running = false; };
}

// ---- Progress helpers ----
function setLoadProgress(pct, text) {
  const fill  = document.getElementById('loading-bar-fill');
  const label = document.getElementById('loading-pct');
  const stage = document.getElementById('loading-stage');
  if (fill)  fill.style.width = Math.min(100, pct) + '%';
  if (label) label.textContent = Math.round(pct) + '%';
  if (stage && text) stage.textContent = text;
}

// ---- Main loader sequence ----
export async function runLoadingSequence(onComplete) {
  // Pick a random splash
  const splashEl = document.getElementById('loading-splash');
  if (splashEl) {
    splashEl.textContent = SPLASH_TEXTS[Math.floor(Math.random() * SPLASH_TEXTS.length)];
  }

  // Start animated background
  const stopBg = startLoadingBackground();

  // Kick off the game INIT callback at stage 3 (35%)
  // then continue faking stages while it processes
  let gameReady = false;
  let stageIdx  = 0;

  // Run through early stages before game init
  for (let i = 0; i < 3; i++) {
    const s = STAGES[i];
    setLoadProgress(s.pct, s.text);
    await sleep(180 + Math.random() * 120);
  }

  // Signal game to initialise (terrain gen, mesh build etc.)
  onComplete._resolveReady = null;
  const gameReadyPromise = new Promise(res => { onComplete._resolveReady = res; });

  // Trigger game init
  onComplete();

  // Continue advancing bar stages while game loads
  for (let i = 3; i < STAGES.length - 1; i++) {
    const s = STAGES[i];
    const delay = 200 + Math.random() * 280;
    await sleep(delay);
    setLoadProgress(s.pct, s.text);
  }

  // Wait for the game to signal it's ready
  await gameReadyPromise;

  // Snap to 100%
  setLoadProgress(100, STAGES[STAGES.length - 1].text);
  await sleep(600);

  // Fade out
  const screen = document.getElementById('loading-screen');
  if (screen) {
    screen.style.transition = 'opacity 0.8s ease';
    screen.style.opacity    = '0';
    await sleep(850);
    screen.style.display    = 'none';
    screen.remove();
  }

  if (stopBg) stopBg();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
