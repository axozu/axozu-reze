/* axozu blink — цикл анимации (WebGL2).
 *
 * Порядок рендера в шейдере:
 *   1) кадры глаз open / half / closed морфятся друг в друга по заранее
 *      посчитанному оптическому потоку (assets/flow_*.png): веко реально
 *      едет вниз/вверх, а не проявляется наплывом;
 *   2) к результату применяется колыхание волос (displacement по hair_mask);
 *   3) всё это масштабируется/сдвигается «дыханием».
 * Надпись axozu — DOM-элемент поверх canvas.
 */
'use strict';

// ============================================================================
//  КОНСТАНТЫ (все тайминги в секундах, если не сказано иное)
// ============================================================================

// --- Глаза -------------------------------------------------------------------
const OPEN_HOLD = 4.2;    // 0.0 – 4.2  глаза открыты
const CLOSE_DUR = 1.0;    // 4.2 – 5.2  закрываются
const CLOSED_HOLD = 1.4;  // 5.2 – 6.6  закрыты
const OPEN_DUR = 1.3;     // 6.6 – 7.9  открываются
const CYCLE = Math.round((OPEN_HOLD + CLOSE_DUR + CLOSED_HOLD + OPEN_DUR) * 1000); // мс, 7900
const CYCLE_S = CYCLE / 1000;

const CLOSE_START = OPEN_HOLD;
const CLOSE_END = CLOSE_START + CLOSE_DUR;
const OPEN_START = CLOSE_END + CLOSED_HOLD;
const OPEN_END = OPEN_START + OPEN_DUR; // == CYCLE / 1000

const HALF_KEY = 0.55;                    // прогресс закрытия, на котором кадр = half.jpg
const EYE_EASING = 'easeInOutSine';       // имя функции из easing.js
// Морфинг: внутри перехода кадр A «едет» к B по потоку, а смена самих пикселей
// A→B (кроссфейд) происходит только в этом окне локального t — так меньше
// двойных контуров. [0, 1] = обычный кроссфейд по всей длине.
const EYE_MORPH_BLEND = [0.3, 0.7];
const EYE_MORPH = true;                   // false — простой кроссфейд целых кадров
// Прямоугольник, который покрывают поля потока (px кадра 2252×1544).
// Должен совпадать с CROP в tools/make_eye_flow.py.
const FLOW_RECT = { x: 470, y: 220, w: 1290, h: 540 };
const FLOW_ZERO = 128;                    // кодирование потока в PNG: 128 = 0 px

// --- Надпись axozu -----------------------------------------------------------
// Исчезает полностью до начала закрытия, проявляется ровно к полному открытию.
const TEXT_FADE_OUT_DUR = 1.1;
const TEXT_FADE_IN_DUR = 1.5;
const TEXT_FADE_OUT_END = CLOSE_START;                            // 4.2
const TEXT_FADE_OUT_START = TEXT_FADE_OUT_END - TEXT_FADE_OUT_DUR; // 3.1
const TEXT_FADE_IN_END = OPEN_END;                                // 7.9
const TEXT_FADE_IN_START = TEXT_FADE_IN_END - TEXT_FADE_IN_DUR;    // 6.4
const TEXT_EASING = 'easeInOutSine';

const TEXT = 'axozu';
const TEXT_FONT = '"Segoe UI Light", "Segoe UI", "Helvetica Neue", "Avenir Next", Helvetica, Arial, sans-serif';
const TEXT_WEIGHT = 200;
const TEXT_SIZE = 0.052;          // размер шрифта, доля ширины окна
const TEXT_LETTER_SPACING = '0.55em';
const TEXT_Y = 0.80;              // центр надписи, доля высоты окна (нижняя треть)
const TEXT_SHIFT = 6;             // сдвиг по Y при появлении/исчезании, px окна 1126×772

