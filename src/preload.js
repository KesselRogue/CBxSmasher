'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('cbx', {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  chooseOutputDir: () => ipcRenderer.invoke('choose-output-dir'),
  openFolder: (targetPath) => ipcRenderer.invoke('open-folder', targetPath),
  filterComicFiles: (filePaths) => ipcRenderer.invoke('filter-comic-files', filePaths),
  chooseInputFiles: () => ipcRenderer.invoke('choose-input-files'),
  convertFiles: (args) => ipcRenderer.invoke('convert-files', args),
  onProgress: (callback) => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('convert-progress', listener);
    return () => ipcRenderer.removeListener('convert-progress', listener);
  },
});
