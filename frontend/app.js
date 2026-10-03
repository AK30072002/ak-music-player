/* AK Music Player — frontend. Plain JS, no build step. */
'use strict';

/* ================================================================ helpers */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Native Android shell (the APK) exposes window.AKAndroid
const AKA = window.AKAndroid || null;
const IN_APP = !!AKA;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const fmtTime = s => {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};
const fmtLong = s => { const m = Math.round((s || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`; };
const fmtBytes = b => b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB';
const ago = ts => {
  if (!ts) return '';
  const s = Date.now() / 1000 - ts;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ts * 1000).toLocaleDateString();
};
const shuffleArr = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const openExternal = u => { if (IN_APP) { try { return AKA.openExternal(u); } catch { } } open(u, '_blank', 'noopener'); };
const store = (k, v) => { try { localStorage.setItem('akmp.' + k, JSON.stringify(v)); } catch { } };
const load = k => { try { return JSON.parse(localStorage.getItem('akmp.' + k)); } catch { return null; } };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ================================================================ icons */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  library: '<path d="M5 4v16M10 4v16M15 4.5l4.5 15"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-9.5-9.6A5.2 5.2 0 0 1 12 6.2a5.2 5.2 0 0 1 9.5 4.7c-2 5-9.5 9.6-9.5 9.6z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  shuffle: '<path d="M16 4h4v4M4 20 20 4M20 16v4h-4M15 15l5 5M4 4l5 5"/>',
  repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  repeat1: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/><path d="M11 10h1v4"/>',
  play: { fill: true, d: '<path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z"/>' },
  pause: { fill: true, d: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>' },
  prev: { fill: true, d: '<path d="M18 5.5v13a1 1 0 0 1-1.6.8L8 13v6H6V5h2v6l8.4-6.3a1 1 0 0 1 1.6.8z"/>' },
  next: { fill: true, d: '<path d="M6 5.5v13a1 1 0 0 0 1.6.8L16 13v6h2V5h-2v6L7.6 4.7A1 1 0 0 0 6 5.5z"/>' },
  loader: '<path d="M12 3a9 9 0 1 0 9 9"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  queue: '<path d="M3 6h12M3 12h12M3 18h7M17 18V8l4-2"/><circle cx="15" cy="18" r="2"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  volumeLow: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  more: { fill: true, d: '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>' },
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  pin: '<path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z"/>',
  playNext: '<path d="M3 6h12M3 12h8M3 18h8"/><path d="M15 12l6 4-6 4z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
  phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1 20 20M8.1 15.9 20 4"/>',
  merge: '<path d="M4 6h6l4 6-4 6H4M14 12h7M18 9l3 3-3 3"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  box: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
  boxChecked: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
  save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
};
const svg = n => {
  const d = ICONS[n] || ICONS.music;
  return typeof d === 'string'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
    : `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${d.d}</svg>`;
};
const ic = n => `<i data-icon="${n}">${svg(n)}</i>`;
const hydrate = (root = document) => $$('i[data-icon]', root).forEach(el => { if (!el.firstChild) el.innerHTML = svg(el.dataset.icon); });
const setIcon = (btn, n) => { const i = btn && btn.querySelector('i[data-icon]'); if (i && i.dataset.icon !== n) { i.dataset.icon = n; i.innerHTML = svg(n); } };

/* ================================================================ API */
async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let r;
  try { r = await fetch('/api' + path, opts); }
  catch { throw new Error("Can't reach the AK Music Player server. Is it running?"); }
  let data = null;
  try { data = await r.json(); } catch { }
  if (!r.ok) {
    const d = data && data.detail;
    throw new Error(typeof d === 'string' ? d : `Request failed (${r.status})`);
  }
  return data;
}
const audioUrl = t => `/api/tracks/${encodeURIComponent(t.id)}/audio`;

/* ================================================================ settings */
const DEFAULTS = {
  theme: 'auto', onPaste: 'play', crossfade: 0, effects: !isIOS && !IN_APP, normalize: false,
  eq: [0, 0, 0, 0, 0], eqPreset: 'Flat', volume: 0.8, muted: false, speed: 1,
  resume: true, shuffle: false, repeat: 'off',
};
const settings = Object.assign({}, DEFAULTS, load('settings') || {});
const saveSettings = () => store('settings', settings);
const EQ_FREQS = [60, 230, 910, 3600, 14000];
const EQ_PRESETS = {
  'Flat': [0, 0, 0, 0, 0], 'Bass boost': [7, 4, 0, 0, 1], 'Vocal': [-2, 0, 3, 4, 1],
  'Treble': [0, 0, 0, 4, 7], 'Electronic': [5, 2, -1, 2, 5], 'Acoustic': [3, 2, 1, 2, 3],
  'Late night': [3, 1, 0, -2, -4], 'Podcast': [-4, 1, 4, 3, -2],
};

function applyTheme() {
  const mode = settings.theme === 'auto'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : settings.theme;
  document.documentElement.dataset.theme = mode;
  const bar = mode === 'light' ? '#f1f6f1' : '#14201a';
  $('meta[name="theme-color"]').content = bar;
  try { AKA?.setTheme(bar, mode === 'light'); } catch { }
  vizAccent = null;
}
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyTheme);

/* ================================================================ app state */
const S = { playlists: [], health: null };
const P = {
  queue: [], original: null, index: -1, playing: false, loading: false, token: 0,
  crossfading: false, counted: false, errSkips: 0, from: '', resumeAt: 0,
  sleepTimer: null, sleepAt: 0, sleepEndOfTrack: false, panel: null, lastPos: 0, lastSave: 0,
};
const current = () => P.queue[P.index] || null;
const isCurrent = t => !!t && current()?.id === t.id;

/* ================================================================ audio engine */
const decks = [$('#deckA'), $('#deckB')];
let active = 0;
const levels = [1, 0];
const fadeTimers = [null, null];
let actx = null, master = null, analyser = null, comp = null, eqNodes = [], deckGains = [];
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

function initAudioGraph() {
  if (actx || !settings.effects) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain();
    analyser = actx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    eqNodes = EQ_FREQS.map((f, i) => {
      const b = actx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f; b.Q.value = 1; b.gain.value = settings.eq[i] || 0;
      return b;
    });
    for (let i = 0; i < eqNodes.length - 1; i++) eqNodes[i].connect(eqNodes[i + 1]);
    comp = actx.createDynamicsCompressor();
    comp.threshold.value = -24; comp.knee.value = 20; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.25;
    routeNormalize();
    master.connect(analyser);
    analyser.connect(actx.destination);
    decks.forEach((d, i) => {
      const src = actx.createMediaElementSource(d);
      const g = actx.createGain();
      src.connect(g); g.connect(eqNodes[0]);
      deckGains[i] = g;
    });
    applyLevels();
  } catch (e) {
    console.warn('Audio effects unavailable', e);
    actx = null;
  }
}
function routeNormalize() {
  if (!actx) return;
  const last = eqNodes[eqNodes.length - 1];
  try { last.disconnect(); } catch { }
  try { comp.disconnect(); } catch { }
  if (settings.normalize) { last.connect(comp); comp.connect(master); } else last.connect(master);
}
function setEq(values) {
  settings.eq = values.slice(); saveSettings();
  eqNodes.forEach((b, i) => b.gain.setTargetAtTime(values[i], actx.currentTime, 0.05));
}
function applyLevels() {
  const v = settings.muted ? 0 : settings.volume ** 2;
  if (actx) {
    master.gain.value = v;
    deckGains.forEach((g, i) => { g.gain.value = levels[i]; });
    decks.forEach(d => { d.volume = 1; });
  } else {
    decks.forEach((d, i) => { d.volume = clamp(levels[i] * v, 0, 1); });
  }
}
const fadeResolvers = [null, null];
function fade(i, to, ms) {
  return new Promise(res => {
    clearInterval(fadeTimers[i]);
    fadeResolvers[i]?.();
    fadeResolvers[i] = res;
    const from = levels[i], start = performance.now();
    if (ms <= 0) { levels[i] = to; applyLevels(); fadeResolvers[i] = null; return res(); }
    fadeTimers[i] = setInterval(() => {
      const k = Math.min(1, (performance.now() - start) / ms);
      levels[i] = from + (to - from) * k;
      applyLevels();
      if (k >= 1) { clearInterval(fadeTimers[i]); fadeResolvers[i] = null; res(); }
    }, 40);
  });
}
function stopFades() {
  [0, 1].forEach(i => { clearInterval(fadeTimers[i]); const r = fadeResolvers[i]; fadeResolvers[i] = null; r?.(); });
}

// unlock audio on the first interaction (needed by Safari / Chrome autoplay rules)
function unlock() {
  initAudioGraph();
  actx?.resume?.();
  decks.forEach(d => {
    if (!d.getAttribute('src')) { d.src = SILENT; d.play().then(() => d.pause()).catch(() => { }); }
  });
}
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, unlock, { once: true, capture: true }));

/* ---------- preparing (the server caches the audio once) */
const preparing = new Map();
function prepare(t) {
  if (t.status === 'ready') return Promise.resolve(t);
  if (preparing.has(t.id)) return preparing.get(t.id);
  const p = api(`/tracks/${encodeURIComponent(t.id)}/prepare`, { method: 'POST' })
    .then(u => { syncTrack(u); return u; })
    .catch(e => { syncTrack({ id: t.id, status: 'error', error: e.message }); throw e; })
    .finally(() => preparing.delete(t.id));
  preparing.set(t.id, p);
  return p;
}
function prefetchNext() {
  const ni = nextIndex(true);
  if (ni !== null && P.queue[ni] && P.queue[ni].status !== 'ready') prepare(P.queue[ni]).catch(() => { });
}

/* ---------- transport */
async function playIndex(i, { autoplay = true, startAt = 0 } = {}) {
  if (i < 0 || i >= P.queue.length) return;
  const token = ++P.token;
  P.index = i; P.crossfading = false; P.counted = false; P.resumeAt = 0;
  const t = P.queue[i];
  stopFades();
  const other = 1 - active;
  decks[other].pause(); levels[other] = 0;
  setLoading(true); renderNow(); saveSession();
  try { await prepare(t); }
  catch (e) {
    if (token !== P.token) return;
    setLoading(false);
    toast(`Couldn't play “${t.title}”. ${e.message}`, { error: true, ms: 7000 });
    if (autoplay && P.errSkips < 3 && nextIndex(true) !== null) { P.errSkips++; next(true); }
    return;
  }
  if (token !== P.token) return;
  P.errSkips = 0;
  const d = decks[active];
  d.src = audioUrl(t);
  d.defaultPlaybackRate = d.playbackRate = settings.speed;
  levels[active] = 1; applyLevels();
  if (startAt > 0) d.addEventListener('loadedmetadata', () => { d.currentTime = startAt; }, { once: true });
  if (autoplay) {
    try { initAudioGraph(); await actx?.resume?.(); await d.play(); }
    catch (e) { if (e.name !== 'AbortError') toast('Press play to start listening'); }
  }
  if (token !== P.token) return;
  setLoading(false); renderNow(); updateMediaSession(); prefetchNext();
  if (lyricsVisible()) loadLyrics();
}

function nextIndex(auto = false) {
  if (!P.queue.length) return null;
  if (P.index + 1 < P.queue.length) return P.index + 1;
  if (settings.repeat === 'all') return 0;
  return null;
}
function next(auto = false) {
  const ni = nextIndex(auto);
  if (ni === null) { if (!auto) toast("That's the end of your queue"); return; }
  playIndex(ni);
}
function prev() {
  const d = decks[active];
  if (d.currentTime > 3 || (P.index <= 0 && settings.repeat !== 'all')) { d.currentTime = 0; return; }
  playIndex(P.index > 0 ? P.index - 1 : P.queue.length - 1);
}
function togglePlay() {
  const t = current();
  if (!t) {
    if (P.queue.length) return playIndex(0);
    toast('Paste a link to start playing'); $$('[data-paste] input[type="url"]').find(i => i.offsetParent)?.focus(); return;
  }
  const d = decks[active];
  const src = d.getAttribute('src') || '';
  if (!src || src.startsWith('data:')) return playIndex(P.index, { startAt: P.resumeAt });
  if (d.paused) { initAudioGraph(); actx?.resume?.(); d.play().catch(() => { }); }
  else { d.pause(); decks[1 - active].pause(); }
}
function seekTo(sec) {
  const d = decks[active];
  if (isFinite(d.duration)) d.currentTime = clamp(sec, 0, d.duration - 0.1);
}
async function crossfadeTo(ni) {
  const t = P.queue[ni];
  if (t.status !== 'ready') { prepare(t).catch(() => { }); return; }
  P.crossfading = true;
  const old = active, nw = 1 - active, d = decks[nw];
  d.src = audioUrl(t);
  d.defaultPlaybackRate = d.playbackRate = settings.speed;
  levels[nw] = 0; applyLevels();
  try { await d.play(); } catch { P.crossfading = false; return; }
  const ms = Math.max(400, (decks[old].duration - decks[old].currentTime) * 1000);
  active = nw; P.index = ni; P.counted = false; P.token++;
  renderNow(); updateMediaSession(); saveSession(); prefetchNext();
  if (lyricsVisible()) loadLyrics();
  fade(nw, 1, ms);
  await fade(old, 0, ms);
  decks[old].pause();
  P.crossfading = false;
}

function onTime() {
  const d = decks[active], t = current();
  if (!t) return;
  const dur = isFinite(d.duration) ? d.duration : (t.duration || 0);
  updateProgress(d.currentTime, dur);
  highlightLyrics(d.currentTime);
  if (!P.counted && d.currentTime > Math.min(30, (dur || 60) * 0.5)) {
    P.counted = true;
    t.play_count = (t.play_count || 0) + 1;
    api(`/tracks/${encodeURIComponent(t.id)}/played`, { method: 'POST' }).catch(() => { });
  }
  if (settings.crossfade > 0 && !P.crossfading && settings.repeat !== 'one' && !P.sleepEndOfTrack &&
    dur > settings.crossfade * 2 && dur - d.currentTime <= settings.crossfade) {
    const ni = nextIndex(true);
    if (ni !== null && ni !== P.index) crossfadeTo(ni);
  }
  const now = Date.now();
  if (now - P.lastPos > 1000 && 'mediaSession' in navigator && dur) {
    P.lastPos = now;
    try { navigator.mediaSession.setPositionState({ duration: dur, position: Math.min(d.currentTime, dur), playbackRate: d.playbackRate }); } catch { }
  }
  if (now - P.lastSave > 5000) { P.lastSave = now; saveSession(); }
}
function onEnded() {
  if (P.sleepEndOfTrack) { cancelSleep(); setPlaying(false); toast('Sleep timer stopped playback'); return; }
  if (settings.repeat === 'one') { const d = decks[active]; d.currentTime = 0; d.play(); P.counted = false; return; }
  const ni = nextIndex(true);
  if (ni === null) { setPlaying(false); return; }
  playIndex(ni);
}
decks.forEach((d, i) => {
  d.addEventListener('timeupdate', () => { if (i === active) onTime(); });
  d.addEventListener('play', () => { if (i === active) setPlaying(true); });
  d.addEventListener('pause', () => { if (i === active) setPlaying(false); });
  d.addEventListener('ended', () => { if (i === active) onEnded(); });
  d.addEventListener('waiting', () => { if (i === active) setLoading(true); });
  d.addEventListener('playing', () => { if (i === active) setLoading(false); });
  d.addEventListener('loadedmetadata', () => { if (i === active) onTime(); });
  d.addEventListener('error', () => {
    const src = d.getAttribute('src') || '';
    if (i === active && src && !src.startsWith('data:')) {
      setLoading(false);
      toast("This song stopped loading. Try playing it again.", { error: true });
    }
  });
});

/* ---------- queue operations */
function playList(list, start = 0, { from = '', shuffle } = {}) {
  if (!list || !list.length) return;
  if (shuffle !== undefined) { settings.shuffle = shuffle; saveSettings(); }
  P.from = from;
  const tracks = list.slice();
  if (settings.shuffle) {
    P.original = tracks;
    const first = tracks[start];
    P.queue = [first, ...shuffleArr(tracks.filter((_, i) => i !== start))];
    playIndex(0);
  } else {
    P.original = null; P.queue = tracks; playIndex(start);
  }
  renderModes(); renderPanel();
}
function playNow(t) {
  if (!current()) { P.queue = [t]; P.original = null; P.from = ''; return playIndex(0); }
  P.queue.splice(P.index + 1, 0, t);
  if (P.original) P.original.push(t);
  playIndex(P.index + 1);
  renderPanel();
}
function playNextTracks(ts) {
  if (!current()) return playList(ts, 0);
  P.queue.splice(P.index + 1, 0, ...ts);
  if (P.original) P.original.push(...ts);
  renderPanel(); saveSession(); prefetchNext();
  toast(ts.length > 1 ? `${ts.length} songs will play next` : `“${ts[0].title}” will play next`);
}
function addToQueue(ts) {
  P.queue.push(...ts);
  if (P.original) P.original.push(...ts);
  renderPanel(); saveSession();
  toast(ts.length > 1 ? `Added ${ts.length} songs to the queue` : 'Added to queue');
}
function removeFromQueue(qi) {
  if (qi === P.index) return;
  const [t] = P.queue.splice(qi, 1);
  if (qi < P.index) P.index--;
  if (P.original) { const k = P.original.findIndex(x => x.id === t.id); if (k >= 0) P.original.splice(k, 1); }
  renderPanel(); saveSession();
}
function moveInQueue(from, to) {
  if (from === to) return;
  const cur = current();
  const [t] = P.queue.splice(from, 1);
  P.queue.splice(to > from ? to - 1 : to, 0, t);
  P.index = P.queue.indexOf(cur);
  renderPanel(); saveSession();
}
function clearUpcoming() {
  P.queue = P.queue.slice(0, P.index + 1);
  P.original = null;
  renderPanel(); saveSession();
}
function toggleShuffle() {
  settings.shuffle = !settings.shuffle; saveSettings();
  const cur = current();
  if (settings.shuffle) {
    P.original = P.queue.slice();
    const rest = shuffleArr(P.queue.filter((_, i) => i !== P.index));
    P.queue = cur ? [cur, ...rest] : rest;
    P.index = cur ? 0 : -1;
  } else if (P.original) {
    P.queue = P.original; P.original = null;
    P.index = cur ? Math.max(0, P.queue.findIndex(t => t.id === cur.id)) : -1;
  }
  renderModes(); renderPanel(); saveSession(); prefetchNext();
  toast(settings.shuffle ? 'Shuffle on' : 'Shuffle off');
}
function cycleRepeat() {
  settings.repeat = { off: 'all', all: 'one', one: 'off' }[settings.repeat] || 'off';
  saveSettings(); renderModes();
  toast({ off: 'Repeat off', all: 'Repeating the queue', one: 'Repeating this song' }[settings.repeat]);
}
function setSpeed(v) {
  settings.speed = v; saveSettings();
  decks.forEach(d => { d.defaultPlaybackRate = d.playbackRate = v; });
  $('#npSpeed').textContent = `${v}×`;
  renderPanelIf('sound');
}

/* ---------- sleep timer */
function cancelSleep() {
  clearTimeout(P.sleepTimer); clearInterval(P.sleepTick);
  P.sleepTimer = null; P.sleepAt = 0; P.sleepEndOfTrack = false;
  $('#sleepBadge').hidden = true; $('#sleepBtn').classList.remove('on');
}
function setSleep(min) {
  cancelSleep();
  if (min === 'end') {
    P.sleepEndOfTrack = true;
    $('#sleepBadge').textContent = 'end';
  } else {
    P.sleepAt = Date.now() + min * 60000;
    P.sleepTimer = setTimeout(async () => {
      const a = active;
      await fade(a, 0, 5000);
      decks.forEach(d => d.pause());
      levels[a] = 1; applyLevels(); cancelSleep();
      toast('Sleep timer stopped playback');
    }, min * 60000);
    const tick = () => { $('#sleepBadge').textContent = Math.max(1, Math.ceil((P.sleepAt - Date.now()) / 60000)) + 'm'; };
    tick(); P.sleepTick = setInterval(tick, 20000);
  }
  $('#sleepBadge').hidden = false; $('#sleepBtn').classList.add('on');
  toast(min === 'end' ? 'Playback stops after this song' : `Playback stops in ${min} minutes`);
}
function sleepMenu(anchor) {
  const items = [5, 15, 30, 45, 60, 90].map(m => ({ label: `${m} minutes`, icon: 'clock', action: () => setSleep(m) }));
  items.push({ label: 'End of this song', icon: 'music', action: () => setSleep('end') });
  if (P.sleepTimer || P.sleepEndOfTrack) items.push({ sep: true }, { label: 'Turn off sleep timer', icon: 'x', action: () => { cancelSleep(); toast('Sleep timer off'); } });
  openMenu([{ title: 'Stop playing in…' }, ...items], anchor);
}

/* ---------- session persistence */
function saveSession() {
  if (!settings.resume) return;
  const strip = t => { const { error, ...rest } = t; return rest; };
  store('session', {
    queue: P.queue.slice(0, 500).map(strip), index: P.index, from: P.from,
    time: decks[active].currentTime || P.resumeAt || 0,
    original: P.original ? P.original.slice(0, 500).map(strip) : null,
  });
}
function restoreSession() {
  const s = settings.resume && load('session');
  if (!s || !s.queue?.length) return;
  P.queue = s.queue; P.index = clamp(s.index, 0, s.queue.length - 1);
  P.original = s.original; P.from = s.from || ''; P.resumeAt = s.time || 0;
  const t = current();
  renderNow();
  updateProgress(P.resumeAt, t?.duration || 0);
}
addEventListener('pagehide', saveSession);

/* ---------- media session (lock screen, headphones, keyboard media keys) */
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const t = current();
  if (!t) return;
  const art = t.cover ? [{ src: new URL(t.cover, location.href).href, sizes: '512x512' }] : [];
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title || '', artist: t.artist || t.platform || '', album: t.album || P.from || 'AK Music Player', artwork: art });
}
if ('mediaSession' in navigator) {
  const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch { } };
  h('play', () => togglePlay()); h('pause', () => togglePlay());
  h('previoustrack', prev); h('nexttrack', () => next());
  h('seekto', e => seekTo(e.seekTime));
  h('seekbackward', e => seekTo(decks[active].currentTime - (e.seekOffset || 10)));
  h('seekforward', e => seekTo(decks[active].currentTime + (e.seekOffset || 10)));
  h('stop', () => decks.forEach(d => d.pause()));
}

