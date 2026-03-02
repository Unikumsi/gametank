const canvas = document.getElementById("gameCanvas");
const hudCanvas = document.getElementById("hudCanvas");
const gameWrap = document.querySelector(".game-wrap");
const mobileControlsRoot = document.getElementById("mobileControls");
const moveJoystickEl = document.getElementById("moveJoystick");
const aimJoystickEl = document.getElementById("aimJoystick");
const fireBtnEl = document.getElementById("fireBtn");
const apBtnEl = document.getElementById("apBtn");
const airBtnEl = document.getElementById("airBtn");
const moveKnobEl = moveJoystickEl ? moveJoystickEl.querySelector(".joystick-knob") : null;
const aimKnobEl = aimJoystickEl ? aimJoystickEl.querySelector(".joystick-knob") : null;

const ctx = canvas.getContext("2d");
const hudCtx = hudCanvas.getContext("2d");

const TILE = 40;

const TILE_FLOOR = 0;
const TILE_STONE = 1;
const TILE_BRICK = 2;
const TILE_BORDER = 3;
const TILE_BUSH = 4;

const WALL_HP_BY_TYPE = {
  [TILE_STONE]: 2,
  [TILE_BRICK]: 3,
};

const PLAYER_BASE_HP = 3;
const PLAYER_START_AMMO = 18;
const PLAYER_START_FUEL = 100;

const SOLID_TILES = new Set([TILE_STONE, TILE_BRICK, TILE_BORDER]);
const SIGHT_BLOCKING_TILES = new Set([TILE_STONE, TILE_BRICK, TILE_BORDER]);

const keys = {};
const justPressed = new Set();
const mouse = { x: 0, y: 0, down: false };

let isTouchDevice = false;
const touchInput = {
  move: { pointerId: null, x: 0, y: 0, mag: 0 },
  aim: { pointerId: null, x: 0, y: 0, mag: 0 },
  fireHeld: false,
  heavyQueued: false,
  airstrikeQueued: false,
};

let level = 1;
let nextUpgradeKillMark = 10;
let pendingUpgrades = 0;
let gameOver = false;

let maze = [];
let wallHp = [];
let bushRegionMap = [];

let mapCols = 0;
let mapRows = 0;
let mapWidth = 0;
let mapHeight = 0;

let bullets = [];
let enemies = [];
let fuelBarrels = [];
let ammoCrates = [];
let armorCrates = [];
let pendingBombs = [];
let explosions = [];
let trackMarks = [];
let smokeParticles = [];
let wrecks = [];
let turretDebris = [];

let playerBushInfo = { hidden: false, region: 0 };
let runRecorded = false;

const camera = { x: 0, y: 0 };
const LEADERBOARD_KEY = "tank_maze_ru_leaderboard_v1";
let leaderboard = loadLeaderboard();

let audioCtx = null;
const soundCooldown = {};

const FLAG_US = { type: "us" };
const FLAG_PLAYER = { type: "h", colors: ["#dfe7ef", "#3f6dc7", "#d74d45"] };

const PLAYER_STYLE = {
  track: "#32383b",
  body: "#5a926b",
  bodyDark: "#426d50",
  panel: "#82c298",
  turret: "#4f7f5f",
  barrel: "#2f4034",
  flag: FLAG_PLAYER,
};

const ENEMY_STYLE_POOL = [
  {
    track: "#2f2f34",
    body: "#8d5145",
    bodyDark: "#703c33",
    panel: "#af6e5f",
    turret: "#82483d",
    barrel: "#382522",
  },
  {
    track: "#303237",
    body: "#6b7a84",
    bodyDark: "#505f69",
    panel: "#8ea3b2",
    turret: "#60727d",
    barrel: "#29343a",
  },
  {
    track: "#2f3432",
    body: "#7c6f4c",
    bodyDark: "#61573d",
    panel: "#9f946d",
    turret: "#6e6547",
    barrel: "#3d3727",
  },
  {
    track: "#2f3034",
    body: "#78666f",
    bodyDark: "#5f5058",
    panel: "#98818d",
    turret: "#6f5d67",
    barrel: "#352830",
  },
];

const player = {
  x: 0,
  y: 0,
  radius: 16,
  bodyAngle: 0,
  turretAngle: 0,
  speed: 156,
  health: PLAYER_BASE_HP,
  maxHealth: PLAYER_BASE_HP,
  armor: 0,
  maxArmor: 0,
  ammo: PLAYER_START_AMMO,
  maxAmmo: 38,
  fuel: PLAYER_START_FUEL,
  maxFuel: PLAYER_START_FUEL,
  fireCooldownMs: 420,
  lastShotAt: 0,
  totalKills: 0,
  heavyUnlocked: false,
  heavyCharges: 0,
  heavyMaxCharges: 0,
  heavyProgress: 0,
  heavyKillsPerCharge: 3,
  heavyCooldownMs: 920,
  lastHeavyAt: 0,
  airstrikeUnlocked: false,
  airstrikeCharges: 0,
  airstrikeMaxCharges: 0,
  airstrikeProgress: 0,
  airstrikeKillsPerCharge: 4,
  airstrikeCooldownMs: 900,
  lastAirstrikeAt: 0,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function approach(current, target, maxDelta) {
  if (current < target) {
    return Math.min(target, current + maxDelta);
  }
  return Math.max(target, current - maxDelta);
}

function hashInt(x, y, salt = 0) {
  let n = (x * 374761393 + y * 668265263 + salt * 982451653) >>> 0;
  n ^= n >>> 13;
  n = (n * 1274126177) >>> 0;
  n ^= n >>> 16;
  return n >>> 0;
}

function hashFloat(x, y, salt = 0) {
  return (hashInt(x, y, salt) % 1000) / 1000;
}

function normalizeAngle(angle) {
  let a = angle;
  while (a <= -Math.PI) {
    a += Math.PI * 2;
  }
  while (a > Math.PI) {
    a -= Math.PI * 2;
  }
  return a;
}

function shortestAngleDiff(from, to) {
  return normalizeAngle(to - from);
}

function rotateTowardAngle(current, target, maxStep) {
  const diff = shortestAngleDiff(current, target);
  if (Math.abs(diff) <= maxStep) {
    return target;
  }
  return current + Math.sign(diff) * maxStep;
}

function roundRectPath(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y);
  c.quadraticCurveTo(x + w, y, x + w, y + rr);
  c.lineTo(x + w, y + h - rr);
  c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  c.lineTo(x + rr, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - rr);
  c.lineTo(x, y + rr);
  c.quadraticCurveTo(x, y, x + rr, y);
  c.closePath();
}

function drawWrappedText(c, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const words = text.split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (c.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) {
    lines.push(line);
  }

  for (let i = 0; i < Math.min(lines.length, maxLines); i += 1) {
    c.fillText(lines[i], x, y + i * lineHeight);
  }
}

function detectTouchDevice() {
  return (
    (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ||
    (navigator.maxTouchPoints || 0) > 0
  );
}

function setJoystickKnobOffset(knobEl, dx, dy) {
  if (!knobEl) {
    return;
  }
  knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

function resetTouchStick(kind) {
  const stick = touchInput[kind];
  stick.pointerId = null;
  stick.x = 0;
  stick.y = 0;
  stick.mag = 0;
  if (kind === "move") {
    setJoystickKnobOffset(moveKnobEl, 0, 0);
  } else {
    setJoystickKnobOffset(aimKnobEl, 0, 0);
  }
}

function refreshInputMode() {
  isTouchDevice = detectTouchDevice();
  document.body.classList.toggle("touch-device", isTouchDevice);
  if (mobileControlsRoot) {
    mobileControlsRoot.style.display = isTouchDevice ? "block" : "";
  }
  if (!isTouchDevice) {
    resetTouchStick("move");
    resetTouchStick("aim");
    touchInput.fireHeld = false;
    touchInput.heavyQueued = false;
    touchInput.airstrikeQueued = false;
  }
}

function updateTouchStickFromClient(kind, clientX, clientY) {
  const stickEl = kind === "move" ? moveJoystickEl : aimJoystickEl;
  const knobEl = kind === "move" ? moveKnobEl : aimKnobEl;
  if (!stickEl) {
    return;
  }

  const rect = stickEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radius = Math.max(20, rect.width * 0.38);

  let dx = clientX - cx;
  let dy = clientY - cy;
  const dist = Math.hypot(dx, dy);

  if (dist > radius) {
    const scale = radius / dist;
    dx *= scale;
    dy *= scale;
  }

  setJoystickKnobOffset(knobEl, dx, dy);

  const stick = touchInput[kind];
  stick.x = dx / radius;
  stick.y = dy / radius;
  stick.mag = clamp(Math.hypot(stick.x, stick.y), 0, 1);
}

function safeSetPointerCapture(target, pointerId) {
  if (!target || typeof target.setPointerCapture !== "function") {
    return;
  }
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Some Safari builds may reject capture; non-critical.
  }
}

function safeReleasePointerCapture(target, pointerId) {
  if (!target || typeof target.releasePointerCapture !== "function") {
    return;
  }
  try {
    if (typeof target.hasPointerCapture === "function" && !target.hasPointerCapture(pointerId)) {
      return;
    }
    target.releasePointerCapture(pointerId);
  } catch {
    // Ignore.
  }
}

function updateMouseFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((clientX - rect.left) / rect.width) * canvas.width;
  mouse.y = ((clientY - rect.top) / rect.height) * canvas.height;
}

function toWorldPoint(screenX, screenY) {
  return {
    x: screenX + camera.x,
    y: screenY + camera.y,
  };
}

function getPlayerAimWorldTarget() {
  if (isTouchDevice && touchInput.aim.mag > 0.16) {
    const aimDistance = 300;
    return {
      x: player.x + touchInput.aim.x * aimDistance,
      y: player.y + touchInput.aim.y * aimDistance,
    };
  }
  return toWorldMouse();
}

function getAirstrikeWorldTarget() {
  if (isTouchDevice && touchInput.aim.mag > 0.16) {
    const strikeDistance = 260;
    return {
      x: clamp(player.x + touchInput.aim.x * strikeDistance, 0, mapWidth),
      y: clamp(player.y + touchInput.aim.y * strikeDistance, 0, mapHeight),
    };
  }
  return toWorldMouse();
}

function loadLeaderboard() {
  const fallback = {
    bestLevel: 1,
    bestKills: 0,
    runs: [],
    updatedAt: Date.now(),
  };

  try {
    const raw = localStorage.getItem(LEADERBOARD_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    return {
      bestLevel: parsed.bestLevel || 1,
      bestKills: parsed.bestKills || 0,
      runs: Array.isArray(parsed.runs) ? parsed.runs.slice(0, 10) : [],
      updatedAt: parsed.updatedAt || Date.now(),
    };
  } catch {
    return fallback;
  }
}

function saveLeaderboard() {
  try {
    leaderboard.updatedAt = Date.now();
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(leaderboard));
  } catch {
    // Ignore storage errors in private mode.
  }
}

function updateBestProgress() {
  leaderboard.bestLevel = Math.max(leaderboard.bestLevel || 1, level);
  leaderboard.bestKills = Math.max(leaderboard.bestKills || 0, player.totalKills);
  saveLeaderboard();
}

function recordRunIfNeeded() {
  if (runRecorded) {
    return;
  }

  runRecorded = true;
  leaderboard.bestLevel = Math.max(leaderboard.bestLevel || 1, level);
  leaderboard.bestKills = Math.max(leaderboard.bestKills || 0, player.totalKills);

  const now = new Date();
  leaderboard.runs.push({
    level,
    kills: player.totalKills,
    date: now.toISOString(),
  });

  leaderboard.runs.sort((a, b) => {
    if (b.kills !== a.kills) {
      return b.kills - a.kills;
    }
    return b.level - a.level;
  });
  leaderboard.runs = leaderboard.runs.slice(0, 10);
  saveLeaderboard();
}

function ensureAudioReady() {
  if (!audioCtx) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      return;
    }
    audioCtx = new AudioCtor();
  }

  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
}

function playTone(freq, duration, gain, wave, glide = 0) {
  if (!audioCtx) {
    return;
  }

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();

  osc.type = wave;
  osc.frequency.setValueAtTime(freq, now);
  if (glide !== 0) {
    osc.frequency.linearRampToValueAtTime(freq + glide, now + duration);
  }

  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.exponentialRampToValueAtTime(gain, now + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(amp);
  amp.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + duration + 0.03);
}

function playSound(name) {
  if (!audioCtx || audioCtx.state !== "running") {
    return;
  }

  const now = performance.now();
  const cool = {
    shot: 55,
    enemyShot: 80,
    hit: 60,
    boom: 70,
    pickup: 45,
    kill: 80,
    upgrade: 120,
  };
  if (soundCooldown[name] && now - soundCooldown[name] < (cool[name] || 0)) {
    return;
  }
  soundCooldown[name] = now;

  if (name === "shot") {
    playTone(280, 0.06, 0.05, "square", -70);
  } else if (name === "enemyShot") {
    playTone(190, 0.07, 0.04, "square", -40);
  } else if (name === "hit") {
    playTone(120, 0.05, 0.03, "sawtooth", -35);
  } else if (name === "boom") {
    playTone(95, 0.18, 0.075, "triangle", -70);
  } else if (name === "pickup") {
    playTone(520, 0.06, 0.035, "sine", 130);
  } else if (name === "kill") {
    playTone(220, 0.09, 0.05, "square", 120);
  } else if (name === "upgrade") {
    playTone(360, 0.09, 0.045, "triangle", 180);
  }
}

