// VLC process wrapper. Spawns VLC with the "rc" (remote control) interface
// and drives it by writing commands to stdin and parsing stdout.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import { appendFileSync } from 'node:fs';

const DEBUG = process.env.VLC_DEBUG;
const log = (m) => { if (DEBUG) appendFileSync(DEBUG, `${Date.now() % 100000} ${m}\n`); };

const CANDIDATES = [
  process.env.VLC_PATH,
  '/Applications/VLC.app/Contents/MacOS/VLC',
  '/usr/bin/vlc',
  '/usr/local/bin/vlc',
  'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
  'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
].filter(Boolean);

export function findVlc() {
  for (const p of CANDIDATES) if (existsSync(p)) return p;
  return 'vlc'; // hope it is on PATH
}

export class Vlc extends EventEmitter {
  constructor() {
    super();
    this.bin = findVlc();
    this.proc = null;
    this.buffer = '';
    this.pending = [];
  }

  start() {
    this.proc = spawn(this.bin, [
      '--intf', 'rc',           // remote-control interface on stdin/stdout
      '--no-video',
      '--quiet',
      '--rc-fake-tty',
      '--no-playlist-autostart',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    this.proc.stdout.on('data', (chunk) => this._onData(chunk.toString()));
    this.proc.stderr.on('data', () => {});
    this.proc.on('exit', (code) => this.emit('exit', code));
    this.proc.on('error', (err) => this.emit('error', err));
    // Whatever way Node exits, never leave an orphaned VLC behind.
    process.on('exit', () => { try { this.proc.kill('SIGKILL'); } catch {} });
    return this;
  }

  _onData(text) {
    log('<< ' + JSON.stringify(text));
    this.buffer += text;
    // rc prompts with "> " after each command; treat that as end of response.
    let idx;
    while ((idx = this.buffer.indexOf('> ')) !== -1) {
      const chunk = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const resolve = this.pending.shift();
      if (resolve) resolve(chunk.trim());
    }
  }

  // Send a command and wait for VLC's reply.
  send(cmd, timeoutMs = 1500) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const i = this.pending.indexOf(resolve);
        if (i !== -1) this.pending.splice(i, 1);
        resolve('');
      }, timeoutMs);
      this.pending.push((out) => { clearTimeout(timer); resolve(out); });
      log('>> ' + cmd);
      this.proc.stdin.write(cmd + '\n');
    });
  }

  play(file)   { return this.send('clear').then(() => this.send(`add ${pathToFileURL(file).href}`)); }
  pause()      { return this.send('pause'); }
  resume()     { return this.send('play'); }
  stop()       { return this.send('stop'); }
  seek(sec)    { return this.send(`seek ${sec}`); }
  volume(v)    { return this.send(`volume ${v}`); }
  volUp()      { return this.send('volup 1'); }
  volDown()    { return this.send('voldown 1'); }

  async isPlaying() { return (await this.send('is_playing')) === '1'; }
  // 'playing' | 'paused' | 'stopped'
  async getState() {
    const m = /\( state (\w+) \)/.exec(await this.send('status'));
    return m ? m[1] : 'stopped';
  }
  async getTime()   { return parseInt(await this.send('get_time'), 10) || 0; }
  async getLength() { return parseInt(await this.send('get_length'), 10) || 0; }

  quit() {
    if (!this.proc) return;
    try { this.proc.stdin.write('quit\n'); } catch {}
    setTimeout(() => { try { this.proc.kill('SIGKILL'); } catch {} }, 500);
  }
}