/* ================================================================ player UI */
const playBtns = () => [$('#playBtn'), $('#npPlay')];
let lastNative = '';
function notifyNative() {
  if (!IN_APP) return;
  const t = current();
  const st = t ? { title: t.title || '', artist: t.artist || t.platform || '', playing: P.playing,
    cover: t.cover ? new URL(t.cover, location.href).href : '' } : { title: '', artist: '', playing: false, cover: '' };
  const key = JSON.stringify(st);
  if (key === lastNative) return;
  lastNative = key;
  try { AKA.onState(key); } catch { }
}
function setPlaying(b) {
  P.playing = b;
  notifyNative();
  playBtns().forEach(btn => { setIcon(btn, P.loading ? 'loader' : b ? 'pause' : 'play'); btn.setAttribute('aria-label', b ? 'Pause' : 'Play'); });
  document.body.classList.toggle('paused', !b);
  document.body.classList.toggle('spinning', !!current());
  $$('.trow.playing .num button').forEach(btn => setIcon(btn, b ? 'pause' : 'play'));
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = b ? 'playing' : 'paused';
}
function setLoading(b) {
  P.loading = b;
  playBtns().forEach(btn => btn.classList.toggle('loading', b));
  setPlaying(P.playing);
}
function renderNow() {
  const t = current();
  const title = t ? t.title : 'Nothing playing';
  const artist = t ? (t.artist || t.platform || '') : 'Paste a link to start';
  $('#npTitle').textContent = title; $('#npBigTitle').textContent = title;
  $('#npArtist').textContent = artist; $('#npBigArtist').textContent = t ? artist : '';
  ['#npArt', '#npBigArt'].forEach(sel => {
    const img = $(sel);
    img.src = t?.cover || 'logo.png'; img.hidden = false;
    img.onerror = () => { img.onerror = null; img.src = 'logo.png'; };
  });
  $('#npBg').style.backgroundImage = t?.cover ? `url("${t.cover}")` : 'none';
  $('#npFrom').textContent = P.from ? `Playing from ${P.from}` : t ? `Playing from ${t.platform || 'your library'}` : '';
  ['#likeBtn', '#npLike'].forEach(s => $(s).setAttribute('aria-pressed', String(!!t?.liked)));
  document.title = t ? `${t.title}${t.artist ? ' – ' + t.artist : ''} | AK Music Player` : 'AK Music Player';
  markPlayingRows();
  setPlaying(P.playing);
  renderPanelIf('queue');
}
function markPlayingRows() {
  const id = current()?.id;
  $$('.trow[data-id]').forEach(r => {
    const on = r.dataset.id === id;
    r.classList.toggle('playing', on);
    const b = r.querySelector('.num button');
    if (b) setIcon(b, on && P.playing ? 'pause' : 'play');
  });
}
function renderModes() {
  ['#shuffleBtn', '#npShuffle'].forEach(s => { $(s).setAttribute('aria-pressed', String(settings.shuffle)); $(s).classList.toggle('on', settings.shuffle); });
  ['#repeatBtn', '#npRepeat'].forEach(s => {
    const b = $(s);
    setIcon(b, settings.repeat === 'one' ? 'repeat1' : 'repeat');
    b.classList.toggle('on', settings.repeat !== 'off');
    b.setAttribute('aria-label', `Repeat: ${settings.repeat}`);
  });
  $('#npSpeed').textContent = `${settings.speed}×`;
}
let seeking = false;
function updateProgress(cur, dur) {
  const pct = dur ? (cur / dur) * 100 : 0;
  if (!seeking) {
    ['#seekBar', '#npSeek'].forEach(s => { const r = $(s); r.value = dur ? Math.round((cur / dur) * 1000) : 0; r.style.setProperty('--p', pct + '%'); });
  }
  $('#curTime').textContent = $('#npCur').textContent = fmtTime(cur);
  $('#durTime').textContent = $('#npDur').textContent = fmtTime(dur);
  $('#miniProgress').style.width = pct + '%';
}
function renderVolume() {
  const v = Math.round(settings.volume * 100);
  const r = $('#volBar'); r.value = settings.muted ? 0 : v; r.style.setProperty('--p', (settings.muted ? 0 : v) + '%');
  setIcon($('#muteBtn'), settings.muted || v === 0 ? 'mute' : v < 50 ? 'volumeLow' : 'volume');
}
function setVolume(v) { settings.volume = clamp(v, 0, 1); settings.muted = false; saveSettings(); applyLevels(); renderVolume(); }
function toggleMute() { settings.muted = !settings.muted; saveSettings(); applyLevels(); renderVolume(); }

// seek bars
['#seekBar', '#npSeek'].forEach(sel => {
  const r = $(sel);
  r.addEventListener('input', () => {
    seeking = true;
    const d = decks[active], dur = isFinite(d.duration) ? d.duration : (current()?.duration || 0);
    r.style.setProperty('--p', r.value / 10 + '%');
    $('#curTime').textContent = $('#npCur').textContent = fmtTime((r.value / 1000) * dur);
  });
  r.addEventListener('change', () => {
    const d = decks[active];
    seeking = false;
    if (!current()) return;
    if (isFinite(d.duration)) seekTo((r.value / 1000) * d.duration);
    else P.resumeAt = (r.value / 1000) * (current().duration || 0);
  });
});
$('#volBar').addEventListener('input', e => setVolume(e.target.value / 100));

/* ================================================================ lyrics */
const L = { id: null, lines: null, plain: null, instrumental: false, loading: false, cur: -1 };
const lyricsVisible = () => (P.panel === 'lyrics' && !$('#panel').hidden) || (!$('#nowPlaying').hidden && !$('#npLyrics').hidden);
function parseLRC(s) {
  const out = [];
  for (const line of s.split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) continue;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) out.push({ t: +m[1] * 60 + +m[2], text });
  }
  return out.sort((a, b) => a.t - b.t);
}
async function loadLyrics(force = false) {
  const t = current();
  if (!t) { Object.assign(L, { id: null, lines: null, plain: null }); return renderLyrics(); }
  if (L.id === t.id && !force) return renderLyrics();
  Object.assign(L, { id: t.id, lines: null, plain: null, instrumental: false, loading: true, cur: -1 });
  renderLyrics();
  try {
    const r = await api(`/tracks/${encodeURIComponent(t.id)}/lyrics`);
    if (L.id !== t.id) return;
    L.lines = r.synced ? parseLRC(r.synced) : null;
    L.plain = r.plain; L.instrumental = r.instrumental;
  } catch { }
  L.loading = false;
  renderLyrics();
}
function lyricsHTML() {
  if (!current()) return '<div class="empty"><p>Play something to see its lyrics.</p></div>';
  if (L.loading) return '<p style="color:var(--muted)"><span class="spinner"></span> Finding lyrics…</p>';
  if (L.lines?.length) return `<div class="lyrics">${L.lines.map((l, i) => `<p data-t="${l.t}" data-li="${i}">${esc(l.text) || '♪'}</p>`).join('')}</div>`;
  if (L.plain) return `<div class="lyrics plain">${L.plain.split('\n').map(l => `<p>${esc(l) || '&nbsp;'}</p>`).join('')}</div>`;
  if (L.instrumental) return '<div class="empty"><h3>Instrumental</h3><p>No words in this one. Enjoy.</p></div>';
  return `<div class="empty"><h3>No lyrics found</h3><p>Lyrics are matched by song title and artist. If the title includes extra words, edit the song details and try again.</p>
    <button class="ghost-btn" data-act="edit-current">Edit song details</button></div>`;
}
function renderLyrics() {
  if (P.panel === 'lyrics' && !$('#panel').hidden) { $('#panelBody').innerHTML = lyricsHTML(); }
  if (!$('#npLyrics').hidden) $('#npLyrics').innerHTML = lyricsHTML();
  L.cur = -1;
  highlightLyrics(decks[active].currentTime);
}
function highlightLyrics(time) {
  if (!L.lines || L.id !== current()?.id) return;
  let idx = -1;
  for (let i = 0; i < L.lines.length; i++) { if (L.lines[i].t <= time + 0.25) idx = i; else break; }
  if (idx === L.cur) return;
  L.cur = idx;
  $$('.lyrics').forEach(box => {
    const ps = box.children;
    for (let i = 0; i < ps.length; i++) { ps[i].classList.toggle('now', i === idx); ps[i].classList.toggle('past', i < idx); }
    const el = ps[idx];
    const scroller = box.closest('.panel-body, .np-lyrics');
    if (el && scroller) scroller.scrollTo({ top: el.offsetTop - scroller.offsetTop - scroller.clientHeight / 2.6, behavior: 'smooth' });
  });
}
document.addEventListener('click', e => {
  const p = e.target.closest('.lyrics p[data-t]');
  if (p) seekTo(+p.dataset.t);
  if (e.target.closest('[data-act="edit-current"]') && current()) editTrack(current());
});

/* ================================================================ visualizer */
let vizRaf = 0, vizAccent = null;
const vizData = new Uint8Array(128);
function vizLoop() {
  const c = $('#viz'), g = c.getContext('2d'), W = c.width, cx = W / 2;
  if (!vizAccent) vizAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  g.clearRect(0, 0, W, W);
  if (analyser && P.playing) analyser.getByteFrequencyData(vizData); else vizData.fill(0);
  const bars = 120, r0 = W * 0.415;
  g.strokeStyle = vizAccent; g.lineCap = 'round'; g.lineWidth = W / 200;
  for (let i = 0; i < bars; i++) {
    const k = i < bars / 2 ? i : bars - 1 - i;
    const v = vizData[Math.floor((k * vizData.length * 0.72) / (bars / 2))] / 255;
    const len = W * 0.008 + v * v * W * 0.075;
    const a = (i / bars) * Math.PI * 2 - Math.PI / 2;
    g.globalAlpha = 0.25 + 0.75 * v;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * (r0 + len), cx + Math.sin(a) * (r0 + len));
    g.stroke();
  }
  g.globalAlpha = 1;
  vizRaf = requestAnimationFrame(vizLoop);
}