function toWorldMouse() {
  return toWorldPoint(mouse.x, mouse.y);
}

function resizeCanvas() {
  refreshInputMode();

  const gameRect = gameWrap ? gameWrap.getBoundingClientRect() : canvas.getBoundingClientRect();
  const hudRect = hudCanvas.getBoundingClientRect();

  const width = Math.max(300, Math.floor(gameRect.width || window.innerWidth - 12));
  const gameH = Math.max(220, Math.floor(gameRect.height || window.innerHeight - 200));
  const hudH = Math.max(70, Math.floor(hudRect.height || (isTouchDevice ? 84 : 104)));

  canvas.width = width;
  canvas.height = gameH;
  hudCanvas.width = width;
  hudCanvas.height = hudH;
}

function isInside(x, y) {
  return x >= 0 && x < mapCols && y >= 0 && y < mapRows;
}

function isWalkableTile(tileType, allowBush = true) {
  return tileType === TILE_FLOOR || (allowBush && tileType === TILE_BUSH);
}

function addBushes(grid, cols, rows) {
  const patchCount = 5 + level;

  for (let p = 0; p < patchCount; p += 1) {
    const cx = Math.floor(rand(2, cols - 2));
    const cy = Math.floor(rand(2, rows - 2));
    const radius = Math.floor(rand(1, 3));

    if (grid[cy][cx] !== TILE_FLOOR) {
      continue;
    }

    for (let y = cy - radius; y <= cy + radius; y += 1) {
      for (let x = cx - radius; x <= cx + radius; x += 1) {
        if (!isInside(x, y)) {
          continue;
        }
        if (grid[y][x] !== TILE_FLOOR) {
          continue;
        }
        const d = Math.hypot(x - cx, y - cy);
        if (d > radius + 0.45) {
          continue;
        }
        if (Math.random() < 0.82) {
          grid[y][x] = TILE_BUSH;
        }
      }
    }
  }

  const singles = Math.floor((cols * rows) / 48);
  for (let i = 0; i < singles; i += 1) {
    const x = Math.floor(rand(1, cols - 1));
    const y = Math.floor(rand(1, rows - 1));
    if (grid[y][x] === TILE_FLOOR && Math.random() < 0.54) {
      grid[y][x] = TILE_BUSH;
    }
  }

  // Keep spawn zone clear.
  for (let y = 1; y <= 3; y += 1) {
    for (let x = 1; x <= 3; x += 1) {
      if (isInside(x, y)) {
        grid[y][x] = TILE_FLOOR;
      }
    }
  }
}

function makeMaze(cols, rows) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(TILE_STONE));

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) {
        grid[y][x] = TILE_BORDER;
      }
    }
  }

  const stack = [{ x: 1, y: 1 }];
  grid[1][1] = TILE_FLOOR;

  const dirs = [
    { x: 2, y: 0 },
    { x: -2, y: 0 },
    { x: 0, y: 2 },
    { x: 0, y: -2 },
  ];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const neighbors = [];

    for (const d of dirs) {
      const nx = current.x + d.x;
      const ny = current.y + d.y;

      if (!isInside(nx, ny)) {
        continue;
      }
      if (nx <= 0 || ny <= 0 || nx >= cols - 1 || ny >= rows - 1) {
        continue;
      }
      if (grid[ny][nx] !== TILE_FLOOR) {
        neighbors.push({ x: nx, y: ny, mx: current.x + d.x / 2, my: current.y + d.y / 2 });
      }
    }

    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }

    const next = neighbors[Math.floor(Math.random() * neighbors.length)];
    grid[next.my][next.mx] = TILE_FLOOR;
    grid[next.y][next.x] = TILE_FLOOR;
    stack.push({ x: next.x, y: next.y });
  }

  const extraHoles = Math.floor((cols * rows) / 40);
  for (let i = 0; i < extraHoles; i += 1) {
    const x = Math.floor(rand(2, cols - 2));
    const y = Math.floor(rand(2, rows - 2));
    if (grid[y][x] !== TILE_FLOOR && Math.random() < 0.76) {
      grid[y][x] = TILE_FLOOR;
    }
  }

  for (let y = 1; y < rows - 1; y += 1) {
    for (let x = 1; x < cols - 1; x += 1) {
      if (grid[y][x] === TILE_STONE) {
        grid[y][x] = Math.random() < 0.58 ? TILE_STONE : TILE_BRICK;
      }
    }
  }

  addBushes(grid, cols, rows);

  return grid;
}

function buildWallHp() {
  wallHp = maze.map((row) => row.map((tile) => WALL_HP_BY_TYPE[tile] || 0));
}

function buildBushRegions() {
  bushRegionMap = Array.from({ length: mapRows }, () => Array(mapCols).fill(0));
  let regionId = 1;

  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];

  for (let y = 0; y < mapRows; y += 1) {
    for (let x = 0; x < mapCols; x += 1) {
      if (maze[y][x] !== TILE_BUSH || bushRegionMap[y][x] !== 0) {
        continue;
      }

      const queue = [{ x, y }];
      bushRegionMap[y][x] = regionId;

      while (queue.length > 0) {
        const current = queue.pop();

        for (const d of dirs) {
          const nx = current.x + d.x;
          const ny = current.y + d.y;
          if (!isInside(nx, ny)) {
            continue;
          }
          if (maze[ny][nx] !== TILE_BUSH || bushRegionMap[ny][nx] !== 0) {
            continue;
          }

          bushRegionMap[ny][nx] = regionId;
          queue.push({ x: nx, y: ny });
        }
      }

      regionId += 1;
    }
  }
}

function tileAtWorld(x, y) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);

  if (!isInside(tx, ty)) {
    return { type: TILE_BORDER, tx, ty };
  }

  return { type: maze[ty][tx], tx, ty };
}

function circleRectHit(cx, cy, r, rx, ry, rw, rh) {
  const nearestX = clamp(cx, rx, rx + rw);
  const nearestY = clamp(cy, ry, ry + rh);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy < r * r;
}

function collidesWall(x, y, radius) {
  const minX = Math.floor((x - radius) / TILE);
  const maxX = Math.floor((x + radius) / TILE);
  const minY = Math.floor((y - radius) / TILE);
  const maxY = Math.floor((y + radius) / TILE);

  for (let ty = minY; ty <= maxY; ty += 1) {
    for (let tx = minX; tx <= maxX; tx += 1) {
      if (!isInside(tx, ty)) {
        return true;
      }

      if (!SOLID_TILES.has(maze[ty][tx])) {
        continue;
      }

      if (circleRectHit(x, y, radius, tx * TILE, ty * TILE, TILE, TILE)) {
        return true;
      }
    }
  }

  return false;
}

function moveWithCollisions(entity, dx, dy) {
  const prevX = entity.x;
  const prevY = entity.y;

  const nx = entity.x + dx;
  if (!collidesWall(nx, entity.y, entity.radius)) {
    entity.x = nx;
  }

  const ny = entity.y + dy;
  if (!collidesWall(entity.x, ny, entity.radius)) {
    entity.y = ny;
  }

  return Math.hypot(entity.x - prevX, entity.y - prevY);
}

function worldOffset(entity, forward, side) {
  const cos = Math.cos(entity.bodyAngle);
  const sin = Math.sin(entity.bodyAngle);
  return {
    x: entity.x + cos * forward - sin * side,
    y: entity.y + sin * forward + cos * side,
  };
}

function pushTrackMark(entity, side) {
  const p = worldOffset(entity, -(entity.radius * 0.95), side);
  trackMarks.push({
    x: p.x,
    y: p.y,
    angle: entity.bodyAngle,
    width: entity.isBoss ? 8 : 6,
    life: 6.6,
    maxLife: 6.6,
  });
}

function pushSmoke(entity, intensity = 1) {
  const p = worldOffset(entity, -(entity.radius + 4), 0);
  smokeParticles.push({
    x: p.x + rand(-2, 2),
    y: p.y + rand(-2, 2),
    vx: rand(-8, 8),
    vy: rand(-18, -8),
    size: rand(4, 8) * intensity,
    life: rand(0.35, 0.65),
    maxLife: rand(0.35, 0.65),
    tint: entity.isBoss ? "rgba(90, 90, 90, 1)" : "rgba(110, 118, 120, 1)",
  });
}

function emitMotionEffects(entity, moved, dt) {
  entity.trackEmit = (entity.trackEmit || 0) + moved;
  if (entity.trackEmit > (entity.isBoss ? 14 : 11)) {
    pushTrackMark(entity, entity.isBoss ? 11 : 9);
    pushTrackMark(entity, entity.isBoss ? -11 : -9);
    entity.trackEmit = 0;
  }

  entity.smokeEmit = (entity.smokeEmit || 0) + dt;
  if (moved > 0.12 && entity.smokeEmit > (entity.isBoss ? 0.08 : 0.12)) {
    pushSmoke(entity, entity.isBoss ? 1.25 : 1);
    entity.smokeEmit = 0;
  }
}

function createWreckFromEnemy(enemy) {
  wrecks.push({
    x: enemy.x,
    y: enemy.y,
    angle: enemy.bodyAngle,
    isBoss: !!enemy.isBoss,
    style: enemy.style,
    life: 25,
    maxLife: 25,
  });

  turretDebris.push({
    x: enemy.x,
    y: enemy.y,
    vx: rand(-70, 70),
    vy: rand(-95, -40),
    angle: enemy.turretAngle,
    spin: rand(-4, 4),
    size: enemy.isBoss ? 12 : 9,
    life: 16,
    maxLife: 16,
    color: enemy.style.turret,
  });

  if (enemy.isBoss) {
    turretDebris.push({
      x: enemy.x,
      y: enemy.y,
      vx: rand(-75, 75),
      vy: rand(-95, -45),
      angle: enemy.turretAngleB || enemy.turretAngle,
      spin: rand(-4, 4),
      size: 12,
      life: 16,
      maxLife: 16,
      color: enemy.style.turret,
    });
  }
}

function updateWorldParticles(dt) {
  for (let i = trackMarks.length - 1; i >= 0; i -= 1) {
    const m = trackMarks[i];
    m.life -= dt;
    if (m.life <= 0) {
      trackMarks.splice(i, 1);
    }
  }

  for (let i = smokeParticles.length - 1; i >= 0; i -= 1) {
    const s = smokeParticles[i];
    s.life -= dt;
    if (s.life <= 0) {
      smokeParticles.splice(i, 1);
      continue;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy -= 4 * dt;
    s.size += 7 * dt;
  }

  for (let i = turretDebris.length - 1; i >= 0; i -= 1) {
    const d = turretDebris[i];
    d.life -= dt;
    if (d.life <= 0) {
      turretDebris.splice(i, 1);
      continue;
    }
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.vy += 120 * dt;
    d.vx *= 0.985;
    d.angle += d.spin * dt;
  }

  for (let i = wrecks.length - 1; i >= 0; i -= 1) {
    wrecks[i].life -= dt;
    if (wrecks[i].life <= 0) {
      wrecks.splice(i, 1);
    }
  }
}

function damageWallTile(tx, ty, damage) {
  if (!isInside(tx, ty)) {
    return;
  }

  const tileType = maze[ty][tx];
  if ((tileType !== TILE_STONE && tileType !== TILE_BRICK) || wallHp[ty][tx] <= 0) {
    return;
  }

  wallHp[ty][tx] -= damage;
  if (wallHp[ty][tx] <= 0) {
    maze[ty][tx] = TILE_FLOOR;
    wallHp[ty][tx] = 0;
  }
}

function randomWalkablePosition(minDistanceFromPlayer = 0, allowBush = true) {
  for (let i = 0; i < 3400; i += 1) {
    const tx = Math.floor(rand(1, mapCols - 1));
    const ty = Math.floor(rand(1, mapRows - 1));

    if (!isWalkableTile(maze[ty][tx], allowBush)) {
      continue;
    }

    const x = tx * TILE + TILE / 2;
    const y = ty * TILE + TILE / 2;

    if (minDistanceFromPlayer > 0) {
      if (Math.hypot(x - player.x, y - player.y) < minDistanceFromPlayer) {
        continue;
      }
    }

    return { x, y };
  }

  return { x: TILE * 1.5, y: TILE * 1.5 };
}

function hasLineOfSight(x1, y1, x2, y2) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(dist / 12);

  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;

    const tile = tileAtWorld(x, y);
    if (SIGHT_BLOCKING_TILES.has(tile.type)) {
      return false;
    }
  }

  return true;
}

