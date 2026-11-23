'use strict';
/**
 * VAHO · Experiencia Web
 * Un vidrio empañado guarda un recuerdo.
 * Tocarlo despeja el vaho y deja ver la imagen; el vaho vuelve solo.
 * Ver = oír: cuanto más vidrio despejas, más se abre el filtro del sonido.
 */

const $ = s => document.querySelector(s);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// =============================================================================
// 1. MOTOR DE AUDIO (Web Audio API)
// =============================================================================
const AudioEngine = {
  ctx: null,
  buffers: {},
  sources: {},
  nodes: {},
  muted: false,
  initialized: false,
  leftClarity: 0,
  rightClarity: 0,
  totalClarity: 0,
  meanFog: 1.0,
  fingerVel: 0,
  fingerX: 0.5,
  fingerPress: 0,
  fogUnderFinger: 1.0,
  palmActive: false,
  blowLevel: 0,
  touchDist: 1.0,
  lastTouchTime: performance.now(),
  touchActive: false,

  SOUND_FILES: [
    'chirrido_a.wav', 'chirrido_b.wav', 'gota_1.wav', 'gota_2.wav', 'gota_3.wav',
    'lluvia.wav', 'calor.wav', 'caja_musical.wav', 'murmullo.wav',
    'barrido.wav', 'reloj.wav', 'soplido.wav'
  ],

  async init() {
    if (this.initialized) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    await this.ctx.resume();

    // 1. Compresor de dinámica final (unifica la acústica del vidrio)
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 18;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.12;
    comp.connect(this.ctx.destination);
    this.nodes.comp = comp;

    // Ganancia general (para silenciar/activar)
    const masterGain = this.ctx.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(comp);
    this.nodes.masterGain = masterGain;

    // 2. Reverb sintético por convolución (evoca memoria lejana)
    const conv = this.ctx.createConvolver();
    conv.buffer = this.createSyntheticImpulse(2.4, 1.8);
    const convGain = this.ctx.createGain();
    convGain.gain.value = 0.22;
    conv.connect(convGain);
    convGain.connect(masterGain);
    this.nodes.conv = conv;
    this.nodes.convGain = convGain;

    // 3. Filtro pasa-bajos del recuerdo (ver = oír: cuanto más vidrio despejas, más se abre)
    const memFilter = this.ctx.createBiquadFilter();
    memFilter.type = 'lowpass';
    memFilter.frequency.value = 320;
    memFilter.Q.value = 0.85;
    this.nodes.memFilter = memFilter;

    // Submezcla de memoria conectada a seco y a reverb
    const memMix = this.ctx.createGain();
    memMix.gain.value = 1.0;
    memFilter.connect(memMix);
    memMix.connect(masterGain);
    memMix.connect(conv);
    this.nodes.memMix = memMix;

    // 4. Canales de control individual
    // a) Caja musical (controlada por la mitad derecha)
    const gainCaja = this.ctx.createGain();
    gainCaja.gain.value = 0;
    gainCaja.connect(memFilter);
    this.nodes.gainCaja = gainCaja;

    // b) Murmullo de voces (controlado por la mitad izquierda)
    const gainMurmullo = this.ctx.createGain();
    gainMurmullo.gain.value = 0;
    gainMurmullo.connect(memFilter);
    this.nodes.gainMurmullo = gainMurmullo;

    // c) Lluvia exterior (fuerte con todo empañado, se apaga al despejar)
    const gainLluvia = this.ctx.createGain();
    gainLluvia.gain.value = 0.65;
    gainLluvia.connect(masterGain);
    this.nodes.gainLluvia = gainLluvia;

    // d) Calor de palma (zumbido grave)
    const gainCalor = this.ctx.createGain();
    gainCalor.gain.value = 0;
    gainCalor.connect(masterGain);
    this.nodes.gainCalor = gainCalor;

    // e) Soplido (aliento)
    const gainSoplido = this.ctx.createGain();
    gainSoplido.gain.value = 0;
    gainSoplido.connect(masterGain);
    this.nodes.gainSoplido = gainSoplido;

    // f) Reloj (tic-tac cuando queda vidrio despejado y nadie toca)
    const gainReloj = this.ctx.createGain();
    gainReloj.gain.value = 0;
    gainReloj.connect(masterGain);
    this.nodes.gainReloj = gainReloj;

    // g) Chirrido de fricción sobre vidrio
    const chirridoFilter = this.ctx.createBiquadFilter();
    chirridoFilter.type = 'lowpass';
    chirridoFilter.frequency.value = 2400;
    chirridoFilter.Q.value = 1.5;

    const chirridoPan = this.ctx.createStereoPanner();
    chirridoFilter.connect(chirridoPan);

    const gainChirrido = this.ctx.createGain();
    gainChirrido.gain.value = 0;
    chirridoPan.connect(gainChirrido);
    gainChirrido.connect(masterGain);

    this.nodes.chirridoFilter = chirridoFilter;
    this.nodes.chirridoPan = chirridoPan;
    this.nodes.gainChirrido = gainChirrido;

    // Ganancias independientes para alternar chirrido seco (a) y mojado (b)
    const gainChirrA = this.ctx.createGain();
    const gainChirrB = this.ctx.createGain();
    gainChirrA.gain.value = 0.5;
    gainChirrB.gain.value = 0.5;
    gainChirrA.connect(chirridoFilter);
    gainChirrB.connect(chirridoFilter);
    this.nodes.gainChirrA = gainChirrA;
    this.nodes.gainChirrB = gainChirrB;

    // Cargar todos los archivos de sonido sintetizados
    await this.loadSounds();
    this.startLoops();
    this.initialized = true;
  },

  createSyntheticImpulse(durationSec, decayRate) {
    const len = Math.floor(this.ctx.sampleRate * durationSec);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t * decayRate * 4.0);
      }
    }
    return buf;
  },

  async loadSounds() {
    const basePath = 'sonidos/';
    await Promise.all(this.SOUND_FILES.map(async file => {
      const name = file.replace('.wav', '');
      try {
        const res = await fetch(basePath + file);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ab = await res.arrayBuffer();
        this.buffers[name] = await this.ctx.decodeAudioData(ab);
      } catch (err) {
        console.warn(`No se pudo cargar el sonido ${file}:`, err);
      }
    }));
  },

  startLoops() {
    const makeLoop = (name, destNode) => {
      if (!this.buffers[name]) return null;
      const s = this.ctx.createBufferSource();
      s.buffer = this.buffers[name];
      s.loop = true;
      s.connect(destNode);
      s.start(0);
      this.sources[name] = s;
      return s;
    };

    makeLoop('caja_musical', this.nodes.gainCaja);
    makeLoop('murmullo', this.nodes.gainMurmullo);
    makeLoop('lluvia', this.nodes.gainLluvia);
    makeLoop('calor', this.nodes.gainCalor);
    makeLoop('soplido', this.nodes.gainSoplido);
    makeLoop('reloj', this.nodes.gainReloj);
    makeLoop('chirrido_a', this.nodes.gainChirrA);
    makeLoop('chirrido_b', this.nodes.gainChirrB);
  },

  playOneShot(name, destNode, gainVal = 1.0, panVal = 0, rateVal = 1.0) {
    if (!this.initialized || !this.buffers[name] || this.muted) return;
    try {
      const s = this.ctx.createBufferSource();
      s.buffer = this.buffers[name];
      s.playbackRate.value = rateVal;

      const g = this.ctx.createGain();
      g.gain.value = gainVal;

      const pan = this.ctx.createStereoPanner();
      pan.pan.value = clamp(panVal, -1, 1);

      s.connect(g);
      g.connect(pan);
      pan.connect(destNode || this.nodes.masterGain);
      s.start(0);
    } catch {}
  },

  playGota(radiusPx, normX) {
    let soundName = 'gota_1';
    let rate = 1.0;
    if (radiusPx > 7) {
      soundName = 'gota_2';
      rate = clamp(1.1 - (radiusPx - 7) * 0.04, 0.75, 1.2);
    } else if (radiusPx < 4.5) {
      soundName = 'gota_3';
      rate = clamp(0.95 + (4.5 - radiusPx) * 0.08, 0.9, 1.35);
    }
    const pan = normX * 2 - 1;
    this.playOneShot(soundName, this.nodes.comp, 0.75, pan, rate);
  },

  playBarrido() {
    this.playOneShot('barrido', this.nodes.comp, 0.65, 0, 1.0);
  },

  setMute(m) {
    this.muted = m;
    if (this.nodes.masterGain) {
      this.nodes.masterGain.gain.setTargetAtTime(m ? 0 : 1.0, this.ctx.currentTime, 0.05);
    }
  },

  update() {
    if (!this.initialized || !this.ctx) return;
    const now = this.ctx.currentTime;
    const smooth = 0.05;

    // 1. Filtro del recuerdo (ver = oír)
    // Con dist (2 dedos separándose), el filtro se cierra y el recuerdo se aleja
    const distFactor = clamp(1.0 - (this.touchDist - 1.0) * 0.5, 0.35, 1.0);
    const targetFc = (320 * Math.pow(18000 / 320, clamp(this.totalClarity, 0, 1))) * distFactor;
    this.nodes.memFilter.frequency.setTargetAtTime(clamp(targetFc, 100, 20000), now, smooth);

    // Reverb: aumenta cuando se separan 2 dedos
    const targetRev = 0.22 + clamp((this.touchDist - 1.0) * 0.6, 0, 0.7);
    this.nodes.convGain.gain.setTargetAtTime(targetRev, now, smooth);

    // Caja de música: se ralentiza ligeramente si se separan los dedos
    if (this.sources['caja_musical'] && this.sources['caja_musical'].playbackRate) {
      const targetRate = clamp(1.0 - (this.touchDist - 1.0) * 0.25, 0.75, 1.0);
      this.sources['caja_musical'].playbackRate.setTargetAtTime(targetRate, now, smooth);
    }

    // 2. Claridad por mitades (izq = murmullo, der = caja musical)
    const targetCaja = clamp(this.rightClarity * 1.25, 0, 0.85);
    const targetMurmullo = clamp(this.leftClarity * 1.25, 0, 0.80);
    this.nodes.gainCaja.gain.setTargetAtTime(targetCaja, now, smooth);
    this.nodes.gainMurmullo.gain.setTargetAtTime(targetMurmullo, now, smooth);

    // 3. Lluvia exterior (mundo de afuera)
    const targetLluvia = Math.pow(clamp(this.meanFog, 0, 1), 1.5) * 0.65;
    this.nodes.gainLluvia.gain.setTargetAtTime(targetLluvia, now, 0.1);

    // 4. Calor de palma
    const targetCalor = this.palmActive ? 0.85 : 0;
    this.nodes.gainCalor.gain.setTargetAtTime(targetCalor, now, 0.08);

    // 5. Soplido
    const targetSoplido = clamp(this.blowLevel * 1.3, 0, 0.85);
    this.nodes.gainSoplido.gain.setTargetAtTime(targetSoplido, now, 0.04);

    // 6. Reloj (tic-tac cuando queda vidrio despejado y nadie toca)
    const idleSec = (performance.now() - this.lastTouchTime) / 1000;
    const hasClearGlass = this.totalClarity > 0.12;
    const targetReloj = (!this.touchActive && hasClearGlass && idleSec > 1.2)
      ? clamp((idleSec - 1.2) * 0.35, 0, 0.42)
      : 0;
    this.nodes.gainReloj.gain.setTargetAtTime(targetReloj, now, 0.15);

    // 7. Chirrido de dedo sobre vidrio
    const isDragging = this.touchActive && this.fingerVel > 0.015 && !this.palmActive;
    const targetChirrGain = isDragging ? clamp(this.fingerVel * 2.8, 0, 0.75) : 0;
    this.nodes.gainChirrido.gain.setTargetAtTime(targetChirrGain, now, 0.03);

    // Paneo estéreo
    const targetPan = clamp(this.fingerX * 2 - 1, -1, 1);
    this.nodes.chirridoPan.pan.setTargetAtTime(targetPan, now, 0.04);

    // Brillo del filtro del chirrido según presión/diámetro
    const targetChirrFilt = 1200 + this.fingerPress * 5200;
    this.nodes.chirridoFilter.frequency.setTargetAtTime(targetChirrFilt, now, 0.04);

    // Vaho bajo el dedo: seco (a) vs mojado (b)
    const wetRatio = clamp(this.fogUnderFinger, 0, 1);
    this.nodes.gainChirrA.gain.setTargetAtTime(1 - wetRatio, now, 0.04);
    this.nodes.gainChirrB.gain.setTargetAtTime(wetRatio, now, 0.04);

    // Tono/velocidad del chirrido según velocidad
    if (this.sources['chirrido_a'] && this.sources['chirrido_a'].playbackRate) {
      const vRate = clamp(0.9 + this.fingerVel * 0.4, 0.8, 1.4);
      this.sources['chirrido_a'].playbackRate.setTargetAtTime(vRate, now, 0.04);
      this.sources['chirrido_b'].playbackRate.setTargetAtTime(vRate, now, 0.04);
    }
  }
};