/* ================================================================ toasts / menus / modals */
function toast(msg, { error = false, ms = 3800, sticky = false, html = false, action } = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '');
  el.setAttribute('role', error ? 'alert' : 'status');
  const span = document.createElement('span');
  if (html) span.innerHTML = msg; else span.textContent = msg;
  el.append(span);
  if (action) {
    const b = document.createElement('button');
    b.textContent = action[0];
    b.onclick = () => { action[1](); el.remove(); };
    el.append(b);
  }
  $('#toasts').append(el);
  const all = $$('.toast:not(.sticky)', $('#toasts'));
  if (all.length > 2) all.slice(0, all.length - 2).forEach(x => x.remove());
  if (sticky) el.classList.add('sticky');
  if (!sticky) setTimeout(() => el.remove(), ms);
  return el;
}

let menuAnchor = null;
function openMenu(items, anchor) {
  const m = $('#menu');
  const build = list => {
    m.innerHTML = '';
    for (const it of list) {
      if (it.sep) { m.append(document.createElement('hr')); continue; }
      if (it.title) { const d = document.createElement('div'); d.className = 'menu-title'; d.textContent = it.title; m.append(d); continue; }
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem');
      if (it.danger) b.className = 'danger';
      b.innerHTML = `${ic(it.icon || 'music')}<span style="flex:1">${esc(it.label)}</span>${it.sub ? ic('right') : it.checked ? ic('check') : ''}`;
      b.onclick = async e => {
        e.stopPropagation();
        if (it.sub) {
          const sub = await it.sub();
          build([{ label: 'Back', icon: 'back', back: true, action: () => build(list) }, { sep: true }, ...sub]);
          return;
        }
        if (it.back) return it.action();
        closeMenu();
        it.action?.();
      };
      m.append(b);
    }
    m.hidden = false;
    position();
    m.querySelector('button')?.focus({ preventScroll: true });
  };
  const position = () => {
    const r = anchor instanceof Event
      ? { left: anchor.clientX, right: anchor.clientX, top: anchor.clientY, bottom: anchor.clientY }
      : anchor.getBoundingClientRect();
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let x = r.right - mw, y = r.bottom + 6;
    if (anchor instanceof Event) { x = r.left; y = r.top; }
    if (x < 8) x = 8;
    if (x + mw > innerWidth - 8) x = innerWidth - mw - 8;
    if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 6);
    m.style.left = x + 'px'; m.style.top = y + 'px';
  };
  menuAnchor = anchor;
  build(items);
}
function closeMenu() {
  $('#menu').hidden = true;
  if (menuAnchor && !(menuAnchor instanceof Event)) menuAnchor.focus?.({ preventScroll: true });
  menuAnchor = null;
}
document.addEventListener('pointerdown', e => { if (!$('#menu').hidden && !e.target.closest('#menu')) closeMenu(); });
$('#menu').addEventListener('keydown', e => {
  const bs = $$('#menu button'), i = bs.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length]?.focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length]?.focus(); }
});

function modal(html, onMount) {
  return new Promise(resolve => {
    const wrap = $('#modal'), box = wrap.firstElementChild;
    box.innerHTML = html;
    wrap.hidden = false;
    const done = v => { wrap.hidden = true; box.innerHTML = ''; resolve(v); };
    box.querySelector('[data-cancel]')?.addEventListener('click', () => done(null));
    wrap.onclick = e => { if (e.target === wrap) done(null); };
    wrap.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    onMount(box, done);
    (box.querySelector('input,textarea,button.primary-btn,button.danger-btn'))?.focus();
  });
}
function formModal({ title, fields, submit = 'Save' }) {
  return modal(`<form><h2>${esc(title)}</h2>
    ${fields.map(f => `<label for="mf-${f.name}">${esc(f.label)}</label>${f.type === 'textarea'
      ? `<textarea id="mf-${f.name}" name="${f.name}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`
      : `<input type="text" id="mf-${f.name}" name="${f.name}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" ${f.required ? 'required' : ''}>`}`).join('')}
    <div class="btns"><button type="button" class="ghost-btn" data-cancel>Cancel</button><button class="primary-btn">${esc(submit)}</button></div></form>`,
    (box, done) => {
      box.querySelector('form').onsubmit = e => {
        e.preventDefault();
        done(Object.fromEntries(new FormData(e.target).entries()));
      };
    });
}
function confirmModal(title, text, ok = 'Delete') {
  return modal(`<h2>${esc(title)}</h2><p style="color:var(--muted);margin:0 0 16px">${esc(text)}</p>
    <div class="btns"><button class="ghost-btn" data-cancel>Cancel</button><button class="danger-btn" data-ok>${esc(ok)}</button></div>`,
    (box, done) => { box.querySelector('[data-ok]').onclick = () => done(true); });
}

/* ================================================================ library data helpers */
const lists = {};
let listSeq = 0;
function reg(tracks, ctx = {}) { const k = 'l' + (++listSeq); lists[k] = { tracks, ctx, from: ctx.from || '' }; return k; }
function allKnownTracks() {
  const out = [...P.queue, ...(P.original || [])];
  Object.values(lists).forEach(l => out.push(...l.tracks));
  return out;
}
function syncTrack(u) {
  allKnownTracks().forEach(t => { if (t && t.id === u.id) Object.assign(t, u); });
  $$(`[data-id="${CSS.escape(u.id)}"] .like-btn`).forEach(b => b.setAttribute('aria-pressed', String(!!u.liked)));
  if (current()?.id === u.id) {
    ['#likeBtn', '#npLike'].forEach(s => $(s).setAttribute('aria-pressed', String(!!current().liked)));
  }
}
async function toggleLike(t) {
  if (!t) return;
  const liked = !t.liked;
  syncTrack({ ...t, liked });
  try {
    syncTrack(await api(`/tracks/${encodeURIComponent(t.id)}`, { method: 'PATCH', body: { liked } }));
    toast(liked ? 'Added to Liked songs' : 'Removed from Liked songs');
    if (currentRoute().name === 'liked' && !liked) route();
  } catch (e) { syncTrack({ ...t, liked: !liked }); toast(e.message, { error: true }); }
}
async function editTrack(t) {
  const v = await formModal({
    title: 'Edit song details', fields: [
      { name: 'title', label: 'Title', value: t.title, required: true },
      { name: 'artist', label: 'Artist', value: t.artist },
      { name: 'album', label: 'Album', value: t.album },
    ]
  });
  if (!v) return;
  try {
    const u = await api(`/tracks/${encodeURIComponent(t.id)}`, { method: 'PATCH', body: v });
    syncTrack(u);
    if (isCurrent(t)) { renderNow(); updateMediaSession(); if (lyricsVisible()) loadLyrics(true); }
    toast('Saved'); route();
  } catch (e) { toast(e.message, { error: true }); }
}
async function deleteTrack(t) {
  if (!await confirmModal('Remove from library?', `“${t.title}” will be removed from your library, playlists and history.`, 'Remove')) return;
  try {
    await api(`/tracks/${encodeURIComponent(t.id)}`, { method: 'DELETE' });
    toast('Removed from library');
    refreshPlaylists(); route();
  } catch (e) { toast(e.message, { error: true }); }
}
function filenameFrom(cd) {
  if (!cd) return null;
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (m) return decodeURIComponent(m[1]);
  const n = cd.match(/filename="([^"]+)"/i);
  return n ? n[1] : null;
}
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
async function downloadTrack(t, fmt = 'mp3') {
  const label = fmt === 'original' ? 'file' : fmt.toUpperCase();
  if (IN_APP) {
    const url = new URL(`/api/tracks/${encodeURIComponent(t.id)}/download?format=${fmt}`, location.href).href;
    const ext = fmt === 'original' ? (t.ext || '.m4a') : '.' + fmt;
    try { AKA.download(url, `${t.artist ? t.artist + ' - ' : ''}${t.title}${ext}`); toast(`Downloading ${label}. You'll find it in Downloads/AK Music Player`, { ms: 5000 }); }
    catch (e) { toast(e.message, { error: true }); }
    return;
  }
  const tst = toast(`<span class="spinner"></span> Preparing ${label} of “${esc(t.title)}”…`, { sticky: true, html: true });
  try {
    const r = await fetch(`/api/tracks/${encodeURIComponent(t.id)}/download?format=${fmt}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Download failed');
    const blob = await r.blob();
    saveBlob(blob, filenameFrom(r.headers.get('Content-Disposition')) || `${t.title}.${fmt}`);
    syncTrack({ id: t.id, status: 'ready' });
    toast(`Downloaded “${t.title}”`);
  } catch (e) { toast(e.message, { error: true }); }
  finally { tst.remove(); }
}
const ALL_FORMATS = [['mp3', 'MP3 (320 kbps)'], ['m4a', 'M4A / AAC'], ['flac', 'FLAC (lossless container)'], ['original', 'Original file (no conversion)']];
const formatsAvailable = () => {
  const ok = S.health?.formats;
  if (!ok) return ALL_FORMATS;
  if (ok.length === 1) return [['original', 'Original quality (M4A / audio file)']];
  return ALL_FORMATS.filter(([f]) => ok.includes(f));
};
const downloadSub = t => formatsAvailable().map(([f, l]) => ({ label: l, icon: 'download', action: () => downloadTrack(t, f) }));
function downloadPlaylist(p, fmt = 'mp3') {
  toast(`Building a zip of “${p.name}”. The download starts when it's ready — long playlists take a while.`, { ms: 8000 });
  if (IN_APP) { try { AKA.download(new URL(`/api/playlists/${p.id}/download?format=${fmt}`, location.href).href, `${p.name}.zip`); } catch { } return; }
  const a = document.createElement('a');
  a.href = `/api/playlists/${p.id}/download?format=${fmt}`;
  document.body.append(a); a.click(); a.remove();
}

async function refreshPlaylists() {
  try { S.playlists = await api('/playlists'); } catch { S.playlists = []; }
  renderSidebar();
}
async function createPlaylist(trackIds = []) {
  const v = await formModal({ title: 'New playlist', submit: 'Create', fields: [
    { name: 'name', label: 'Name', placeholder: 'Road trip, Focus, Gym…', required: true },
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Optional' },
  ] });
  if (!v) return null;
  try {
    const p = await api('/playlists', { method: 'POST', body: v });
    if (trackIds.length) await api(`/playlists/${p.id}/tracks`, { method: 'POST', body: { track_ids: trackIds } });
    await refreshPlaylists();
    toast(trackIds.length ? `Created “${p.name}” and added ${trackIds.length > 1 ? trackIds.length + ' songs' : 'the song'}` : `Created “${p.name}”`);
    return p;
  } catch (e) { toast(e.message, { error: true }); return null; }
}
async function addToPlaylist(pid, tracks) {
  try {
    const r = await api(`/playlists/${pid}/tracks`, { method: 'POST', body: { track_ids: tracks.map(t => t.id) } });
    toast(r.added ? `Added to “${r.playlist.name}”` : `Already in “${r.playlist.name}”`);
    refreshPlaylists();
    if (currentRoute().name === 'playlist' && currentRoute().id === pid) route();
  } catch (e) { toast(e.message, { error: true }); }
}
const playlistSub = tracks => () => [
  { label: 'New playlist…', icon: 'plus', action: () => createPlaylist(tracks.map(t => t.id)) },
  ...(S.playlists.length ? [{ sep: true }] : []),
  ...S.playlists.map(p => ({ label: p.name, icon: 'list', action: () => addToPlaylist(p.id, tracks) })),
];
function trackMenu(t, ctx = {}) {
  const items = [
    { label: isCurrent(t) && P.playing ? 'Pause' : 'Play', icon: isCurrent(t) && P.playing ? 'pause' : 'play', action: () => isCurrent(t) ? togglePlay() : playNow(t) },
    { label: 'Play next', icon: 'playNext', action: () => playNextTracks([t]) },
    { label: 'Add to queue', icon: 'queue', action: () => addToQueue([t]) },
    { label: 'Add to playlist', icon: 'plus', sub: playlistSub([t]) },
    { label: t.liked ? 'Remove from Liked songs' : 'Add to Liked songs', icon: 'heart', action: () => toggleLike(t) },
    { sep: true },
    { label: 'Download', icon: 'download', sub: () => downloadSub(t) },
    { label: 'Edit / trim song', icon: 'scissors', action: () => { location.hash = `#/edit/${encodeURIComponent(t.id)}`; } },
    { label: 'Combine with other songs', icon: 'merge', action: () => { location.hash = `#/combine?ids=${encodeURIComponent(t.id)}`; } },
    { label: 'Edit details', icon: 'edit', action: () => editTrack(t) },
  ];
  if (t.artist) items.push({ label: `More by ${t.artist}`, icon: 'user', action: () => { location.hash = `#/library?q=${encodeURIComponent(t.artist)}`; } });
  if (!t.source_url?.startsWith('upload://')) {
    items.push({ label: 'Open original link', icon: 'external', action: () => openExternal(t.source_url) });
    items.push({ label: 'Copy link', icon: 'copy', action: () => { if (IN_APP) { AKA.copy(t.source_url); toast('Link copied'); } else navigator.clipboard?.writeText(t.source_url).then(() => toast('Link copied')); } });
  }
  if (t.status === 'error') items.push({ label: 'Try loading again', icon: 'refresh', action: () => { t.status = 'new'; playNow(t); } });
  items.push({ sep: true });
  if (ctx.playlistId) items.push({ label: 'Remove from this playlist', icon: 'x', action: async () => {
    await api(`/playlists/${ctx.playlistId}/tracks/${encodeURIComponent(t.id)}`, { method: 'DELETE' }).catch(e => toast(e.message, { error: true }));
    toast('Removed from playlist'); refreshPlaylists(); route();
  } });
  if (ctx.queueIndex !== undefined && ctx.queueIndex !== P.index) items.push({ label: 'Remove from queue', icon: 'x', action: () => removeFromQueue(ctx.queueIndex) });
  items.push({ label: 'Remove from library', icon: 'trash', danger: true, action: () => deleteTrack(t) });
  return items;
}

/* ================================================================ adding links & files */
async function addLink(raw, { mode = settings.onPaste, playlistId } = {}) {
  const url = (raw || '').trim();
  if (!url) return;
  if (!/https?:\/\//i.test(url)) { toast('Paste a full link that starts with http:// or https://', { error: true }); return; }
  $$('[data-paste]').forEach(f => f.classList.add('busy'));
  const tst = toast('<span class="spinner"></span> Looking up that link…', { sticky: true, html: true });
  const musicApp = /spotify|music\.apple|music\.amazon|amazon\.[a-z.]+\/music|deezer|tidal|gaana|wynk|hungama|resso|boomplay|anghami|shazam/i.test(url);
  try {
    const r = await api('/add', { method: 'POST', body: { url, playlist_id: playlistId || null } });
    $$('[data-paste] input[type="url"]').forEach(i => { i.value = ''; });
    const n = r.tracks.length;
    if (r.playlist) {
      await refreshPlaylists();
      toast(`Saved playlist “${r.playlist.name}” with ${r.playlist.track_count} songs` + (musicApp ? '. Each song is found on YouTube when you play it.' : ''), { ms: musicApp ? 6000 : 3800 });
      if (mode === 'play') playList(r.tracks, 0, { from: r.playlist.name });
      else if (mode === 'queue') addToQueue(r.tracks);
      location.hash = `#/playlist/${r.playlist.id}`;
      return;
    }
    if (playlistId) { await refreshPlaylists(); toast(n > 1 ? `Added ${n} songs` : `Added “${r.tracks[0].title}”`); route(); return; }
    if (mode === 'play') { n > 1 ? playList(r.tracks, 0) : playNow(r.tracks[0]); }
    else if (mode === 'queue') addToQueue(r.tracks);
    else toast(n > 1 ? `Saved ${n} songs to your library` : `Saved “${r.tracks[0].title}” to your library`);
    const rn = currentRoute().name;
    if (rn === 'home' || rn === 'library') route();
  } catch (e) {
    const site = /instagram/i.test(url) ? 'instagram' : /facebook|fb\.watch/i.test(url) ? 'facebook' : /(^|\/\/|\.)(x|twitter)\.com/i.test(url) ? 'x' : null;
    if (IN_APP && site && /signed in/i.test(e.message)) {
      toast(e.message, { error: true, ms: 12000, action: ['Sign in', () => AKA.signIn(site)] });
    } else toast(e.message, { error: true, ms: 8000 });
  } finally {
    tst.remove();
    $$('[data-paste]').forEach(f => f.classList.remove('busy'));
  }
}
async function uploadFiles(files) {
  if (!files.length) return;
  const tst = toast(`<span class="spinner"></span> Adding ${files.length} file${files.length > 1 ? 's' : ''}…`, { sticky: true, html: true });
  const added = [];
  for (const f of files) {
    const form = new FormData(); form.append('file', f);
    try { const r = await api('/upload', { method: 'POST', form }); added.push(...r.tracks); }
    catch (e) { toast(`${f.name}: ${e.message}`, { error: true }); }
  }
  tst.remove();
  if (!added.length) return;
  toast(`Added ${added.length} song${added.length > 1 ? 's' : ''} to your library`);
  if (!current()) playList(added, 0, { from: 'your uploads' });
  route();
}
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-paste]');
  if (!f) return;
  e.preventDefault();
  addLink(f.querySelector('input[type="url"]').value);
});
document.addEventListener('paste', e => {
  if (e.target.closest('input, textarea, [contenteditable]')) return;
  const text = e.clipboardData?.getData('text') || '';
  if (/https?:\/\//i.test(text)) { e.preventDefault(); addLink(text); }
});
$('#clipBtn').addEventListener('click', async () => {
  try {
    const text = IN_APP ? AKA.getClipboard() : await navigator.clipboard.readText();
    if (!text) return toast('Your clipboard is empty');
    $('#pasteInput').value = text;
    addLink(text);
  } catch { toast('Allow clipboard access, or paste with Ctrl+V / ⌘V', { error: true }); }
});
$('#uploadInput').addEventListener('change', e => { uploadFiles([...e.target.files]); e.target.value = ''; });

/* ================================================================ rendering pieces */
const hueOf = s => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
const genArt = name => `<div class="ph-art gen" style="--h:${hueOf(name)}"><span>${esc((String(name || '♪').trim()[0] || '♪').toUpperCase())}</span></div>`;
function art(t, cls = '') {
  return t.cover
    ? `<img src="${esc(t.cover)}" alt="" loading="lazy" class="${cls}" data-name="${esc(t.title)}" onerror="imgFail(this)">`
    : genArt(t.title);
}
window.imgFail = img => { const d = document.createElement('div'); d.innerHTML = img.dataset.name ? genArt(img.dataset.name) : `<div class="ph-art">${ic('music')}</div>`; img.replaceWith(d.firstElementChild); };
function mosaic(covers, size = '', name = '') {
  if (!covers || !covers.length) return `<div class="mosaic one" style="${size}">${name ? genArt(name) : `<div class="ph-art">${ic('music')}</div>`}</div>`;
  if (covers.length < 4) return `<div class="mosaic one" style="${size}"><img src="${esc(covers[0])}" alt="" loading="lazy" onerror="imgFail(this)"></div>`;
  return `<div class="mosaic" style="${size}">${covers.slice(0, 4).map(c => `<img src="${esc(c)}" alt="" loading="lazy" onerror="imgFail(this)">`).join('')}</div>`;
}
function trackRow(t, i, key, { when = false, sortable = false } = {}) {
  const cur = isCurrent(t);
  return `<div class="trow${cur ? ' playing' : ''}" data-list="${key}" data-i="${i}" data-pos="${i}" data-id="${esc(t.id)}" data-action="play" ${sortable ? 'draggable="true"' : ''}>
    <div class="num"><span>${i + 1}</span><button data-action="play" aria-label="Play ${esc(t.title)}">${ic(cur && P.playing ? 'pause' : 'play')}</button></div>
    <div class="thumb">${art(t)}</div>
    <div style="min-width:0"><div class="tt">${esc(t.title)}</div>
      <div class="ta">${t.artist ? `<span data-action="artist" data-artist="${esc(t.artist)}" role="link" tabindex="0">${esc(t.artist)}</span>` : esc(t.platform || '')}${t.status === 'error' ? '<span class="err"> · couldn\'t load</span>' : ''}</div></div>
    <div class="src">${when ? esc(ago(t.played_at)) : esc(t.album || t.platform || '')}</div>
    <div class="when">${when ? esc(t.platform || '') : esc(ago(t.added_at))}</div>
    <div class="dur">${t.duration ? fmtTime(t.duration) : ''}</div>
    <button class="icon-btn sm like-btn" data-action="like" aria-pressed="${!!t.liked}" aria-label="Like">${ic('heart')}</button>
    <button class="icon-btn sm" data-action="menu" aria-label="More options for ${esc(t.title)}">${ic('more')}</button>
  </div>`;
}
function trackList(tracks, ctx = {}, opts = {}) {
  const key = reg(tracks, ctx);
  return `<div class="tracks" data-key="${key}">
    <div class="trow thead"><div class="num">#</div><div></div><div>Title</div><div>${opts.when ? 'Played' : 'Album / source'}</div><div>${opts.when ? 'Source' : 'Added'}</div><div class="dur">${ic('clock')}</div><div></div><div></div></div>
    ${tracks.map((t, i) => trackRow(t, i, key, opts)).join('')}</div>`;
}
function shelf(title, tracks, link, ctx = {}) {
  if (!tracks || !tracks.length) return '';
  const key = reg(tracks, ctx);
  return `<section class="section"><h2>${esc(title)}${link ? `<a href="${link}">Show all</a>` : ''}</h2>
    <div class="shelf">${tracks.map((t, i) => `<article class="card" data-list="${key}" data-i="${i}" data-id="${esc(t.id)}" data-action="play" tabindex="0" aria-label="Play ${esc(t.title)}">
      <div class="art">${art(t)}</div><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist || t.platform || '')}</div>
      <button class="fab" data-action="play" aria-label="Play ${esc(t.title)}" tabindex="-1">${ic('play')}</button></article>`).join('')}</div></section>`;
}
function playlistCard(p) {
  return `<a class="card" href="#/playlist/${p.id}">${mosaic(p.covers, 'aspect-ratio:1;border-radius:10px', p.name)}
    <div class="t">${esc(p.name)}</div><div class="a">${p.track_count} song${p.track_count === 1 ? '' : 's'}</div>
    <button class="fab" data-action="play-playlist" data-pid="${p.id}" aria-label="Play ${esc(p.name)}">${ic('play')}</button></a>`;
}
function renderSidebar() {
  const r = currentRoute();
  $('#sidePlaylists').innerHTML = S.playlists.length
    ? S.playlists.map(p => `<a href="#/playlist/${p.id}" class="${r.name === 'playlist' && r.id === p.id ? 'active' : ''}">${mosaic(p.covers, '', p.name)}
        <span class="pl-name">${p.pinned ? '📌 ' : ''}${esc(p.name)}<span class="pl-sub">${p.track_count} song${p.track_count === 1 ? '' : 's'}</span></span></a>`).join('')
    : `<p style="color:var(--faint);font-size:14px;padding:4px 12px">Create a playlist, or paste a YouTube playlist link to import one.</p>`;
}