function getBushRegionAtWorld(x, y) {
  const tile = tileAtWorld(x, y);
  if (tile.type !== TILE_BUSH || !isInside(tile.tx, tile.ty)) {
    return 0;
  }
  return bushRegionMap[tile.ty][tile.tx] || 0;
}

function getEntityBushInfo(entity) {
  const probes = [
    { x: 0, y: 0 },
    { x: entity.radius * 0.38, y: 0 },
    { x: -entity.radius * 0.38, y: 0 },
    { x: 0, y: entity.radius * 0.38 },
    { x: 0, y: -entity.radius * 0.38 },
  ];

  let inBushCount = 0;
  const regions = new Map();

  for (const probe of probes) {
    const tile = tileAtWorld(entity.x + probe.x, entity.y + probe.y);
    if (tile.type === TILE_BUSH) {
      inBushCount += 1;
      const id = bushRegionMap[tile.ty][tile.tx] || 0;
      if (id > 0) {
        regions.set(id, (regions.get(id) || 0) + 1);
      }
    }
  }

  let region = 0;
  let best = -1;
  for (const [id, score] of regions.entries()) {
    if (score > best) {
      best = score;
      region = id;
    }
  }

  return {
    hidden: inBushCount >= 3,
    region,
  };
}

function placePickups() {
  fuelBarrels = [];
  ammoCrates = [];
  armorCrates = [];

  const fuelCount = 3 + Math.floor(level / 2);
  const ammoCount = 4 + Math.floor(level / 2);
  const armorCount = player.maxArmor > 0 ? 1 + Math.floor(level / 3) : 0;

  for (let i = 0; i < fuelCount; i += 1) {
    fuelBarrels.push(randomWalkablePosition(100, false));
  }

  for (let i = 0; i < ammoCount; i += 1) {
    ammoCrates.push(randomWalkablePosition(100, false));
  }

  for (let i = 0; i < armorCount; i += 1) {
    armorCrates.push(randomWalkablePosition(100, false));
  }
}

function createPatrolRoute(origin) {
  const points = [{ x: origin.x, y: origin.y }];
  const count = 3 + Math.floor(Math.random() * 3);

  for (let i = 1; i < count; i += 1) {
    points.push(randomWalkablePosition(130, true));
  }

  return points;
}

function createEnemyStyle(index) {
  const base = ENEMY_STYLE_POOL[index % ENEMY_STYLE_POOL.length];
  return {
    ...base,
    flag: FLAG_US,
  };
}

function spawnEnemies() {
  enemies = [];

  const bossCount = level % 3 === 0 ? 1 : 0;
  const count = Math.max(3, 3 + level - bossCount);

  for (let i = 0; i < count; i += 1) {
    const pos = randomWalkablePosition(270, false);
    const route = createPatrolRoute(pos);

    enemies.push({
      x: pos.x,
      y: pos.y,
      radius: 16,
      bodyAngle: rand(0, Math.PI * 2),
      turretAngle: rand(0, Math.PI * 2),
      speed: 86 + level * 4.5,
      currentSpeed: 0,
      maxTurnRate: 1.32 + level * 0.04,
      accel: 118 + level * 5.5,
      health: 2,
      maxHealth: 2,
      fireCooldownMs: Math.max(460, Math.floor(1280 - level * 60 + rand(-80, 120))),
      lastShotAt: 0,
      patrolPoints: route,
      patrolIndex: route.length > 1 ? 1 : 0,
      patrolPauseUntil: 0,
      combatUntil: 0,
      seesPlayer: false,
      spotStartedAt: 0,
      reactionDelayMs: Math.max(60, Math.floor(310 - level * 11 + rand(0, 130))),
      sightRange: 430 + level * 19,
      baseSpread: Math.max(0.06, 0.25 - level * 0.009),
      turretTurnSpeed: 1.18 + level * 0.075,
      lastKnownX: pos.x,
      lastKnownY: pos.y,
      orbitDir: Math.random() < 0.5 ? -1 : 1,
      nextOrbitFlipAt: 0,
      stuckTimer: 0,
      avoidTurnDir: Math.random() < 0.5 ? -1 : 1,
      isBoss: false,
      style: createEnemyStyle(i),
      trackEmit: 0,
      smokeEmit: 0,
    });
  }

  for (let i = 0; i < bossCount; i += 1) {
    const pos = randomWalkablePosition(320, false);
    const route = createPatrolRoute(pos);

    enemies.push({
      x: pos.x,
      y: pos.y,
      radius: 22,
      bodyAngle: rand(0, Math.PI * 2),
      turretAngle: rand(0, Math.PI * 2),
      turretAngleB: rand(0, Math.PI * 2),
      speed: 64 + level * 2.2,
      currentSpeed: 0,
      maxTurnRate: 1.0 + level * 0.03,
      accel: 92 + level * 2,
      health: 5,
      maxHealth: 5,
      fireCooldownMs: Math.max(1120, Math.floor(2050 - level * 40)),
      lastShotAt: 0,
      patrolPoints: route,
      patrolIndex: route.length > 1 ? 1 : 0,
      patrolPauseUntil: 0,
      combatUntil: 0,
      seesPlayer: false,
      spotStartedAt: 0,
      reactionDelayMs: Math.max(80, Math.floor(280 - level * 8 + rand(0, 120))),
      sightRange: 470 + level * 16,
      baseSpread: Math.max(0.045, 0.13 - level * 0.003),
      turretTurnSpeed: 0.9 + level * 0.08,
      lastKnownX: pos.x,
      lastKnownY: pos.y,
      orbitDir: Math.random() < 0.5 ? -1 : 1,
      nextOrbitFlipAt: 0,
      stuckTimer: 0,
      avoidTurnDir: Math.random() < 0.5 ? -1 : 1,
      isBoss: true,
      style: {
        track: "#2b2f33",
        body: "#7f5550",
        bodyDark: "#66423d",
        panel: "#a67269",
        turret: "#8a5952",
        barrel: "#2e1f1b",
        flag: FLAG_US,
      },
      trackEmit: 0,
      smokeEmit: 0,
    });
  }
}

function setupLevel(nextLevel) {
  level = nextLevel;

  mapCols = Math.min(17 + (level - 1) * 2, 47);
  mapRows = Math.min(13 + (level - 1) * 2, 35);

  if (mapCols % 2 === 0) {
    mapCols += 1;
  }
  if (mapRows % 2 === 0) {
    mapRows += 1;
  }

  maze = makeMaze(mapCols, mapRows);
  buildWallHp();
  buildBushRegions();

  mapWidth = mapCols * TILE;
  mapHeight = mapRows * TILE;

  player.x = TILE * 1.5;
  player.y = TILE * 1.5;

  player.fuel = Math.max(player.fuel, player.maxFuel * 0.62);
  player.ammo = Math.max(player.ammo, Math.floor(player.maxAmmo * 0.4));

  bullets = [];
  pendingBombs = [];
  explosions = [];
  trackMarks = [];
  smokeParticles = [];
  wrecks = [];
  turretDebris = [];

  spawnEnemies();
  placePickups();

  playerBushInfo = getEntityBushInfo(player);
  updateBestProgress();
}

function resetGame() {
  level = 1;
  nextUpgradeKillMark = 10;
  pendingUpgrades = 0;
  gameOver = false;
  runRecorded = false;

  player.health = PLAYER_BASE_HP;
  player.maxHealth = PLAYER_BASE_HP;
  player.armor = 0;
  player.maxArmor = 0;
  player.ammo = PLAYER_START_AMMO;
  player.maxAmmo = 38;
  player.fuel = PLAYER_START_FUEL;
  player.maxFuel = PLAYER_START_FUEL;
  player.fireCooldownMs = 420;
  player.lastShotAt = 0;
  player.totalKills = 0;

  player.heavyUnlocked = false;
  player.heavyCharges = 0;
  player.heavyMaxCharges = 0;
  player.heavyProgress = 0;
  player.heavyKillsPerCharge = 3;
  player.heavyCooldownMs = 820;
  player.lastHeavyAt = 0;

  player.airstrikeUnlocked = false;
  player.airstrikeCharges = 0;
  player.airstrikeMaxCharges = 0;
  player.airstrikeProgress = 0;
  player.airstrikeKillsPerCharge = 4;
  player.lastAirstrikeAt = 0;

  setupLevel(1);
}

function shoot(from, owner, nowMs, angle, speed, spread = 0, options = {}) {
  const shellAngle = angle + rand(-spread, spread);
  bullets.push({
    x: from.x + Math.cos(shellAngle) * (from.radius + 10),
    y: from.y + Math.sin(shellAngle) * (from.radius + 10),
    vx: Math.cos(shellAngle) * speed,
    vy: Math.sin(shellAngle) * speed,
    radius: options.radius || 4,
    owner,
    life: options.life || 1.75,
    damage: options.damage || 1,
    wallDamage: options.wallDamage || options.damage || 1,
    type: options.type || "normal",
    splashRadius: options.splashRadius || 0,
    pierceWalls: options.pierceWalls || 0,
    pierceEnemies: options.pierceEnemies || 0,
    lastPenTile: null,
  });

  if (options.touchOwnerCooldown !== false) {
    from.lastShotAt = nowMs;
  }

  playSound(owner === "player" ? "shot" : "enemyShot");
}

function tryShootPlayer(nowMs) {
  if (player.ammo <= 0) {
    return;
  }

  if (nowMs - player.lastShotAt < player.fireCooldownMs) {
    return;
  }

  shoot(player, "player", nowMs, player.turretAngle, 345, 0, {
    type: "normal",
    damage: 1,
    wallDamage: 1,
    radius: 4,
  });

  player.ammo -= 1;
}

function tryFireHeavy(nowMs) {
  if (!player.heavyUnlocked || player.heavyCharges <= 0) {
    return;
  }

  if (nowMs - player.lastHeavyAt < player.heavyCooldownMs) {
    return;
  }

  shoot(player, "player", nowMs, player.turretAngle, 390, 0.004, {
    type: "ap",
    damage: 2.5,
    wallDamage: 3,
    radius: 5,
    life: 1.5,
    pierceWalls: 1,
    pierceEnemies: 1,
    touchOwnerCooldown: false,
  });

  player.heavyCharges -= 1;
  player.lastHeavyAt = nowMs;
}

function scheduleAirstrike(x, y) {
  const shellCount = 6;
  for (let i = 0; i < shellCount; i += 1) {
    const a = rand(0, Math.PI * 2);
    const d = rand(0, 74);
    pendingBombs.push({
      x: x + Math.cos(a) * d,
      y: y + Math.sin(a) * d,
      delay: 0.45 + i * 0.16 + rand(0, 0.19),
      radius: 70,
      damage: 2,
      owner: "player",
    });
  }
}

function tryCallAirstrike(nowMs) {
  if (!player.airstrikeUnlocked || player.airstrikeCharges <= 0) {
    return;
  }

  if (nowMs - player.lastAirstrikeAt < player.airstrikeCooldownMs) {
    return;
  }

  const target = getAirstrikeWorldTarget();
  scheduleAirstrike(target.x, target.y);
  playSound("boom");

  player.airstrikeCharges -= 1;
  player.lastAirstrikeAt = nowMs;
}

function hurtPlayer(damage) {
  const hits = Math.max(1, Math.round(damage));
  playSound("hit");

  for (let i = 0; i < hits; i += 1) {
    if (player.armor > 0) {
      player.armor -= 1;
    } else {
      player.health -= 1;
    }

    if (player.health <= 0) {
      player.health = 0;
      gameOver = true;
      playSound("boom");
      recordRunIfNeeded();
      return;
    }
  }
}

function addSpecialCharge(kind) {
  if (kind === "heavy" && player.heavyUnlocked) {
    if (player.heavyCharges < player.heavyMaxCharges) {
      player.heavyProgress += 1;
      if (player.heavyProgress >= player.heavyKillsPerCharge) {
        player.heavyProgress = 0;
        player.heavyCharges += 1;
      }
    } else {
      player.heavyProgress = 0;
    }
  }

  if (kind === "airstrike" && player.airstrikeUnlocked) {
    if (player.airstrikeCharges < player.airstrikeMaxCharges) {
      player.airstrikeProgress += 1;
      if (player.airstrikeProgress >= player.airstrikeKillsPerCharge) {
        player.airstrikeProgress = 0;
        player.airstrikeCharges += 1;
      }
    } else {
      player.airstrikeProgress = 0;
    }
  }
}

