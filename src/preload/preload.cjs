const { contextBridge, ipcRenderer, webUtils } = require('electron')

function subscribe (channel, callback) {
  const handler = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('torr', {
  getState: () => ipcRenderer.invoke('app:state'),
  snapshot: () => ipcRenderer.invoke('torrents:snapshot'),
  add: payload => ipcRenderer.invoke('torrents:add', payload),
  remove: payload => ipcRenderer.invoke('torrents:remove', payload),
  setPaused: payload => ipcRenderer.invoke('torrents:pause', payload),
  setFileSelected: payload => ipcRenderer.invoke('torrents:select-file', payload),
  setAllFilesSelected: payload => ipcRenderer.invoke('torrents:select-all', payload),
  openFolder: infoHash => ipcRenderer.invoke('torrents:open-folder', { infoHash }),
  pickTorrentFile: () => ipcRenderer.invoke('dialog:pick-torrent'),
  pickDownloadDir: () => ipcRenderer.invoke('dialog:pick-download-dir'),
  openExternal: url => ipcRenderer.invoke('app:open-external', { url }),
  pathForFile: file => webUtils.getPathForFile(file),
  onUpdate: callback => subscribe('torrents:update', callback),
  onToast: callback => subscribe('app:toast', callback)
})
