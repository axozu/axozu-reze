'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('axozu', {
  minimize: () => ipcRenderer.send('win:minimize'),
  close: () => ipcRenderer.send('win:close'),
  showMenu: () => ipcRenderer.send('win:menu'),
  dragStart: () => ipcRenderer.send('win:drag-start'),
  dragMove: () => ipcRenderer.send('win:drag-move'),
  dragEnd: () => ipcRenderer.send('win:drag-end'),
  // цветокор: renderer сообщает текущий пресет и список, main шлёт выбор из меню
  setGradeState: (current, list) => ipcRenderer.send('grade:state', current, list),
  onGrade: (cb) => ipcRenderer.on('grade:set', (_e, name) => cb(name)),
});