function onEnemyKilled(enemy) {
  const { x, y } = enemy;

  player.totalKills += 1;
  createWreckFromEnemy(enemy);
  createExplosionVisual(x, y, enemy.isBoss ? 72 : 54, enemy.isBoss ? "#ffd490" : "#ffb56d");
  playSound(enemy.isBoss ? "boom" : "kill");

  const dropRoll = Math.random();
  if (dropRoll < 0.22) {
    ammoCrates.push({ x, y });
  } else if (dropRoll < 0.44) {
    fuelBarrels.push({ x, y });
  } else if (dropRoll < 0.58 && player.maxArmor > 0) {
    armorCrates.push({ x, y });
  }

  if (player.heavyUnlocked) {
    const apDropChance = enemy.isBoss ? 1 : 0.26;
    if (Math.random() < apDropChance) {
      player.heavyCharges = Math.min(player.heavyMaxCharges, player.heavyCharges + 1);
      player.heavyProgress = 0;
    }
  }

  addSpecialCharge("heavy");
  addSpecialCharge("airstrike");

  while (player.totalKills >= nextUpgradeKillMark) {
    pendingUpgrades += 1;
    nextUpgradeKillMark += 10;
    playSound("upgrade");
  }
}

function applyUpgrade(choice) {
  if (choice === "fire") {
    player.fireCooldownMs = Math.max(130, Math.floor(player.fireCooldownMs * 0.88));
  }

  if (choice === "armor") {
    player.maxArmor = Math.min(14, player.maxArmor + 1);
    player.armor = player.maxArmor;
    armorCrates.push(randomWalkablePosition(70, false));
  }

  if (choice === "heavy") {
    if (!player.heavyUnlocked) {
      player.heavyUnlocked = true;
      player.heavyMaxCharges = 2;
      player.heavyCharges = 1;
      player.heavyProgress = 0;
      player.heavyKillsPerCharge = 3;
      player.heavyCooldownMs = 760;
    } else {
      player.heavyMaxCharges = Math.min(8, player.heavyMaxCharges + 1);
      player.heavyCharges = Math.min(player.heavyMaxCharges, player.heavyCharges + 1);
      player.heavyKillsPerCharge = Math.max(2, player.heavyKillsPerCharge - 1);
      player.heavyCooldownMs = Math.max(540, player.heavyCooldownMs - 40);
    }
  }

  if (choice === "airstrike") {
    if (!player.airstrikeUnlocked) {
      player.airstrikeUnlocked = true;
      player.airstrikeMaxCharges = 1;
      player.airstrikeCharges = 1;
      player.airstrikeProgress = 0;
      player.airstrikeKillsPerCharge = 4;
    } else {
      player.airstrikeMaxCharges = Math.min(6, player.airstrikeMaxCharges + 1);
      player.airstrikeCharges = Math.min(player.airstrikeMaxCharges, player.airstrikeCharges + 1);
      player.airstrikeKillsPerCharge = Math.max(3, player.airstrikeKillsPerCharge - 1);
    }
  }

  pendingUpgrades = Math.max(0, pendingUpgrades - 1);
  playSound("upgrade");
}

function createExplosionVisual(x, y, radius, color = "#ffbe7c") {
  explosions.push({
    x,
    y,
    radius,
    life: 0.44,
    duration: 0.44,
    color,
  });
}

function applyExplosion(x, y, radius, damage, owner) {
  createExplosionVisual(x, y, radius, owner === "player" ? "#ffc989" : "#ff9970");
  playSound("boom");

  const minTx = Math.floor((x - radius) / TILE);
  const maxTx = Math.floor((x + radius) / TILE);
  const minTy = Math.floor((y - radius) / TILE);
  const maxTy = Math.floor((y + radius) / TILE);

  for (let ty = minTy; ty <= maxTy; ty += 1) {
    for (let tx = minTx; tx <= maxTx; tx += 1) {
      if (!isInside(tx, ty)) {
        continue;
      }

      const tileType = maze[ty][tx];
      if (tileType !== TILE_STONE && tileType !== TILE_BRICK) {
        continue;
      }

      const cx = tx * TILE + TILE / 2;
      const cy = ty * TILE + TILE / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d > radius + TILE * 0.45) {
        continue;
      }

      const factor = 1 - d / (radius + TILE * 0.45);
      const wallDamage = Math.max(1, Math.round(damage * factor + 0.35));
      damageWallTile(tx, ty, wallDamage);
    }
  }

  if (owner === "player") {
    for (let i = enemies.length - 1; i >= 0; i -= 1) {
      const enemy = enemies[i];
      const d = Math.hypot(enemy.x - x, enemy.y - y);
      if (d > radius + enemy.radius) {
        continue;
      }

      const factor = 1 - d / (radius + enemy.radius);
      const hitDamage = Math.max(1, Math.round(damage * factor + 0.4));
      enemy.health -= hitDamage;

      if (enemy.health <= 0) {
        const dead = enemies.splice(i, 1)[0];
        onEnemyKilled(dead);
      }
    }
  } else {
    const d = Math.hypot(player.x - x, player.y - y);
    if (d <= radius + player.radius) {
      const factor = 1 - d / (radius + player.radius);
      hurtPlayer(Math.max(1, Math.round(damage * factor + 0.35)));
    }
  }
}

function updatePendingBombs(dt) {
  for (let i = pendingBombs.length - 1; i >= 0; i -= 1) {
    const bomb = pendingBombs[i];
    bomb.delay -= dt;

    if (bomb.delay <= 0) {
      applyExplosion(bomb.x, bomb.y, bomb.radius, bomb.damage, bomb.owner);
      pendingBombs.splice(i, 1);
    }
  }
}

function updateExplosions(dt) {
  for (let i = explosions.length - 1; i >= 0; i -= 1) {
    const e = explosions[i];
    e.life -= dt;
    if (e.life <= 0) {
      explosions.splice(i, 1);
    }
  }
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i -= 1) {
    const bullet = bullets[i];

    bullet.life -= dt;
    if (bullet.life <= 0) {
      if (bullet.type === "heavy") {
        applyExplosion(bullet.x, bullet.y, bullet.splashRadius, bullet.damage, bullet.owner);
      }
      bullets.splice(i, 1);
      continue;
    }

    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;

    if (bullet.x < 0 || bullet.y < 0 || bullet.x > mapWidth || bullet.y > mapHeight) {
      if (bullet.type === "heavy") {
        applyExplosion(bullet.x, bullet.y, bullet.splashRadius, bullet.damage, bullet.owner);
      }
      bullets.splice(i, 1);
      continue;
    }

    const tile = tileAtWorld(bullet.x, bullet.y);
    if (SOLID_TILES.has(tile.type)) {
      if (bullet.type === "heavy") {
        applyExplosion(bullet.x, bullet.y, bullet.splashRadius, bullet.damage, bullet.owner);
      } else if (bullet.type === "ap" && bullet.pierceWalls > 0) {
        const penKey = `${tile.tx}:${tile.ty}`;
        if (bullet.lastPenTile !== penKey) {
          damageWallTile(tile.tx, tile.ty, bullet.wallDamage);
          bullet.pierceWalls -= 1;
          bullet.lastPenTile = penKey;
          bullet.x += bullet.vx * dt * 0.35;
          bullet.y += bullet.vy * dt * 0.35;
        }
        continue;
      } else {
        damageWallTile(tile.tx, tile.ty, bullet.wallDamage);
      }

      bullets.splice(i, 1);
      continue;
    }

    if (bullet.owner === "player") {
      let removed = false;

      for (let e = enemies.length - 1; e >= 0; e -= 1) {
        const enemy = enemies[e];
        const d = Math.hypot(bullet.x - enemy.x, bullet.y - enemy.y);
        if (d >= bullet.radius + enemy.radius) {
          continue;
        }

        if (bullet.type === "heavy") {
          applyExplosion(bullet.x, bullet.y, bullet.splashRadius, bullet.damage, bullet.owner);
        } else {
          enemy.health -= bullet.damage;
          if (enemy.health <= 0) {
            const dead = enemies.splice(e, 1)[0];
            onEnemyKilled(dead);
          }
        }

        if (bullet.type === "ap" && bullet.pierceEnemies > 0) {
          bullet.pierceEnemies -= 1;
          bullets.splice(i, 1);
          removed = true;
        } else {
          bullets.splice(i, 1);
          removed = true;
        }
        break;
      }

      if (removed) {
        continue;
      }
    } else {
      const d = Math.hypot(bullet.x - player.x, bullet.y - player.y);
      if (d < bullet.radius + player.radius) {
        hurtPlayer(bullet.damage);
        bullets.splice(i, 1);
      }
    }
  }
}

function computeEnemySeparation(enemy) {
  let sx = 0;
  let sy = 0;

  for (const other of enemies) {
    if (other === enemy) {
      continue;
    }

    const dx = enemy.x - other.x;
    const dy = enemy.y - other.y;
    const dist = Math.hypot(dx, dy);
    const minDist = enemy.radius + other.radius + 16;

    if (dist > 0 && dist < minDist) {
      const push = (minDist - dist) / minDist;
      sx += (dx / dist) * push;
      sy += (dy / dist) * push;
    }
  }

  return { x: sx, y: sy };
}

function updateEnemies(dt, nowMs) {
  for (const enemy of enemies) {
    const dxToPlayer = player.x - enemy.x;
    const dyToPlayer = player.y - enemy.y;
    const distToPlayer = Math.hypot(dxToPlayer, dyToPlayer);

    const enemyBush = getEntityBushInfo(enemy);
    const sameBushCluster =
      playerBushInfo.hidden &&
      enemyBush.region > 0 &&
      enemyBush.region === playerBushInfo.region;

    const hasLOS =
      distToPlayer < enemy.sightRange && hasLineOfSight(enemy.x, enemy.y, player.x, player.y);
    const seesNow = hasLOS && (!playerBushInfo.hidden || sameBushCluster);

    if (seesNow) {
      if (!enemy.seesPlayer) {
        enemy.spotStartedAt = nowMs;
      }

      enemy.seesPlayer = true;
      enemy.lastKnownX = player.x;
      enemy.lastKnownY = player.y;

      if (nowMs - enemy.spotStartedAt >= enemy.reactionDelayMs) {
        enemy.combatUntil = Math.max(enemy.combatUntil, nowMs + 2400 + level * 110);
      }
    } else {
      enemy.seesPlayer = false;
      enemy.spotStartedAt = 0;
    }

    const inCombat = nowMs < enemy.combatUntil;

    let desiredX = 0;
    let desiredY = 0;

    if (inCombat) {
      const tx = enemy.lastKnownX - enemy.x;
      const ty = enemy.lastKnownY - enemy.y;
      const targetDist = Math.hypot(tx, ty) || 1;
      const ux = tx / targetDist;
      const uy = ty / targetDist;

      const preferredDist = enemy.isBoss
        ? clamp(260 - level * 3, 170, 260)
        : clamp(220 - level * 4, 145, 220);

      if (targetDist > preferredDist + 35) {
        desiredX += ux;
        desiredY += uy;
      } else if (targetDist < preferredDist - 28) {
        desiredX -= ux * 0.9;
        desiredY -= uy * 0.9;
      }

      if (nowMs > enemy.nextOrbitFlipAt) {
        if (Math.random() < 0.45) {
          enemy.orbitDir *= -1;
        }
        enemy.nextOrbitFlipAt = nowMs + rand(900, 2000);
      }

      const orbitScale = enemy.isBoss ? 0.52 : 0.72;
      desiredX += -uy * enemy.orbitDir * orbitScale;
      desiredY += ux * enemy.orbitDir * orbitScale;
    } else {
      if (nowMs >= enemy.patrolPauseUntil) {
        const target = enemy.patrolPoints[enemy.patrolIndex];
        const tx = target.x - enemy.x;
        const ty = target.y - enemy.y;
        const dist = Math.hypot(tx, ty);

        if (dist < 20) {
          enemy.patrolIndex = (enemy.patrolIndex + 1) % enemy.patrolPoints.length;
          enemy.patrolPauseUntil = nowMs + rand(120, 290);
        } else if (dist > 0) {
          desiredX += tx / dist;
          desiredY += ty / dist;
        }
      }
    }

    const separation = computeEnemySeparation(enemy);
    desiredX += separation.x * 1.7;
    desiredY += separation.y * 1.7;

    let targetSpeed = 0;
    const desiredLen = Math.hypot(desiredX, desiredY);

    if (desiredLen > 0.001) {
      desiredX /= desiredLen;
      desiredY /= desiredLen;

      const targetHeading = Math.atan2(desiredY, desiredX);
      const headingDiff = Math.abs(shortestAngleDiff(enemy.bodyAngle, targetHeading));

      enemy.bodyAngle = rotateTowardAngle(enemy.bodyAngle, targetHeading, enemy.maxTurnRate * dt);

      targetSpeed = inCombat ? enemy.speed : enemy.speed * (enemy.isBoss ? 0.62 : 0.7);
      if (headingDiff > 1.08) {
        targetSpeed *= 0.45;
      }
    }

    enemy.currentSpeed = approach(enemy.currentSpeed, targetSpeed, enemy.accel * dt);

    const step = enemy.currentSpeed * dt;
    let moved = 0;
    if (step > 0.001) {
      moved = moveWithCollisions(enemy, Math.cos(enemy.bodyAngle) * step, Math.sin(enemy.bodyAngle) * step);
    }

    if (step > 0.2 && moved < step * 0.32) {
      enemy.stuckTimer += dt;
      enemy.currentSpeed *= 0.35;
      enemy.bodyAngle += enemy.avoidTurnDir * enemy.maxTurnRate * dt * 1.22;

      if (enemy.stuckTimer > 0.65) {
        enemy.stuckTimer = 0;
        enemy.avoidTurnDir *= -1;
        if (!inCombat) {
          enemy.patrolIndex = (enemy.patrolIndex + 1) % enemy.patrolPoints.length;
          enemy.patrolPauseUntil = nowMs + rand(160, 360);
        }
      }
    } else {
      enemy.stuckTimer = Math.max(0, enemy.stuckTimer - dt * 1.9);
    }
    emitMotionEffects(enemy, moved, dt);

    const turretTarget = inCombat
      ? Math.atan2(enemy.lastKnownY - enemy.y, enemy.lastKnownX - enemy.x)
      : enemy.bodyAngle;

    enemy.turretAngle = rotateTowardAngle(
      enemy.turretAngle,
      turretTarget,
      enemy.turretTurnSpeed * dt,
    );

    if (enemy.isBoss) {
      const turretTargetB = inCombat
        ? Math.atan2(enemy.lastKnownY - enemy.y, enemy.lastKnownX - enemy.x) + enemy.orbitDir * 0.07
        : enemy.bodyAngle + enemy.orbitDir * 0.18;
      enemy.turretAngleB = rotateTowardAngle(
        enemy.turretAngleB || enemy.turretAngle,
        turretTargetB,
        enemy.turretTurnSpeed * dt * 0.95,
      );
    }

    if (
      inCombat &&
      seesNow &&
      distToPlayer < enemy.sightRange - 20 &&
      nowMs - enemy.lastShotAt >= enemy.fireCooldownMs
    ) {
      const liveAngle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
      const gate = (enemy.isBoss ? 0.17 : 0.135) + clamp(distToPlayer / 980, 0, 0.07);

      if (enemy.isBoss) {
        const aimDiffA = Math.abs(shortestAngleDiff(enemy.turretAngle, liveAngle));
        const aimDiffB = Math.abs(shortestAngleDiff(enemy.turretAngleB || enemy.turretAngle, liveAngle));
        const spreadBoss = clamp(enemy.baseSpread - level * 0.002, 0.03, 0.14);

        if (aimDiffA < gate || aimDiffB < gate) {
          shoot(enemy, "enemy", nowMs, enemy.turretAngle, 300 + level * 4, spreadBoss, {
            type: "enemy",
            damage: 1,
            wallDamage: 1,
            radius: 4,
          });
          shoot(enemy, "enemy", nowMs, enemy.turretAngleB || enemy.turretAngle, 300 + level * 4, spreadBoss, {
            type: "enemy",
            damage: 1,
            wallDamage: 1,
            radius: 4,
            touchOwnerCooldown: false,
          });
          enemy.lastShotAt = nowMs;
        }
      } else {
        const aimDiff = Math.abs(shortestAngleDiff(enemy.turretAngle, liveAngle));
        if (aimDiff < gate) {
          const spread = clamp(enemy.baseSpread - level * 0.003, 0.04, 0.2);
          shoot(enemy, "enemy", nowMs, enemy.turretAngle, 280 + level * 4, spread, {
            type: "enemy",
            damage: 1,
            wallDamage: 1,
            radius: 4,
          });
        }
      }
    }
  }
}

