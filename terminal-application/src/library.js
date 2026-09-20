// Scans a directory (recursively) for audio files.
import { readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const AUDIO_EXT = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.opus', '.wma', '.aiff']);

export function scanLibrary(dir) {
  const tracks = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const full = join(d, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (AUDIO_EXT.has(extname(name).toLowerCase())) {
        tracks.push({ path: full, title: basename(name, extname(name)) });
      }
    }
  };
  walk(dir);
  tracks.sort((a, b) => a.title.localeCompare(b.title));
  return tracks;
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}
