# CBxSmasher

A small Windows desktop app for shrinking digital comic files. Drag one or
more `.cbr`/`.cbz` files onto the window, and CBxSmasher re-encodes every
page image to WebP and writes a new, much smaller `.cbz` to an output folder
of your choosing. Non-image entries (like a `ComicInfo.xml` metadata sidecar)
are carried over untouched.

## Why

CBR/CBZ archives are usually just JPEG or PNG pages zipped/rarred together.
WebP typically gets pages down to 60-80% of their original size at
visually-lossless quality, which adds up fast across a real collection.

## Status

Early scaffold — the core drag-and-drop → convert → save pipeline is in
place and unit-tested against a synthetic archive. Not yet packaged/released.

## Tech stack

- **Electron** (Chromium + Node) for the desktop shell and native
  drag-and-drop.
- **[sharp](https://github.com/lovell/sharp)** for image decoding/WebP
  encoding.
- **[node-unrar-js](https://github.com/YuJianrong/node-unrar-js)** (a WASM
  build of unrar) to read `.cbr`/RAR archives — no external `unrar.exe`
  needed.
- **[adm-zip](https://github.com/cthackers/adm-zip)** to read `.cbz`/ZIP
  archives and write the converted output archive.
- **electron-builder** to package a distributable Windows installer/portable
  exe.

Archive format is detected from the file's actual magic bytes, not just its
extension, since real-world `.cbr` files are occasionally actually ZIP data
(and vice versa).

## Getting started

Requires [Node.js](https://nodejs.org/) 20+.

```bash
npm install
npm start
```

The first `npm install` downloads Electron's ~180 MB runtime binary, so it
can take a minute depending on your connection.

## Building a Windows installer

```bash
npm run dist:win
```

Output lands in `dist/` (an NSIS installer and a portable `.exe`).

## How it works

1. Drop `.cbr`/`.cbz` files on the window (or use "Browse files…").
2. Pick an output folder, a WebP quality (or toggle lossless), and click
   **Convert All**.
3. Each archive's pages are read, sorted into natural reading order,
   re-encoded to WebP at the chosen quality, and repackaged into a new
   `.cbz` in the output folder — leaving your originals untouched.

## Project layout

```
src/
  main.js             Electron main process: window, dialogs, IPC handlers
  preload.js          contextBridge API exposed to the renderer
  converter.js         Core conversion pipeline (extract → convert → repack)
  archiveReader.js       Format-sniffing zip/rar entry reader
  naturalSort.js           "page10" sorts after "page2", not before it
  renderer/                 UI (drag-and-drop, settings, queue, progress)
```

## License

MIT