/* ================================================================ router & views */
const view = $('#view');
let routeToken = 0;
function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '') || 'home';
  const [path, qs] = h.split('?');
  const [name, id] = path.split('/');
  return { name: name || 'home', id, params: new URLSearchParams(qs || '') };
}
async function route() {
  const r = currentRoute();
  const token = ++routeToken;
  for (const k in lists) delete lists[k];
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === r.name || (r.name === 'playlist' && a.dataset.nav === 'playlists')));
  document.body.classList.toggle('on-home', r.name === 'home');
  renderSidebar();
  edCleanup();
  const views = { home: viewHome, library: viewLibrary, liked: viewLiked, history: viewHistory, playlist: viewPlaylist, playlists: viewPlaylists, settings: viewSettings,
    phone: viewPhone, edit: viewEdit, combine: viewCombine };
  try {
    const html = await (views[r.name] || viewHome)(r, token);
    if (token !== routeToken || html === undefined) return;
    view.innerHTML = html;
    hydrate(view);
    afterRender[r.name]?.(r);
  } catch (e) {
    if (token !== routeToken) return;
    view.innerHTML = `<div class="empty"><h3>Couldn't load this page</h3><p>${esc(e.message)}</p><button class="primary-btn" onclick="route()">Try again</button></div>`;
  }
  markPlayingRows();
}
const afterRender = {};

async function viewHome() {
  const h = await api('/home');
  const st = h.stats;
  const hero = `<section class="hero">
    <h1>What are we playing?</h1>
    <p>Paste or share a link from YouTube, Instagram, Spotify, Apple Music, Amazon Music or 1,000+ other sites. AK Music Player plays just the audio, with no ads, and keeps it in your library.</p>
    <form class="paste" data-paste autocomplete="off">${ic('link')}
      <input type="url" inputmode="url" placeholder="https://…" aria-label="Link to play">
      <label class="icon-btn sm" title="Add audio files" aria-label="Upload audio files">${ic('upload')}<input type="file" accept="audio/*" multiple hidden data-upload></label>
      <button class="primary-btn">Play</button></form>
    <div class="sources"><span>YouTube &amp; YouTube Music</span><span>Instagram reels</span><span>Spotify</span><span>Apple Music</span><span>Amazon Music</span><span>JioSaavn</span><span>Gaana</span><span>Wynk</span><span>SoundCloud</span><span>Deezer</span><span>TikTok</span><span>Playlists &amp; albums</span></div>
    ${st.tracks ? `<div class="stats"><div><b>${st.tracks}</b>song${st.tracks === 1 ? '' : 's'}</div><div><b>${st.plays}</b>play${st.plays === 1 ? '' : 's'}</div><div><b>${st.minutes.toLocaleString()}</b>minutes listened</div><div><b>${S.playlists.length}</b>playlist${S.playlists.length === 1 ? '' : 's'}</div></div>` : ''}
  </section>`;
  if (!st.tracks) {
    return hero + `<div class="section" style="color:var(--muted);max-width:60ch">
      <h2>Start your library</h2>
      <p>Every link you play is saved here. Tip: you can paste a link anywhere on the page with Ctrl+V / ⌘V, and paste a whole YouTube playlist to import it.</p></div>`;
  }
  return hero
    + shelf('Continue listening', h.recent, '#/history', { from: 'Continue listening' })
    + (S.playlists.length ? `<section class="section"><h2>Your playlists<a href="#/playlists">Show all</a></h2><div class="shelf">${S.playlists.slice(0, 10).map(playlistCard).join('')}</div></section>` : '')
    + shelf('Recently added', h.added, '#/library', { from: 'Recently added' })
    + shelf('On repeat', h.top, '#/library?sort=plays', { from: 'On repeat' })
    + (h.artists.length ? `<section class="section"><h2>Artists you play</h2><div class="artists">${h.artists.map(a =>
      `<button data-action="artist" data-artist="${esc(a.artist)}">${esc(a.artist)}<small>${a.tracks}</small></button>`).join('')}</div></section>` : '');
}
afterRender.home = () => {
  $('[data-upload]', view)?.addEventListener('change', e => { uploadFiles([...e.target.files]); e.target.value = ''; });
};