// --- Волосы ------------------------------------------------------------------
// Амплитуда в пикселях исходного кадра 1126×772 (для текстур 2252×1544 это ×2).
const HAIR_AMP = { x: 3.5, y: 1.5 };
const HAIR_AMPLITUDE = HAIR_AMP; // алиас из ТЗ
// Периоды трёх синусоид — доли цикла (7.9 / 3.95 / 2.63 с), так что колыхание
// тоже строго периодично с циклом.
const HAIR_PERIODS = [CYCLE_S, CYCLE_S / 2, CYCLE_S / 3];
const HAIR_WEIGHTS = [1.0, 0.55, 0.25];   // вклад каждой синусоиды
const HAIR_WAVE_Y = 5.0;                 // насколько фаза зависит от Y (радиан на высоту кадра)
const HAIR_BLINK_BOOST = 0.20;           // +20% амплитуды во время моргания
const HAIR_BOOST_RAMP = 0.8;             // длительность плавного нарастания/спада буста

// --- Дыхание -----------------------------------------------------------------
const BREATH_PERIOD = CYCLE_S / 2;      // ~3.95 с — спокойное дыхание
const BREATH_SCALE = 0.006;              // scale 1.0 -> 1.006
const BREATH_SHIFT = { x: 0.6, y: -1.5 }; // px кадра 1126×772 на пике вдоха

// --- Цветокор ----------------------------------------------------------------
// Пресеты переключаются клавишей G или через ПКМ-меню; выбор запоминается.
//   sat       насыщенность (0 = ч/б)
//   gamma     >1 — плотнее полутона (кожа и фон не «выгорают»)
//   contrast  сила S-кривой
//   fade      подъём чёрного («матовая» плёнка)
//   shadow / high  тонирование теней и светов (множители RGB)
//   vignette  затемнение к краям
//   grain     зерно (амплитуда), обновляется GRAIN_FPS раз в секунду
const GRADE_DEFAULT = 'bw';
const GRAIN_FPS = 24;
const GRADES = {
  bw: {
    label: 'Ч/б плёнка',
    sat: 0.0, gamma: 1.3, contrast: 0.5, fade: 0.035,
    shadow: [0.97, 0.98, 1.03], high: [1.03, 1.0, 0.965],
    vignette: 0.42, grain: 0.05,
    textColor: '#f4f2ee',
    textGlow: '0 0 0.2em rgba(255, 255, 255, 0.75), 0 0 0.9em rgba(255, 255, 255, 0.35), 0 0 0.6em rgba(0, 0, 0, 0.28), 0 0 0.08em rgba(0, 0, 0, 0.4)',
  },
  film: {
    label: 'Цветная плёнка',
    sat: 0.8, gamma: 1.08, contrast: 0.25, fade: 0.03,
    shadow: [0.95, 0.98, 1.06], high: [1.04, 1.0, 0.95],
    vignette: 0.32, grain: 0.035,
    textColor: '#fbf6ef',
    textGlow: '0 0 0.2em rgba(255, 236, 220, 0.8), 0 0 0.9em rgba(220, 180, 255, 0.4), 0 0 0.6em rgba(40, 20, 50, 0.25), 0 0 0.08em rgba(40, 20, 50, 0.35)',
  },
  none: {
    label: 'Оригинал',
    sat: 1, gamma: 1, contrast: 0, fade: 0, shadow: [1, 1, 1], high: [1, 1, 1], vignette: 0, grain: 0,
    textColor: '#f6f2ff',
    textGlow: '0 0 0.25em rgba(235, 220, 255, 0.85), 0 0 0.8em rgba(190, 160, 255, 0.55)',
  },
};

// --- Разное ------------------------------------------------------------------
const BLINK_JITTER_ENABLED = false; // случайный разброс паузы между морганиями
const BLINK_JITTER = 0.5;           // ± секунд к удержанию открытых глаз
const DEBUG = false;                // отладочный вывод фазы (переключается клавишей D)

