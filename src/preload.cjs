const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('anyloader', {
  state: () => ipcRenderer.invoke('state'),
  clipboard: () => ipcRenderer.invoke('clipboard'),
  inspect: url => ipcRenderer.invoke('inspect', url),
  enqueue: (url, options) => ipcRenderer.invoke('enqueue', url, options),
  extractAudio: (id, options) => ipcRenderer.invoke('extract-audio', id, options),
  action: (id, action) => ipcRenderer.invoke('action', id, action),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  settings: value => ipcRenderer.invoke('settings', value),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  onState: fn => { const listener = (_e, state) => fn(state); ipcRenderer.on('state', listener); return () => ipcRenderer.removeListener('state', listener); },
  onNavigate: fn => { const listener = (_e, page) => fn(page); ipcRenderer.on('navigate', listener); return () => ipcRenderer.removeListener('navigate', listener); }
});
