import * as vscode from 'vscode';

interface GardenState {
  totalLinesTyped: number;
  totalCharTyped: number;
  sessionLines: number;
  stage: number; // 0-7 stages
  lastActivity: number;
  streakDays: number;
  lastActiveDate: string;
}

const STAGE_THRESHOLDS = [0, 50, 150, 300, 500, 750, 1050, 1400];
const STAGE_NAMES = [
  'Seed 🌰',
  'Sprout 🌱',
  'Seedling 🌿',
  'Young Plant 🪴',
  'Small Tree 🌳',
  'Growing Tree 🌲',
  'Tall Tree 🎋',
  'Mighty Tree 🌴',
];

let gardenState: GardenState;
let statusBarItem: vscode.StatusBarItem;
let gardenPanel: vscode.WebviewPanel | undefined;
let context: vscode.ExtensionContext;

export function activate(ctx: vscode.ExtensionContext) {
  context = ctx;
  gardenState = loadState();

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'codeGarden.openGarden';
  updateStatusBar();
  statusBarItem.show();
  ctx.subscriptions.push(statusBarItem);

  // Commands
  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeGarden.openGarden', openGarden),
    vscode.commands.registerCommand('codeGarden.resetGarden', resetGarden)
  );

  // Track typing
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(onTextChanged)
  );

  // Register sidebar webview
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codeGarden.gardenView', {
      resolveWebviewView(webviewView) {
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = getWebviewContent(webviewView.webview, true);
        webviewView.webview.onDidReceiveMessage(handleMessage);
      }
    })
  );
}

function onTextChanged(event: vscode.TextDocumentChangeEvent) {
  if (event.document.uri.scheme === 'output') return;

  let linesAdded = 0;
  for (const change of event.contentChanges) {
    const newLines = (change.text.match(/\n/g) || []).length;
    linesAdded += newLines;
    gardenState.totalCharTyped += change.text.length;
  }

  if (linesAdded > 0) {
    gardenState.totalLinesTyped += linesAdded;
    gardenState.sessionLines += linesAdded;

    const newStage = calculateStage(gardenState.totalLinesTyped);
    const stageUp = newStage > gardenState.stage;
    gardenState.stage = newStage;

    if (stageUp) {
      vscode.window.showInformationMessage(
        `🌱 Your plant grew! It's now a ${STAGE_NAMES[gardenState.stage]}!`
      );
    }

    gardenState.lastActivity = Date.now();
    saveState();
    updateStatusBar();
    updatePanel();
  }
}

function calculateStage(lines: number): number {
  let stage = 0;
  for (let i = STAGE_THRESHOLDS.length - 1; i >= 0; i--) {
    if (lines >= STAGE_THRESHOLDS[i]) {
      stage = i;
      break;
    }
  }
  return Math.min(stage, STAGE_NAMES.length - 1);
}

function updateStatusBar() {
  const stage = gardenState.stage;
  const icons = ['🌰', '🌱', '🌿', '🪴', '🌳', '🌲', '🎋', '🌴'];
  statusBarItem.text = `${icons[stage]} ${gardenState.totalLinesTyped} lines`;
  statusBarItem.tooltip = `Code Garden: ${STAGE_NAMES[stage]}\nClick to open garden`;
}