const IMG_W = 2252;
const IMG_H = 1544;
const BASE_W = 1126; // «исходный» кадр, в котором заданы амплитуды в px
const BASE_H = 772;

// ============================================================================

const E = window.Easing;
const ease = (name) => E[name] || E.easeInOutSine;

// ---------------- Расписание цикла (с опциональным джиттером) ----------------
// Джиттер реализован как удлинение/укорочение удержания открытых глаз:
// локальная фаза p' = max(0, p - extra) — пока p < extra, кадр стоит в фазе 0.
let cycleStart = 0;
let cycleExtra = 0;
let jitterInit = false;

function nextExtra() {
  return BLINK_JITTER_ENABLED ? (Math.random() * 2 - 1) * BLINK_JITTER * 1000 : 0;
}

/** Фаза цикла в секундах [0 .. CYCLE/1000). */
function cyclePhase(t) {
  if (!BLINK_JITTER_ENABLED) return (t % CYCLE) / 1000;
  if (!jitterInit) { cycleStart = t; cycleExtra = nextExtra(); jitterInit = true; }
  while (t - cycleStart >= CYCLE + cycleExtra) {
    cycleStart += CYCLE + cycleExtra;
    cycleExtra = nextExtra();
  }
  const p = t - cycleStart; // мс
  return Math.max(0, p - cycleExtra) / 1000;
}

/** Прогресс закрытия глаз: 0 = открыты, 1 = закрыты. */
function eyeProgress(p) {
  if (p < CLOSE_START) return 0;
  if (p < CLOSE_END) return E.range(p, CLOSE_START, CLOSE_END, ease(EYE_EASING));
  if (p < OPEN_START) return 1;
  return 1 - E.range(p, OPEN_START, OPEN_END, ease(EYE_EASING));
}

/** Сегмент морфинга для прогресса закрытия:
 *  seg 0 = open→half, seg 1 = half→closed; t — позиция внутри (0..1). */
function eyeSegment(k) {
  if (k <= HALF_KEY) return { seg: 0, t: HALF_KEY > 0 ? k / HALF_KEY : 1 };
  return { seg: 1, t: (k - HALF_KEY) / (1 - HALF_KEY) };
}

/** Непрозрачность надписи и её сдвиг (-1..1, доля TEXT_SHIFT). */
function textState(p) {
  const fe = ease(TEXT_EASING);
  if (p < TEXT_FADE_OUT_START) return { o: 1, s: 0 };
  if (p < TEXT_FADE_OUT_END) {
    const k = E.range(p, TEXT_FADE_OUT_START, TEXT_FADE_OUT_END, fe);
    return { o: 1 - k, s: -k };            // уходит чуть вверх
  }
  if (p < TEXT_FADE_IN_START) return { o: 0, s: 1 };
  const k = E.range(p, TEXT_FADE_IN_START, TEXT_FADE_IN_END, fe);
  return { o: k, s: 1 - k };               // приходит снизу
}

/** Огибающая усиления волос во время моргания (0..1). */
function hairBoost(p) {
  if (p < CLOSE_START || p > OPEN_END) return 0;
  const up = E.range(p, CLOSE_START, CLOSE_START + HAIR_BOOST_RAMP, E.easeInOutSine);
  const down = 1 - E.range(p, OPEN_END - HAIR_BOOST_RAMP, OPEN_END, E.easeInOutSine);
  return Math.min(up, down);
}

// ---------------- WebGL ----------------
const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); // y вниз, как у картинки
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uOpen;
uniform sampler2D uHalf;
uniform sampler2D uClosed;
uniform sampler2D uMask;
uniform sampler2D uFlowAB; // поток A→B текущего сегмента
uniform sampler2D uFlowBA; // поток B→A