const lib = { q: '', sort: 'added', platform: '' };
async function viewLibrary(r) {
  lib.q = r.params.get('q') ?? lib.q;
  if (r.params.get('sort')) lib.sort = r.params.get('sort');
  const [tracks, all] = await Promise.all([
    api(`/tracks?q=${encodeURIComponent(lib.q)}&sort=${lib.sort}&platform=${encodeURIComponent(lib.platform)}`),
    api('/tracks'),
  ]);
  const platforms = [...new Set(all.map(t => t.platform).filter(Boolean))].sort();
  const total = tracks.reduce((s, t) => s + (t.duration || 0), 0);
  return `<div class="view-head"><div><h1>Library</h1><p class="sub">${tracks.length} song${tracks.length === 1 ? '' : 's'}${total ? ', ' + fmtLong(total) : ''}</p></div>
      <div class="actions"><button class="chip" data-act="play-all">${ic('play')}Play all</button><button class="chip" data-act="shuffle-all">${ic('shuffle')}Shuffle</button>
      <a class="chip" href="#/combine">${ic('merge')}Combine songs</a></div></div>
    <div class="toolbar">
      <div class="search">${ic('search')}<input id="libSearch" type="search" placeholder="Search songs, artists, albums" value="${esc(lib.q)}" aria-label="Search library"></div>
      <select class="select" id="libSort" aria-label="Sort by">${[['added', 'Recently added'], ['title', 'Title'], ['artist', 'Artist'], ['plays', 'Most played'], ['recent', 'Recently played'], ['duration', 'Longest']].map(([v, l]) => `<option value="${v}" ${lib.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${platforms.length > 1 ? `<div class="chips">${['', ...platforms].map(p => `<button class="chip ${lib.platform === p ? 'on' : ''}" data-platform="${esc(p)}">${esc(p || 'All')}</button>`).join('')}</div>` : ''}
    </div>
    <div id="libList">${tracks.length ? trackList(tracks, { from: 'your library' }) : emptyLibrary()}</div>`;
}
const emptyLibrary = () => lib.q || lib.platform
  ? `<div class="empty"><h3>No matches</h3><p>Nothing in your library matches that search. Try fewer words.</p></div>`
  : `<div class="empty"><h3>Your library is empty</h3><p>Paste a link at the top to play your first song. It'll be saved here automatically.</p></div>`;
afterRender.library = () => {
  const refresh = debounce(async () => {
    const tracks = await api(`/tracks?q=${encodeURIComponent(lib.q)}&sort=${lib.sort}&platform=${encodeURIComponent(lib.platform)}`);
    if (!$('#libList')) return;
    $('#libList').innerHTML = tracks.length ? trackList(tracks, { from: 'your library' }) : emptyLibrary();
    hydrate($('#libList')); markPlayingRows();
  }, 200);
  $('#libSearch').addEventListener('input', e => { lib.q = e.target.value; refresh(); });
  $('#libSort').addEventListener('change', e => { lib.sort = e.target.value; refresh(); });
  $$('[data-platform]', view).forEach(b => b.addEventListener('click', () => {
    lib.platform = b.dataset.platform;
    $$('[data-platform]', view).forEach(x => x.classList.toggle('on', x === b));
    refresh();
  }));
};

async function viewLiked() {
  const tracks = await api('/tracks?liked=true&sort=liked');
  return `<div class="pl-head"><div class="mosaic one" style="width:180px;height:180px;border-radius:16px;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center">${ic('heart').replace('data-icon', 'style="width:70px;height:70px" data-icon')}</div>
    <div class="meta"><div class="kind">Playlist</div><h1>Liked songs</h1><p>${tracks.length} song${tracks.length === 1 ? '' : 's'}${tracks.length ? ', ' + fmtLong(tracks.reduce((s, t) => s + (t.duration || 0), 0)) : ''}</p></div></div>
    ${tracks.length ? `<div class="pl-actions"><button class="fab" data-act="play-all" aria-label="Play liked songs">${ic('play')}</button>
      <button class="icon-btn" data-act="shuffle-all" aria-label="Shuffle">${ic('shuffle')}</button></div>${trackList(tracks, { from: 'Liked songs' })}`
      : `<div class="empty"><h3>Songs you like will appear here</h3><p>Tap the heart on any song to save it.</p></div>`}`;
}

async function viewHistory() {
  const tracks = await api('/history');
  return `<div class="view-head"><div><h1>History</h1><p class="sub">Everything you've listened to, newest first.</p></div>
    ${tracks.length ? `<div class="actions"><button class="chip" data-act="clear-history">${ic('trash')}Clear history</button></div>` : ''}</div>
    ${tracks.length ? trackList(tracks, { from: 'your history' }, { when: true }) : `<div class="empty"><h3>Nothing played yet</h3><p>Songs show up here after you've listened for a bit.</p></div>`}`;
}

async function viewPlaylists() {
  return `<div class="view-head"><div><h1>Playlists</h1></div><div class="actions"><button class="chip" data-act="new-playlist">${ic('plus')}New playlist</button></div></div>
    ${S.playlists.length ? `<div class="grid-cards">${S.playlists.map(playlistCard).join('')}</div>`
      : `<div class="empty"><h3>No playlists yet</h3><p>Create one, or paste a YouTube / SoundCloud playlist link to import it in one go.</p><button class="primary-btn" data-act="new-playlist">New playlist</button></div>`}`;
}

let curPlaylist = null;
async function viewPlaylist(r) {
  const p = await api(`/playlists/${r.id}`);
  curPlaylist = p;
  return `<div class="pl-head">${mosaic(p.covers, '', p.name)}
    <div class="meta"><div class="kind">Playlist${p.source_url ? ' · imported' : ''}</div><h1>${esc(p.name)}</h1>
      ${p.description ? `<p>${esc(p.description)}</p>` : ''}
      <p>${p.track_count} song${p.track_count === 1 ? '' : 's'}${p.duration ? ', ' + fmtLong(p.duration) : ''}</p></div></div>
    <div class="pl-actions">
      ${p.tracks.length ? `<button class="fab" data-act="play-all" aria-label="Play">${ic('play')}</button>
      <button class="icon-btn" data-act="shuffle-all" aria-label="Shuffle play">${ic('shuffle')}</button>
      <button class="icon-btn" data-act="pl-download" aria-label="Download playlist">${ic('download')}</button>` : ''}
      <button class="chip" data-act="pl-add">${ic('link')}Add songs from a link</button>
      <button class="icon-btn" data-act="pl-menu" aria-label="Playlist options">${ic('more')}</button>
    </div>
    ${p.tracks.length ? trackList(p.tracks, { playlistId: p.id, from: p.name }, { sortable: true })
      : `<div class="empty"><h3>This playlist is empty</h3><p>Add songs from your library with the ⋯ menu → Add to playlist, or add a link directly.</p></div>`}`;
}
afterRender.playlist = () => {
  const box = $('.tracks', view);
  if (!box) return;
  sortable(box, '.trow[draggable]', async (from, to) => {
    const t = curPlaylist.tracks;
    const [m] = t.splice(from, 1);
    t.splice(to > from ? to - 1 : to, 0, m);
    try { await api(`/playlists/${curPlaylist.id}/order`, { method: 'PUT', body: { track_ids: t.map(x => x.id) } }); }
    catch (e) { toast(e.message, { error: true }); }
    route();
  });
};
function playlistMenu(p, anchor) {
  openMenu([
    { label: 'Play', icon: 'play', action: () => playList(p.tracks, 0, { from: p.name, shuffle: false }) },
    { label: 'Add to queue', icon: 'queue', action: () => addToQueue(p.tracks) },
    { label: 'Download as zip', icon: 'download', sub: () => formatsAvailable().map(([f, l]) => ({ label: l, icon: 'download', action: () => downloadPlaylist(p, f) })) },
    { sep: true },
    { label: 'Edit name & description', icon: 'edit', action: async () => {
      const v = await formModal({ title: 'Edit playlist', fields: [
        { name: 'name', label: 'Name', value: p.name, required: true },
        { name: 'description', label: 'Description', type: 'textarea', value: p.description } ] });
      if (!v) return;
      await api(`/playlists/${p.id}`, { method: 'PATCH', body: v }).catch(e => toast(e.message, { error: true }));
      await refreshPlaylists(); route();
    } },
    { label: p.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', action: async () => {
      await api(`/playlists/${p.id}`, { method: 'PATCH', body: { pinned: !p.pinned } });
      await refreshPlaylists(); toast(p.pinned ? 'Unpinned' : 'Pinned to the top');
    } },
    { label: 'Duplicate', icon: 'copy', action: async () => {
      const np = await api(`/playlists/${p.id}/duplicate`, { method: 'POST' });
      await refreshPlaylists(); location.hash = `#/playlist/${np.id}`; toast('Playlist duplicated');
    } },
    ...(p.source_url ? [{ label: 'Open original playlist', icon: 'external', action: () => openExternal(p.source_url) }] : []),
    { sep: true },
    { label: 'Delete playlist', icon: 'trash', danger: true, action: async () => {
      if (!await confirmModal('Delete this playlist?', `“${p.name}” will be deleted. The songs stay in your library.`)) return;
      await api(`/playlists/${p.id}`, { method: 'DELETE' });
      await refreshPlaylists(); location.hash = '#/home'; toast('Playlist deleted');
    } },
  ], anchor);
}

/* ================================================================ version 2: editor, combine, phone */
const parseTime = str => {
  const s = String(str ?? '').trim().replace(',', '.');
  if (!s || !/^[\d:.]+$/.test(s)) return NaN;
  const parts = s.split(':');
  if (parts.length > 3 || parts.some(p => p === '' || isNaN(+p))) return NaN;
  return parts.reduce((acc, p) => acc * 60 + +p, 0);
};
const fmtPrecise = sec => {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.round(sec * 10) / 10;
  const m = Math.floor(sec / 60), r = sec - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
};
const editingAvailable = () => !(S.health && S.health.editing === false);
const noEditing = () => `<div class="empty"><h3>Editing isn't available here</h3><p>Editing needs FFmpeg, which couldn't run on this device. Playing and downloading still work.</p></div>`;
function resultPanel(t, again) {
  const fmt = (S.health?.formats || []).includes('mp3') ? 'mp3' : 'original';
  return `<div class="done-card">${ic('check')}<div class="done-text"><b>Saved “${esc(t.title)}”</b><span>${fmtTime(t.duration)} long, now in your library</span></div>
    <div class="row-btns"><button class="chip on" data-done="play">${ic('play')}Play</button>
    <button class="chip" data-done="download" data-fmt="${fmt}">${ic('download')}${IN_APP ? 'Save to phone' : 'Download'}${fmt === 'mp3' ? ' (MP3)' : ''}</button>
    <a class="chip" href="#/edit/${encodeURIComponent(t.id)}">${ic('scissors')}${again}</a></div></div>`;
}
function wireResult(box, t) {
  box.querySelector('[data-done="play"]').onclick = () => playNow(t);
  box.querySelector('[data-done="download"]').onclick = e => downloadTrack(t, e.currentTarget.dataset.fmt);
}

/* ---------- song editor */
let ED = null;
function edCleanup() {
  if (!ED) return;
  cancelAnimationFrame(ED.raf);
  try { ED.audio.pause(); ED.audio.removeAttribute('src'); ED.audio.load(); } catch { }
  ED = null;
}
function edMergedCuts() {
  const r = ED.cuts.map(c => [Math.max(ED.start, Math.min(c.a, c.b)), Math.min(ED.end, Math.max(c.a, c.b))])
    .filter(([a, b]) => b - a >= 0.05).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of r) {
    if (out.length && a <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
    else out.push([a, b]);
  }
  return out;
}
function edKeep() {
  const keep = []; let pos = ED.start;
  for (const [a, b] of edMergedCuts()) { if (a - pos > 0.02) keep.push([pos, a]); pos = Math.max(pos, b); }
  if (ED.end - pos > 0.02) keep.push([pos, ED.end]);
  return keep;
}
const edNewLength = () => edKeep().reduce((s, [a, b]) => s + (b - a), 0);
function edPosInEdit(t) {
  let e = 0;
  for (const [a, b] of edKeep()) { if (t >= b) e += b - a; else { if (t > a) e += t - a; break; } }
  return e;
}

async function viewEdit(r) {
  if (!editingAvailable()) return noEditing();
  const t = await api(`/tracks/${r.id}`);
  const quick = (k, s, l) => `<button class="chip" data-ed="${k}" data-sec="${s}">${l}</button>`;
  return `<div class="view-head"><div><h1>Edit song</h1><p class="sub">${esc(t.title)}${t.artist ? ' by ' + esc(t.artist) : ''}</p></div></div>
  <div class="editor" id="editor" data-id="${esc(t.id)}">
    <div class="wave-wrap"><canvas id="wave" aria-label="Song waveform. Tap to move the playhead."></canvas>
      <div class="wave-msg" id="waveMsg"><span class="spinner"></span> Getting the song ready…</div></div>
    <div class="ed-bar">
      <button class="play-btn" id="edPlay" aria-label="Preview the edit">${ic('play')}</button>
      <div class="ed-time"><b id="edNow">0:00.0</b><span>Preview skips the parts you remove</span></div>
      <div class="ed-quick">
        <button class="chip" data-ed="set-start">${ic('scissors')}Start here</button>
        <button class="chip" data-ed="set-end">${ic('scissors')}End here</button>
        <button class="chip" data-ed="cut-here">${ic('x')}Cut 5 s here</button>
      </div>
    </div>
    <div class="ed-summary">
      <div><b id="sumOrig">–</b><span>Original</span></div>
      <div><b id="sumNew">–</b><span>New length</span></div>
      <div><b id="sumCut">–</b><span>Removed</span></div>
    </div>
    <section class="ed-sec"><h2>Trim the start and end</h2>
      <div class="ed-row"><label for="edStartT">Start</label><input type="range" id="edStart" step="0.1" aria-label="Start"><input class="time" id="edStartT" inputmode="decimal" autocomplete="off"></div>
      <div class="ed-row"><label for="edEndT">End</label><input type="range" id="edEnd" step="0.1" aria-label="End"><input class="time" id="edEndT" inputmode="decimal" autocomplete="off"></div>
      <div class="chips">${quick('trim-start', 5, 'Remove first 5 s')}${quick('trim-start', 10, 'Remove first 10 s')}${quick('trim-end', 5, 'Remove last 5 s')}${quick('trim-end', 10, 'Remove last 10 s')}${quick('reset', 0, 'Reset')}</div>
      <p class="hint">Type exact times like 0:10 or 3:50.5, or drag the sliders.</p>
    </section>
    <section class="ed-sec"><h2>Cut parts out of the middle</h2>
      <p class="hint">Each cut removes everything between its two times. Add as many as you need.</p>
      <div id="cuts"></div>
      <button class="chip" data-ed="add-cut">${ic('plus')}Add a cut</button>
    </section>
    <section class="ed-sec"><h2>Fade</h2>
      <div class="field"><div class="lbl">Fade in <span id="fiVal">Off</span></div><input type="range" id="edFi" min="0" max="10" step="0.5" value="0" aria-label="Fade in seconds"></div>
      <div class="field"><div class="lbl">Fade out <span id="foVal">Off</span></div><input type="range" id="edFo" min="0" max="10" step="0.5" value="0" aria-label="Fade out seconds"></div>
    </section>
    <section class="ed-sec"><h2>Save</h2>
      <label class="lbl-plain" for="edTitle">Name of the new song</label>
      <input class="text-in" id="edTitle" value="${esc(t.title)} (edit)" maxlength="200">
      <div class="row-btns"><button class="primary-btn" id="edSave">Save as new song</button><button class="ghost-btn" data-ed="cancel">Cancel</button></div>
      <p class="hint">Your original song stays exactly as it is.</p>
      <div id="edResult"></div>
    </section>
  </div>`;
}

afterRender.edit = async r => {
  edCleanup();
  const box = $('#editor');
  if (!box) return;
  const id = box.dataset.id;
  let t, w;
  try {
    t = await api(`/tracks/${encodeURIComponent(id)}/prepare`, { method: 'POST' });
    w = await api(`/tracks/${encodeURIComponent(id)}/waveform?points=900`);
  } catch (e) {
    $('#waveMsg') && ($('#waveMsg').innerHTML = esc(e.message));
    return;
  }
  if (!$('#editor') || $('#editor').dataset.id !== id) return;
  const dur = w.duration || t.duration || 0;
  ED = { t, dur, peaks: w.peaks, start: 0, end: dur, cuts: [], fi: 0, fo: 0, audio: new Audio(audioUrl(t)), raf: 0 };
  ED.audio.preload = 'auto';
  $('#waveMsg').hidden = true;
  ['#edStart', '#edEnd'].forEach(s => { $(s).min = 0; $(s).max = dur.toFixed(1); });
  $('#sumOrig').textContent = fmtPrecise(dur);
  edRenderCuts(); edSync(); edDraw();

  const a = ED.audio;
  a.addEventListener('play', () => { setIcon($('#edPlay'), 'pause'); edLoop(); });
  a.addEventListener('pause', () => { setIcon($('#edPlay'), 'play'); edDraw(); });
  a.addEventListener('ended', () => { a.currentTime = ED?.start || 0; });

  $('#edPlay').onclick = () => {
    if (!ED) return;
    if (a.paused) {
      if (P.playing) togglePlay();
      if (a.currentTime < ED.start || a.currentTime >= ED.end - 0.05) a.currentTime = ED.start;
      a.play().catch(() => toast('Tap play again to preview'));
    } else a.pause();
  };
  const cv = $('#wave');
  cv.onclick = e => {
    const rect = cv.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(ED.dur, (e.clientX - rect.left) / rect.width * ED.dur));
    edDraw(); edShowTime();
  };
  addEventListener('resize', edDraw);

  box.addEventListener('input', e => {
    if (!ED) return;
    const el = e.target;
    if (el.id === 'edStart') { ED.start = +el.value; edFix('start'); }
    else if (el.id === 'edEnd') { ED.end = +el.value; edFix('end'); }
    else if (el.dataset.cut) { const c = ED.cuts[+el.dataset.ci]; c[el.dataset.cut] = +el.value; edFix(); }
    else if (el.id === 'edFi') ED.fi = +el.value;
    else if (el.id === 'edFo') ED.fo = +el.value;
    else return;
    edSync(el); edDraw();
  });
  box.addEventListener('change', e => {
    if (!ED) return;
    const el = e.target;
    if (!el.classList.contains('time')) return;
    const v = parseTime(el.value);
    if (isNaN(v)) {
      toast('Type a time like 1:05 or 3:50.5', { error: true });
      const back = el.id === 'edStartT' ? ED.start : el.id === 'edEndT' ? ED.end : ED.cuts[+el.dataset.ci]?.[el.dataset.cutt];
      el.value = fmtPrecise(back ?? 0);
      return;
    }
    if (el.id === 'edStartT') { ED.start = v; edFix('start'); }
    else if (el.id === 'edEndT') { ED.end = v; edFix('end'); }
    else if (el.dataset.cutt) { ED.cuts[+el.dataset.ci][el.dataset.cutt] = v; edFix(); }
    edSync(); edDraw();
  });
  box.addEventListener('click', async e => {
    const b = e.target.closest('[data-ed]');
    if (!b || !ED) return;
    const now = a.currentTime, sec = +b.dataset.sec || 0;
    switch (b.dataset.ed) {
      case 'set-start': ED.start = now; edFix('start'); break;
      case 'set-end': ED.end = now; edFix('end'); break;
      case 'cut-here': ED.cuts.push({ a: now, b: Math.min(ED.dur, now + 5) }); edFix(); edRenderCuts(); break;
      case 'trim-start': ED.start = sec; edFix('start'); break;
      case 'trim-end': ED.end = ED.dur - sec; edFix('end'); break;
      case 'reset': ED.start = 0; ED.end = ED.dur; ED.cuts = []; ED.fi = ED.fo = 0; $('#edFi').value = 0; $('#edFo').value = 0; edRenderCuts(); break;
      case 'add-cut': {
        const mid = Math.min(Math.max(now, ED.start), ED.end - 1);
        ED.cuts.push({ a: mid, b: Math.min(ED.end, mid + 10) }); edFix(); edRenderCuts(); break;
      }
      case 'del-cut': ED.cuts.splice(+b.dataset.ci, 1); edRenderCuts(); break;
      case 'cancel': history.length > 1 ? history.back() : (location.hash = '#/library'); return;
    }
    edSync(); edDraw();
  });
  $('#edSave').onclick = edSave;
};