function updatePickups() {
  for (let i = fuelBarrels.length - 1; i >= 0; i -= 1) {
    const pickup = fuelBarrels[i];
    if (Math.hypot(player.x - pickup.x, player.y - pickup.y) < 24) {
      player.health = Math.min(player.maxHealth, player.health + 1);
      player.fuel = Math.min(player.maxFuel, player.fuel + 42);
      playSound("pickup");
      fuelBarrels.splice(i, 1);
    }
  }

  for (let i = ammoCrates.length - 1; i >= 0; i -= 1) {
    const pickup = ammoCrates[i];
    if (Math.hypot(player.x - pickup.x, player.y - pickup.y) < 24) {
      player.ammo = Math.min(player.maxAmmo, player.ammo + 11);
      playSound("pickup");
      ammoCrates.splice(i, 1);
    }
  }

  for (let i = armorCrates.length - 1; i >= 0; i -= 1) {
    const pickup = armorCrates[i];
    if (Math.hypot(player.x - pickup.x, player.y - pickup.y) < 24) {
      if (player.maxArmor > 0) {
        player.armor = Math.min(player.maxArmor, player.armor + 2);
      }
      playSound("pickup");
      armorCrates.splice(i, 1);
    }
  }
}

function updateCamera() {
  camera.x = clamp(player.x - canvas.width / 2, 0, Math.max(0, mapWidth - canvas.width));
  camera.y = clamp(player.y - canvas.height / 2, 0, Math.max(0, mapHeight - canvas.height));
}

function updatePlayer(dt, nowMs) {
  const up = keys.KeyW || keys.ArrowUp;
  const down = keys.KeyS || keys.ArrowDown;
  const left = keys.KeyA || keys.ArrowLeft;
  const right = keys.KeyD || keys.ArrowRight;

  let mvx = 0;
  let mvy = 0;
  if (isTouchDevice && touchInput.move.mag > 0.08) {
    mvx = touchInput.move.x;
    mvy = touchInput.move.y;
  } else {
    if (up) {
      mvy -= 1;
    }
    if (down) {
      mvy += 1;
    }
    if (left) {
      mvx -= 1;
    }
    if (right) {
      mvx += 1;
    }

    const len = Math.hypot(mvx, mvy);
    if (len > 0) {
      mvx /= len;
      mvy /= len;
    }
  }

  const moveLen = Math.hypot(mvx, mvy);
  if (moveLen > 1) {
    mvx /= moveLen;
    mvy /= moveLen;
  }

  const aimTarget = getPlayerAimWorldTarget();
  player.turretAngle = Math.atan2(aimTarget.y - player.y, aimTarget.x - player.x);

  if (player.fuel > 0 && moveLen > 0.01) {
    const dx = mvx * player.speed * dt;
    const dy = mvy * player.speed * dt;
    const moved = moveWithCollisions(player, dx, dy);

    if (moved > 0.01) {
      player.bodyAngle = Math.atan2(mvy, mvx);
      player.fuel = Math.max(0, player.fuel - moved * 0.019);
      emitMotionEffects(player, moved, dt);
    }
  }

  if (mouse.down || keys.Space || (isTouchDevice && touchInput.fireHeld)) {
    tryShootPlayer(nowMs);
  }

  if (justPressed.has("KeyE") || touchInput.heavyQueued) {
    tryFireHeavy(nowMs);
  }

  if (justPressed.has("KeyQ") || touchInput.airstrikeQueued) {
    tryCallAirstrike(nowMs);
  }

  touchInput.heavyQueued = false;
  touchInput.airstrikeQueued = false;
}

function handleUpgradeInput() {
  if (justPressed.has("Digit1")) {
    applyUpgrade("fire");
  }
  if (justPressed.has("Digit2")) {
    applyUpgrade("armor");
  }
  if (justPressed.has("Digit3")) {
    applyUpgrade("heavy");
  }
  if (justPressed.has("Digit4")) {
    applyUpgrade("airstrike");
  }
}

function update(dt, nowMs) {
  if (gameOver) {
    if (justPressed.has("KeyR")) {
      resetGame();
    }
    updateWorldParticles(dt);
    return;
  }

  if (pendingUpgrades > 0) {
    handleUpgradeInput();
    playerBushInfo = getEntityBushInfo(player);
    updateCamera();
    updateWorldParticles(dt);
    return;
  }

  playerBushInfo = getEntityBushInfo(player);

  updatePlayer(dt, nowMs);
  updateEnemies(dt, nowMs);
  updateBullets(dt);
  updatePendingBombs(dt);
  updateExplosions(dt);
  updatePickups();
  updateWorldParticles(dt);

  if (enemies.length === 0) {
    setupLevel(level + 1);
  }

  playerBushInfo = getEntityBushInfo(player);
  updateCamera();
}

function drawFloorTile(wx, wy, tx, ty) {
  const shade = 20 + Math.floor(hashFloat(tx, ty, 1) * 13);
  const g = shade + 10;
  const b = shade + 8;
  ctx.fillStyle = `rgb(${shade}, ${g}, ${b})`;
  ctx.fillRect(wx, wy, TILE, TILE);

  if (hashFloat(tx, ty, 2) > 0.72) {
    ctx.fillStyle = "rgba(69, 87, 72, 0.35)";
    const ox = 4 + hashFloat(tx, ty, 3) * 21;
    const oy = 5 + hashFloat(tx, ty, 4) * 22;
    ctx.fillRect(wx + ox, wy + oy, 3, 3);
    ctx.fillRect(wx + ox + 5, wy + oy - 1, 2, 2);
  }

  if (hashFloat(tx, ty, 5) > 0.8) {
    ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(wx + 6 + hashFloat(tx, ty, 6) * 13, wy + 5 + hashFloat(tx, ty, 7) * 8);
    ctx.lineTo(wx + 16 + hashFloat(tx, ty, 8) * 10, wy + 24 + hashFloat(tx, ty, 9) * 10);
    ctx.stroke();
  }
}

