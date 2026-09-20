#!/usr/bin/env node
// Terminal music player: Node.js CLI driving VLC.
import { resolve } from 'node:path';
import readline from 'node:readline';
import { Vlc } from './vlc.js';
import { scanLibrary, fmtTime } from './library.js';

const dir = resolve(process.argv[2] || process.env.MUSIC_DIR || './music');
const tracks = scanLibrary(dir);

if (tracks.length === 0) {
  console.error(`No audio files found in ${dir}\nUsage: node src/index.js [music-directory]`);
  process.exit(1);
}

const vlc = new Vlc().start();
let current = -1;
let paused = false;
let volume = 256;   // VLC rc volume: 0-512, 256 = 100%
const VOL_STEP = Math.round(256 * 0.10);   // 10% per keypress
let time = 0, length = 0;
let shuffle = false;
let repeat = 'all';   // 'all' | 'one' | 'off'

vlc.on('error', (e) => { console.error(`Could not start VLC (${vlc.bin}): ${e.message}`); process.exit(1); });
vlc.on('exit', () => { cleanup(); process.exit(0); });

// ---- rendering --------------------------------------------------------
const c = { dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', reset: '\x1b[0m' };
const WINDOW = 12;

function render() {
  const rows = process.stdout.rows || 30;
  process.stdout.write('\x1b[2J\x1b[H'); // clear screen, home
  console.log(`${c.bold}${c.cyan}♫ Terminal Music Player${c.reset}  ${c.dim}(VLC backend)  ${dir}${c.reset}\n`);

  const start = Math.max(0, Math.min(current - Math.floor(WINDOW / 2), tracks.length - WINDOW));
  const end = Math.min(tracks.length, start + WINDOW);
  for (let i = start; i < end; i++) {
    const mark = i === current ? (paused ? `${c.yellow}⏸` : `${c.green}▶`) : ' ';
    const num = String(i + 1).padStart(3);
    const line = `${mark} ${num}. ${tracks[i].title}${c.reset}`;
    console.log(i === current ? `${c.bold}${line}` : `${c.dim}${line}`);
  }
  if (tracks.length > WINDOW) console.log(`${c.dim}   … ${tracks.length} tracks total${c.reset}`);

  console.log();
  if (current >= 0) {
    const pct = length ? time / length : 0;
    const width = Math.max(10, Math.min(50, (process.stdout.columns || 80) - 20));
    const filled = Math.round(pct * width);
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
    const state = paused ? 'PAUSED' : 'PLAYING';
    console.log(`${c.bold}${state}${c.reset}  ${tracks[current].title}`);
    console.log(`${bar} ${fmtTime(time)} / ${fmtTime(length)}`);
  } else {
    console.log(`${c.dim}Stopped. Press Enter or 'p' to play.${c.reset}\n`);
  }
  const flags = `${shuffle ? 'shuffle ' : ''}${repeat !== 'off' ? 'repeat:' + repeat : ''}`.trim();
  console.log(`vol ${Math.round(volume / 256 * 100)}%  ${flags ? c.yellow + flags + c.reset : ''}`);
  console.log(`\n${c.dim}space/p pause · s stop · n next · b prev · ←/→ seek 10s · +/- volume · r repeat all/one/off · z shuffle · 1-9 jump · q quit${c.reset}`);
  void rows;
}

// ---- playback ---------------------------------------------------------
// `gen` increments on every user-initiated state change. A poll that started
// under an older generation discards its result, so a slow VLC reply can
// never overwrite a newer command (e.g. auto-advance after the user hit stop).
let gen = 0;
let loaded = false;      // has the current track reported a length yet?
let stoppedPolls = 0;

async function playIndex(i) {
  if (i < 0 || i >= tracks.length) return;
  const g = ++gen;
  current = i;
  paused = false;
  time = 0; length = 0; loaded = false; stoppedPolls = 0;
  render();
  await vlc.play(tracks[i].path);
  if (g !== gen) return;               // superseded while VLC was loading
  await vlc.volume(volume);
}

function nextIndex() {
  if (shuffle && tracks.length > 1) {
    let n; do { n = Math.floor(Math.random() * tracks.length); } while (n === current);
    return n;
  }
  return current + 1;
}

// Called when a track finishes or the user presses next.
async function next(userInitiated = false) {
  if (repeat === 'one' && !userInitiated) return playIndex(current);
  const n = nextIndex();
  if (n < tracks.length) return playIndex(n);
  // Reached the end of the playlist: wrap to the first track unless repeat is off.
  if (repeat === 'off' && !userInitiated) return stop();
  return playIndex(0);
}

async function prev() {
  if (time > 3) { time = 0; return vlc.seek(0); }   // restart current track
  return playIndex(current > 0 ? current - 1 : tracks.length - 1);
}

async function togglePause() {
  if (current < 0) return playIndex(0);
  gen++;
  paused = !paused;
  render();
  await vlc.pause();
}

async function stop() {
  gen++;
  current = -1; paused = false; time = 0; length = 0; loaded = false; stoppedPolls = 0;
  render();
  await vlc.stop();
}

// Poll VLC once a second for position and end-of-track.
let polling = false;
setInterval(async () => {
  if (current < 0 || polling) return;
  polling = true;
  const g = gen;
  try {
    const [t, l, state] = await Promise.all([vlc.getTime(), vlc.getLength(), vlc.getState()]);
    if (g !== gen) return;             // state changed while we were waiting; drop stale reply
    if (state === 'stopped') {
      // VLC reports stopped with time/length 0 once a track ends.
      if (loaded || ++stoppedPolls >= 2) { loaded = false; stoppedPolls = 0; return next(); }
      return;
    }
    stoppedPolls = 0;
    if (l > 0) { loaded = true; time = t; length = l; }
    paused = state === 'paused';       // resync if VLC changed state on its own
    render();
  } finally { polling = false; }
}, 1000);

// ---- input ------------------------------------------------------------
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();

process.stdin.on('keypress', async (str, key) => {
  if (!key) return;
  if (key.ctrl && key.name === 'c') return quit();
  switch (key.name) {
    case 'q': return quit();
    case 'space': case 'p': case 'return': return togglePause();
    case 's': return stop();
    case 'n': return next(true);
    case 'b': return prev();
    case 'right': await vlc.seek(`+10`); return;
    case 'left': await vlc.seek(`-10`); return;
    case 'r': repeat = repeat === 'all' ? 'one' : repeat === 'one' ? 'off' : 'all'; return render();
    case 'z': shuffle = !shuffle; return render();
  }
  if (str === '+' || str === '=') { volume = Math.min(512, volume + VOL_STEP); await vlc.volume(volume); return render(); }
  if (str === '-') { volume = Math.max(0, volume - VOL_STEP); await vlc.volume(volume); return render(); }
  if (/^[1-9]$/.test(str)) return playIndex(parseInt(str, 10) - 1);
});

function cleanup() {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdout.write('\x1b[2J\x1b[H');
}

let quitting = false;
function quit() {
  if (quitting) return;
  quitting = true;
  cleanup();
  vlc.quit();
  console.log('Bye.');
  setTimeout(() => process.exit(0), 600);
}

process.on('SIGINT', quit);
process.on('SIGTERM', quit);
process.on('SIGHUP', quit);

render();