uniform int   uSeg;      // 0: A=open, B=half; 1: A=half, B=closed
uniform float uT;        // позиция внутри сегмента
uniform float uK;        // вес B при смешивании
uniform float uMorph;    // 1 — морфинг по потоку, 0 — кроссфейд
uniform vec4  uFlowRect; // x, y, w, h в UV кадра
uniform float uTime;     // секунды, непрерывно
uniform vec2  uHairAmp;  // амплитуда волос в UV
uniform vec3  uPeriods;
uniform vec3  uWeights;
uniform float uWaveY;
uniform vec2  uCover;    // доля текстуры, видимая окну (object-fit: cover)
uniform float uScale;    // дыхание
uniform vec2  uShift;    // дыхание, UV

uniform float uSat;
uniform float uGamma;
uniform float uContrast;
uniform float uFade;
uniform vec3  uShadowTint;
uniform vec3  uHighTint;
uniform float uVignette;
uniform float uGrain;
uniform float uGrainSeed;
uniform float uDpr;

const float TAU = 6.28318530718;
const vec2  IMG = vec2(${IMG_W.toFixed(1)}, ${IMG_H.toFixed(1)});
const float FLOW_ZERO = ${FLOW_ZERO.toFixed(1)};

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// hash12 (Dave Hoskins) — без видимых полос на пиксельной сетке
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 grade(vec3 c) {
  float l = dot(c, LUMA);
  c = mix(vec3(l), c, uSat);
  c = pow(max(c, 0.0), vec3(uGamma));                       // плотность полутонов
  c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);          // S-кривая
  float l2 = dot(c, LUMA);
  c *= mix(uShadowTint, uHighTint, smoothstep(0.1, 0.9, l2)); // сплит-тон
  c = mix(vec3(uFade), vec3(1.0), c);                       // матовый чёрный

  // виньетка в экранных координатах
  vec2 q = (vUv - 0.5) * vec2(1.2, 1.0);
  float v = smoothstep(0.95, 0.2, length(q));
  c *= mix(1.0 - uVignette, 1.0, v);

  // зерно: сильнее в полутонах, слабее в глубоких тенях и светах
  vec2 gp = floor(gl_FragCoord.xy / max(uDpr, 1.0));
  float n = hash(gp + vec2(mod(uGrainSeed * 61.0, 4096.0), mod(uGrainSeed * 113.0, 4096.0))) - 0.5;
  c += n * uGrain * (1.0 - 0.7 * abs(l2 * 2.0 - 1.0));
  return clamp(c, 0.0, 1.0);
}

float wave(vec2 uv, vec3 ph) {
  vec3 a = TAU * uTime / uPeriods + ph + uv.y * uWaveY * vec3(1.0, 0.73, 1.31) + uv.x * vec3(1.7, -2.3, 0.9);
  vec3 s = sin(a) * uWeights;
  return (s.x + s.y + s.z) / (uWeights.x + uWeights.y + uWeights.z);
}

