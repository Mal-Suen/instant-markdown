const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('dialog:open-file'),
  openDir: () => ipcRenderer.invoke('dialog:open-dir'),
  saveFileDialog: (defaultName, content) => ipcRenderer.invoke('dialog:save-file', defaultName, content),
  readFile: (p) => ipcRenderer.invoke('fs:read', p),
  writeFile: (p, c) => ipcRenderer.invoke('fs:write', p, c),
  readTree: (p) => ipcRenderer.invoke('fs:tree', p),
  recentList: () => ipcRenderer.invoke('recent:list'),
  recentAdd: (p) => ipcRenderer.invoke('recent:add', p),
  recentClear: () => ipcRenderer.invoke('recent:clear'),
  readAsset: (rel) => ipcRenderer.invoke('read-asset', rel),
  exportPdf: (title, html) => ipcRenderer.invoke('export:pdf', title, html),
  exportHtml: (defaultName, html) => ipcRenderer.invoke('export:html', defaultName, html),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  onMenuEvent: (cb) => ipcRenderer.on('menu-event', (e, cmd, arg) => cb(cmd, arg)),
  onOpenFile: (cb) => ipcRenderer.on('open-file', (e, p) => cb(p)),
  onConfirmClose: (cb) => ipcRenderer.on('confirm-close', () => cb()),
  confirmUnsaved: (message) => ipcRenderer.invoke('confirm-unsaved', message),
  closeReply: (action) => ipcRenderer.send('close-reply', action),
  syncViewState: (s) => ipcRenderer.send('view-state', s),
})