function edFix(which) {
  const d = ED.dur;
  ED.start = Math.max(0, Math.min(ED.start, d - 0.5));
  ED.end = Math.max(0.5, Math.min(ED.end, d));
  if (ED.end - ED.start < 0.5) {
    if (which === 'end') ED.start = Math.max(0, ED.end - 0.5); else ED.end = Math.min(d, ED.start + 0.5);
  }
  for (const c of ED.cuts) { c.a = Math.max(0, Math.min(c.a, d)); c.b = Math.max(0, Math.min(c.b, d)); }
}
function edRenderCuts() {
  const box = $('#cuts');
  if (!box || !ED) return;
  const max = ED.dur.toFixed(1);
  box.innerHTML = ED.cuts.length ? ED.cuts.map((c, i) => `<div class="cut">
      <div class="cut-head"><b>Cut ${i + 1}</b><span data-cutlen="${i}"></span>
        <button class="icon-btn sm" data-ed="del-cut" data-ci="${i}" aria-label="Remove cut ${i + 1}">${ic('trash')}</button></div>
      <div class="ed-row"><label>From</label><input type="range" min="0" max="${max}" step="0.1" data-cut="a" data-ci="${i}" aria-label="Cut ${i + 1} from"><input class="time" data-cutt="a" data-ci="${i}" inputmode="decimal" aria-label="Cut ${i + 1} from time"></div>
      <div class="ed-row"><label>To</label><input type="range" min="0" max="${max}" step="0.1" data-cut="b" data-ci="${i}" aria-label="Cut ${i + 1} to"><input class="time" data-cutt="b" data-ci="${i}" inputmode="decimal" aria-label="Cut ${i + 1} to time"></div>
    </div>`).join('') : '<p class="hint" style="margin:0 0 12px">No cuts yet.</p>';
  hydrate(box);
}
function edSync(skip) {
  if (!ED) return;
  const setR = (el, v) => { if (el && el !== skip) { el.value = v.toFixed(1); el.style.setProperty('--p', (v / ED.dur * 100) + '%'); } };
  const setT = (el, v) => { if (el && el !== document.activeElement) el.value = fmtPrecise(v); };
  setR($('#edStart'), ED.start); setT($('#edStartT'), ED.start);
  setR($('#edEnd'), ED.end); setT($('#edEndT'), ED.end);
  ED.cuts.forEach((c, i) => {
    setR($(`[data-cut="a"][data-ci="${i}"]`), c.a); setT($(`[data-cutt="a"][data-ci="${i}"]`), c.a);
    setR($(`[data-cut="b"][data-ci="${i}"]`), c.b); setT($(`[data-cutt="b"][data-ci="${i}"]`), c.b);
    const len = Math.abs(c.b - c.a), el = $(`[data-cutlen="${i}"]`);
    if (el) el.textContent = `removes ${fmtPrecise(len)}`;
  });
  $('#fiVal').textContent = ED.fi ? ED.fi + ' s' : 'Off';
  $('#foVal').textContent = ED.fo ? ED.fo + ' s' : 'Off';
  ['#edFi', '#edFo'].forEach(s => { const r = $(s); r.style.setProperty('--p', (r.value / 10 * 100) + '%'); });
  const nl = edNewLength();
  $('#sumNew').textContent = fmtPrecise(nl);
  $('#sumCut').textContent = (ED.dur - nl > 0.05 ? '−' : '') + fmtPrecise(ED.dur - nl);
}
function edShowTime() { if (ED) $('#edNow').textContent = fmtPrecise(ED.audio.currentTime); }
function edDraw() {
  const cv = $('#wave');
  if (!cv || !ED) return;
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim(), text = css.getPropertyValue('--text').trim(), faint = css.getPropertyValue('--line').trim();
  const x = t => t / ED.dur * W;
  const keep = edKeep();
  const kept = t => keep.some(([a, b]) => t >= a && t < b);
  const n = ED.peaks.length, bw = W / n;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n * ED.dur, h = Math.max(1.5, ED.peaks[i] * (H - 12));
    g.fillStyle = kept(t) ? text : faint;
    g.globalAlpha = kept(t) ? 0.85 : 1;
    g.fillRect(i * bw, (H - h) / 2, Math.max(1, bw - 0.6), h);
  }
  g.globalAlpha = 0.18; g.fillStyle = accent;
  g.fillRect(0, 0, x(ED.start), H); g.fillRect(x(ED.end), 0, W - x(ED.end), H);
  for (const [a, b] of edMergedCuts()) g.fillRect(x(a), 0, x(b) - x(a), H);
  g.globalAlpha = 1; g.fillStyle = accent;
  g.fillRect(x(ED.start) - 1, 0, 2, H); g.fillRect(x(ED.end) - 1, 0, 2, H);
  g.fillStyle = text; g.fillRect(x(ED.audio.currentTime) - 1, 0, 2, H);
}
function edLoop() {
  if (!ED) return;
  const a = ED.audio;
  if (!a.paused) {
    const t = a.currentTime;
    if (t < ED.start - 0.05) a.currentTime = ED.start;
    else if (t >= ED.end) { a.pause(); a.currentTime = ED.start; }
    else for (const [x, y] of edMergedCuts()) if (t >= x && t < y - 0.03) { a.currentTime = y; break; }
    const e = edPosInEdit(a.currentTime), nl = edNewLength();
    let v = 1;
    if (ED.fi > 0) v = Math.min(v, e / ED.fi);
    if (ED.fo > 0) v = Math.min(v, (nl - e) / ED.fo);
    a.volume = Math.max(0, Math.min(1, v)) * (settings.muted ? 0 : settings.volume);
  }
  edShowTime(); edDraw();
  if (!a.paused) ED.raf = requestAnimationFrame(edLoop);
}
async function edSave() {
  if (!ED) return;
  if (edNewLength() < 0.5) return toast('Keep at least half a second of the song', { error: true });
  ED.audio.pause();
  const btn = $('#edSave'); btn.disabled = true;
  const tst = toast('<span class="spinner"></span> Saving your edit…', { sticky: true, html: true });
  try {
    const nt = await api('/edit/trim', { method: 'POST', body: {
      track_id: ED.t.id, start: ED.start, end: ED.end, cuts: ED.cuts.map(c => [c.a, c.b]),
      fade_in: ED.fi, fade_out: ED.fo, title: $('#edTitle').value.trim() || null } });
    const res = $('#edResult');
    if (res) { res.innerHTML = resultPanel(nt, 'Edit the new song'); hydrate(res); wireResult(res, nt); res.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    toast(`Saved “${nt.title}” (${fmtTime(nt.duration)})`);
  } catch (e) { toast(e.message, { error: true, ms: 8000 }); }
  finally { tst.remove(); btn.disabled = false; }
}

/* ---------- combine songs */
const CB = { list: [], src: 'library', q: '', xf: 0, gap: 0 };
async function viewCombine(r) {
  if (!editingAvailable()) return noEditing();
  const ids = (r.params.get('ids') || '').split(',').filter(Boolean);
  if (ids.length) {
    const got = await Promise.all(ids.map(id => api(`/tracks/${encodeURIComponent(id)}`).catch(() => null)));
    CB.list = got.filter(Boolean);
    history.replaceState(null, '', '#/combine');
  }
  return `<div class="view-head"><div><h1>Combine songs</h1><p class="sub">Join songs one after another to make one new song.</p></div></div>
  <div class="combine">
    <section class="ed-sec"><h2>Your new song</h2><div id="cbList"></div><p class="cb-total" id="cbTotal"></p></section>
    <section class="ed-sec"><h2>Add songs</h2>
      <div class="toolbar"><div class="search">${ic('search')}<input id="cbSearch" type="search" placeholder="Search songs" aria-label="Search songs to add" value="${esc(CB.q)}"></div>
      ${IN_APP ? `<div class="chips"><button class="chip ${CB.src === 'library' ? 'on' : ''}" data-cbsrc="library">Library</button><button class="chip ${CB.src === 'phone' ? 'on' : ''}" data-cbsrc="phone">On this phone</button></div>` : ''}</div>
      <div id="cbResults" class="cb-results"></div></section>
    <section class="ed-sec"><h2>How to join them</h2>
      <div class="field"><div class="lbl">Crossfade <span id="cbXfVal"></span></div><input type="range" id="cbXf" min="0" max="10" step="0.5" value="${CB.xf}" aria-label="Crossfade seconds">
        <p class="hint">Blends the end of each song into the start of the next.</p></div>
      <div class="field"><div class="lbl">Silence between songs <span id="cbGapVal"></span></div><input type="range" id="cbGap" min="0" max="5" step="0.5" value="${CB.gap}" aria-label="Seconds of silence between songs">
        <p class="hint">Only used when crossfade is off.</p></div>
    </section>
    <section class="ed-sec"><h2>Save</h2>
      <label class="lbl-plain" for="cbTitle">Name of the new song</label>
      <input class="text-in" id="cbTitle" maxlength="200" placeholder="Song 1 + Song 2">
      <div class="row-btns"><button class="primary-btn" id="cbCreate">Create song</button></div>
      <div id="cbResult"></div>
    </section>
  </div>`;
}
function cbRender() {
  const box = $('#cbList');
  if (!box) return;
  const L = CB.list;
  box.innerHTML = L.length ? L.map((t, i) => `<div class="cb-row">
      <span class="cb-n">${i + 1}</span><div class="thumb">${art(t)}</div>
      <div class="cb-t"><div class="tt">${esc(t.title)}</div><div class="ta">${esc(t.artist || t.platform || '')}${t.duration ? ', ' + fmtTime(t.duration) : ''}</div></div>
      <button class="icon-btn sm" data-cb="up" data-i="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${ic('up')}</button>
      <button class="icon-btn sm" data-cb="down" data-i="${i}" aria-label="Move down" ${i === L.length - 1 ? 'disabled' : ''}>${ic('down')}</button>
      <button class="icon-btn sm" data-cb="remove" data-i="${i}" aria-label="Remove">${ic('x')}</button></div>`).join('')
    : '<p class="hint" style="margin:0">Add at least two songs below. They play in this order.</p>';
  hydrate(box);
  const n = L.length, sum = L.reduce((s, t) => s + (t.duration || 0), 0);
  const xf = Math.min(CB.xf, n ? Math.min(...L.map(t => t.duration || 999)) / 2 : 0);
  const total = sum - (CB.xf > 0 ? xf : -CB.gap) * Math.max(0, n - 1);
  $('#cbTotal').textContent = n ? `${n} song${n === 1 ? '' : 's'}, about ${fmtTime(total)} in total` : '';
  $('#cbXfVal').textContent = CB.xf ? CB.xf + ' s' : 'Off';
  $('#cbGapVal').textContent = CB.gap ? CB.gap + ' s' : 'None';
  $('#cbGap').disabled = CB.xf > 0;
  ['#cbXf', '#cbGap'].forEach(s => { const r = $(s); r.style.setProperty('--p', (r.value / r.max * 100) + '%'); });
  const ph = n >= 2 ? L.slice(0, 3).map(t => t.title).join(' + ') + (n > 3 ? ' …' : '') : 'Song 1 + Song 2';
  $('#cbTitle').placeholder = ph;
}
let cbPhoneItems = null;
async function cbSearch() {
  const box = $('#cbResults');
  if (!box) return;
  const q = CB.q.trim().toLowerCase();
  let rows;
  if (CB.src === 'phone') {
    if (!AKA.hasAudioPermission()) { box.innerHTML = `<p class="hint">Allow access to your phone's music first: open the <a href="#/phone">On this phone</a> tab.</p>`; return; }
    cbPhoneItems = cbPhoneItems || JSON.parse(AKA.listDeviceAudio() || '[]');
    rows = cbPhoneItems.filter(it => !q || (it.title + ' ' + it.artist).toLowerCase().includes(q)).slice(0, 60)
      .map((it, i) => ({ key: 'p' + cbPhoneItems.indexOf(it), title: it.title, sub: [it.artist, it.folder].filter(Boolean).join(', '), duration: it.duration, cover: null }));
  } else {
    const tracks = await api(`/tracks?q=${encodeURIComponent(CB.q)}&sort=added`);
    cbResultsCache = tracks;
    rows = tracks.slice(0, 60).map((t, i) => ({ key: 'l' + i, title: t.title, sub: t.artist || t.platform || '', duration: t.duration, cover: t.cover }));
  }
  box.innerHTML = rows.length ? rows.map(r => `<div class="cb-row"><div class="thumb">${art({ title: r.title, cover: r.cover })}</div>
      <div class="cb-t"><div class="tt">${esc(r.title)}</div><div class="ta">${esc(r.sub)}${r.duration ? ', ' + fmtTime(r.duration) : ''}</div></div>
      <button class="chip" data-cbadd="${r.key}">${ic('plus')}Add</button></div>`).join('')
    : `<p class="hint">${q ? 'No songs match that search.' : 'No songs yet.'}</p>`;
  hydrate(box);
}
let cbResultsCache = [];
afterRender.combine = () => {
  const box = $('.combine');
  if (!box) return;
  cbRender(); cbSearch();
  $('#cbSearch').addEventListener('input', debounce(e => { CB.q = e.target.value; cbSearch(); }, 200));
  box.addEventListener('input', e => {
    if (e.target.id === 'cbXf') { CB.xf = +e.target.value; cbRender(); }
    if (e.target.id === 'cbGap') { CB.gap = +e.target.value; cbRender(); }
  });
  box.addEventListener('click', async e => {
    const src = e.target.closest('[data-cbsrc]');
    if (src) { CB.src = src.dataset.cbsrc; $$('[data-cbsrc]').forEach(b => b.classList.toggle('on', b === src)); return cbSearch(); }
    const add = e.target.closest('[data-cbadd]');
    if (add) {
      const k = add.dataset.cbadd;
      try {
        let t;
        if (k[0] === 'p') {
          const it = cbPhoneItems[+k.slice(1)];
          [t] = await api('/device/link', { method: 'POST', body: { items: [{ path: it.path, title: it.title, artist: it.artist, album: it.album, duration: it.duration }] } });
        } else t = cbResultsCache[+k.slice(1)];
        CB.list.push(t); cbRender();
        toast(`Added “${t.title}”`, { ms: 1500 });
      } catch (err) { toast(err.message, { error: true }); }
      return;
    }
    const b = e.target.closest('[data-cb]');
    if (!b) return;
    const i = +b.dataset.i, L = CB.list;
    if (b.dataset.cb === 'up' && i > 0) [L[i - 1], L[i]] = [L[i], L[i - 1]];
    if (b.dataset.cb === 'down' && i < L.length - 1) [L[i + 1], L[i]] = [L[i], L[i + 1]];
    if (b.dataset.cb === 'remove') L.splice(i, 1);
    cbRender();
  });
  $('#cbCreate').onclick = async () => {
    if (CB.list.length < 2) return toast('Add at least two songs first', { error: true });
    const btn = $('#cbCreate'); btn.disabled = true;
    const tst = toast(`<span class="spinner"></span> Combining ${CB.list.length} songs…`, { sticky: true, html: true });
    try {
      const nt = await api('/edit/merge', { method: 'POST', body: {
        track_ids: CB.list.map(t => t.id), crossfade: CB.xf, gap: CB.gap, title: $('#cbTitle').value.trim() || null } });
      const res = $('#cbResult');
      if (res) { res.innerHTML = resultPanel(nt, 'Edit or trim it'); hydrate(res); wireResult(res, nt); res.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      toast(`Created “${nt.title}” (${fmtTime(nt.duration)})`);
    } catch (err) { toast(err.message, { error: true, ms: 8000 }); }
    finally { tst.remove(); btn.disabled = false; }
  };
};

/* ---------- songs already on the phone */
const PH = { items: null, q: '', sort: 'added', folder: '', select: false, sel: new Set(), deleting: null };
function phFiltered() {
  const q = PH.q.trim().toLowerCase();
  let L = (PH.items || []).filter(it => (!PH.folder || it.folder === PH.folder) && (!q || `${it.title} ${it.artist} ${it.album} ${it.folder}`.toLowerCase().includes(q)));
  const by = { added: (a, b) => b.added - a.added, title: (a, b) => a.title.localeCompare(b.title), artist: (a, b) => (a.artist || '~').localeCompare(b.artist || '~'),
    size: (a, b) => b.size - a.size, duration: (a, b) => b.duration - a.duration }[PH.sort];
  return by ? L.slice().sort(by) : L;
}
async function viewPhone() {
  if (!IN_APP) return `<div class="empty"><h3>Only in the Android app</h3><p>Install AK Music Player on your phone to see, edit and delete the songs stored there.</p></div>`;
  if (!AKA.hasAudioPermission()) {
    PH.items = null;
    return `<div class="empty"><h3>See the music on your phone</h3>
      <p>Allow AK Music Player to see your songs and other audio files. They stay where they are and are never uploaded.</p>
      <button class="primary-btn" data-act="phone-allow">Allow access</button><p class="hint" id="permHelp"></p></div>`;
  }
  PH.items = JSON.parse(AKA.listDeviceAudio() || '[]');
  cbPhoneItems = PH.items;
  const total = PH.items.reduce((s, it) => s + it.size, 0);
  const folders = Object.entries(PH.items.reduce((m, it) => (m[it.folder] = (m[it.folder] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return `<div class="view-head"><div><h1>On this phone</h1><p class="sub">${PH.items.length} audio file${PH.items.length === 1 ? '' : 's'}, ${fmtBytes(total)}</p></div>
      <div class="actions"><button class="chip" data-act="ph-play">${ic('play')}Play all</button><button class="chip" data-act="ph-shuffle">${ic('shuffle')}Shuffle</button>
      <button class="chip" data-act="ph-select">${ic('boxChecked')}Select</button></div></div>
    ${PH.items.length ? `<div class="toolbar">
      <div class="search">${ic('search')}<input id="phSearch" type="search" placeholder="Search songs on this phone" value="${esc(PH.q)}" aria-label="Search"></div>
      <select class="select" id="phSort" aria-label="Sort by">${[['added', 'Newest'], ['title', 'Title'], ['artist', 'Artist'], ['size', 'Biggest files'], ['duration', 'Longest']].map(([v, l]) => `<option value="${v}" ${PH.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${folders.length > 1 ? `<div class="chips">${[['', 'All folders'], ...folders.map(([f]) => [f, f])].map(([v, l]) => `<button class="chip ${PH.folder === v ? 'on' : ''}" data-folder="${esc(v)}">${esc(l || 'Other')}</button>`).join('')}</div>` : ''}
    </div><div id="phList"></div><div class="select-bar" id="phBar" hidden></div>`
    : `<div class="empty"><h3>No audio files found</h3><p>Songs you download or copy to this phone will show up here.</p></div>`}`;
}
function phRender() {
  const box = $('#phList');
  if (!box) return;
  const L = phFiltered();
  PH.view = L;
  box.innerHTML = L.length ? `<div class="tracks">${L.slice(0, 1500).map((it, i) => {
      const on = PH.sel.has(it.id);
      return `<div class="trow ph-row${on ? ' selected' : ''}" data-pi="${i}">
        <div class="num"><span>${i + 1}</span></div>
        <div class="thumb">${PH.select ? `<div class="ph-check">${ic(on ? 'boxChecked' : 'box')}</div>` : genArt(it.title)}</div>
        <div style="min-width:0"><div class="tt">${esc(it.title)}</div><div class="ta">${esc(it.artist || it.folder || '')}</div></div>
        <div class="src">${esc(it.folder)}</div><div class="when">${fmtBytes(it.size)}</div><div class="dur">${it.duration ? fmtTime(it.duration) : ''}</div><div></div>
        <button class="icon-btn sm" data-phmenu="${i}" aria-label="Options for ${esc(it.title)}">${ic('more')}</button></div>`;
    }).join('')}</div>` : `<div class="empty"><h3>No matches</h3><p>Nothing on this phone matches that search.</p></div>`;
  hydrate(box);
  const bar = $('#phBar');
  if (bar) {
    bar.hidden = !PH.select;
    const n = PH.sel.size;
    bar.innerHTML = `<span><b>${n}</b> selected</span>
      <button class="chip" data-act="ph-sel-all">Select all</button>
      <button class="chip" data-act="ph-sel-combine" ${n < 2 ? 'disabled' : ''}>${ic('merge')}Combine</button>
      <button class="chip" data-act="ph-sel-playlist" ${n < 1 ? 'disabled' : ''}>${ic('plus')}Playlist</button>
      <button class="chip danger-chip" data-act="ph-sel-delete" ${n < 1 ? 'disabled' : ''}>${ic('trash')}Delete</button>
      <button class="chip" data-act="ph-select">Done</button>`;
    hydrate(bar);
  }
}
async function phLink(items) {
  if (!items.length) return [];
  const out = [];
  for (let i = 0; i < items.length; i += 500) {
    out.push(...await api('/device/link', { method: 'POST', body: { items: items.slice(i, i + 500).map(it => ({ path: it.path, title: it.title, artist: it.artist, album: it.album, duration: it.duration })) } }));
  }
  return out;
}
async function phPlay(index, shuffle) {
  const L = PH.view || phFiltered();
  if (!L.length) return;
  const tst = L.length > 200 ? toast('<span class="spinner"></span> Getting your songs ready…', { sticky: true, html: true }) : null;
  try {
    const tracks = await phLink(L.slice(0, 1500));
    playList(tracks, shuffle ? Math.floor(Math.random() * tracks.length) : index, { from: 'your phone', shuffle: shuffle ? true : undefined });
  } catch (e) { toast(e.message, { error: true }); }
  finally { tst?.remove(); }
}
async function phDelete(items) {
  if (!items.length) return;
  const one = items.length === 1;
  const ok = await confirmModal(one ? `Delete “${items[0].title}”?` : `Delete ${items.length} files?`,
    `${one ? 'This file is' : 'These files are'} deleted from your phone permanently and can't be recovered. Android will ask you to confirm.`, 'Delete');
  if (!ok) return;
  PH.deleting = items;
  try { AKA.deleteDeviceAudio(JSON.stringify(items.map(it => ({ id: it.id, path: it.path })))); }
  catch (e) { PH.deleting = null; toast(e.message, { error: true }); }
}
window.akDeviceDeleted = async (ok, msg) => {
  const items = PH.deleting || [];
  PH.deleting = null;
  if (!ok) { toast(msg && msg !== 'cancelled' ? `Couldn't delete: ${msg}` : 'Nothing was deleted', { error: !!(msg && msg !== 'cancelled') }); return; }
  try {
    const r = await api('/device/forget', { method: 'POST', body: { paths: items.map(it => it.path) } });
    const gone = new Set(r.ids || []);
    const wasCurrent = current() && gone.has(current().id);
    for (let i = P.queue.length - 1; i >= 0; i--) if (gone.has(P.queue[i].id) && i !== P.index) removeFromQueue(i);
    if (wasCurrent) { decks.forEach(d => d.pause()); if (nextIndex(true) !== null) next(true); }
  } catch { }
  toast(items.length === 1 ? `Deleted “${items[0].title}”` : `Deleted ${items.length} files`);
  PH.sel.clear(); PH.select = false; cbPhoneItems = null;
  route();
};
window.akAudioPermission = (granted, canAskAgain) => {
  if (granted) return route();
  const help = $('#permHelp');
  if (help) help.innerHTML = canAskAgain ? 'Access was not allowed. Tap the button to try again.'
    : 'Access is turned off. Open Android Settings → Permissions → Music and audio, and choose Allow. <br><button class="chip" data-act="phone-settings">Open settings</button>';
  hydrate(help || document);
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentRoute().name === 'phone' && IN_APP && !PH.items && AKA.hasAudioPermission()) route();
});
function phMenu(it, anchor) {
  const one = async () => (await phLink([it]))[0];
  openMenu([
    { label: 'Play', icon: 'play', action: async () => { const L = PH.view || []; phPlay(Math.max(0, L.indexOf(it))); } },
    { label: 'Play next', icon: 'playNext', action: async () => playNextTracks([await one()]) },
    { label: 'Add to queue', icon: 'queue', action: async () => addToQueue([await one()]) },
    { label: 'Add to playlist', icon: 'plus', sub: async () => playlistSub([await one()])() },
    { sep: true },
    { label: 'Edit / trim', icon: 'scissors', action: async () => { const t = await one(); location.hash = `#/edit/${encodeURIComponent(t.id)}`; } },
    { label: 'Combine with other songs', icon: 'merge', action: async () => { const t = await one(); location.hash = `#/combine?ids=${encodeURIComponent(t.id)}`; } },
    { sep: true },
    { title: `${it.folder || 'Phone'}, ${fmtBytes(it.size)}` },
    { label: 'Delete from phone', icon: 'trash', danger: true, action: () => phDelete([it]) },
  ], anchor);
}
afterRender.phone = () => {
  if (!$('#phList')) return;
  phRender();
  $('#phSearch').addEventListener('input', debounce(e => { PH.q = e.target.value; phRender(); }, 150));
  $('#phSort').addEventListener('change', e => { PH.sort = e.target.value; phRender(); });
  $$('[data-folder]', view).forEach(b => b.addEventListener('click', () => {
    PH.folder = b.dataset.folder; $$('[data-folder]', view).forEach(x => x.classList.toggle('on', x === b)); phRender();
  }));
  $('#phList').addEventListener('click', e => {
    const m = e.target.closest('[data-phmenu]');
    const L = PH.view || [];
    if (m) { e.stopPropagation(); return phMenu(L[+m.dataset.phmenu], m); }
    const row = e.target.closest('[data-pi]');
    if (!row) return;
    const it = L[+row.dataset.pi];
    if (PH.select) { PH.sel.has(it.id) ? PH.sel.delete(it.id) : PH.sel.add(it.id); phRender(); }
    else phPlay(+row.dataset.pi);
  });
  $('#phList').addEventListener('contextmenu', e => {
    const row = e.target.closest('[data-pi]');
    if (!row) return;
    e.preventDefault(); phMenu((PH.view || [])[+row.dataset.pi], e);
  });
};
async function phoneAct(act, el) {
  const selected = () => (PH.items || []).filter(it => PH.sel.has(it.id));
  switch (act) {
    case 'phone-allow': AKA.requestAudioPermission(); return true;
    case 'phone-settings': AKA.openAppSettings(); return true;
    case 'ph-play': phPlay(0); return true;
    case 'ph-shuffle': phPlay(0, true); return true;
    case 'ph-select': PH.select = !PH.select; PH.sel.clear(); phRender(); return true;
    case 'ph-sel-all': (PH.view || []).forEach(it => PH.sel.add(it.id)); phRender(); return true;
    case 'ph-sel-delete': phDelete(selected()); return true;
    case 'ph-sel-combine': {
      const tracks = await phLink(selected());
      CB.list = tracks; location.hash = '#/combine'; return true;
    }
    case 'ph-sel-playlist': {
      const tracks = await phLink(selected());
      openMenu([{ title: `Add ${tracks.length} song${tracks.length === 1 ? '' : 's'} to` }, ...playlistSub(tracks)()], el); return true;
    }
  }
  return false;
}

const SITES = [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['x', 'X (Twitter)']];
function accountsHTML() {
  let st = {};
  try { st = JSON.parse(AKA.accounts()); } catch { }
  const any = SITES.some(([k]) => st[k]);
  return `<section><h2>Accounts</h2>
    <p>Some Instagram, Facebook and X posts only play when you're signed in. Sign in once here; your login stays on this phone.</p>
    <div class="row-btns">${SITES.map(([k, n]) => st[k]
      ? `<span class="chip on">${ic('check')}${n}</span>`
      : `<button class="chip" data-act="sign-in" data-site="${k}">${ic('user')}Sign in to ${n}</button>`).join('')}
      ${any ? `<button class="chip" data-act="sign-out">${ic('x')}Sign out</button>` : ''}</div></section>
    <section><h2>App</h2><p>AK Music Player ${esc(AKA.version?.() || '')} for Android. Everything runs on this phone: no computer, no account and no ads.</p></section>`;
}
window.akAccountsChanged = () => { if (currentRoute().name === 'settings') route(); toast('Signed in. Try your link again.'); };
async function viewSettings() {
  const [health, storage] = await Promise.all([api('/health').catch(() => null), api('/storage').catch(() => null)]);
  const opt = (name, val, label) => `<button class="chip ${settings[name] === val ? 'on' : ''}" data-set="${name}" data-val="${val}">${label}</button>`;
  return `<div class="view-head"><div><h1>Settings</h1></div></div><div class="settings">
    <section><h2>Appearance</h2><div class="chips">${opt('theme', 'auto', 'Match my device')}${opt('theme', 'dark', 'Dark')}${opt('theme', 'light', 'Light')}</div></section>
    <section><h2>When I paste a link</h2><div class="chips">${opt('onPaste', 'play', 'Play it now')}${opt('onPaste', 'queue', 'Add it to the queue')}${opt('onPaste', 'save', 'Just save it')}</div></section>
    ${IN_APP ? accountsHTML() : ''}
    <section><h2>Playback</h2>
      <div class="field"><div class="lbl">Crossfade <span id="cfVal">${settings.crossfade ? settings.crossfade + ' s' : 'Off'}</span></div>
        <input type="range" id="cfRange" min="0" max="12" step="1" value="${settings.crossfade}" style="--p:${settings.crossfade / 12 * 100}%" aria-label="Crossfade seconds">
        <p class="hint">Blends the end of one song into the start of the next.</p></div>
      <label class="switch"><span>Audio effects<small>Equalizer, volume levelling and the visualizer. ${isIOS ? 'On iPhone and iPad this can stop playback when the screen locks.' : 'Takes effect after a reload.'}</small></span><input type="checkbox" id="fxToggle" ${settings.effects ? 'checked' : ''}></label>
      <label class="switch"><span>Continue where I left off<small>Remembers your queue and position when you come back.</small></span><input type="checkbox" id="resumeToggle" ${settings.resume ? 'checked' : ''}></label>
    </section>
    <section><h2>Storage</h2>
      <p>${storage ? `Cached audio ${fmtBytes(storage.audio)}, artwork ${fmtBytes(storage.covers)}, converted downloads ${fmtBytes(storage.exports)}.` : 'Storage details unavailable.'} Cached audio makes songs start instantly the second time.</p>
      <div class="row-btns"><button class="chip" data-act="clear-exports">${ic('trash')}Clear converted downloads</button></div></section>
    <section><h2>Backup</h2><p>Save your library, likes and playlists to a file, or restore them on another device.</p>
      <div class="row-btns"><a class="chip" href="/api/backup" download>${ic('download')}Download backup</a>
      <label class="chip" style="cursor:pointer">${ic('upload')}Restore from backup<input type="file" accept="application/json,.json" id="restoreInput" hidden></label></div></section>
    <section ${IN_APP ? 'hidden' : ''}><h2>Keyboard shortcuts</h2><div class="kbd">
      <span><kbd>Space</kbd></span><span>Play / pause</span><span><kbd>←</kbd> <kbd>→</kbd></span><span>Back / forward 5 seconds</span>
      <span><kbd>↑</kbd> <kbd>↓</kbd></span><span>Volume</span><span><kbd>N</kbd> <kbd>P</kbd></span><span>Next / previous song</span>
      <span><kbd>S</kbd> <kbd>R</kbd></span><span>Shuffle / repeat</span><span><kbd>L</kbd></span><span>Like the current song</span>
      <span><kbd>M</kbd></span><span>Mute</span><span><kbd>F</kbd></span><span>Full-screen player</span>
      <span><kbd>Q</kbd></span><span>Queue</span><span><kbd>/</kbd></span><span>Paste a link</span>
      <span><kbd>Ctrl</kbd>+<kbd>V</kbd></span><span>Play a copied link from anywhere</span></div></section>
    <section><h2>${IN_APP ? 'Music engine' : 'Server'}</h2><p>${health ? `yt-dlp ${esc(health.yt_dlp)}. FFmpeg ${health.ffmpeg ? 'installed' : IN_APP ? 'unavailable on this phone, so downloads keep the original quality' : '<b style="color:var(--danger)">not found</b> — install it to download MP3/FLAC'}. ${IN_APP ? `YouTube helper ${health.js_runtime ? 'ready' : '<b style="color:var(--danger)">unavailable</b> (some YouTube videos may not play)'}.` : `Login cookies ${health.cookies ? 'configured' : 'not set (needed for some Instagram posts)'}.`}` : "Can't reach the server."}</p></section>
  </div>`;
}
afterRender.settings = () => {
  $$('[data-set]', view).forEach(b => b.addEventListener('click', () => {
    settings[b.dataset.set] = b.dataset.val; saveSettings();
    $$(`[data-set="${b.dataset.set}"]`, view).forEach(x => x.classList.toggle('on', x === b));
    if (b.dataset.set === 'theme') applyTheme();
  }));
  $('#cfRange').addEventListener('input', e => {
    settings.crossfade = +e.target.value; saveSettings();
    e.target.style.setProperty('--p', settings.crossfade / 12 * 100 + '%');
    $('#cfVal').textContent = settings.crossfade ? settings.crossfade + ' s' : 'Off';
  });
  $('#fxToggle').addEventListener('change', e => {
    settings.effects = e.target.checked; saveSettings();
    toast('Reload the app to apply', { action: ['Reload', () => { saveSession(); location.reload(); }] });
  });
  $('#resumeToggle').addEventListener('change', e => { settings.resume = e.target.checked; saveSettings(); if (!settings.resume) localStorage.removeItem('akmp.session'); });
  $('#restoreInput').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const form = new FormData(); form.append('file', f);
    try { const r = await api('/restore', { method: 'POST', form }); toast(`Restored ${r.tracks} songs and ${r.playlists} playlists`); refreshPlaylists(); }
    catch (err) { toast(err.message, { error: true }); }
  });
};

/* ---------- view click handling */
async function handleAct(act, el) {
  if (act.startsWith('ph') && await phoneAct(act, el)) return;
  const r = currentRoute();
  const listKey = $('.tracks', view)?.dataset.key;
  const tracks = listKey ? lists[listKey].tracks : [];
  const from = listKey ? lists[listKey].from : '';
  switch (act) {
    case 'play-all': return playList(tracks, 0, { from, shuffle: false });
    case 'shuffle-all': return playList(tracks, Math.floor(Math.random() * tracks.length), { from, shuffle: true });
    case 'clear-history':
      if (await confirmModal('Clear listening history?', 'Your history and "Continue listening" will be emptied. Play counts stay.', 'Clear')) { await api('/history', { method: 'DELETE' }); route(); }
      return;
    case 'new-playlist': { const p = await createPlaylist(); if (p) location.hash = `#/playlist/${p.id}`; return; }
    case 'pl-download': return openMenu([{ title: 'Download playlist as' }, ...formatsAvailable().map(([f, l]) => ({ label: l, icon: 'download', action: () => downloadPlaylist(curPlaylist, f) }))], el);
    case 'pl-menu': return playlistMenu(curPlaylist, el);
    case 'pl-add': {
      const v = await formModal({ title: `Add to “${curPlaylist.name}”`, submit: 'Add', fields: [{ name: 'url', label: 'Link to a song or playlist', placeholder: 'https://…', required: true }] });
      if (v) addLink(v.url, { playlistId: curPlaylist.id, mode: 'save' });
      return;
    }
    case 'sign-in': try { AKA.signIn(el.dataset.site); } catch { } return;
    case 'sign-out':
      if (await confirmModal('Sign out of all sites?', 'Instagram, Facebook and X posts that need an account will stop working until you sign in again.', 'Sign out')) {
        try { AKA.signOut(); } catch { }
        toast('Signed out'); route();
      }
      return;
    case 'clear-exports': await api('/storage/exports', { method: 'DELETE' }); toast('Converted downloads cleared'); return route();
  }
}
function onListClick(e) {
  const actEl = e.target.closest('[data-act]');
  if (actEl && e.currentTarget.contains(actEl)) { e.preventDefault(); return handleAct(actEl.dataset.act, actEl); }
  const a = e.target.closest('[data-action]');
  if (!a || !e.currentTarget.contains(a)) return;
  const holder = a.closest('[data-list]');
  const list = holder ? lists[holder.dataset.list] : null;
  const i = holder ? +holder.dataset.i : -1;
  const t = list ? list.tracks[i] : null;
  switch (a.dataset.action) {
    case 'play':
      e.preventDefault();
      if (!t) return;
      if (isCurrent(t) && decks[active].getAttribute('src') && !decks[active].getAttribute('src').startsWith('data:')) return togglePlay();
      return playList(list.tracks, i, { from: list.from });
    case 'like': e.stopPropagation(); return toggleLike(t);
    case 'menu': e.stopPropagation(); return openMenu(trackMenu(t, list.ctx), a);
    case 'artist': e.stopPropagation(); location.hash = `#/library?q=${encodeURIComponent(a.dataset.artist)}`; return;
    case 'play-playlist':
      e.preventDefault(); e.stopPropagation();
      api(`/playlists/${a.dataset.pid}`).then(p => p.tracks.length ? playList(p.tracks, 0, { from: p.name }) : toast('That playlist is empty'));
      return;
  }
}
view.addEventListener('click', onListClick);
view.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('.card[data-action], [data-action="artist"]')) { e.preventDefault(); e.target.click(); }
});
view.addEventListener('contextmenu', e => {
  const holder = e.target.closest('[data-list]');
  if (!holder) return;
  const list = lists[holder.dataset.list];
  e.preventDefault();
  openMenu(trackMenu(list.tracks[+holder.dataset.i], list.ctx), e);
});