// =============================================================================
// 2. SIMULACIÓN DE IMAGEN Y CAMPO DE VAHO
// =============================================================================
const GRID_W = 384;
const GRID_H = 216;
const fogGrid = new Float32Array(GRID_W * GRID_H);
fogGrid.fill(1.0); // Completamente empañado al iniciar

// Canvases de trabajo
const cvMain = $('#cvMain');
const ctxMain = cvMain.getContext('2d');

const memCanvas = document.createElement('canvas');
const memCtx = memCanvas.getContext('2d');

const blurCanvas = document.createElement('canvas');
const blurCtx = blurCanvas.getContext('2d');

const maskedBlurCanvas = document.createElement('canvas');
const maskedBlurCtx = maskedBlurCanvas.getContext('2d');

const fogCanvas = document.createElement('canvas');
fogCanvas.width = GRID_W;
fogCanvas.height = GRID_H;
const fogCtx = fogCanvas.getContext('2d');
const fogImgData = fogCtx.createImageData(GRID_W, GRID_H);

let viewW = 0, viewH = 0, dpr = 1;

// Escena de bahía al atardecer por defecto (pintada por código)
function drawDefaultBaySunset(ctx, w, h) {
  // 1. Cielo crepuscular con gradiente cálido
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, '#0a1320'); // Noche azul-gris arriba
  sky.addColorStop(0.35, '#281734');
  sky.addColorStop(0.65, '#682947');
  sky.addColorStop(0.85, '#d95a46'); // Coral
  sky.addColorStop(0.96, '#ffa95a'); // Brasa cálida
  sky.addColorStop(1.0, '#ffe18f');  // Horizonte dorado
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.62);

  // 2. Sol poniente a la derecha
  const sunX = w * 0.76;
  const sunY = h * 0.58;
  const sunR = Math.min(w, h) * 0.09;

  // Halo radiante
  const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 3.8);
  sunGlow.addColorStop(0, 'rgba(255, 246, 214, 0.95)');
  sunGlow.addColorStop(0.2, 'rgba(255, 185, 90, 0.8)');
  sunGlow.addColorStop(0.6, 'rgba(217, 90, 70, 0.25)');
  sunGlow.addColorStop(1, 'rgba(10, 19, 32, 0)');
  ctx.fillStyle = sunGlow;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR * 3.8, 0, Math.PI * 2);
  ctx.fill();

  // Disco solar brillante
  ctx.fillStyle = '#fffdf0';
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR * 0.6, 0, Math.PI * 2);
  ctx.fill();

  // 3. Agua de la bahía (reflejos horizontales)
  const water = ctx.createLinearGradient(0, h * 0.62, 0, h);
  water.addColorStop(0, '#2d1829');
  water.addColorStop(0.25, '#1e1b2d');
  water.addColorStop(0.7, '#111822');
  water.addColorStop(1, '#091017');
  ctx.fillStyle = water;
  ctx.fillRect(0, h * 0.62, w, h * 0.38);

  // Estela de reflejo dorado del sol sobre el agua
  const colW = w * 0.16;
  for (let y = h * 0.62; y < h; y += 4) {
    const prog = (y - h * 0.62) / (h * 0.38);
    const waveW = colW * (1 + prog * 1.8) * (0.7 + 0.3 * Math.sin(y * 0.4));
    const alpha = (1 - prog * 0.8) * 0.45;
    ctx.fillStyle = `rgba(255, 190, 95, ${alpha})`;
    ctx.fillRect(sunX - waveW / 2, y, waveW, 2.5);
  }

  // 4. Casas y colinas con luces a la izquierda
  ctx.fillStyle = '#1c152a';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.62);
  ctx.bezierCurveTo(w * 0.15, h * 0.50, w * 0.32, h * 0.55, w * 0.46, h * 0.62);
  ctx.lineTo(0, h * 0.62);
  ctx.fill();

  // Silueta de casitas costeras
  ctx.fillStyle = '#10141f';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.62);
  ctx.lineTo(0, h * 0.54);

  const houses = [
    { x: w * 0.04, y: h * 0.53, w: 28, h: 22 },
    { x: w * 0.08, y: h * 0.51, w: 34, h: 28 },
    { x: w * 0.13, y: h * 0.54, w: 26, h: 20 },
    { x: w * 0.18, y: h * 0.52, w: 38, h: 26 },
    { x: w * 0.24, y: h * 0.55, w: 30, h: 18 },
    { x: w * 0.29, y: h * 0.57, w: 24, h: 14 }
  ];

  ctx.lineTo(w * 0.02, h * 0.55);
  houses.forEach(hs => {
    ctx.lineTo(hs.x, hs.y + hs.h);
    ctx.lineTo(hs.x, hs.y);
    ctx.lineTo(hs.x + hs.w / 2, hs.y - 8);
    ctx.lineTo(hs.x + hs.w, hs.y);
    ctx.lineTo(hs.x + hs.w, hs.y + hs.h);
  });
  ctx.lineTo(w * 0.40, h * 0.62);
  ctx.lineTo(0, h * 0.62);
  ctx.fill();

  // Luces cálidas en las ventanas (brasa / amarillo ámbar)
  houses.forEach((hs, idx) => {
    const numWindows = 2 + (idx % 2);
    for (let wi = 0; wi < numWindows; wi++) {
      const wx = hs.x + 6 + wi * 10;
      const wy = hs.y + 6;
      ctx.fillStyle = (idx % 2 === 0) ? '#ffa95a' : '#ffd166';
      ctx.fillRect(wx, wy, 4, 5);

      ctx.fillStyle = 'rgba(255, 169, 90, 0.2)';
      ctx.beginPath();
      ctx.arc(wx + 2, wy + 2.5, 9, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 169, 90, 0.15)';
      ctx.fillRect(wx - 2, h * 0.62 + 4 + idx * 3, 8, 2);
    }
  });

  // 5. Muelle de madera a la derecha
  const pierStart = w * 0.66;
  const pierEnd = w * 0.95;
  const pierY = h * 0.66;

  ctx.fillStyle = '#0a0e16';
  for (let px = pierStart; px <= pierEnd; px += 26) {
    ctx.fillRect(px, pierY - 4, 6, h * 0.22);
    ctx.fillStyle = 'rgba(10, 14, 22, 0.4)';
    ctx.fillRect(px - 1, pierY + h * 0.22, 8, 18);
    ctx.fillStyle = '#0a0e16';
  }
  ctx.fillRect(pierStart - 12, pierY - 8, pierEnd - pierStart + 24, 8);
  ctx.fillRect(pierEnd + 8, pierY - 18, 7, 18);
  ctx.fillRect(pierStart + 14, pierY - 16, 6, 16);

  // Silueta de barca amarrada
  ctx.beginPath();
  ctx.moveTo(pierEnd - 30, pierY + 28);
  ctx.lineTo(pierEnd + 15, pierY + 28);
  ctx.lineTo(pierEnd + 5, pierY + 38);
  ctx.lineTo(pierEnd - 22, pierY + 38);
  ctx.closePath();
  ctx.fillStyle = '#0a0e16';
  ctx.fill();

  // 6. Círculos Bokeh nostálgicos y desenfocados
  const bokehs = [
    { x: w * 0.72, y: h * 0.45, r: 42, c: 'rgba(255, 210, 130, 0.22)' },
    { x: sunX + 40, y: sunY - 30, r: 58, c: 'rgba(255, 169, 90, 0.18)' },
    { x: w * 0.48, y: h * 0.52, r: 35, c: 'rgba(230, 120, 100, 0.15)' },
    { x: w * 0.20, y: h * 0.42, r: 48, c: 'rgba(255, 200, 110, 0.12)' },
    { x: w * 0.85, y: h * 0.35, r: 64, c: 'rgba(255, 225, 140, 0.14)' },
    { x: w * 0.10, y: h * 0.68, r: 30, c: 'rgba(255, 169, 90, 0.16)' },
    { x: w * 0.60, y: h * 0.75, r: 50, c: 'rgba(255, 180, 110, 0.12)' }
  ];
  bokehs.forEach(b => {
    ctx.fillStyle = b.c;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  });
}

