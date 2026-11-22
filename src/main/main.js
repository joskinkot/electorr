import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TorrentManager } from './torrent-manager.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const RENDERER_DIR = path.join(ROOT, 'src', 'renderer')
const PRELOAD = path.join(ROOT, 'src', 'preload', 'preload.cjs')
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json')
const DEFAULT_DOWNLOAD_DIR = path.join(app.getPath('downloads'), 'torr')

const isDev = process.argv.includes('--dev')

let win = null
let manager = null
let quitting = false
let restored = false
let saveTimer = null
let pushTimer = null

const settings = {
  downloadPath: DEFAULT_DOWNLOAD_DIR,
  torrents: []
}

function loadSettings () {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
    if (typeof raw.downloadPath === 'string' && raw.downloadPath) settings.downloadPath = raw.downloadPath
    if (Array.isArray(raw.torrents)) {
      settings.torrents = raw.torrents.filter(item => item && typeof item.torrentId === 'string')
    }
  } catch {}
  try {
    fs.mkdirSync(settings.downloadPath, { recursive: true })
  } catch {}
}

function writeSettings () {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true })
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
  } catch (err) {
    console.error('Не удалось сохранить настройки:', err.message)
  }
}

function persistSoon () {
  if (!manager || !restored) return
  settings.torrents = manager.persisted()
  clearTimeout(saveTimer)
  saveTimer = setTimeout(writeSettings, 400)
}

function pushUpdate () {
  if (!win || win.isDestroyed()) return
  win.webContents.send('torrents:update', manager.snapshot())
}

function toast (message, kind = 'info') {
  if (!win || win.isDestroyed()) return
  win.webContents.send('app:toast', { message, kind })
}

function createWindow () {
  win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: false,
    title: 'torr',
    backgroundColor: '#0b0e14',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  win.loadFile(path.join(RENDERER_DIR, 'index.html'))
  win.once('ready-to-show', () => win.show())

  if (isDev) {
    win.webContents.on('console-message', event => {
      console.log(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`)
    })
    win.webContents.on('did-fail-load', (_event, code, description, url) => {
      console.error(`[renderer] did-fail-load ${code} ${description} ${url}`)
    })
    win.webContents.openDevTools({ mode: 'detach' })
  }

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F12') {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) {
      win.webContents.reload()
      event.preventDefault()
    }
  })

  // Внешние ссылки — в системный браузер, навигацию внутри окна запрещаем.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault()
  })

  win.on('closed', () => { win = null })
}

function registerIpc () {
  ipcMain.handle('app:state', () => ({
    downloadPath: settings.downloadPath,
    port: manager.port,
    version: app.getVersion()
  }))

  ipcMain.handle('torrents:snapshot', () => manager.snapshot())

  ipcMain.handle('torrents:add', async (_event, payload = {}) => {
    try {
      const result = await manager.add(payload)
      pushUpdate()
      persistSoon()
      return { ok: true, ...result }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('torrents:remove', async (_event, { infoHash, deleteFiles } = {}) => {
    try {
      const removed = await manager.remove(infoHash, deleteFiles)
      pushUpdate()
      persistSoon()
      return { ok: removed }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('torrents:pause', async (_event, { infoHash, paused } = {}) => {
    try {
      const done = await manager.setPaused(infoHash, !!paused)
      pushUpdate()
      persistSoon()
      return { ok: done }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('torrents:select-file', async (_event, { infoHash, index, selected } = {}) => {
    try {
      const done = await manager.setFileSelected(infoHash, index, !!selected)
      pushUpdate()
      return { ok: done }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('torrents:select-all', async (_event, { infoHash, selected } = {}) => {
    try {
      const done = await manager.setAllFilesSelected(infoHash, !!selected)
      pushUpdate()
      return { ok: done }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('torrents:open-folder', async (_event, { infoHash } = {}) => {
    try {
      const folder = await manager.folderFor(infoHash)
      if (!folder) return { ok: false, error: 'Торрент не найден' }
      fs.mkdirSync(folder, { recursive: true })
      const error = await shell.openPath(folder)
      return error ? { ok: false, error } : { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('dialog:pick-torrent', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Открыть .torrent',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Torrent', extensions: ['torrent'] }]
    })
    return { ok: !canceled, filePaths: canceled ? [] : filePaths }
  })

  ipcMain.handle('dialog:pick-download-dir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Папка для загрузок',
      defaultPath: settings.downloadPath,
      properties: ['openDirectory', 'createDirectory']
    })
    if (canceled || !filePaths[0]) return { ok: false }
    settings.downloadPath = filePaths[0]
    manager.setDownloadPath(settings.downloadPath)
    writeSettings()
    pushUpdate()
    return { ok: true, downloadPath: settings.downloadPath }
  })

  ipcMain.handle('app:open-external', async (_event, { url } = {}) => {
    if (!/^https?:\/\//i.test(String(url))) return { ok: false }
    await shell.openExternal(url)
    return { ok: true }
  })
}

async function restoreTorrents () {
  for (const item of settings.torrents) {
    try {
      await manager.add({ magnet: item.torrentId, paused: !!item.paused })
    } catch (err) {
      console.warn('Не удалось восстановить торрент:', err.message)
    }
  }
  restored = true
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  loadSettings()

  manager = new TorrentManager({ downloadPath: settings.downloadPath })
  manager.on('changed', () => {
    pushUpdate()
    persistSoon()
  })
  manager.on('torrent-error', ({ name, message }) => toast(`${name}: ${message}`, 'error'))
  manager.on('fatal', err => toast(`Критическая ошибка клиента: ${err.message}`, 'error'))

  try {
    await manager.init()
  } catch (err) {
    dialog.showErrorBox('torr', `Не удалось запустить торрент-клиент:\n${err.message}`)
    app.quit()
    return
  }

  registerIpc()
  createWindow()
  await restoreTorrents()

  pushTimer = setInterval(pushUpdate, 1000)
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', event => {
  if (quitting || !manager) return
  quitting = true
  event.preventDefault()
  clearInterval(pushTimer)
  clearTimeout(saveTimer)
  if (restored) settings.torrents = manager.persisted()
  writeSettings()

  const finish = () => app.exit(0)
  setTimeout(finish, 3000)
  manager.destroy().then(finish, finish)
})