/* ---------- drag-to-reorder (desktop) */
function sortable(box, selector, onMove) {
  let from = null;
  box.addEventListener('dragstart', e => {
    const r = e.target.closest(selector); if (!r) return;
    from = +r.dataset.pos; r.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(from));
  });
  box.addEventListener('dragend', () => { from = null; $$('.dragging, .drop-before', box).forEach(x => x.classList.remove('dragging', 'drop-before')); });
  box.addEventListener('dragover', e => {
    if (from === null) return;
    const r = e.target.closest(selector); if (!r) return;
    e.preventDefault();
    $$('.drop-before', box).forEach(x => x.classList.remove('drop-before'));
    r.classList.add('drop-before');
  });
  box.addEventListener('drop', e => {
    const r = e.target.closest(selector);
    if (from === null || !r) return;
    e.preventDefault();
    const rect = r.getBoundingClientRect();
    let to = +r.dataset.pos + (e.clientY > rect.top + rect.height / 2 ? 1 : 0);
    const f = from; from = null;
    if (to !== f && to !== f + 1) onMove(f, to);
    else $$('.dragging, .drop-before', box).forEach(x => x.classList.remove('dragging', 'drop-before'));
  });
}

/* ================================================================ side panel */
function openPanel(tab) {
  const panel = $('#panel');
  if (!panel.hidden && P.panel === tab) return closePanel();
  P.panel = tab; panel.hidden = false;
  $$('.panel-tabs [role="tab"]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.panel === tab)));
  $$('[data-open-panel]').forEach(b => b.classList.toggle('on', b.dataset.openPanel === tab));
  renderPanel();
  if (tab === 'lyrics') loadLyrics();
}
function closePanel() { $('#panel').hidden = true; P.panel = null; $$('[data-open-panel]').forEach(b => b.classList.remove('on')); }
function renderPanelIf(tab) { if (P.panel === tab && !$('#panel').hidden) renderPanel(); }
function renderPanel() {
  if ($('#panel').hidden) return;
  const body = $('#panelBody');
  if (P.panel === 'lyrics') { body.innerHTML = lyricsHTML(); L.cur = -1; highlightLyrics(decks[active].currentTime); return; }
  if (P.panel === 'sound') { body.innerHTML = soundHTML(); hydrate(body); wireSound(body); return; }
  const cur = current();
  const qrow = (t, qi) => `<div class="qrow${qi === P.index ? ' current' : ''}" data-q="${qi}" data-pos="${qi}" ${qi > P.index ? 'draggable="true"' : ''}>
      <div class="thumb">${art(t)}</div><div style="min-width:0;cursor:pointer" data-qplay="${qi}"><div class="tt">${esc(t.title)}</div><div class="ta">${esc(t.artist || t.platform || '')}</div></div>
      <button class="icon-btn sm" data-qmenu="${qi}" aria-label="Options">${ic('more')}</button></div>`;
  const upcoming = P.queue.map((t, i) => [t, i]).filter(([, i]) => i > P.index);
  body.innerHTML = `${cur ? `<h3>Now playing</h3>${qrow(cur, P.index)}` : '<div class="empty"><p>Your queue is empty. Play a song or playlist to fill it.</p></div>'}
    ${upcoming.length ? `<h3 style="display:flex;justify-content:space-between;align-items:center">Next up${P.from ? ` from ${esc(P.from)}` : ''}<button class="ghost-btn" data-qclear style="font-size:13px;padding:4px 8px">Clear</button></h3>
    <div id="qList">${upcoming.map(([t, i]) => qrow(t, i)).join('')}</div>` : (cur ? '<p style="color:var(--faint);font-size:14px;margin-top:18px">Nothing queued after this song. Use “Play next” or “Add to queue” on any song.</p>' : '')}`;
  hydrate(body);
  if ($('#qList')) sortable($('#qList'), '.qrow[draggable]', moveInQueue);
}
$('#panelBody').addEventListener('click', e => {
  const p = e.target.closest('[data-qplay]');
  if (p) { const qi = +p.dataset.qplay; return qi === P.index ? togglePlay() : playIndex(qi); }
  const m = e.target.closest('[data-qmenu]');
  if (m) { const qi = +m.dataset.qmenu; return openMenu(trackMenu(P.queue[qi], { queueIndex: qi }), m); }
  if (e.target.closest('[data-qclear]')) clearUpcoming();
});
$$('.panel-tabs [role="tab"]').forEach(b => b.addEventListener('click', () => openPanel(b.dataset.panel)));
$('#panelClose').addEventListener('click', closePanel);
$$('[data-open-panel]').forEach(b => b.addEventListener('click', () => openPanel(b.dataset.openPanel)));

function soundHTML() {
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const fx = !!actx;
  return `<h3>Playback speed</h3><div class="chips">${speeds.map(s => `<button class="chip ${settings.speed === s ? 'on' : ''}" data-speed="${s}">${s}×</button>`).join('')}</div>
    <h3>Crossfade</h3><div class="field"><div class="lbl">Blend songs together <span id="pcfVal">${settings.crossfade ? settings.crossfade + ' s' : 'Off'}</span></div>
      <input type="range" id="pcf" min="0" max="12" value="${settings.crossfade}" style="--p:${settings.crossfade / 12 * 100}%" aria-label="Crossfade seconds"></div>
    <h3>Equalizer</h3>
    ${fx ? `<div class="chips">${Object.keys(EQ_PRESETS).map(n => `<button class="chip ${settings.eqPreset === n ? 'on' : ''}" data-preset="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      <div class="eq">${EQ_FREQS.map((f, i) => `<div class="band"><span>${settings.eq[i] > 0 ? '+' : ''}${settings.eq[i]}</span><input type="range" min="-12" max="12" step="1" value="${settings.eq[i]}" data-band="${i}" aria-label="${f} Hz"><span>${f >= 1000 ? f / 1000 + 'k' : f}</span></div>`).join('')}</div>
      <label class="switch"><span>Even out volume<small>Makes quiet and loud songs sound closer in level.</small></span><input type="checkbox" id="normToggle" ${settings.normalize ? 'checked' : ''}></label>`
      : `<p style="color:var(--muted);font-size:14px">${settings.effects ? 'Start playing a song to use the equalizer.' : 'Turn on Audio effects in Settings to use the equalizer.'}</p>`}
    <h3>Sleep timer</h3><button class="chip" id="panelSleep">${ic('moon')}${P.sleepTimer ? 'Ends in ' + Math.ceil((P.sleepAt - Date.now()) / 60000) + ' min' : P.sleepEndOfTrack ? 'Ends after this song' : 'Set a timer'}</button>`;
}
function wireSound(body) {
  $$('[data-speed]', body).forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
  $('#pcf', body).addEventListener('input', e => {
    settings.crossfade = +e.target.value; saveSettings();
    e.target.style.setProperty('--p', settings.crossfade / 12 * 100 + '%');
    $('#pcfVal').textContent = settings.crossfade ? settings.crossfade + ' s' : 'Off';
  });
  $$('[data-preset]', body).forEach(b => b.addEventListener('click', () => { settings.eqPreset = b.dataset.preset; setEq(EQ_PRESETS[b.dataset.preset]); renderPanel(); }));
  $$('[data-band]', body).forEach(r => r.addEventListener('input', () => {
    const v = settings.eq.slice(); v[+r.dataset.band] = +r.value;
    settings.eqPreset = 'Custom'; setEq(v);
    r.previousElementSibling.textContent = (r.value > 0 ? '+' : '') + r.value;
    $$('[data-preset]', body).forEach(x => x.classList.remove('on'));
  }));
  $('#normToggle', body)?.addEventListener('change', e => { settings.normalize = e.target.checked; saveSettings(); routeNormalize(); });
  $('#panelSleep', body).addEventListener('click', e => sleepMenu(e.currentTarget));
}

/* ================================================================ now playing overlay */
function openNowPlaying() {
  if (!current()) return toast('Nothing is playing yet');
  $('#nowPlaying').hidden = false;
  hydrate($('#nowPlaying'));
  cancelAnimationFrame(vizRaf); vizLoop();
  if (!$('#npLyrics').hidden) loadLyrics();
  $('#npClose').focus();
}
function closeNowPlaying() { if ($('#nowPlaying').hidden) return; $('#nowPlaying').hidden = true; cancelAnimationFrame(vizRaf); $('#npOpen').focus(); }
$('#npOpen').addEventListener('click', e => { if (!e.target.closest('button')) openNowPlaying(); });
$('#npOpen').addEventListener('keydown', e => { if (e.key === 'Enter') openNowPlaying(); });
$('#npClose').addEventListener('click', closeNowPlaying);
$('#npLyricsBtn').addEventListener('click', () => {
  const box = $('#npLyrics');
  box.hidden = !box.hidden;
  $('#npLyricsBtn').classList.toggle('on', !box.hidden);
  if (!box.hidden) loadLyrics();
});
$('#npQueueBtn').addEventListener('click', () => { closeNowPlaying(); openPanel('queue'); });
$('#npDownload').addEventListener('click', e => current() && openMenu([{ title: 'Download as' }, ...downloadSub(current())], e.currentTarget));
$('#npSpeed').addEventListener('click', () => {
  const speeds = [0.75, 1, 1.25, 1.5, 2];
  setSpeed(speeds[(speeds.indexOf(settings.speed) + 1) % speeds.length] || 1);
});
$('#npMore').addEventListener('click', e => current() && openMenu(trackMenu(current()), e.currentTarget));

/* ================================================================ wiring player buttons */
['#playBtn', '#npPlay'].forEach(s => $(s).addEventListener('click', togglePlay));
['#nextBtn', '#npNext'].forEach(s => $(s).addEventListener('click', () => next()));
['#prevBtn', '#npPrev'].forEach(s => $(s).addEventListener('click', prev));
['#shuffleBtn', '#npShuffle'].forEach(s => $(s).addEventListener('click', toggleShuffle));
['#repeatBtn', '#npRepeat'].forEach(s => $(s).addEventListener('click', cycleRepeat));
['#likeBtn', '#npLike'].forEach(s => $(s).addEventListener('click', () => current() ? toggleLike(current()) : null));
$('#muteBtn').addEventListener('click', toggleMute);
$('#sleepBtn').addEventListener('click', e => sleepMenu(e.currentTarget));
$('#newPlaylistBtn').addEventListener('click', async () => { const p = await createPlaylist(); if (p) location.hash = `#/playlist/${p.id}`; });

/* ---------- keyboard shortcuts */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$('#menu').hidden) return closeMenu();
    if (!$('#nowPlaying').hidden) return closeNowPlaying();
    if (!$('#panel').hidden) return closePanel();
  }
  if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey || !$('#modal').hidden) return;
  const d = decks[active];
  const k = e.key;
  const actions = {
    ' ': togglePlay, 'k': togglePlay,
    'ArrowRight': () => seekTo(d.currentTime + 5), 'ArrowLeft': () => seekTo(d.currentTime - 5),
    'ArrowUp': () => setVolume(settings.volume + 0.05), 'ArrowDown': () => setVolume(settings.volume - 0.05),
    'n': () => next(), 'p': prev, 's': toggleShuffle, 'r': cycleRepeat, 'm': toggleMute,
    'l': () => current() && toggleLike(current()),
    'f': () => $('#nowPlaying').hidden ? openNowPlaying() : closeNowPlaying(),
    'q': () => openPanel('queue'),
    '/': () => { closeNowPlaying(); $$('[data-paste] input[type="url"]').find(i => i.offsetParent)?.focus(); },
  };
  const fn = actions[k] || actions[k.toLowerCase()];
  if (!fn) return;
  if (k === ' ' && e.target.closest('button, a, [role="button"], .card')) return;
  e.preventDefault();
  fn();
});

