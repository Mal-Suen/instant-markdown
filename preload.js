const { contextBridge, ipcRenderer, webUtils } = require('electron')

// main 经 additionalArguments 传入；打包版默认不暴露渲染层测试钩子（与 --eval 门控同源）
const devHooks = (() => {
  try {
    return process.argv.indexOf('im-dev-hooks') >= 0
  } catch {
    return false
  }
})()

contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('dialog:open-file'),
  openDir: () => ipcRenderer.invoke('dialog:open-dir'),
  saveFileDialog: (defaultName, content) => ipcRenderer.invoke('dialog:save-file', defaultName, content),
  readFile: (p) => ipcRenderer.invoke('fs:read', p),
  writeFile: (p, c, enc) => ipcRenderer.invoke('fs:write', p, c, enc),
  readTree: (p) => ipcRenderer.invoke('fs:tree', p),
  readImage: (p) => ipcRenderer.invoke('fs:read-image', p),
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
  devHooks,
})
