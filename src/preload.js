const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zapret', {
  state: () => ipcRenderer.invoke('state'),
  call: (name, ...args) => ipcRenderer.invoke('call', name, ...args),
  win: what => ipcRenderer.send('win', what),
  on: (channel, fn) => {
    if (['state', 'toast', 'open'].includes(channel)) ipcRenderer.on(channel, (_, v) => fn(v));
  },
});
