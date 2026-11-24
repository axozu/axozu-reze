'use strict';
const path = require('path');
const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron');

const IMG_W = 2252;
const IMG_H = 1544;
const ASPECT = IMG_W / IMG_H;          // ~1.459
const START_SCREEN_FRACTION = 0.7;     // стартовый размер — ~70% рабочей области экрана
const MIN_WIDTH = 360;

let win = null;

function initialSize() {
  const { workArea } = screen.getPrimaryDisplay();
  let width = Math.round(Math.min(workArea.width * START_SCREEN_FRACTION,
    workArea.height * START_SCREEN_FRACTION * ASPECT));
  width = Math.max(MIN_WIDTH, width);
  return { width, height: Math.round(width / ASPECT) };
}

function createWindow() {
  const { width, height } = initialSize();
  win = new BrowserWindow({
    width,
    height,
    minWidth: MIN_WIDTH,
    minHeight: Math.round(MIN_WIDTH / ASPECT),
    frame: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: '#1a1720',
    title: 'axozu',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.setAspectRatio(ASPECT);

  // Подстраховка: если ОС всё же отдала размер не в пропорции — поправим.
  win.on('will-resize', (e, newBounds, details) => {
    const w = newBounds.width;
    const h = newBounds.height;
    if (Math.abs(w / h - ASPECT) < 0.01) return;
    e.preventDefault();
    const edge = details && details.edge ? details.edge : '';
    const byHeight = edge === 'top' || edge === 'bottom';
    const nw = byHeight ? Math.round(h * ASPECT) : w;
    const nh = byHeight ? h : Math.round(w / ASPECT);
    win.setBounds({ x: newBounds.x, y: newBounds.y, width: nw, height: nh });
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
}

// --- Перетаскивание за любую область -----------------------------------------
// -webkit-app-region: drag не подходит: он съедает двойной клик (развернуть окно)
// и правую кнопку (системное меню). Поэтому двигаем окно вручную.
let drag = null;
ipcMain.on('win:drag-start', () => {
  if (!win) return;
  drag = { cursor: screen.getCursorScreenPoint(), bounds: win.getBounds() };
});
ipcMain.on('win:drag-move', () => {
  if (!win || !drag) return;
  const c = screen.getCursorScreenPoint();
  const { x, y, width, height } = drag.bounds;
  // фиксированные width/height — чтобы окно не «росло» при DPI-масштабировании Windows
  win.setBounds({ x: x + c.x - drag.cursor.x, y: y + c.y - drag.cursor.y, width, height });
});
ipcMain.on('win:drag-end', () => { drag = null; });

ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:close', () => win && win.close());

let grade = { current: '', list: [] };
ipcMain.on('grade:state', (_e, current, list) => { grade = { current, list }; });

ipcMain.on('win:menu', () => {
  if (!win) return;
  const gradeItems = grade.list.map(([name, label]) => ({
    label,
    type: 'radio',
    checked: name === grade.current,
    click: () => win && win.webContents.send('grade:set', name),
  }));
  const menu = Menu.buildFromTemplate([
    {
      label: 'Поверх всех окон',
      type: 'checkbox',
      checked: win.isAlwaysOnTop(),
      click: (item) => win && win.setAlwaysOnTop(item.checked, 'floating'),
    },
    { type: 'separator' },
    ...(gradeItems.length ? [{ label: 'Цвет', submenu: gradeItems }, { type: 'separator' }] : []),
    { label: 'Свернуть', click: () => win && win.minimize() },
    { label: 'Закрыть', accelerator: 'Esc', click: () => win && win.close() },
  ]);
  menu.popup({ window: win });
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