function updateBlurredMemory() {
  blurCanvas.width = memCanvas.width;
  blurCanvas.height = memCanvas.height;
  blurCtx.clearRect(0, 0, blurCanvas.width, blurCanvas.height);

  // Versión borrosa y lechosa del recuerdo
  blurCtx.filter = 'blur(16px) saturate(0.65) brightness(0.92)';
  blurCtx.drawImage(memCanvas, 0, 0);
  blurCtx.filter = 'none';

  // Tinte lechoso de vaho #cfdde3
  blurCtx.fillStyle = 'rgba(207, 221, 227, 0.28)';
  blurCtx.fillRect(0, 0, blurCanvas.width, blurCanvas.height);
}

function initMemoryImage() {
  memCanvas.width = 1920;
  memCanvas.height = 1080;
  drawDefaultBaySunset(memCtx, memCanvas.width, memCanvas.height);
  updateBlurredMemory();
}

function loadUserImage(file) {
  if (!file) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    memCanvas.width = img.naturalWidth || 1920;
    memCanvas.height = img.naturalHeight || 1080;
    memCtx.clearRect(0, 0, memCanvas.width, memCanvas.height);
    memCtx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    updateBlurredMemory();
    showGestureToast('un recuerdo nuevo guardado en el vidrio');
  };
  img.src = url;
}