void main() {
  // экран -> текстура: cover + дыхание (масштаб от центра)
  vec2 uv = (vUv - 0.5) * uCover / uScale + 0.5 - uShift;

  // колыхание волос: вес из маски в точке назначения, мягкий край маски
  // даёт непрерывное смещение, лицо (вес 0) не двигается совсем
  float w = texture(uMask, uv).r;
  vec2 d = vec2(wave(uv, vec3(0.0, 1.9, 4.1)), wave(uv, vec3(2.6, 0.7, 5.3))) * uHairAmp * w;
  vec2 suv = clamp(uv - d, vec2(0.0), vec2(1.0));

  // моргание: A сэмплируется со сдвигом назад по потоку A→B на t,
  // B — по потоку B→A на (1-t). Вне зоны глаз поток = 0 и кадры совпадают.
  vec2 fuv = (suv - uFlowRect.xy) / uFlowRect.zw;
  vec2 fab = (texture(uFlowAB, fuv).rg * 255.0 - FLOW_ZERO) / IMG * uMorph;
  vec2 fba = (texture(uFlowBA, fuv).rg * 255.0 - FLOW_ZERO) / IMG * uMorph;
  vec2 ua = clamp(suv - uT * fab, vec2(0.0), vec2(1.0));
  vec2 ub = clamp(suv - (1.0 - uT) * fba, vec2(0.0), vec2(1.0));

  vec3 ca, cb;
  if (uSeg == 0) { ca = texture(uOpen, ua).rgb; cb = texture(uHalf, ub).rgb; }
  else           { ca = texture(uHalf, ua).rgb; cb = texture(uClosed, ub).rgb; }
  outColor = vec4(grade(mix(ca, cb, uK)), 1.0);
}`;

const canvas = document.getElementById('gl');
const textEl = document.getElementById('axozu');
const debugEl = document.getElementById('debug');
let debugOn = DEBUG;

const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false });
if (!gl) {
  document.body.insertAdjacentHTML('beforeend', '<div class="err">WebGL2 недоступен</div>');
  throw new Error('WebGL2 not available');
}

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);

const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
const aPos = gl.getAttribLocation(prog, 'aPos');
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

const U = {};
for (const n of ['uOpen', 'uHalf', 'uClosed', 'uMask', 'uFlowAB', 'uFlowBA', 'uSeg', 'uT', 'uK',
  'uMorph', 'uFlowRect', 'uTime', 'uHairAmp', 'uPeriods',
  'uWeights', 'uWaveY', 'uCover', 'uScale', 'uShift', 'uSat', 'uGamma', 'uContrast', 'uFade',
  'uShadowTint', 'uHighTint', 'uVignette', 'uGrain', 'uGrainSeed', 'uDpr']) U[n] = gl.getUniformLocation(prog, n);

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Не удалось загрузить ' + src));
    img.src = src;
  });
}

function makeTexture(img, unit, isData = false) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  // данные (маска, поток) — без цветокоррекции браузера
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, isData ? gl.NONE : gl.BROWSER_DEFAULT_WEBGL);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (isData) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  } else {
    gl.generateMipmap(gl.TEXTURE_2D); // чистое уменьшение 2252 -> размер окна
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
  return tex;
}

// ---------------- Размеры / HiDPI ----------------
let cssW = 0, cssH = 0, dpr = 0;
function syncSize() {
  const w = window.innerWidth, h = window.innerHeight, r = window.devicePixelRatio || 1;
  if (w === cssW && h === cssH && r === dpr) return;
  cssW = w; cssH = h; dpr = r;
  canvas.width = Math.max(1, Math.round(w * r));
  canvas.height = Math.max(1, Math.round(h * r));
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform1f(U.uDpr, r);

  const ca = w / h, ia = IMG_W / IMG_H;
  if (ca > ia) gl.uniform2f(U.uCover, 1, ia / ca);
  else gl.uniform2f(U.uCover, ca / ia, 1);

  textEl.style.fontSize = (w * TEXT_SIZE).toFixed(2) + 'px';
}

function setupText() {
  textEl.textContent = TEXT;
  Object.assign(textEl.style, {
    fontFamily: TEXT_FONT,
    fontWeight: String(TEXT_WEIGHT),
    letterSpacing: TEXT_LETTER_SPACING,
    // компенсируем хвостовой letter-spacing, чтобы надпись стояла ровно по центру
    paddingLeft: TEXT_LETTER_SPACING,
    top: (TEXT_Y * 100) + '%',
  });
}

// ---------------- Цветокор ----------------
const GRADE_KEY = 'axozu.grade';
let gradeName = GRADE_DEFAULT;
try {
  const saved = localStorage.getItem(GRADE_KEY);
  if (saved && GRADES[saved]) gradeName = saved;
} catch (_) { /* хранилище недоступно — используем значение по умолчанию */ }

function applyGrade(name) {
  if (!GRADES[name]) return;
  gradeName = name;
  const g = GRADES[name];
  gl.uniform1f(U.uSat, g.sat);
  gl.uniform1f(U.uGamma, g.gamma);
  gl.uniform1f(U.uContrast, g.contrast);
  gl.uniform1f(U.uFade, g.fade);
  gl.uniform3f(U.uShadowTint, g.shadow[0], g.shadow[1], g.shadow[2]);
  gl.uniform3f(U.uHighTint, g.high[0], g.high[1], g.high[2]);
  gl.uniform1f(U.uVignette, g.vignette);
  gl.uniform1f(U.uGrain, g.grain);
  textEl.style.color = g.textColor;
  textEl.style.textShadow = g.textGlow;
  try { localStorage.setItem(GRADE_KEY, name); } catch (_) { /* не критично */ }
  if (api && api.setGradeState) api.setGradeState(name, Object.keys(GRADES).map((k) => [k, GRADES[k].label]));
}
window.applyGrade = applyGrade; // для отладки из консоли

// подсказка в углу коротко подсвечивается при смене цветокора
const hintEl = document.getElementById('hint');
let hintTimer = 0;
function flashHint() {
  if (!hintEl) return;
  hintEl.classList.add('flash');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hintEl.classList.remove('flash'), 350);
}

function cycleGrade() {
  const names = Object.keys(GRADES);
  applyGrade(names[(names.indexOf(gradeName) + 1) % names.length]);
  flashHint();
}

// Потоки текущего сегмента сидят на юнитах 4/5; переключаем только при смене сегмента.
let flowTex = null;
let curSeg = -1;
function bindSegment(seg) {
  curSeg = seg;
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, seg ? flowTex.hc : flowTex.oh);
  gl.activeTexture(gl.TEXTURE5);
  gl.bindTexture(gl.TEXTURE_2D, seg ? flowTex.ch : flowTex.ho);
  gl.uniform1i(U.uSeg, seg);
}

const api = window.axozu;
if (api && api.onGrade) api.onGrade((name) => applyGrade(name));

// ---------------- Цикл ----------------
let fps = 0, fpsFrames = 0, fpsT = 0;

function frame(now) {
  syncSize();

  const t = now / 1000;          // непрерывное время для волос и дыхания
  const p = cyclePhase(now);     // фаза цикла, с

  // глаза
  const k = eyeProgress(p);
  const sg = eyeSegment(k);
  const kb = EYE_MORPH ? E.range(sg.t, EYE_MORPH_BLEND[0], EYE_MORPH_BLEND[1], E.smoothstep) : sg.t;
  if (sg.seg !== curSeg) bindSegment(sg.seg);
  gl.uniform1f(U.uT, sg.t);
  gl.uniform1f(U.uK, kb);

  // волосы
  const boost = 1 + HAIR_BLINK_BOOST * hairBoost(p);
  gl.uniform1f(U.uTime, t);
  gl.uniform1f(U.uGrainSeed, Math.floor(t * GRAIN_FPS) % 997);
  gl.uniform2f(U.uHairAmp, (HAIR_AMP.x / BASE_W) * boost, (HAIR_AMP.y / BASE_H) * boost);

  // дыхание: 0..1 синусоида; при b=0 сдвиг 0, а запас от масштаба всегда
  // больше сдвига — белых полей не бывает
  const b = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / BREATH_PERIOD);
  gl.uniform1f(U.uScale, 1 + BREATH_SCALE * b);
  gl.uniform2f(U.uShift, (BREATH_SHIFT.x / BASE_W) * b, (BREATH_SHIFT.y / BASE_H) * b);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // надпись
  const ts = textState(p);
  textEl.style.opacity = ts.o.toFixed(4);
  const shiftPx = ts.s * TEXT_SHIFT * (cssW / BASE_W);
  textEl.style.transform = `translate(-50%, calc(-50% + ${shiftPx.toFixed(2)}px))`;

  // отладка
  fpsFrames++;
  if (now - fpsT >= 500) { fps = (fpsFrames * 1000) / (now - fpsT); fpsFrames = 0; fpsT = now; }
  if (debugOn) {
    debugEl.style.display = 'block';
    debugEl.textContent =
      `phase ${p.toFixed(2)} / ${(CYCLE / 1000).toFixed(1)} s\n` +
      `eyes  ${k.toFixed(3)}  ${sg.seg ? 'half→closed' : 'open→half'} t=${sg.t.toFixed(2)} mix=${kb.toFixed(2)}\n` +
      `text  ${ts.o.toFixed(3)}\n` +
      `hair  x${boost.toFixed(3)}\n` +
      `grade ${gradeName}\n` +
      `fps   ${fps.toFixed(0)}  ${canvas.width}×${canvas.height} @${dpr}`;
  } else {
    debugEl.style.display = 'none';
  }

  requestAnimationFrame(frame);
}

// ---------------- Окно: перетаскивание, кнопки, меню, выход ----------------

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  api.dragStart();
});
canvas.addEventListener('pointermove', (e) => {
  if (canvas.hasPointerCapture(e.pointerId)) api.dragMove();
});
const endDrag = (e) => {
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  api.dragEnd();
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('dblclick', () => api.close());
window.addEventListener('contextmenu', (e) => { e.preventDefault(); api.showMenu(); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.close();
  else if (e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В') debugOn = !debugOn;
  else if (e.key === 'g' || e.key === 'G' || e.key === 'п' || e.key === 'П') cycleGrade();
});

for (const btn of document.querySelectorAll('.ctl')) {
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('dblclick', (e) => e.stopPropagation());
}
document.getElementById('btn-min').addEventListener('click', () => api.minimize());
document.getElementById('btn-close').addEventListener('click', () => api.close());

// ---------------- Старт ----------------
(async function start() {
  setupText();
  const [open, half, closed, mask, oh, ho, hc, ch] = await Promise.all(
    ['assets/open.jpg', 'assets/half.jpg', 'assets/closed.jpg', 'assets/hair_mask.png',
      'assets/flow_open_half.png', 'assets/flow_half_open.png',
      'assets/flow_half_closed.png', 'assets/flow_closed_half.png'].map(loadImage));
  makeTexture(open, 0);
  makeTexture(half, 1);
  makeTexture(closed, 2);
  makeTexture(mask, 3, true);
  // поля потока загружаются через «запасной» юнит 6, а в работе биндятся на 4/5
  flowTex = {
    oh: makeTexture(oh, 6, true), ho: makeTexture(ho, 6, true),
    hc: makeTexture(hc, 6, true), ch: makeTexture(ch, 6, true),
  };
  gl.uniform1i(U.uFlowAB, 4);
  gl.uniform1i(U.uFlowBA, 5);
  gl.uniform1f(U.uMorph, EYE_MORPH ? 1 : 0);
  gl.uniform4f(U.uFlowRect, FLOW_RECT.x / IMG_W, FLOW_RECT.y / IMG_H, FLOW_RECT.w / IMG_W, FLOW_RECT.h / IMG_H);
  bindSegment(0);
  gl.uniform1i(U.uOpen, 0);
  gl.uniform1i(U.uHalf, 1);
  gl.uniform1i(U.uClosed, 2);
  gl.uniform1i(U.uMask, 3);
  gl.uniform3f(U.uPeriods, HAIR_PERIODS[0], HAIR_PERIODS[1], HAIR_PERIODS[2]);
  gl.uniform3f(U.uWeights, HAIR_WEIGHTS[0], HAIR_WEIGHTS[1], HAIR_WEIGHTS[2]);
  gl.uniform1f(U.uWaveY, HAIR_WAVE_Y);
  applyGrade(gradeName);

  document.body.classList.add('ready');
  requestAnimationFrame(frame);
})().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<div class="err">${String(err.message || err)}</div>`);
});
