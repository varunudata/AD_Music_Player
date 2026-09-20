# Terminal Music Player

A command-line music player written in Node.js that uses VLC as its audio engine.
Node spawns VLC as a child process with the `rc` (remote control) interface and
sends it commands over stdin, reading state back from stdout.

## Requirements
- Node.js 18+
- VLC (https://www.videolan.org). Auto-detected on macOS/Linux/Windows, or set `VLC_PATH`.

## Usage
```
node src/index.js [music-directory]     # default: ./music
```

## Keys
| Key | Action |
|-----|--------|
| space / p / Enter | play / pause |
| s | stop |
| n / b | next / previous track |
| ← / → | seek -10s / +10s |
| + / - | volume |
| r | cycle repeat: all (default) → one → off |
| z | toggle shuffle |
| 1-9 | jump to track |
| q | quit |

## Concepts demonstrated
- **CLI development**: raw-mode keypress handling with `readline`, ANSI rendering.
- **File handling**: recursive directory scan for audio files with `fs`.
- **Process management**: `child_process.spawn`, stdin/stdout piping, request/response
  parsing against VLC's rc prompt, clean shutdown on SIGINT/SIGTERM.

## Debugging
Set `VLC_DEBUG=/path/to/log` to record every command sent to VLC and every raw reply.

## Layout
- `src/index.js`  – CLI: keypress handling, rendering, playlist logic
- `src/vlc.js`    – VLC child-process wrapper (rc interface over stdin/stdout)
- `src/library.js`– recursive audio-file scanner
- `music/`        – default library directory (two spoken sample tracks included)