// Despejar niebla en el campo de baja resolución
function clearFog(normX, normY, normRadius, intensity = 1.0) {
  const cx = normX * GRID_W;
  const cy = normY * GRID_H;
  const r = normRadius * GRID_W;
  const minX = Math.max(0, Math.floor(cx - r));
  const maxX = Math.min(GRID_W - 1, Math.ceil(cx + r));
  const minY = Math.max(0, Math.floor(cy - r));
  const maxY = Math.min(GRID_H - 1, Math.ceil(cy + r));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d < 1.0) {
        const falloff = (1 - d * d) ** 2 * intensity;
        const idx = y * GRID_W + x;
        fogGrid[idx] = Math.max(0, fogGrid[idx] - falloff);
      }
    }
  }
}

// Añadir vaho rápidamente (por soplido o respiración)
function addFogBreath(intensity) {
  const cx = GRID_W / 2;
  const cy = GRID_H / 2;
  const r = GRID_W * 0.45;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      const amount = Math.max(0, 1 - d * 0.7) * intensity;
      const idx = y * GRID_W + x;
      fogGrid[idx] = Math.min(1.0, fogGrid[idx] + amount);
    }
  }
}

// =============================================================================
// 3. FÍSICA DE GOTAS CON EFECTO LENTE (óptica nítida e invertida)
// =============================================================================
class Droplet {
  constructor(x, y, r) {
    this.x = x;
    this.y = y;
    this.r = r;
    this.vx = 0;
    this.vy = 0;
    this.mass = r * r;
    this.stuck = true;
  }