function openGarden() {
  if (gardenPanel) {
    gardenPanel.reveal();
    return;
  }

  gardenPanel = vscode.window.createWebviewPanel(
    'codeGarden',
    '🌱 Code Garden',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  gardenPanel.webview.html = getWebviewContent(gardenPanel.webview, false);
  gardenPanel.webview.onDidReceiveMessage(handleMessage);
  gardenPanel.onDidDispose(() => { gardenPanel = undefined; });
}

function handleMessage(message: any) {
  if (message.command === 'reset') {
    resetGarden();
  }
}

function resetGarden() {
  vscode.window.showWarningMessage(
    'Reset your garden? Your plant will start over as a seed. 🌰',
    'Reset', 'Cancel'
  ).then(choice => {
    if (choice === 'Reset') {
      gardenState = {
        totalLinesTyped: 0,
        totalCharTyped: 0,
        sessionLines: 0,
        stage: 0,
        lastActivity: Date.now(),
        streakDays: 0,
        lastActiveDate: new Date().toDateString()
      };
      saveState();
      updateStatusBar();
      updatePanel();
    }
  });
}

function updatePanel() {
  if (gardenPanel) {
    gardenPanel.webview.html = getWebviewContent(gardenPanel.webview, false);
  }
}

function loadState(): GardenState {
  return context.globalState.get<GardenState>('gardenState') || {
    totalLinesTyped: 0,
    totalCharTyped: 0,
    sessionLines: 0,
    stage: 0,
    lastActivity: Date.now(),
    streakDays: 0,
    lastActiveDate: new Date().toDateString()
  };
}

function saveState() {
  context.globalState.update('gardenState', gardenState);
}

function getWebviewContent(webview: vscode.Webview, isSidebar: boolean): string {
  const state = gardenState;
  const stage = state.stage;
  const nextThreshold = STAGE_THRESHOLDS[Math.min(stage + 1, STAGE_THRESHOLDS.length - 1)];
  const currentThreshold = STAGE_THRESHOLDS[stage];
  const progress = stage >= STAGE_NAMES.length - 1
    ? 100
    : Math.round(((state.totalLinesTyped - currentThreshold) / (nextThreshold - currentThreshold)) * 100);

  const stateJson = JSON.stringify({
    stage,
    totalLines: state.totalLinesTyped,
    progress: Math.min(progress, 100),
    stageName: STAGE_NAMES[stage],
    nextThreshold,
    sessionLines: state.sessionLines
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Code Garden</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  
  body {
    background: linear-gradient(180deg, #0d1b0e 0%, #0a1a0b 40%, #0e1f10 100%);
    min-height: 100vh;
    font-family: 'Segoe UI', system-ui, sans-serif;
    color: #b8d4b8;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: ${isSidebar ? '12px 8px' : '24px 20px'};
  }

  .header {
    text-align: center;
    margin-bottom: ${isSidebar ? '12px' : '20px'};
  }

  .header h1 {
    font-size: ${isSidebar ? '14px' : '22px'};
    font-weight: 600;
    color: #7ec87e;
    letter-spacing: 0.5px;
  }

  .stage-badge {
    display: inline-block;
    background: rgba(126, 200, 126, 0.12);
    border: 1px solid rgba(126, 200, 126, 0.3);
    border-radius: 20px;
    padding: ${isSidebar ? '2px 10px' : '4px 16px'};
    font-size: ${isSidebar ? '10px' : '13px'};
    color: #7ec87e;
    margin-top: 6px;
  }

  .garden-container {
    width: 100%;
    max-width: ${isSidebar ? '200px' : '380px'};
    position: relative;
  }

  #gardenCanvas {
    width: 100%;
    border-radius: 12px;
    display: block;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: ${isSidebar ? '6px' : '10px'};
    width: 100%;
    max-width: ${isSidebar ? '200px' : '380px'};
    margin-top: ${isSidebar ? '10px' : '16px'};
  }

  .stat-card {
    background: rgba(126, 200, 126, 0.07);
    border: 1px solid rgba(126, 200, 126, 0.15);
    border-radius: 8px;
    padding: ${isSidebar ? '6px 8px' : '10px 14px'};
    text-align: center;
  }

  .stat-value {
    font-size: ${isSidebar ? '16px' : '24px'};
    font-weight: 700;
    color: #7ec87e;
    line-height: 1;
  }

  .stat-label {
    font-size: ${isSidebar ? '8px' : '11px'};
    color: #6a9a6a;
    margin-top: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .progress-section {
    width: 100%;
    max-width: ${isSidebar ? '200px' : '380px'};
    margin-top: ${isSidebar ? '8px' : '14px'};
  }

  .progress-label {
    display: flex;
    justify-content: space-between;
    font-size: ${isSidebar ? '9px' : '11px'};
    color: #6a9a6a;
    margin-bottom: 5px;
  }

  .progress-bar {
    height: ${isSidebar ? '6px' : '8px'};
    background: rgba(126, 200, 126, 0.1);
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid rgba(126, 200, 126, 0.2);
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #3d8c3d, #7ec87e, #a8e6a8);
    border-radius: 4px;
    transition: width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
    position: relative;
    overflow: hidden;
  }

  .progress-fill::after {
    content: '';
    position: absolute;
    top: 0; left: -100%;
    width: 100%; height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
    animation: shimmer 2s infinite;
  }

  @keyframes shimmer {
    to { left: 200%; }
  }

  .reset-btn {
    margin-top: ${isSidebar ? '10px' : '16px'};
    background: rgba(200, 80, 80, 0.1);
    border: 1px solid rgba(200, 80, 80, 0.2);
    color: #c87878;
    padding: ${isSidebar ? '4px 12px' : '6px 18px'};
    border-radius: 6px;
    cursor: pointer;
    font-size: ${isSidebar ? '9px' : '11px'};
    transition: all 0.2s;
  }

  .reset-btn:hover {
    background: rgba(200, 80, 80, 0.2);
    border-color: rgba(200, 80, 80, 0.4);
  }

  .tip {
    font-size: ${isSidebar ? '8px' : '10px'};
    color: rgba(106, 154, 106, 0.6);
    text-align: center;
    margin-top: ${isSidebar ? '8px' : '12px'};
    font-style: italic;
  }
</style>
</head>
<body>

<div class="header">
  <h1>🌱 Code Garden</h1>
  <div class="stage-badge" id="stageBadge">Loading...</div>
</div>

<div class="garden-container">
  <canvas id="gardenCanvas" width="400" height="${isSidebar ? 220 : 320}"></canvas>
</div>

<div class="progress-section">
  <div class="progress-label">
    <span>Growth Progress</span>
    <span id="progressLabel">0%</span>
  </div>
  <div class="progress-bar">
    <div class="progress-fill" id="progressFill" style="width: 0%"></div>
  </div>
</div>

<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-value" id="totalLines">0</div>
    <div class="stat-label">Total Lines</div>
  </div>
  <div class="stat-card">
    <div class="stat-value" id="sessionLines">0</div>
    <div class="stat-label">This Session</div>
  </div>
</div>

<button class="reset-btn" onclick="resetGarden()">↺ Reset Garden</button>
<div class="tip" id="tipText">Write your first line to begin growing!</div>

<script>
const vscode = acquireVsCodeApi();
const state = ${stateJson};

const canvas = document.getElementById('gardenCanvas');
const ctx = canvas.getContext('2d');
const isSidebar = ${isSidebar};
const canvasH = canvas.height;
const canvasW = canvas.width;

// Update UI
document.getElementById('stageBadge').textContent = state.stageName;
document.getElementById('totalLines').textContent = state.totalLines.toLocaleString();
document.getElementById('sessionLines').textContent = state.sessionLines.toLocaleString();
document.getElementById('progressFill').style.width = state.progress + '%';
document.getElementById('progressLabel').textContent = state.progress + '%';

const tips = [
  "Write your first line to begin growing!",
  "Keep coding! Your sprout is thirsty for commits.",
  "Great start! Your seedling is stretching upward.",
  "Halfway there — your plant is getting stronger!",
  "Beautiful work! A small tree is taking shape.",
  "Your dedication shows in every branch!",
  "Almost a mighty tree — keep going!",
  "🎉 Maximum growth! You're a legendary coder!"
];
document.getElementById('tipText').textContent = tips[Math.min(state.stage, tips.length - 1)];

// ── Drawing Engine ──────────────────────────────────────────────────────────

let animFrame = 0;
const wind = { speed: 0, target: 0.4, current: 0 };

function drawBackground() {
  // Sky gradient (dark, VS Code-like)
  const sky = ctx.createLinearGradient(0, 0, 0, canvasH * 0.65);
  sky.addColorStop(0, '#0d1b0e');
  sky.addColorStop(1, '#1a3a1c');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvasW, canvasH * 0.75);

  // Ground
  const ground = ctx.createLinearGradient(0, canvasH * 0.72, 0, canvasH);
  ground.addColorStop(0, '#1a3a1c');
  ground.addColorStop(0.3, '#152e17');
  ground.addColorStop(1, '#0e1f10');
  ctx.fillStyle = ground;
  ctx.fillRect(0, canvasH * 0.72, canvasW, canvasH * 0.28);

  // Subtle ground line
  ctx.strokeStyle = 'rgba(126, 200, 126, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, canvasH * 0.72);
  ctx.lineTo(canvasW, canvasH * 0.72);
  ctx.stroke();

  // Stars (only stage < 4)
  if (state.stage < 4) {
    ctx.fillStyle = 'rgba(200,230,200,0.5)';
    const stars = [[30,15],[80,8],[140,20],[200,5],[280,18],[320,10],[370,22],[50,40],[180,35],[340,38]];
    for (const [x,y] of stars) {
      ctx.beginPath();
      ctx.arc(x, y, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Grass tufts
  for (let i = 0; i < 12; i++) {
    const gx = 20 + i * 32 + Math.sin(i * 1.7) * 10;
    const gy = canvasH * 0.72;
    drawGrassTuft(gx, gy, 6 + Math.sin(i) * 2);
  }
}

function drawGrassTuft(x, y, size) {
  ctx.strokeStyle = 'rgba(100, 180, 100, 0.4)';
  ctx.lineWidth = 1;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * 3, y);
    ctx.quadraticCurveTo(x + i * 4 + wind.current * size * 0.5, y - size * 0.6, x + i * 2 + wind.current * size, y - size);
    ctx.stroke();
  }
}

function drawSeed(cx, groundY) {
  // Soil mound
  ctx.fillStyle = '#2a4a2a';
  ctx.beginPath();
  ctx.ellipse(cx, groundY, 18, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // Seed
  ctx.fillStyle = '#5a3a1a';
  ctx.beginPath();
  ctx.ellipse(cx, groundY - 3, 7, 5, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8a5a2a';
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // Tiny crack
  ctx.strokeStyle = 'rgba(180, 140, 80, 0.6)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - 1, groundY - 5);
  ctx.lineTo(cx + 2, groundY - 2);
  ctx.stroke();
}

function drawSprout(cx, groundY, t) {
  const sway = Math.sin(t * 0.03) * wind.current * 3;

  // Stem
  ctx.strokeStyle = '#5a9a5a';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, groundY);
  ctx.quadraticCurveTo(cx + sway * 0.5, groundY - 15, cx + sway, groundY - 30);
  ctx.stroke();

  // Two tiny leaves
  const tipX = cx + sway;
  const tipY = groundY - 30;

  drawLeaf(tipX - 5, tipY + 5, -0.5, 10, 5, sway * 0.1);
  drawLeaf(tipX + 5, tipY + 5, 0.5, 10, 5, sway * 0.1);

  // Top bud
  ctx.fillStyle = '#7ec87e';
  ctx.beginPath();
  ctx.ellipse(tipX, tipY, 3, 5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawSeedling(cx, groundY, t) {
  const sway = Math.sin(t * 0.025) * wind.current * 4;
  const h = isSidebar ? 55 : 70;

  ctx.strokeStyle = '#5a9a5a';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, groundY);
  ctx.quadraticCurveTo(cx + sway * 0.3, groundY - h * 0.5, cx + sway, groundY - h);
  ctx.stroke();

  const tx = cx + sway, ty = groundY - h;

  // Leaves
  for (let i = 0; i < 3; i++) {
    const ly = groundY - 20 - i * 18;
    const lx = cx + sway * (i / 3);
    const side = i % 2 === 0 ? 1 : -1;
    drawLeaf(lx + side * 10, ly, side * 0.4, 18, 9, sway * 0.08);
  }

  // Crown leaves
  drawLeaf(tx - 8, ty + 5, -0.3, 16, 8, sway * 0.15);
  drawLeaf(tx + 8, ty + 5, 0.3, 16, 8, sway * 0.15);
  drawLeaf(tx, ty, 0, 14, 7, 0);
}

function drawYoungPlant(cx, groundY, t) {
  const sway = Math.sin(t * 0.022) * wind.current * 3;
  const h = isSidebar ? 75 : 100;

  // Trunk
  ctx.strokeStyle = '#6b7a45';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, groundY);
  ctx.quadraticCurveTo(cx + sway * 0.4, groundY - h * 0.5, cx + sway * 0.7, groundY - h);
  ctx.stroke();

  // Branch left
  const bx = cx + sway * 0.4, by = groundY - h * 0.55;
  ctx.strokeStyle = '#5a6a3a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.quadraticCurveTo(bx - 15, by - 15, bx - 25 + sway, by - 5);
  ctx.stroke();

  // Branch right
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.quadraticCurveTo(bx + 15, by - 15, bx + 28 + sway, by - 8);
  ctx.stroke();

  // Foliage cluster
  const tx = cx + sway * 0.7, ty = groundY - h;
  drawFoliageCluster(tx, ty, isSidebar ? 32 : 42, t);
  drawFoliageCluster(bx - 22 + sway * 0.8, by - 8, isSidebar ? 18 : 24, t);
  drawFoliageCluster(bx + 25 + sway * 0.8, by - 10, isSidebar ? 18 : 24, t);
}

function drawSmallTree(cx, groundY, t) {
  const sway = Math.sin(t * 0.02) * wind.current * 2;
  const h = isSidebar ? 95 : 130;

  // Trunk
  ctx.strokeStyle = '#5a4a2a';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, groundY);
  ctx.lineTo(cx + sway * 0.3, groundY - h * 0.5);
  ctx.lineTo(cx + sway * 0.5, groundY - h);
  ctx.stroke();

  // Bark texture
  ctx.strokeStyle = 'rgba(100, 80, 40, 0.3)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const barkY = groundY - (h / 4) * i;
    const barkX = cx + sway * (i / 4) * 0.5;
    ctx.beginPath();
    ctx.moveTo(barkX - 3, barkY);
    ctx.quadraticCurveTo(barkX, barkY - 8, barkX + 3, barkY + 2);
    ctx.stroke();
  }

  // Branches
  const branches = [
    { x: cx + sway * 0.2, y: groundY - h * 0.4, dx: -40, dy: -20 },
    { x: cx + sway * 0.3, y: groundY - h * 0.55, dx: 38, dy: -18 },
    { x: cx + sway * 0.4, y: groundY - h * 0.7, dx: -28, dy: -15 },
    { x: cx + sway * 0.45, y: groundY - h * 0.8, dx: 25, dy: -12 },
  ];

  for (const b of branches) {
    ctx.strokeStyle = '#4a3a1a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.quadraticCurveTo(b.x + b.dx * 0.5, b.y + b.dy * 0.5 - 8, b.x + b.dx + sway * 0.6, b.y + b.dy);
    ctx.stroke();
    drawFoliageCluster(b.x + b.dx + sway * 0.6, b.y + b.dy, isSidebar ? 20 : 26, t);
  }

  // Main crown
  drawFoliageCluster(cx + sway * 0.5, groundY - h - 5, isSidebar ? 40 : 55, t);
}

function drawGrowingTree(cx, groundY, t) {
  const sway = Math.sin(t * 0.018) * wind.current * 1.5;
  const h = isSidebar ? 105 : 150;

  // Thick trunk
  const trunkGrad = ctx.createLinearGradient(cx - 6, 0, cx + 6, 0);
  trunkGrad.addColorStop(0, '#3a2a10');
  trunkGrad.addColorStop(0.4, '#5a4a2a');
  trunkGrad.addColorStop(1, '#3a2a10');
  ctx.strokeStyle = trunkGrad;
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, groundY);
  ctx.bezierCurveTo(cx + sway * 0.2, groundY - h * 0.3, cx + sway * 0.3, groundY - h * 0.6, cx + sway * 0.4, groundY - h);
  ctx.stroke();

  // Root flares
  for (let i = -2; i <= 2; i++) {
    ctx.strokeStyle = 'rgba(60,40,15,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + i * 4, groundY - 5);
    ctx.quadraticCurveTo(cx + i * 12, groundY + 3, cx + i * 20, groundY + 1);
    ctx.stroke();
  }

  // Branch system
  const branchData = [
    { relH: 0.35, side: -1, spread: 55, w: 5 },
    { relH: 0.45, side: 1, spread: 52, w: 5 },
    { relH: 0.58, side: -1, spread: 42, w: 4 },
    { relH: 0.65, side: 1, spread: 40, w: 4 },
    { relH: 0.75, side: -1, spread: 32, w: 3 },
    { relH: 0.80, side: 1, spread: 30, w: 3 },
  ];

  for (const b of branchData) {
    const bx = cx + sway * b.relH * 0.5;
    const by = groundY - h * b.relH;
    const ex = bx + b.side * b.spread + sway * 0.8;
    const ey = by - 20;
    ctx.strokeStyle = '#4a3a1a';
    ctx.lineWidth = b.w;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + b.side * b.spread * 0.5, by - 15, ex, ey);
    ctx.stroke();
    drawFoliageCluster(ex, ey, isSidebar ? 22 : 30, t);
    // Sub-branch
    if (b.spread > 40) {
      ctx.lineWidth = b.w - 2;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + b.side * 15 + sway * 0.4, ey - 18);
      ctx.stroke();
      drawFoliageCluster(ex + b.side * 15 + sway * 0.4, ey - 18, isSidebar ? 15 : 20, t);
    }
  }

  // Main crown
  drawFoliageCluster(cx + sway * 0.4, groundY - h - 8, isSidebar ? 52 : 72, t);
}

function drawTallTree(cx, groundY, t) {
  const sway = Math.sin(t * 0.016) * wind.current * 1.2;
  const h = isSidebar ? 120 : 170;

  // Grand trunk with gradient
  const tg = ctx.createLinearGradient(cx - 8, 0, cx + 8, 0);
  tg.addColorStop(0, '#2a1a08');
  tg.addColorStop(0.35, '#4a3a1a');
  tg.addColorStop(0.65, '#6a5a2a');
  tg.addColorStop(1, '#2a1a08');
  ctx.strokeStyle = tg;
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, groundY);
  ctx.bezierCurveTo(cx + sway * 0.15, groundY - h * 0.3, cx + sway * 0.25, groundY - h * 0.65, cx + sway * 0.35, groundY - h);
  ctx.stroke();

  // Roots
  for (let i = -3; i <= 3; i++) {
    const rStrength = Math.abs(i) / 3;
    ctx.strokeStyle = \`rgba(50,35,12,\${0.3 + rStrength * 0.3})\`;
    ctx.lineWidth = 1.5 + rStrength * 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + i * 5, groundY - 10);
    ctx.quadraticCurveTo(cx + i * 15, groundY + 5, cx + i * 28, groundY + 2);
    ctx.stroke();
  }

  // Rich branch system
  const branches = [
    { relH: 0.28, side: -1, spread: 70, w: 7 },
    { relH: 0.36, side: 1, spread: 68, w: 7 },
    { relH: 0.48, side: -1, spread: 58, w: 5 },
    { relH: 0.55, side: 1, spread: 55, w: 5 },
    { relH: 0.65, side: -1, spread: 45, w: 4 },
    { relH: 0.72, side: 1, spread: 42, w: 4 },
    { relH: 0.80, side: -1, spread: 32, w: 3 },
    { relH: 0.86, side: 1, spread: 28, w: 3 },
  ];

  for (const b of branches) {
    const bx = cx + sway * b.relH * 0.4;
    const by = groundY - h * b.relH;
    const ex = bx + b.side * b.spread + sway * 0.9;
    const ey = by - 22;
    ctx.strokeStyle = '#3a2a0e';
    ctx.lineWidth = b.w;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + b.side * b.spread * 0.5, by - 18, ex, ey);
    ctx.stroke();
    drawFoliageCluster(ex, ey, isSidebar ? 24 : 34, t);

    // Sub-branches
    for (let s = 0; s < 2; s++) {
      const sbx = ex + (s === 0 ? -1 : 1) * 10;
      const sby = ey - 12;
      ctx.strokeStyle = '#3a2a0e';
      ctx.lineWidth = Math.max(1, b.w - 3);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(sbx + sway * 0.3, sby);
      ctx.stroke();
      drawFoliageCluster(sbx + sway * 0.3, sby, isSidebar ? 14 : 20, t);
    }
  }

  // Crown
  drawFoliageCluster(cx + sway * 0.35, groundY - h - 10, isSidebar ? 62 : 88, t);
}

function drawMightyTree(cx, groundY, t) {
  const sway = Math.sin(t * 0.015) * wind.current * 1.0;
  const h = isSidebar ? 130 : 185;

  // Massive trunk
  ctx.lineWidth = 22;
  ctx.lineCap = 'round';
  // Shadow trunk
  ctx.strokeStyle = 'rgba(20, 10, 5, 0.5)';
  ctx.beginPath();
  ctx.moveTo(cx + 3, groundY);
  ctx.bezierCurveTo(cx + 3 + sway * 0.1, groundY - h * 0.3, cx + 3 + sway * 0.2, groundY - h * 0.6, cx + 3 + sway * 0.3, groundY - h);
  ctx.stroke();

  // Main trunk
  const tg2 = ctx.createLinearGradient(cx - 11, 0, cx + 11, 0);
  tg2.addColorStop(0, '#1a1005');
  tg2.addColorStop(0.3, '#3a2a0e');
  tg2.addColorStop(0.55, '#5a4a20');
  tg2.addColorStop(0.8, '#3a2a0e');
  tg2.addColorStop(1, '#1a1005');
  ctx.strokeStyle = tg2;
  ctx.beginPath();
  ctx.moveTo(cx, groundY);
  ctx.bezierCurveTo(cx + sway * 0.1, groundY - h * 0.3, cx + sway * 0.2, groundY - h * 0.65, cx + sway * 0.3, groundY - h);
  ctx.stroke();

  // Epic roots
  for (let i = -4; i <= 4; i++) {
    const rS = Math.abs(i) / 4;
    ctx.strokeStyle = \`rgba(40,25,8,\${0.4 + rS * 0.3})\`;
    ctx.lineWidth = 2 + rS * 3;
    ctx.beginPath();
    ctx.moveTo(cx + i * 6, groundY - 12);
    ctx.quadraticCurveTo(cx + i * 18, groundY + 8, cx + i * 38, groundY + 3);
    ctx.stroke();
  }

  // Firefly particles
  for (let f = 0; f < 6; f++) {
    const angle = (t * 0.02 + f * 1.05) % (Math.PI * 2);
    const fx = cx + Math.cos(angle) * (30 + f * 12) + sway * 0.5;
    const fy = groundY - h * 0.5 + Math.sin(angle * 1.3) * 25;
    const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, 4);
    glow.addColorStop(0, 'rgba(200,255,150,0.9)');
    glow.addColorStop(1, 'rgba(200,255,150,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(fx, fy, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Grand branch system
  const branches = [
    { relH: 0.22, side: -1, spread: 85, w: 9 },
    { relH: 0.3, side: 1, spread: 82, w: 9 },
    { relH: 0.4, side: -1, spread: 72, w: 7 },
    { relH: 0.48, side: 1, spread: 70, w: 7 },
    { relH: 0.58, side: -1, spread: 58, w: 5 },
    { relH: 0.65, side: 1, spread: 55, w: 5 },
    { relH: 0.74, side: -1, spread: 42, w: 4 },
    { relH: 0.80, side: 1, spread: 38, w: 4 },
    { relH: 0.88, side: -1, spread: 28, w: 3 },
    { relH: 0.92, side: 1, spread: 24, w: 3 },
  ];

  for (const b of branches) {
    const bx = cx + sway * b.relH * 0.35;
    const by = groundY - h * b.relH;
    const ex = bx + b.side * b.spread + sway * 1.0;
    const ey = by - 25;
    ctx.strokeStyle = '#2a1a08';
    ctx.lineWidth = b.w;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + b.side * b.spread * 0.5, by - 22, ex, ey);
    ctx.stroke();
    drawFoliageCluster(ex, ey, isSidebar ? 28 : 38, t);

    // Rich sub-branches
    for (let s = 0; s < 3; s++) {
      const angle = -0.4 + s * 0.4;
      const sbLen = 18 + s * 6;
      const sbx = ex + Math.cos(angle) * sbLen * b.side + sway * 0.25;
      const sby = ey - Math.sin(Math.abs(angle)) * sbLen - 8;
      ctx.lineWidth = Math.max(1, b.w - 4);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(sbx, sby);
      ctx.stroke();
      drawFoliageCluster(sbx, sby, isSidebar ? 16 : 22, t);
    }
  }

  // Massive crown
  drawFoliageCluster(cx + sway * 0.3, groundY - h - 15, isSidebar ? 72 : 100, t);
  // Crown depth layers
  drawFoliageCluster(cx + sway * 0.3 - 20, groundY - h - 5, isSidebar ? 48 : 65, t);
  drawFoliageCluster(cx + sway * 0.3 + 20, groundY - h - 5, isSidebar ? 48 : 65, t);
}

function drawFoliageCluster(x, y, r, t) {
  // Dark shadow layer
  ctx.fillStyle = 'rgba(20, 60, 20, 0.6)';
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 3, r * 0.85, r * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();

  // Base deep green
  const g1 = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r);
  g1.addColorStop(0, '#4a9a4a');
  g1.addColorStop(0.5, '#2d6e2d');
  g1.addColorStop(1, '#1a4a1a');
  ctx.fillStyle = g1;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();

  // Mid highlight
  const g2 = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r * 0.6);
  g2.addColorStop(0, 'rgba(100, 180, 100, 0.5)');
  g2.addColorStop(1, 'rgba(100, 180, 100, 0)');
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();

  // Specular
  ctx.fillStyle = 'rgba(160, 230, 160, 0.15)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.25, y - r * 0.25, r * 0.35, r * 0.25, -0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawLeaf(x, y, angle, len, w, sway) {
  ctx.save();
  ctx.translate(x + sway, y);
  ctx.rotate(angle);
  const lg = ctx.createLinearGradient(0, 0, 0, -len);
  lg.addColorStop(0, '#3a7a3a');
  lg.addColorStop(0.5, '#5aaa5a');
  lg.addColorStop(1, '#4a9a4a');
  ctx.fillStyle = lg;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(w, -len * 0.5, 0, -len);
  ctx.quadraticCurveTo(-w, -len * 0.5, 0, 0);
  ctx.fill();
  // Midrib
  ctx.strokeStyle = 'rgba(80,160,80,0.5)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -len);
  ctx.stroke();
  ctx.restore();
}

// ── Animation Loop ──────────────────────────────────────────────────────────

function render() {
  animFrame++;
  ctx.clearRect(0, 0, canvasW, canvasH);

  // Update wind
  wind.target = 0.3 + Math.sin(animFrame * 0.007) * 0.3 + Math.sin(animFrame * 0.019) * 0.15;
  wind.current += (wind.target - wind.current) * 0.02;

  drawBackground();

  const cx = canvasW / 2;
  const groundY = canvasH * 0.72;

  switch(state.stage) {
    case 0: drawSeed(cx, groundY); break;
    case 1: drawSprout(cx, groundY, animFrame); break;
    case 2: drawSeedling(cx, groundY, animFrame); break;
    case 3: drawYoungPlant(cx, groundY, animFrame); break;
    case 4: drawSmallTree(cx, groundY, animFrame); break;
    case 5: drawGrowingTree(cx, groundY, animFrame); break;
    case 6: drawTallTree(cx, groundY, animFrame); break;
    case 7: drawMightyTree(cx, groundY, animFrame); break;
  }

  requestAnimationFrame(render);
}

render();

function resetGarden() {
  vscode.postMessage({ command: 'reset' });
}
</script>
</body>
</html>`;
}

export function deactivate() {}