function drawBushTile(wx, wy, tx, ty) {
  drawFloorTile(wx, wy, tx, ty);

  ctx.fillStyle = "rgba(24, 76, 32, 0.42)";
  ctx.fillRect(wx, wy, TILE, TILE);

  ctx.strokeStyle = "rgba(84, 145, 79, 0.38)";
  ctx.lineWidth = 1;
  for (let i = -2; i <= 5; i += 1) {
    const x1 = wx + i * 8;
    ctx.beginPath();
    ctx.moveTo(x1, wy);
    ctx.lineTo(x1 + 14, wy + TILE);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(29, 61, 26, 0.44)";
  for (let i = -2; i <= 5; i += 1) {
    const x1 = wx + i * 8;
    ctx.beginPath();
    ctx.moveTo(x1 + 14, wy);
    ctx.lineTo(x1, wy + TILE);
    ctx.stroke();
  }

  for (let i = 0; i < 7; i += 1) {
    const ox = 4 + hashFloat(tx, ty, 30 + i) * 30;
    const oy = 4 + hashFloat(tx, ty, 40 + i) * 30;
    const r = 3 + hashFloat(tx, ty, 50 + i) * 4;
    const tone = 80 + Math.floor(hashFloat(tx, ty, 60 + i) * 50);
    ctx.fillStyle = `rgba(${20 + i * 2}, ${tone}, ${24 + i}, 0.62)`;
    ctx.beginPath();
    ctx.arc(wx + ox, wy + oy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(16, 42, 20, 0.3)";
  ctx.strokeRect(wx + 1, wy + 1, TILE - 2, TILE - 2);
}

function drawStoneWallTile(wx, wy, tx, ty, hp) {
  const tone = 94 + Math.floor(hashFloat(tx, ty, 70) * 27);
  ctx.fillStyle = `rgb(${tone}, ${tone + 8}, ${tone + 4})`;
  ctx.fillRect(wx, wy, TILE, TILE);

  ctx.strokeStyle = "rgba(43, 46, 48, 0.56)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i += 1) {
    const y = wy + 8 + i * 11 + hashFloat(tx, ty, 80 + i) * 2;
    ctx.beginPath();
    ctx.moveTo(wx + 3, y);
    ctx.lineTo(wx + TILE - 3, y + (hashFloat(tx, ty, 90 + i) - 0.5) * 3);
    ctx.stroke();
  }

  for (let i = 0; i < 2; i += 1) {
    const x = wx + 9 + i * 13 + hashFloat(tx, ty, 100 + i) * 2;
    ctx.beginPath();
    ctx.moveTo(x, wy + 4);
    ctx.lineTo(x + (hashFloat(tx, ty, 110 + i) - 0.5) * 4, wy + TILE - 4);
    ctx.stroke();
  }

  if (hashFloat(tx, ty, 120) > 0.56) {
    ctx.fillStyle = "rgba(34, 84, 45, 0.4)";
    ctx.beginPath();
    ctx.arc(wx + 10 + hashFloat(tx, ty, 121) * 18, wy + 12 + hashFloat(tx, ty, 122) * 16, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  if (hp <= 1) {
    ctx.strokeStyle = "rgba(23, 23, 23, 0.74)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wx + 5, wy + 7);
    ctx.lineTo(wx + TILE - 7, wy + TILE - 9);
    ctx.lineTo(wx + TILE - 5, wy + TILE - 4);
    ctx.stroke();
  }
}

function drawBrickWallTile(wx, wy, tx, ty, hp) {
  const base = 116 + Math.floor(hashFloat(tx, ty, 130) * 28);
  ctx.fillStyle = `rgb(${base}, ${68 + Math.floor(base * 0.14)}, ${56 + Math.floor(base * 0.1)})`;
  ctx.fillRect(wx, wy, TILE, TILE);

  ctx.strokeStyle = "rgba(55, 33, 26, 0.56)";
  ctx.lineWidth = 1.4;
  const rows = 4;
  const rowH = TILE / rows;

  for (let r = 1; r < rows; r += 1) {
    const y = wy + r * rowH;
    ctx.beginPath();
    ctx.moveTo(wx, y);
    ctx.lineTo(wx + TILE, y);
    ctx.stroke();
  }

  for (let r = 0; r < rows; r += 1) {
    const offset = r % 2 === 0 ? 0 : TILE / 4;
    for (let c = 0; c < 3; c += 1) {
      const x = wx + offset + c * (TILE / 3);
      ctx.beginPath();
      ctx.moveTo(x, wy + r * rowH);
      ctx.lineTo(x, wy + (r + 1) * rowH);
      ctx.stroke();
    }
  }

  if (hashFloat(tx, ty, 131) > 0.62) {
    ctx.fillStyle = "rgba(35, 81, 40, 0.35)";
    ctx.fillRect(wx + 3, wy + TILE - 12, 9, 8);
  }

  if (hp <= 2) {
    ctx.strokeStyle = "rgba(38, 22, 18, 0.72)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wx + 6, wy + 9);
    ctx.lineTo(wx + 16, wy + 18);
    ctx.lineTo(wx + 13, wy + TILE - 8);
    ctx.stroke();
  }

  if (hp <= 1) {
    ctx.beginPath();
    ctx.moveTo(wx + TILE - 9, wy + 5);
    ctx.lineTo(wx + TILE - 15, wy + 16);
    ctx.lineTo(wx + TILE - 8, wy + TILE - 8);
    ctx.stroke();
  }
}

function drawBorderTile(wx, wy, tx, ty) {
  const tone = 74 + Math.floor(hashFloat(tx, ty, 140) * 18);
  ctx.fillStyle = `rgb(${tone}, ${tone + 3}, ${tone + 7})`;
  ctx.fillRect(wx, wy, TILE, TILE);

  ctx.fillStyle = "rgba(0, 0, 0, 0.24)";
  ctx.fillRect(wx + 3, wy + 3, TILE - 6, TILE - 6);

  ctx.fillStyle = "rgba(145, 154, 160, 0.48)";
  ctx.fillRect(wx + 5, wy + 5, TILE - 10, 3);
}

function drawTile(wx, wy, tx, ty) {
  const tile = maze[ty][tx];

  if (tile === TILE_FLOOR) {
    drawFloorTile(wx, wy, tx, ty);
  } else if (tile === TILE_BUSH) {
    drawBushTile(wx, wy, tx, ty);
  } else if (tile === TILE_STONE) {
    drawStoneWallTile(wx, wy, tx, ty, wallHp[ty][tx]);
  } else if (tile === TILE_BRICK) {
    drawBrickWallTile(wx, wy, tx, ty, wallHp[ty][tx]);
  } else {
    drawBorderTile(wx, wy, tx, ty);
  }
}

function drawFlag(x, y, flag) {
  const w = 14;
  const h = 9;

  ctx.save();
  ctx.strokeStyle = "#262626";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x, y + 2);
  ctx.lineTo(x, y - 11);
  ctx.stroke();

  ctx.translate(x + 1, y - 11);

  if (flag.type === "us") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#c94141";
    for (let i = 0; i < 6; i += 1) {
      ctx.fillRect(0, i * 1.5, w, 0.8);
    }

    ctx.fillStyle = "#305bb7";
    ctx.fillRect(0, 0, w * 0.46, h * 0.56);

    ctx.fillStyle = "rgba(245, 247, 255, 0.9)";
    for (let sy = 0; sy < 3; sy += 1) {
      for (let sx = 0; sx < 3; sx += 1) {
        ctx.fillRect(1 + sx * 2.1, 1 + sy * 1.5, 0.55, 0.55);
      }
    }
  } else if (flag.type === "h") {
    const stripeH = h / flag.colors.length;
    for (let i = 0; i < flag.colors.length; i += 1) {
      ctx.fillStyle = flag.colors[i];
      ctx.fillRect(0, i * stripeH, w, stripeH);
    }
  } else {
    const stripeW = w / flag.colors.length;
    for (let i = 0; i < flag.colors.length; i += 1) {
      ctx.fillStyle = flag.colors[i];
      ctx.fillRect(i * stripeW, 0, stripeW, h);
    }
  }

  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.strokeRect(0, 0, w, h);
  ctx.restore();
}

function drawTank(tank, style) {
  const scale = tank.isBoss ? 1.22 : 1;
  const armorPlateCount = tank.maxArmor ? Math.min(6, Math.ceil(tank.maxArmor / 2)) : 0;
  const activeArmorPlates = tank.armor ? Math.ceil(tank.armor / 2) : 0;

  ctx.save();
  ctx.translate(tank.x, tank.y + 4);
  ctx.fillStyle = "rgba(0, 0, 0, 0.26)";
  ctx.beginPath();
  ctx.ellipse(0, 0, 23 * scale, 15 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(tank.x, tank.y);
  ctx.rotate(tank.bodyAngle);
  ctx.scale(scale, scale);

  ctx.fillStyle = style.track;
  ctx.fillRect(-21, -16, 8, 32);
  ctx.fillRect(13, -16, 8, 32);

  ctx.fillStyle = "rgba(188, 196, 201, 0.3)";
  for (let i = -11; i <= 11; i += 6) {
    ctx.beginPath();
    ctx.arc(-17, i, 1.7, 0, Math.PI * 2);
    ctx.arc(17, i, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = style.bodyDark;
  ctx.fillRect(-13, -14, 26, 28);

  ctx.fillStyle = style.body;
  ctx.fillRect(-12, -11, 24, 22);

  ctx.fillStyle = style.panel;
  ctx.fillRect(-5, -7, 17, 14);

  if (armorPlateCount > 0) {
    for (let i = 0; i < armorPlateCount; i += 1) {
      const px = -14 + i * 5;
      const filled = i < activeArmorPlates;
      ctx.fillStyle = filled ? "#77a9ff" : "#4d6586";
      ctx.fillRect(px, -18, 4, 3);
      ctx.fillRect(px, 15, 4, 3);
    }

    ctx.fillStyle = activeArmorPlates > 0 ? "#6b9dfa" : "#435873";
    ctx.fillRect(-15, -12, 3, 24);
    ctx.fillRect(12, -12, 3, 24);
  }

  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.lineWidth = 1.6;
  ctx.strokeRect(-13, -14, 26, 28);

  ctx.restore();

  const drawSingleTurret = (angle, sideOffset = 0) => {
    ctx.save();
    const ox = -Math.sin(tank.bodyAngle) * sideOffset;
    const oy = Math.cos(tank.bodyAngle) * sideOffset;
    ctx.translate(tank.x + ox, tank.y + oy);
    ctx.rotate(angle);
    ctx.scale(scale, scale);

    ctx.fillStyle = style.turret;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = style.barrel;
    ctx.fillRect(5, -3.1, 22, 6.2);
    ctx.fillStyle = "#0f1315";
    ctx.fillRect(26, -2, 4, 4);

    ctx.fillStyle = "rgba(222, 232, 236, 0.2)";
    ctx.fillRect(-3.2, -3.2, 5.2, 2.2);
    ctx.restore();
  };

  drawSingleTurret(tank.turretAngle, tank.isBoss ? -6 : 0);
  if (tank.isBoss) {
    drawSingleTurret(tank.turretAngleB || tank.turretAngle, 6);
  }

  drawFlag(tank.x - 16 * scale, tank.y - 22 * scale, style.flag);
}

function drawFuelPickup(x, y) {
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = "#7f4f2e";
  ctx.fillRect(-8, -11, 16, 22);
  ctx.fillStyle = "#a86b3c";
  ctx.fillRect(-7, -10, 14, 20);

  ctx.fillStyle = "#2a1f18";
  ctx.fillRect(-2, -14, 4, 4);

  ctx.fillStyle = "#ffc465";
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(4, 4);
  ctx.lineTo(0, 7);
  ctx.lineTo(-4, 4);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawAmmoPickup(x, y) {
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = "#666e76";
  ctx.fillRect(-10, -8, 20, 16);
  ctx.fillStyle = "#8a949f";
  ctx.fillRect(-9, -7, 18, 14);

  ctx.fillStyle = "#2e3a47";
  ctx.fillRect(-6, -3, 12, 6);

  ctx.fillStyle = "#d9bc72";
  for (let i = -4; i <= 4; i += 4) {
    ctx.fillRect(i, -10, 3, 6);
    ctx.fillStyle = "#ab8e4e";
    ctx.fillRect(i, -10, 3, 2);
    ctx.fillStyle = "#d9bc72";
  }

  ctx.restore();
}

function drawArmorPickup(x, y) {
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = "#4b607a";
  ctx.beginPath();
  ctx.moveTo(0, -11);
  ctx.lineTo(10, -5);
  ctx.lineTo(8, 8);
  ctx.lineTo(0, 12);
  ctx.lineTo(-8, 8);
  ctx.lineTo(-10, -5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#79a9ff";
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(7, -4);
  ctx.lineTo(5, 6);
  ctx.lineTo(0, 9);
  ctx.lineTo(-5, 6);
  ctx.lineTo(-7, -4);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawBombMarkers() {
  for (const bomb of pendingBombs) {
    const p = 1 - clamp(bomb.delay / 1.5, 0, 1);
    const radius = 9 + p * 12;
    const alpha = 0.2 + p * 0.6;

    ctx.strokeStyle = `rgba(255, 80, 60, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bomb.x, bomb.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = `rgba(255, 145, 105, ${alpha * 0.6})`;
    ctx.beginPath();
    ctx.arc(bomb.x, bomb.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawExplosions() {
  for (const e of explosions) {
    const t = clamp(e.life / e.duration, 0, 1);
    const r = e.radius * (1.1 - t * 0.35);

    ctx.fillStyle = `rgba(255, 232, 170, ${0.3 * t})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(255, 190, 112, ${0.46 * t})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r * 0.62, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(255, 118, 52, ${0.55 * t})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r * 0.32, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(255, 248, 218, ${0.22 * t})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r * 0.88, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawTrackMarks() {
  for (const mark of trackMarks) {
    const alpha = clamp(mark.life / mark.maxLife, 0, 1) * 0.28;
    ctx.save();
    ctx.translate(mark.x, mark.y);
    ctx.rotate(mark.angle);
    ctx.fillStyle = `rgba(25, 25, 25, ${alpha})`;
    ctx.fillRect(-5, -mark.width / 2, 10, mark.width);
    ctx.restore();
  }
}

function drawWrecks() {
  for (const wreck of wrecks) {
    const alpha = clamp(wreck.life / wreck.maxLife, 0.25, 1);
    ctx.save();
    ctx.translate(wreck.x, wreck.y);
    ctx.rotate(wreck.angle);
    ctx.globalAlpha = alpha;

    const bodyW = wreck.isBoss ? 32 : 24;
    const bodyH = wreck.isBoss ? 26 : 20;

    ctx.fillStyle = "rgba(36, 34, 30, 0.95)";
    ctx.fillRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.lineWidth = 1.3;
    ctx.strokeRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH);

    ctx.fillStyle = "rgba(255, 123, 67, 0.24)";
    ctx.fillRect(-bodyW / 3, -bodyH / 3, bodyW / 1.5, bodyH / 1.5);
    ctx.restore();
  }
}

function drawTurretDebris() {
  for (const d of turretDebris) {
    const alpha = clamp(d.life / d.maxLife, 0, 1);
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.angle);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(0, 0, d.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1b1b1b";
    ctx.fillRect(d.size * 0.35, -2, d.size * 1.2, 4);
    ctx.restore();
  }
}

function drawSmokeParticles() {
  for (const s of smokeParticles) {
    const alpha = clamp(s.life / s.maxLife, 0, 1) * 0.36;
    ctx.fillStyle = s.tint.replace("1)", `${alpha})`);
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEdgeHaze() {
  const maxR = Math.max(canvas.width, canvas.height) * 0.9;
  const grad = ctx.createRadialGradient(
    player.x,
    player.y,
    TILE * 3.8,
    player.x,
    player.y,
    maxR,
  );
  grad.addColorStop(0, "rgba(255, 255, 255, 0)");
  grad.addColorStop(0.68, "rgba(255, 255, 255, 0.05)");
  grad.addColorStop(1, "rgba(255, 255, 255, 0.14)");

  ctx.fillStyle = grad;
  ctx.fillRect(camera.x, camera.y, canvas.width, canvas.height);
}

function drawWorld() {
  ctx.fillStyle = "#0b1414";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  const startCol = Math.floor(camera.x / TILE);
  const endCol = Math.ceil((camera.x + canvas.width) / TILE);
  const startRow = Math.floor(camera.y / TILE);
  const endRow = Math.ceil((camera.y + canvas.height) / TILE);

  for (let y = startRow; y <= endRow; y += 1) {
    for (let x = startCol; x <= endCol; x += 1) {
      if (!isInside(x, y)) {
        continue;
      }

      drawTile(x * TILE, y * TILE, x, y);
    }
  }
  drawTrackMarks();

  for (const barrel of fuelBarrels) {
    drawFuelPickup(barrel.x, barrel.y);
  }

  for (const crate of ammoCrates) {
    drawAmmoPickup(crate.x, crate.y);
  }

  for (const crate of armorCrates) {
    drawArmorPickup(crate.x, crate.y);
  }

  drawWrecks();
  drawTurretDebris();
  drawBombMarkers();

  for (const enemy of enemies) {
    drawTank(enemy, enemy.style);
  }

  if (playerBushInfo.hidden) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    drawTank(player, PLAYER_STYLE);
    ctx.restore();
  } else {
    drawTank(player, PLAYER_STYLE);
  }

  if (isTouchDevice && touchInput.aim.mag > 0.16) {
    const aimTarget = getPlayerAimWorldTarget();
    const pulse = 0.5 + Math.sin(performance.now() * 0.01) * 0.5;
    const r = 10 + pulse * 2;

    ctx.beginPath();
    ctx.arc(aimTarget.x, aimTarget.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(230, 247, 236, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(aimTarget.x - r - 6, aimTarget.y);
    ctx.lineTo(aimTarget.x - r + 2, aimTarget.y);
    ctx.moveTo(aimTarget.x + r - 2, aimTarget.y);
    ctx.lineTo(aimTarget.x + r + 6, aimTarget.y);
    ctx.moveTo(aimTarget.x, aimTarget.y - r - 6);
    ctx.lineTo(aimTarget.x, aimTarget.y - r + 2);
    ctx.moveTo(aimTarget.x, aimTarget.y + r - 2);
    ctx.lineTo(aimTarget.x, aimTarget.y + r + 6);
    ctx.strokeStyle = "rgba(186, 231, 193, 0.75)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  for (const bullet of bullets) {
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
    if (bullet.type === "ap") {
      ctx.fillStyle = "#d5f3ff";
    } else {
      ctx.fillStyle = bullet.owner === "player" ? "#e7ffe8" : "#ffd2ad";
    }
    ctx.fill();
  }

  drawSmokeParticles();
  drawExplosions();
  drawEdgeHaze();

  ctx.restore();
}

function drawHeartIcon(c, x, y, size, fillRatio) {
  const s = size / 14;
  c.save();
  c.translate(x, y);
  c.scale(s, s);

  c.beginPath();
  c.moveTo(0, 4.5);
  c.bezierCurveTo(0, 1.8, 2.2, 0, 4.4, 0);
  c.bezierCurveTo(6.3, 0, 7.3, 1.1, 8.1, 2.2);
  c.bezierCurveTo(8.9, 1.1, 9.9, 0, 11.8, 0);
  c.bezierCurveTo(14.1, 0, 16.2, 1.8, 16.2, 4.5);
  c.bezierCurveTo(16.2, 7.1, 14.3, 9.2, 12, 11.2);
  c.lineTo(8.1, 14.5);
  c.lineTo(4.2, 11.2);
  c.bezierCurveTo(1.9, 9.2, 0, 7.1, 0, 4.5);
  c.closePath();

  c.fillStyle = "rgba(50, 18, 20, 0.55)";
  c.fill();

  if (fillRatio > 0) {
    c.save();
    c.clip();
    c.fillStyle = "#f65f6f";
    c.fillRect(0, 14.5 * (1 - fillRatio), 17, 16);
    c.restore();
  }

  c.strokeStyle = "rgba(0, 0, 0, 0.45)";
  c.lineWidth = 1.2;
  c.stroke();

  c.restore();
}

function drawShieldIcon(c, x, y, size, filled) {
  const w = size;
  const h = size + 2;

  c.beginPath();
  c.moveTo(x + w * 0.5, y);
  c.lineTo(x + w, y + h * 0.28);
  c.lineTo(x + w * 0.85, y + h * 0.86);
  c.lineTo(x + w * 0.5, y + h);
  c.lineTo(x + w * 0.15, y + h * 0.86);
  c.lineTo(x, y + h * 0.28);
  c.closePath();

  c.fillStyle = filled ? "#5ca2ff" : "rgba(42, 70, 110, 0.35)";
  c.fill();
  c.strokeStyle = "rgba(0, 0, 0, 0.45)";
  c.lineWidth = 1;
  c.stroke();
}

function drawFuelCellIcon(c, x, y, size, fillRatio) {
  const w = size;
  const h = Math.floor(size * 1.12);

  c.fillStyle = "rgba(22, 19, 15, 0.6)";
  c.fillRect(x, y, w, h);

  c.fillStyle = "#3c2f25";
  c.fillRect(x + w * 0.35, y - 2, w * 0.3, 3);

  if (fillRatio > 0) {
    c.fillStyle = "#e4a34b";
    const fillH = (h - 2) * fillRatio;
    c.fillRect(x + 1, y + h - 1 - fillH, w - 2, fillH);
  }

  c.strokeStyle = "rgba(0, 0, 0, 0.4)";
  c.lineWidth = 1;
  c.strokeRect(x, y, w, h);
}

function drawBulletIcon(c, x, y, size, fillRatio) {
  const h = size;
  const w = Math.floor(size * 0.44);

  c.fillStyle = "rgba(20, 25, 29, 0.58)";
  c.fillRect(x, y + 2, w, h - 2);

  if (fillRatio > 0) {
    const filled = (h - 2) * fillRatio;
    c.fillStyle = "#68c9ff";
    c.fillRect(x + 1, y + h - filled, w - 2, filled - 1);
  }

  c.fillStyle = fillRatio > 0 ? "#9fdcff" : "rgba(90, 100, 110, 0.5)";
  c.beginPath();
  c.moveTo(x, y + 2);
  c.lineTo(x + w / 2, y - 2);
  c.lineTo(x + w, y + 2);
  c.closePath();
  c.fill();

  c.strokeStyle = "rgba(0, 0, 0, 0.46)";
  c.lineWidth = 1;
  c.strokeRect(x, y + 2, w, h - 2);
}

function drawChargeDot(c, x, y, filled, colorFull, colorEmpty) {
  c.beginPath();
  c.arc(x, y, 6, 0, Math.PI * 2);
  c.fillStyle = filled ? colorFull : colorEmpty;
  c.fill();
  c.strokeStyle = "rgba(0, 0, 0, 0.45)";
  c.lineWidth = 1;
  c.stroke();
}

function drawHud() {
  const c = hudCtx;
  const w = hudCanvas.width;
  const h = hudCanvas.height;
  const compact = w < 860 || h < 96;
  const uiScale = compact ? clamp(w / 860, 0.68, 1) : 1;
  const lw = w / uiScale;
  const lh = h / uiScale;

  c.clearRect(0, 0, w, h);
  c.save();
  c.scale(uiScale, uiScale);

  c.fillStyle = "rgba(6, 11, 12, 0.87)";
  c.fillRect(0, 0, lw, lh);
  c.strokeStyle = "rgba(213, 238, 239, 0.2)";
  c.strokeRect(0.5, 0.5, lw - 1, lh - 1);

  const sec1X = 16;
  const sec2X = Math.floor(lw * 0.28);
  const sec3X = Math.floor(lw * 0.52);
  const sec4X = Math.floor(lw * 0.76);

  c.fillStyle = "#dfecee";
  c.font = `${compact ? 12 : 13}px Trebuchet MS`;

  c.fillText("ЗДОРОВЬЕ", sec1X, 17);
  for (let i = 0; i < player.maxHealth; i += 1) {
    drawHeartIcon(c, sec1X + i * (compact ? 21 : 24), 21, compact ? 16 : 18, i < player.health ? 1 : 0);
  }

  c.fillStyle = "#b8d2ff";
  c.fillText("БРОНЯ", sec1X, 51);
  const armorSlots = Math.min(10, player.maxArmor);
  for (let i = 0; i < armorSlots; i += 1) {
    drawShieldIcon(c, sec1X + i * (compact ? 13 : 15), 56, compact ? 10 : 12, i < player.armor);
  }
  if (player.maxArmor > armorSlots) {
    c.fillStyle = "#8ab4ff";
    c.fillText(`+${player.maxArmor - armorSlots}`, sec1X + armorSlots * (compact ? 13 : 15) + 4, 69);
  }

  c.fillStyle = "#dfecee";
  c.fillText("ТОПЛИВО", sec2X, 17);
  const fuelCells = compact ? 8 : 10;
  const fuelFill = (player.fuel / player.maxFuel) * fuelCells;
  for (let i = 0; i < fuelCells; i += 1) {
    drawFuelCellIcon(c, sec2X + i * (compact ? 14 : 16), 24, compact ? 11 : 12, clamp(fuelFill - i, 0, 1));
  }
  c.fillStyle = "#d8a76a";
  c.fillText(`${Math.floor(player.fuel)}/${player.maxFuel}`, sec2X, 70);

  c.fillStyle = "#dfecee";
  c.fillText("БОЕЗАПАС", sec3X, 17);
  const ammoCells = compact ? 9 : 12;
  const ammoFill = (player.ammo / player.maxAmmo) * ammoCells;
  for (let i = 0; i < ammoCells; i += 1) {
    drawBulletIcon(c, sec3X + i * (compact ? 11 : 13), 24, compact ? 14 : 16, clamp(ammoFill - i, 0, 1));
  }
  c.fillStyle = "#7cd1ff";
  c.fillText(`${player.ammo}/${player.maxAmmo}`, sec3X, 70);

  c.fillStyle = "#deedf0";
  if (compact) {
    c.fillText(`УР ${level}`, sec4X, 16);
    c.fillText(`ВР ${enemies.length}`, sec4X, 33);
    c.fillText(`ФР ${player.totalKills}`, sec4X, 50);
  } else {
    c.fillText(`УРОВЕНЬ ${level}`, sec4X, 16);
    c.fillText(`ВРАГИ ${enemies.length}`, sec4X, 33);
    c.fillText(`ФРАГИ ${player.totalKills}`, sec4X, 50);
  }

  const toNext = nextUpgradeKillMark - player.totalKills;
  c.fillStyle = toNext > 0 ? "#bcd3d5" : "#8fceff";
  c.fillText(
    compact
      ? toNext > 0
        ? `АП ${toNext}`
        : `АПГОТОВО x${pendingUpgrades}`
      : toNext > 0
        ? `УЛУЧШЕНИЕ ЧЕРЕЗ ${toNext}`
        : `УЛУЧШЕНИЕ ГОТОВО x${pendingUpgrades}`,
    sec4X,
    68,
  );
  c.fillStyle = "#a9c0c2";
  c.fillText(
    compact
      ? `РЕК ${leaderboard.bestLevel}/${leaderboard.bestKills}`
      : `РЕКОРД: ур.${leaderboard.bestLevel} / фр.${leaderboard.bestKills}`,
    sec4X,
    84,
  );

  const abilityY = compact ? 82 : 84;
  c.fillStyle = "#ddeef2";
  c.fillText("AP", sec2X, abilityY);
  if (player.heavyUnlocked) {
    for (let i = 0; i < player.heavyMaxCharges; i += 1) {
      drawChargeDot(c, sec2X + 24 + i * (compact ? 13 : 15), abilityY - 4, i < player.heavyCharges, "#f6d68b", "#5f5542");
    }
    if (player.heavyCharges < player.heavyMaxCharges) {
      c.fillStyle = "#d0bfa1";
      c.fillText(
        `${player.heavyProgress}/${player.heavyKillsPerCharge}`,
        sec2X + 24 + player.heavyMaxCharges * (compact ? 14 : 16) + 4,
        abilityY,
      );
    }
  } else {
    c.fillStyle = "#8d9ca0";
    c.fillText("закрыто", sec2X + 24, abilityY);
  }

  c.fillStyle = "#ddeef2";
  c.fillText("АВИА", sec3X, abilityY);
  if (player.airstrikeUnlocked) {
    for (let i = 0; i < player.airstrikeMaxCharges; i += 1) {
      drawChargeDot(c, sec3X + 28 + i * (compact ? 13 : 15), abilityY - 4, i < player.airstrikeCharges, "#ff9f88", "#614840");
    }
    if (player.airstrikeCharges < player.airstrikeMaxCharges) {
      c.fillStyle = "#d9b2aa";
      c.fillText(
        `${player.airstrikeProgress}/${player.airstrikeKillsPerCharge}`,
        sec3X + 28 + player.airstrikeMaxCharges * (compact ? 14 : 16) + 4,
        abilityY,
      );
    }
  } else {
    c.fillStyle = "#8d9ca0";
    c.fillText("закрыто", sec3X + 28, abilityY);
  }

  c.restore();

  if (isTouchDevice) {
    if (apBtnEl) {
      apBtnEl.textContent = player.heavyUnlocked
        ? `AP ${player.heavyCharges}/${Math.max(1, player.heavyMaxCharges)}`
        : "AP LOCK";
      apBtnEl.disabled = !player.heavyUnlocked;
      apBtnEl.style.opacity = player.heavyUnlocked ? "1" : "0.55";
    }

    if (airBtnEl) {
      airBtnEl.textContent = player.airstrikeUnlocked
        ? `АВИА ${player.airstrikeCharges}/${Math.max(1, player.airstrikeMaxCharges)}`
        : "АВИА LOCK";
      airBtnEl.disabled = !player.airstrikeUnlocked;
      airBtnEl.style.opacity = player.airstrikeUnlocked ? "1" : "0.55";
    }
  }
}

function getUpgradeCards() {
  return [
    {
      key: "1",
      id: "fire",
      title: "Быстрый Заряд",
      desc: "Скорострельность главного орудия +12%.",
      accent: "#86dfc1",
    },
    {
      key: "2",
      id: "armor",
      title: "Композитная Броня",
      desc: "Макс. броня +1 и полное восстановление щитов.",
      accent: "#8eb6ff",
    },
    {
      key: "3",
      id: "heavy",
      title: player.heavyUnlocked ? "Склад AP" : "Открыть AP-Снаряды",
      desc: player.heavyUnlocked
        ? "Вместимость AP +1. Клавиша E стреляет AP-снарядом."
        : "Открывает AP-снаряды: пробивают 1 стену и очень сильны.",
      accent: "#e9c177",
    },
    {
      key: "4",
      id: "airstrike",
      title: player.airstrikeUnlocked ? "Логистика Авиаудара" : "Открыть Авиаудар",
      desc: player.airstrikeUnlocked
        ? "Вместимость авиаудара +1. Клавиша Q вызывает залп."
        : "Открывает авиаудар. Заряды восстанавливаются за фраги.",
      accent: "#f2a08f",
    },
  ];
}

function getUpgradeCardLayout() {
  const cards = getUpgradeCards();
  const narrow = canvas.width < 640;

  if (narrow) {
    const gap = 10;
    const cardW = Math.max(210, Math.min(340, canvas.width - 30));
    const cardH = Math.max(88, Math.min(120, Math.floor(canvas.height * 0.16)));
    const totalH = cards.length * cardH + (cards.length - 1) * gap;
    const startX = Math.floor((canvas.width - cardW) / 2);
    const startY = Math.max(112, Math.floor((canvas.height - totalH) / 2));

    return cards.map((card, i) => ({
      ...card,
      x: startX,
      y: startY + i * (cardH + gap),
      w: cardW,
      h: cardH,
    }));
  }

  const gap = Math.max(12, Math.floor(canvas.width * 0.02));
  const cardW = Math.max(220, Math.min(330, Math.floor((canvas.width - 120 - gap) / 2)));
  const cardH = Math.max(126, Math.floor(canvas.height * 0.24));
  const startX = Math.floor(canvas.width / 2 - (cardW * 2 + gap) / 2);
  const startY = Math.floor(canvas.height / 2 - (cardH * 2 + gap) / 2) + 18;

  return cards.map((card, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    return {
      ...card,
      x: startX + col * (cardW + gap),
      y: startY + row * (cardH + gap),
      w: cardW,
      h: cardH,
    };
  });
}

function trySelectUpgradeAtCanvasPoint(x, y) {
  if (pendingUpgrades <= 0) {
    return false;
  }

  const layout = getUpgradeCardLayout();
  for (const card of layout) {
    if (x >= card.x && x <= card.x + card.w && y >= card.y && y <= card.y + card.h) {
      applyUpgrade(card.id);
      return true;
    }
  }

  return false;
}

function drawUpgradeOverlay() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cards = getUpgradeCardLayout();
  const compact = canvas.width < 720;
  const titleFont = compact ? 26 : 34;
  const subtitleFont = compact ? 14 : 16;
  const cardTitleFont = compact ? 18 : 21;
  const cardDescFont = compact ? 13 : 15;
  const cardHintFont = compact ? 12 : 13;
  const lineHeight = compact ? 18 : 22;

  ctx.fillStyle = "#f3ffff";
  ctx.textAlign = "center";
  ctx.font = `bold ${titleFont}px Trebuchet MS`;
  ctx.fillText("Выбор Улучшения", canvas.width / 2, 72);

  ctx.font = `${subtitleFont}px Trebuchet MS`;
  ctx.fillStyle = "#b7cecf";
  ctx.fillText(`Ожидает улучшений: ${pendingUpgrades}`, canvas.width / 2, 98);

  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    const x = card.x;
    const y = card.y;
    const cardW = card.w;
    const cardH = card.h;

    const grad = ctx.createLinearGradient(x, y, x + cardW, y + cardH);
    grad.addColorStop(0, "rgba(20, 32, 35, 0.92)");
    grad.addColorStop(1, "rgba(10, 18, 20, 0.92)");

    roundRectPath(ctx, x, y, cardW, cardH, 12);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = "rgba(210, 236, 239, 0.22)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = card.accent;
    ctx.fillRect(x, y, cardW, 6);

    ctx.beginPath();
    ctx.arc(x + 26, y + 28, 13, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.09)";
    ctx.fill();
    ctx.strokeStyle = card.accent;
    ctx.lineWidth = 1.3;
    ctx.stroke();

    ctx.fillStyle = "#f0ffff";
    ctx.font = "bold 16px Trebuchet MS";
    ctx.fillText(card.key, x + 26, y + 33);

    ctx.textAlign = "start";
    ctx.fillStyle = "#ebfbfc";
    ctx.font = `bold ${cardTitleFont}px Trebuchet MS`;
    ctx.fillText(card.title, x + 48, y + 35);

    ctx.font = `${cardDescFont}px Trebuchet MS`;
    ctx.fillStyle = "#bad0d4";
    drawWrappedText(ctx, card.desc, x + 20, y + 62, cardW - 40, lineHeight, 3);

    ctx.fillStyle = card.accent;
    ctx.font = `${cardHintFont}px Trebuchet MS`;
    ctx.fillText(isTouchDevice ? "Коснитесь карты" : `Нажмите ${card.key}`, x + 20, y + cardH - 16);

    ctx.textAlign = "center";
  }

  ctx.textAlign = "start";
}

function drawGameOverOverlay() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.66)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const compact = canvas.width < 720;
  const titleFont = compact ? 30 : 42;
  const mainFont = compact ? 16 : 20;
  const listFont = compact ? 13 : 16;

  ctx.fillStyle = "#fff0f0";
  ctx.textAlign = "center";
  ctx.font = `bold ${titleFont}px Trebuchet MS`;
  ctx.fillText("Танк Уничтожен", canvas.width / 2, canvas.height / 2 - 34);

  ctx.font = `${mainFont}px Trebuchet MS`;
  ctx.fillText(
    `Достигнут уровень ${level}, фрагов ${player.totalKills}`,
    canvas.width / 2,
    canvas.height / 2,
  );
  ctx.fillText(
    isTouchDevice ? "Коснитесь экрана для новой игры" : "Нажмите R для новой игры",
    canvas.width / 2,
    canvas.height / 2 + 34,
  );

  ctx.font = `${listFont}px Trebuchet MS`;
  ctx.fillStyle = "#c8dbdd";
  ctx.fillText("Лидерборд:", canvas.width / 2, canvas.height / 2 + 64);

  const top = leaderboard.runs.slice(0, 3);
  for (let i = 0; i < top.length; i += 1) {
    const run = top[i];
    ctx.fillText(
      `${i + 1}. Фраги ${run.kills} | Уровень ${run.level}`,
      canvas.width / 2,
      canvas.height / 2 + 88 + i * 20,
    );
  }

  ctx.textAlign = "start";
}

function drawOverlay() {
  if (pendingUpgrades > 0) {
    drawUpgradeOverlay();
  }

  if (gameOver) {
    drawGameOverOverlay();
  }
}

function render() {
  drawWorld();
  drawOverlay();
  drawHud();
}

window.addEventListener("keydown", (event) => {
  ensureAudioReady();

  if (!keys[event.code]) {
    justPressed.add(event.code);
  }

  keys[event.code] = true;

  if (
    event.code === "Space" ||
    event.code === "ArrowUp" ||
    event.code === "ArrowDown" ||
    event.code === "ArrowLeft" ||
    event.code === "ArrowRight"
  ) {
    event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  keys[event.code] = false;
});

function bindJoystick(joystickEl, kind) {
  if (!joystickEl) {
    return;
  }

  joystickEl.addEventListener("pointerdown", (event) => {
    if (!isTouchDevice || event.pointerType !== "touch") {
      return;
    }

    ensureAudioReady();
    event.preventDefault();

    const stick = touchInput[kind];
    stick.pointerId = event.pointerId;
    updateTouchStickFromClient(kind, event.clientX, event.clientY);
    safeSetPointerCapture(joystickEl, event.pointerId);
  });

  joystickEl.addEventListener("pointermove", (event) => {
    const stick = touchInput[kind];
    if (stick.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    updateTouchStickFromClient(kind, event.clientX, event.clientY);
  });

  const releaseStick = (event) => {
    const stick = touchInput[kind];
    if (stick.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    resetTouchStick(kind);
    safeReleasePointerCapture(joystickEl, event.pointerId);
  };

  joystickEl.addEventListener("pointerup", releaseStick);
  joystickEl.addEventListener("pointercancel", releaseStick);
}

function bindHoldButton(buttonEl, onStart, onEnd) {
  if (!buttonEl) {
    return;
  }

  buttonEl.addEventListener("pointerdown", (event) => {
    ensureAudioReady();
    event.preventDefault();
    onStart();
    buttonEl.classList.add("is-active");
    safeSetPointerCapture(buttonEl, event.pointerId);
  });

  const finish = (event) => {
    event.preventDefault();
    onEnd();
    buttonEl.classList.remove("is-active");
    safeReleasePointerCapture(buttonEl, event.pointerId);
  };

  buttonEl.addEventListener("pointerup", finish);
  buttonEl.addEventListener("pointercancel", finish);
  buttonEl.addEventListener("pointerleave", () => {
    onEnd();
    buttonEl.classList.remove("is-active");
  });
}

function bindTapButton(buttonEl, onTap) {
  if (!buttonEl) {
    return;
  }

  buttonEl.addEventListener("pointerdown", (event) => {
    ensureAudioReady();
    event.preventDefault();
    onTap();
    buttonEl.classList.add("is-active");
    safeSetPointerCapture(buttonEl, event.pointerId);
  });

  const finish = (event) => {
    event.preventDefault();
    buttonEl.classList.remove("is-active");
    safeReleasePointerCapture(buttonEl, event.pointerId);
  };

  buttonEl.addEventListener("pointerup", finish);
  buttonEl.addEventListener("pointercancel", finish);
}

bindJoystick(moveJoystickEl, "move");
bindJoystick(aimJoystickEl, "aim");

bindHoldButton(
  fireBtnEl,
  () => {
    touchInput.fireHeld = true;
  },
  () => {
    touchInput.fireHeld = false;
  },
);

bindTapButton(apBtnEl, () => {
  if (player.heavyUnlocked) {
    touchInput.heavyQueued = true;
  }
});

bindTapButton(airBtnEl, () => {
  if (player.airstrikeUnlocked) {
    touchInput.airstrikeQueued = true;
  }
});

canvas.addEventListener("pointermove", (event) => {
  updateMouseFromClient(event.clientX, event.clientY);
});

canvas.addEventListener("pointerdown", (event) => {
  ensureAudioReady();
  updateMouseFromClient(event.clientX, event.clientY);

  if (pendingUpgrades > 0) {
    event.preventDefault();
    mouse.down = false;
    trySelectUpgradeAtCanvasPoint(mouse.x, mouse.y);
    return;
  }

  if (gameOver) {
    if (event.button === 0 || event.pointerType === "touch") {
      event.preventDefault();
      mouse.down = false;
      resetGame();
    }
    return;
  }

  if (event.button === 0 || event.pointerType === "touch") {
    mouse.down = true;
    if (event.pointerType === "touch") {
      event.preventDefault();
      tryShootPlayer(performance.now());
    }
  }
});

canvas.addEventListener("pointerup", (event) => {
  if (event.button === 0 || event.pointerType === "touch") {
    mouse.down = false;
  }
});

canvas.addEventListener("pointercancel", () => {
  mouse.down = false;
});

window.addEventListener("pointerup", () => {
  mouse.down = false;
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

window.addEventListener("blur", () => {
  mouse.down = false;
  touchInput.fireHeld = false;
  resetTouchStick("move");
  resetTouchStick("aim");
  if (fireBtnEl) {
    fireBtnEl.classList.remove("is-active");
  }
  if (apBtnEl) {
    apBtnEl.classList.remove("is-active");
  }
  if (airBtnEl) {
    airBtnEl.classList.remove("is-active");
  }
  for (const key of Object.keys(keys)) {
    keys[key] = false;
  }
});

window.addEventListener("resize", () => {
  resizeCanvas();
  updateCamera();
});

resizeCanvas();
resetGame();

let prevTime = performance.now();
function gameLoop(now) {
  const dt = Math.min((now - prevTime) / 1000, 0.05);
  prevTime = now;

  update(dt, now);
  render();

  justPressed.clear();
  touchInput.heavyQueued = false;
  touchInput.airstrikeQueued = false;
  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