  update(gx, gy, dt) {
    const forceX = gx * this.mass * 48;
    const forceY = gy * this.mass * 48;
    const frictionThreshold = this.r * 18;
    const totalForce = Math.hypot(forceX, forceY);

    if (this.stuck) {
      if (totalForce > frictionThreshold) {
        this.stuck = false;
        sendHapticToPhone(35);
        AudioEngine.playGota(this.r, this.x / viewW);
      }
    }

    if (!this.stuck) {
      this.vx += (forceX / this.mass) * dt;
      this.vy += (forceY / this.mass) * dt;
      this.vx *= 0.94;
      this.vy *= 0.94;

      this.x += this.vx * dt;
      this.y += this.vy * dt;

      // Deja un trazo limpio a su paso en el vaho
      clearFog(this.x / viewW, this.y / viewH, (this.r * 1.5) / viewW, 0.95);
    }
  }

  draw(ctx) {
    const rx = this.x;
    const ry = this.y;
    const rad = this.r;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;

    // Efecto Lente: muestra la imagen del recuerdo nítida e invertida
    ctx.beginPath();
    ctx.arc(rx, ry, rad, 0, Math.PI * 2);
    ctx.clip();

    ctx.save();
    ctx.translate(rx, ry);
    ctx.scale(1.15, -1.15); // Inversión óptica
    ctx.drawImage(memCanvas, -rx, -ry, viewW, viewH);
    ctx.restore();

    // Menisco y refracción de agua
    const meniscus = ctx.createRadialGradient(rx - rad * 0.3, ry - rad * 0.3, 1, rx, ry, rad);
    meniscus.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
    meniscus.addColorStop(0.5, 'rgba(207, 221, 227, 0.05)');
    meniscus.addColorStop(0.85, 'rgba(9, 16, 23, 0.2)');
    meniscus.addColorStop(1, 'rgba(233, 241, 243, 0.65)');
    ctx.fillStyle = meniscus;
    ctx.beginPath();
    ctx.arc(rx, ry, rad, 0, Math.PI * 2);
    ctx.fill();

    // Brillo especular
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(rx - rad * 0.28, ry - rad * 0.28, Math.max(1.2, rad * 0.25), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

const droplets = [];
function spawnDroplet(x, y, r) {
  if (droplets.length > 90) droplets.shift();
  droplets.push(new Droplet(x, y, r));
}

function spawnShower(count = 18) {
  for (let i = 0; i < count; i++) {
    const rx = Math.random() * viewW;
    const ry = Math.random() * (viewH * 0.45);
    const rad = 3.5 + Math.random() * 6.5;
    spawnDroplet(rx, ry, rad);
  }
  sendHapticToPhone(50);
  AudioEngine.playOneShot('gota_2', AudioEngine.nodes.comp, 0.7);
}


// =============================================================================
// 4. GESTIÓN MQTT Y SINCRONIZACIÓN CON EL TELÉFONO
// =============================================================================
const tacto = new Tacto();
let phoneDev = null;
let phoneCaps = { presion: 'sin dato', diametro: 'sin dato' };
let phoneGravity = { gx: 0, gy: 1.0 };
let phoneShakeCooldown = 0;

function sendHapticToPhone(ms = 40) {
  if (tacto.client && tacto.client.connected && phoneDev) {
    tacto.client.publish(`tacto/${tacto.sala}/${phoneDev.id}/cmd`, JSON.stringify({ vib: ms }));
  }
}

// Subtítulos poéticos flotantes
const seenGestures = new Set();
let toastTimer = null;
function showGestureToast(msg) {
  const toast = $('#gestureToast');
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
}

function triggerGestureNotice(key, text) {
  if (!seenGestures.has(key)) {
    seenGestures.add(key);
    showGestureToast(text);
  }
}


// =============================================================================
// 5. ENTRADAS DE RATÓN Y TECLADO (PRUEBAS SIN TELÉFONO)
// =============================================================================
let isMouseDown = false;
let isShiftDown = false;
let lastMousePos = { x: 0, y: 0, t: performance.now() };
let keyGravity = { x: 0, y: 1.0 };
let isBlowingKey = false;

window.addEventListener('mousedown', e => {
  if (e.target.closest('#topNav, #gateScreen, #guideModal, #qrCard')) return;
  isMouseDown = true;
  isShiftDown = e.shiftKey;
  lastMousePos = { x: e.clientX, y: e.clientY, t: performance.now() };
  AudioEngine.touchActive = true;
  AudioEngine.lastTouchTime = performance.now();

  const nx = e.clientX / viewW;
  const ny = e.clientY / viewH;
  if (isShiftDown) {
    AudioEngine.palmActive = true;
    clearFog(nx, ny, 0.14, 0.9);
    AudioEngine.playBarrido();
    triggerGestureNotice('palma', 'palma → calor');
  } else {
    clearFog(nx, ny, 0.05, 0.95);
    triggerGestureNotice('arrastrar', 'arrastrar → despeja el recuerdo');
  }
});

window.addEventListener('mousemove', e => {
  if (!isMouseDown) return;
  isShiftDown = e.shiftKey;
  const now = performance.now();
  const dt = Math.max(0.001, (now - lastMousePos.t) / 1000);
  const dx = (e.clientX - lastMousePos.x) / viewW;
  const dy = (e.clientY - lastMousePos.y) / viewH;
  const vel = Math.hypot(dx, dy) / dt;

  lastMousePos = { x: e.clientX, y: e.clientY, t: now };
  AudioEngine.lastTouchTime = now;
  AudioEngine.fingerVel = vel;
  AudioEngine.fingerX = e.clientX / viewW;
  AudioEngine.fingerPress = isShiftDown ? 0.9 : 0.45;

  const nx = e.clientX / viewW;
  const ny = e.clientY / viewH;
  const gridIdx = Math.floor(ny * GRID_H) * GRID_W + Math.floor(nx * GRID_W);
  AudioEngine.fogUnderFinger = fogGrid[gridIdx] || 0;

  if (isShiftDown) {
    AudioEngine.palmActive = true;
    clearFog(nx, ny, 0.14, 0.85);
  } else {
    AudioEngine.palmActive = false;
    clearFog(nx, ny, 0.05, 0.95);
    if (vel > 1.8 && Math.random() < 0.18) {
      spawnDroplet(e.clientX, e.clientY, 3.5 + Math.random() * 4);
    }
  }
});

window.addEventListener('mouseup', () => {
  isMouseDown = false;
  AudioEngine.touchActive = false;
  AudioEngine.palmActive = false;
  AudioEngine.fingerVel = 0;
});

window.addEventListener('keydown', e => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (e.key === 'Shift') isShiftDown = true;

  if (e.key === 'ArrowLeft') { keyGravity.x = -0.85; triggerGestureNotice('inclinar', 'inclinar → las gotas escurren'); }
  if (e.key === 'ArrowRight') { keyGravity.x = 0.85; triggerGestureNotice('inclinar', 'inclinar → las gotas escurren'); }
  if (e.key === 'ArrowUp') { keyGravity.y = -0.85; triggerGestureNotice('inclinar', 'inclinar → las gotas escurren'); }
  if (e.key === 'ArrowDown') { keyGravity.y = 1.0; }

  if (e.key.toLowerCase() === 's') {
    spawnShower(14);
    triggerGestureNotice('sacudir', 'sacudir → lluvia de gotas');
  }

  if (e.key.toLowerCase() === 'b' && !isBlowingKey) {
    isBlowingKey = true;
    AudioEngine.blowLevel = 0.85;
    triggerGestureNotice('soplar', 'soplar → el aliento empaña el vidrio');
  }
});

window.addEventListener('keyup', e => {
  if (e.key === 'Shift') isShiftDown = false;
  if (['ArrowLeft', 'ArrowRight'].includes(e.key)) keyGravity.x = 0;
  if (['ArrowUp', 'ArrowDown'].includes(e.key)) keyGravity.y = 1.0;
  if (e.key.toLowerCase() === 'b') {
    isBlowingKey = false;
    AudioEngine.blowLevel = 0;
  }
});

window.addEventListener('dragover', e => { e.preventDefault(); $('#dropOverlay').classList.add('active'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) $('#dropOverlay').classList.remove('active'); });
window.addEventListener('drop', e => {
  e.preventDefault();
  $('#dropOverlay').classList.remove('active');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadUserImage(file);
});


// =============================================================================
// 6. PROCESAMIENTO DE MENSAJES MQTT DEL TELÉFONO
// =============================================================================
tacto.on('dispositivo', d => {
  phoneDev = d;
  if (d && d.caps) phoneCaps = d.caps;
  const isOnline = !!(d && d.online);
  $('#stDot').className = 'status-dot' + (isOnline ? ' online' : '');
  $('#roomStatusText').innerHTML = isOnline
    ? `teléfono: <b>${d.name || 'conectado'}</b>`
    : `sala: <b>${tacto.sala}</b>`;
  if (isOnline) {
    $('#qrCard').classList.add('minimized');
  }
});

tacto.on('datos', (devObj, kind, m) => {
  phoneDev = devObj;
  if (devObj.caps) phoneCaps = devObj.caps;

  if (kind === 'touch') {
    const numFingers = tacto.get('touch.n') || 0;
    AudioEngine.touchActive = numFingers > 0;
    if (AudioEngine.touchActive) AudioEngine.lastTouchTime = performance.now();

    const t1x = tacto.get('t1.x');
    const t1y = tacto.get('t1.y');

    if (t1x != null && t1y != null && numFingers > 0) {
      const now = performance.now();
      const dt = Math.max(0.001, (now - lastMousePos.t) / 1000);
      const dx = t1x - (lastMousePos.x / viewW);
      const dy = t1y - (lastMousePos.y / viewH);
      const vel = Math.hypot(dx, dy) / dt;

      lastMousePos = { x: t1x * viewW, y: t1y * viewH, t: now };
      AudioEngine.fingerVel = vel;
      AudioEngine.fingerX = t1x;

      const rawForce = tacto.get('t1.f') || 0;
      const rawDiam = tacto.get('t1.d') || 40;
      const effectivePress = (phoneCaps.presion === 'variable')
        ? rawForce
        : clamp(rawDiam / 85, 0.2, 1.0);
      AudioEngine.fingerPress = effectivePress;

      const gX = Math.floor(t1x * GRID_W);
      const gY = Math.floor(t1y * GRID_H);
      AudioEngine.fogUnderFinger = fogGrid[gY * GRID_W + gX] || 0;

      const isPalm = numFingers >= 3 || rawDiam > 95;
      AudioEngine.palmActive = isPalm;

      if (isPalm) {
        clearFog(t1x, t1y, 0.16, 0.9);
        triggerGestureNotice('palma', 'palma → calor');
      } else {
        const radius = 0.035 + effectivePress * 0.04;
        clearFog(t1x, t1y, radius, 0.96);
        triggerGestureNotice('arrastrar', 'arrastrar → despeja el recuerdo');

        if (effectivePress > 0.78 && Math.random() < 0.22) {
          spawnDroplet(t1x * viewW, t1y * viewH, 4.5 + effectivePress * 5);
        }
      }
    }

    const dist = tacto.get('touch.dist');
    if (dist != null && numFingers >= 2) {
      AudioEngine.touchDist = clamp(dist, 0.5, 2.5);
      triggerGestureNotice('dist', 'dedos separados → el recuerdo se aleja');
    } else {
      AudioEngine.touchDist = 1.0;
    }
  }

  if (kind === 'motion') {
    const beta = (tacto.get('ang.b') || 0) * (Math.PI / 180);
    const gamma = (tacto.get('ang.g') || 0) * (Math.PI / 180);
    phoneGravity.gx = Math.cos(beta) * Math.sin(gamma);
    phoneGravity.gy = Math.sin(beta);

    if (Math.abs(phoneGravity.gx) > 0.35 || Math.abs(phoneGravity.gy - 1.0) > 0.45) {
      triggerGestureNotice('inclinar', 'inclinar → las gotas escurren');
    }

    const ax = tacto.get('acc.x') || 0;
    const ay = tacto.get('acc.y') || 0;
    const az = tacto.get('acc.z') || 9.81;
    const totalAcc = Math.hypot(ax, ay, az);
    const devAcc = Math.abs(totalAcc - 9.81);

    const now = performance.now();
    if (devAcc > 6.0 && now - phoneShakeCooldown > 1200) {
      phoneShakeCooldown = now;
      spawnShower(20);
      triggerGestureNotice('sacudir', 'sacudir → lluvia de gotas');
    }
  }

  if (kind === 'mic') {
    const level = tacto.get('mic.level') || 0;
    AudioEngine.blowLevel = level;
    if (level > 0.18) {
      addFogBreath(level * 0.08);
      triggerGestureNotice('soplar', 'soplar → el aliento empaña el vidrio');
    }
  }
});


// =============================================================================
// 7. BUCLE PRINCIPAL DE RENDERIZADO Y FÍSICA
// =============================================================================
function resizeViewport() {
  dpr = window.devicePixelRatio || 1;
  viewW = window.innerWidth;
  viewH = window.innerHeight;

  cvMain.width = viewW * dpr;
  cvMain.height = viewH * dpr;
  ctxMain.setTransform(dpr, 0, 0, dpr, 0, 0);

  maskedBlurCanvas.width = viewW;
  maskedBlurCanvas.height = viewH;
}
window.addEventListener('resize', resizeViewport);

let lastFrameTime = performance.now();

function frameLoop(now) {
  const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  // 1. El vaho vuelve solo (~25 s en recuperarse por completo)
  const fogRecovery = dt / 25.0;
  for (let i = 0; i < fogGrid.length; i++) {
    fogGrid[i] = Math.min(1.0, fogGrid[i] + fogRecovery);
  }

  if (isBlowingKey) {
    addFogBreath(0.06);
  }

  // 2. Calcular estadísticas de niebla (claridad total, izq y der)
  let sumFog = 0, sumFogL = 0, sumFogR = 0;
  const halfW = GRID_W / 2;
  const countHalf = halfW * GRID_H;

  for (let y = 0; y < GRID_H; y++) {
    const rowOffset = y * GRID_W;
    for (let x = 0; x < GRID_W; x++) {
      const v = fogGrid[rowOffset + x];
      sumFog += v;
      if (x < halfW) sumFogL += v;
      else sumFogR += v;
    }
  }
  const meanFog = sumFog / fogGrid.length;
  AudioEngine.meanFog = meanFog;
  AudioEngine.totalClarity = 1.0 - meanFog;
  AudioEngine.leftClarity = 1.0 - (sumFogL / countHalf);
  AudioEngine.rightClarity = 1.0 - (sumFogR / countHalf);

  // Actualizar motor de sonido
  AudioEngine.update();

  // 3. Renderizar máscara alfa del vaho en fogCanvas (384x216)
  const data = fogImgData.data;
  for (let y = 0; y < GRID_H; y++) {
    const yOff = y * GRID_W;
    for (let x = 0; x < GRID_W; x++) {
      const idx = yOff + x;
      const f = fogGrid[idx];
      const pIdx = idx * 4;

      // Color base del vaho #cfdde3 (207, 221, 227)
      data[pIdx] = 207;
      data[pIdx + 1] = 221;
      data[pIdx + 2] = 227;
      data[pIdx + 3] = Math.floor(f * 255);

      // Borde claro (anillo luminoso de condensación alrededor de lo despejado)
      if (x < GRID_W - 1 && y < GRID_H - 1) {
        const dfx = Math.abs(fogGrid[idx + 1] - f);
        const dfy = Math.abs(fogGrid[idx + GRID_W] - f);
        const grad = dfx + dfy;
        if (grad > 0.08 && f > 0.1 && f < 0.95) {
          data[pIdx] = 245;
          data[pIdx + 1] = 250;
          data[pIdx + 2] = 255;
          data[pIdx + 3] = Math.min(255, data[pIdx + 3] + Math.floor(grad * 180));
        }
      }
    }
  }
  fogCtx.putImageData(fogImgData, 0, 0);

  // 4. Composición de capas visuales
  // a) Crear la versión borrosa enmascarada exactamente donde hay vaho
  maskedBlurCtx.clearRect(0, 0, viewW, viewH);
  maskedBlurCtx.drawImage(blurCanvas, 0, 0, viewW, viewH);
  maskedBlurCtx.globalCompositeOperation = 'destination-in';
  maskedBlurCtx.drawImage(fogCanvas, 0, 0, viewW, viewH);
  maskedBlurCtx.globalCompositeOperation = 'source-over';

  // b) Dibujar la memoria nítida de base
  ctxMain.clearRect(0, 0, viewW, viewH);
  ctxMain.save();
  if (AudioEngine.touchDist > 1.05) {
    const zoom = 1.0 - (AudioEngine.touchDist - 1.0) * 0.12;
    const blurPx = (AudioEngine.touchDist - 1.0) * 6;
    ctxMain.filter = `blur(${blurPx}px)`;
    ctxMain.translate(viewW / 2, viewH / 2);
    ctxMain.scale(zoom, zoom);
    ctxMain.translate(-viewW / 2, -viewH / 2);
  }
  ctxMain.drawImage(memCanvas, 0, 0, viewW, viewH);
  ctxMain.restore();

  // c) Sobreponer la capa borrosa y lechosa donde el vaho persiste
  ctxMain.drawImage(maskedBlurCanvas, 0, 0, viewW, viewH);

  // d) Velo lechoso extra con grano de microgotas
  ctxMain.save();
  ctxMain.globalAlpha = 0.35;
  ctxMain.drawImage(fogCanvas, 0, 0, viewW, viewH);
  ctxMain.restore();

  // Microgotas estáticas de textura en áreas empañadas
  ctxMain.fillStyle = 'rgba(255, 255, 255, 0.03)';
  const step = 28;
  for (let gy = 14; gy < viewH; gy += step) {
    for (let gx = 14; gx < viewW; gx += step) {
      const fVal = fogGrid[Math.floor((gy / viewH) * GRID_H) * GRID_W + Math.floor((gx / viewW) * GRID_W)] || 0;
      if (fVal > 0.4) {
        ctxMain.beginPath();
        ctxMain.arc(gx + ((gy * 7) % 12), gy, 1.2, 0, Math.PI * 2);
        ctxMain.fill();
      }
    }
  }

  // e) Resplandor cálido de brasa si la palma está apoyada
  if (AudioEngine.palmActive) {
    const px = lastMousePos.x;
    const py = lastMousePos.y;
    const palmGlow = ctxMain.createRadialGradient(px, py, 10, px, py, 140);
    palmGlow.addColorStop(0, 'rgba(255, 169, 90, 0.35)');
    palmGlow.addColorStop(0.6, 'rgba(255, 169, 90, 0.12)');
    palmGlow.addColorStop(1, 'rgba(9, 16, 23, 0)');
    ctxMain.fillStyle = palmGlow;
    ctxMain.beginPath();
    ctxMain.arc(px, py, 140, 0, Math.PI * 2);
    ctxMain.fill();
  }

  // 5. Actualizar y dibujar gotas con efecto lente
  const currentGx = (phoneGravity.gx !== 0) ? phoneGravity.gx : keyGravity.x;
  const currentGy = (phoneGravity.gy !== 0) ? phoneGravity.gy : keyGravity.y;

  for (let i = droplets.length - 1; i >= 0; i--) {
    const d = droplets[i];
    d.update(currentGx, currentGy, dt);
    d.draw(ctxMain);

    if (d.x < -30 || d.x > viewW + 30 || d.y < -30 || d.y > viewH + 30) {
      droplets.splice(i, 1);
    }
  }

  requestAnimationFrame(frameLoop);
}


// =============================================================================
// 8. INTERFAZ, CÓDIGO QR Y CONTROL DE SALA
// =============================================================================
const qrLib = () => window.qrcode ? Promise.resolve() : new Promise((ok, no) => {
  const add = src => new Promise((y, n) => {
    const s = document.createElement('script');
    s.src = src; s.onload = y; s.onerror = n;
    document.head.appendChild(s);
  });
  add(new URL('vendor/qrcode.min.js', document.baseURI).href)
    .catch(() => add('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js'))
    .then(ok, no);
});

async function updateJoinQr() {
  const CFG = window.TACTO_CONFIG || {};
  let base = CFG.phoneUrl || null, isLocal = false;
  try {
    const info = await (await fetch('info', { cache: 'no-store' })).json();
    if (info && info.baseUrl) {
      base = CFG.phoneUrl || info.baseUrl + '/';
      isLocal = true;
    }
  } catch {}

  if (!base) base = new URL('./', location.href).href;
  let u = base + (base.includes('?') ? '&' : '?') + 'sala=' + tacto.sala;
  if (!isLocal) u += '&broker=' + encodeURIComponent(tacto.broker || Tacto.PUBLIC_BROKER);

  // Actualizar textos de sala
  document.querySelectorAll('.roomTextElem').forEach(el => el.textContent = tacto.sala);
  const rText = $('#roomText');
  if (rText) rText.textContent = tacto.sala;
  const urlEl = $('#qrUrlText');
  if (urlEl) urlEl.textContent = u;

  if (isLocal) {
    const localSrc = 'qr.svg?u=' + encodeURIComponent(u);
    document.querySelectorAll('.qrImgElem').forEach(img => {
      img.src = localSrc;
      img.hidden = false;
    });
    return;
  }

  try {
    await qrLib();
    const q = window.qrcode(0, 'M');
    q.addData(u);
    q.make();
    const qrDataUrl = q.createDataURL(4, 4);
    document.querySelectorAll('.qrImgElem').forEach(img => {
      img.src = qrDataUrl;
      img.hidden = false;
    });
  } catch (err) {
    console.error('Error generando QR:', err);
  }
}

// Botones de interfaz
$('#btnEnter').onclick = async () => {
  await AudioEngine.init();
  $('#gateScreen').classList.add('hidden');
};

$('#btnMemory').onclick = () => $('#filePicker').click();
$('#filePicker').onchange = e => {
  if (e.target.files && e.target.files[0]) loadUserImage(e.target.files[0]);
};

$('#btnRefog').onclick = () => {
  fogGrid.fill(1.0);
  droplets.length = 0;
  showGestureToast('el vaho cubre de nuevo el recuerdo');
};

$('#btnMute').onclick = () => {
  const willMute = !AudioEngine.muted;
  AudioEngine.setMute(willMute);
  $('#btnMute').textContent = willMute ? 'sonido: apagado' : 'sonido: encendido';
};

$('#btnGuide').onclick = () => $('#guideModal').classList.add('active');
$('#btnCloseGuide').onclick = () => $('#guideModal').classList.remove('active');

// Alternar visualización de tarjeta QR
$('#roomPill').onclick = () => $('#qrCard').classList.toggle('minimized');
$('#btnCloseQr').onclick = () => $('#qrCard').classList.add('minimized');
$('#btnNewRoom').onclick = () => {
  tacto.cambiarSala(Tacto.nuevaSala());
  updateJoinQr();
};

// =============================================================================
// 9. INICIO
// =============================================================================
resizeViewport();
initMemoryImage();
updateJoinQr();

tacto.connect()
  .then(() => updateJoinQr())
  .catch(err => console.warn('Error conexión MQTT Tacto:', err));

requestAnimationFrame(frameLoop);
