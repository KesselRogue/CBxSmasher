'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const Store = require('electron-store');

const { convertComic } = require('./converter');
const fs = require('fs/promises');

const store = new Store({
  defaults: {
    outputDir: app.getPath('downloads'),
    quality: 82,
    lossless: false,
  },
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 780,
    height: 640,
    minWidth: 560,
    minHeight: 480,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // webUtils.getPathForFile + fs access from the preload script need this
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-settings', () => ({
  outputDir: store.get('outputDir'),
  quality: store.get('quality'),
  lossless: store.get('lossless'),
}));

ipcMain.handle('save-settings', (_event, settings) => {
  if (typeof settings.outputDir === 'string') store.set('outputDir', settings.outputDir);
  if (typeof settings.quality === 'number') store.set('quality', settings.quality);
  if (typeof settings.lossless === 'boolean') store.set('lossless', settings.lossless);
  return true;
});

ipcMain.handle('choose-output-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose an output folder',
    defaultPath: store.get('outputDir'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const dir = result.filePaths[0];
  store.set('outputDir', dir);
  return dir;
});

ipcMain.handle('open-folder', (_event, targetPath) => {
  shell.showItemInFolder(targetPath);
});

/**
 * Filters a list of dropped/browsed paths down to real, readable .cbr/.cbz
 * files (rejecting directories and anything else silently dropped onto the
 * window), preserving the caller's order.
 */
async function filterComicFiles(filePaths) {
  const valid = [];
  for (const filePath of filePaths) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.cbr' && ext !== '.cbz') continue;
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) valid.push(filePath);
    } catch {
      // Vanished or inaccessible between drop and read — skip it.
    }
  }
  return valid;
}

ipcMain.handle('filter-comic-files', (_event, filePaths) => filterComicFiles(filePaths));

ipcMain.handle('choose-input-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose comic files to convert',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Comic archives', extensions: ['cbr', 'cbz'] }],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('convert-files', async (event, { filePaths, outputDir, quality, lossless }) => {
  store.set({ outputDir, quality, lossless });

  const results = [];
  for (const inputPath of filePaths) {
    const baseName = path.basename(inputPath);
    try {
      const result = await convertComic({
        inputPath,
        outputDir,
        quality,
        lossless,
        onProgress: (update) => {
          event.sender.send('convert-progress', { ...update, inputPath });
        },
      });
      results.push({ ok: true, ...result });
    } catch (err) {
      results.push({ ok: false, inputPath, fileName: baseName, error: err.message });
      event.sender.send('convert-progress', { stage: 'error', file: baseName, inputPath, error: err.message });
    }
  }
  return results;
});