/* ================================================================ native shell hooks */
window.akCommand = cmd => ({
  toggle: togglePlay, next: () => next(), prev,
  play: () => { if (!P.playing) togglePlay(); }, pause: () => { if (P.playing) togglePlay(); },
}[cmd] || (() => { }))();
window.akShared = url => addLink(url);
window.akBack = () => {
  if (!$('#menu').hidden) { closeMenu(); return true; }
  if (!$('#modal').hidden) { $('#modal').firstElementChild.querySelector('[data-cancel]')?.click(); return true; }
  if (!$('#nowPlaying').hidden) { closeNowPlaying(); return true; }
  if (!$('#panel').hidden) { closePanel(); return true; }
  if (currentRoute().name !== 'home') { history.back(); return true; }
  return false;
};
if (IN_APP) document.body.classList.add('in-app');

/* ================================================================ boot */
addEventListener('hashchange', route);
applyTheme();
renderVolume();
renderModes();
hydrate();
setPlaying(false);
restoreSession();
refreshPlaylists().then(route);
// links shared to the installed app (Android share sheet) or opened as /?url=…
{
  const qs = new URLSearchParams(location.search);
  const shared = [qs.get('url'), qs.get('text'), qs.get('title')].find(v => v && /https?:\/\//.test(v));
  if (shared) { history.replaceState(null, '', location.pathname + location.hash); addLink(shared.match(/https?:\/\/\S+/)[0]); }
}
api('/health').then(h => { S.health = h; }).catch(() => IN_APP
  ? toast("The music engine stopped.", { error: true, sticky: true, action: ['Restart', () => { try { AKA.retry(); } catch { location.reload(); } }] })
  : toast("Can't reach the AK Music Player server. Start it with run.sh / run.bat", { error: true, sticky: true }));
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
