const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('daybookDesktop', {
  load: () => ipcRenderer.invoke('daybook:load'),
  save: (records) => ipcRenderer.invoke('daybook:save', records),
  exportFile: (kind, date, data) => ipcRenderer.invoke('daybook:export', kind, date, data),
  onReminders: (listener) => {
    ipcRenderer.on('daybook:reminders', (_event, titles) => listener(titles));
  },
});
