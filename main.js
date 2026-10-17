const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')

let win = null
let closedFlushed = false
let viewState = { sidebar: true, outline: true, focus: false, typewriter: false, dark: false }

const args = parseArgv(process.argv)

function parseArgv(argv) {
  const out = { file: null, shot: null, evalJs: null }
  for (const a of argv.slice(2)) {
    if (a.startsWith('--screenshot=')) out.shot = a.slice(13)
    else if (a.startsWith('--eval=')) out.evalJs = a.slice(7)
    else if (!a.startsWith('-') && /\.(md|markdown|txt)$/i.test(a)) out.file = a
  }
  return out
}

const recentFile = () => path.join(app.getPath('userData'), 'recent.json')

function loadRecent() {
  try {
    return JSON.parse(fs.readFileSync(recentFile(), 'utf8'))
  } catch {
    return []
  }
}

function saveRecentList(list) {
  try {
    fs.writeFileSync(recentFile(), JSON.stringify(list, null, 2))
  } catch {}
}

function send(cmd, arg) {
  if (win && !win.isDestroyed()) win.webContents.send('menu-event', cmd, arg)
}

function buildMenu() {
  const recent = loadRecent().filter((p) => {
    try {
      return fs.existsSync(p)
    } catch {
      return false
    }
  })
  const recentSub = recent.length
    ? [
        ...recent.map((p) => ({
          label: path.basename(p),
          click: () => send('recent-open', p),
        })),
        { type: 'separator' },
        {
          label: '清空最近打开',
          click: () => {
            saveRecentList([])
            buildMenu()
          },
        },
      ]
    : [{ label: '（暂无）', enabled: false }]

  const template = [
    {
      label: '文件',
      submenu: [
        { label: '新建', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: '打开…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { label: '打开文件夹…', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('open-dir') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
        { type: 'separator' },
        { label: '导出 PDF…', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('export-pdf') },
        { label: '导出 HTML…', click: () => send('export-html') },
        { type: 'separator' },
        { label: '最近打开', submenu: recentSub },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        { label: '查找…', accelerator: 'CmdOrCtrl+F', click: () => send('find') },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '文件树侧栏', type: 'checkbox', checked: viewState.sidebar, accelerator: 'CmdOrCtrl+\\', click: () => send('toggle-sidebar') },
        { label: '大纲面板', type: 'checkbox', checked: viewState.outline, accelerator: 'CmdOrCtrl+Shift+\\', click: () => send('toggle-outline') },
        { type: 'separator' },
        { label: '专注模式', type: 'checkbox', checked: viewState.focus, accelerator: 'F8', click: () => send('toggle-focus') },
        { label: '打字机模式', type: 'checkbox', checked: viewState.typewriter, accelerator: 'F9', click: () => send('toggle-typewriter') },
        { label: '深色模式', type: 'checkbox', checked: viewState.dark, accelerator: 'CmdOrCtrl+Shift+D', click: () => send('toggle-dark') },
        { type: 'separator' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'resetZoom', label: '重置缩放' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '快捷键', click: () => send('shortcuts') },
        { label: '关于 Instant Markdown', click: showAbout },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function showAbout() {
  dialog.showMessageBox(win, {
    type: 'info',
    message: 'Instant Markdown',
    detail: '即时渲染 Markdown 编辑器\n版本 0.1.0\n基于 Electron 与 Vditor 构建',
    buttons: ['好'],
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 480,
    backgroundColor: '#f5f5f7',
    title: 'Instant Markdown',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  win.once('ready-to-show', () => win.show())
  win.webContents.on('console-message', (event) => {
    if (event && event.message) console.log('[renderer]', event.message)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('close', (e) => {
    if (closedFlushed) return
    e.preventDefault()
    Promise.resolve(
      win.webContents.executeJavaScript('window.__imFlush ? window.__imFlush() : Promise.resolve()')
    )
      .catch(() => {})
      .then(() => {
        closedFlushed = true
        win.close()
      })
  })
  win.on('closed', () => {
    win = null
  })
  win.webContents.once('did-finish-load', () => {
    if (args.file) win.webContents.send('open-file', args.file)
    if (args.shot) runCapture(args)
  })
}

async function runCapture(a) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  await wait(2600)
  if (a.evalJs) {
    try {
      await win.webContents.executeJavaScript(a.evalJs)
    } catch (err) {
      console.log('[eval error]', String(err))
    }
  }
  await wait(1000)
  try {
    const img = await win.webContents.capturePage()
    fs.mkdirSync(path.dirname(a.shot), { recursive: true })
    fs.writeFileSync(a.shot, img.toPNG())
    console.log('[screenshot]', a.shot)
  } catch (err) {
    console.log('[screenshot error]', String(err))
  }
  app.quit()
}

function listDir(dir, depth) {
  const out = []
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  entries.sort((a, b) => {
    const ad = a.isDirectory()
    const bd = b.isDirectory()
    if (ad !== bd) return ad ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      out.push({ type: 'dir', name: ent.name, path: full, children: depth > 0 ? listDir(full, depth - 1) : [] })
    } else if (/\.(md|markdown|txt)$/i.test(ent.name)) {
      out.push({ type: 'file', name: ent.name, path: full })
    }
  }
  return out
}

function registerIpc() {
  ipcMain.handle('dialog:open-file', async () => {
    const r = await dialog.showOpenDialog(win, {
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
      properties: ['openFile'],
    })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('dialog:open-dir', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('dialog:save-file', async (e, defaultName, content) => {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (r.canceled || !r.filePath) return null
    try {
      fs.writeFileSync(r.filePath, content, 'utf8')
      return r.filePath
    } catch {
      return null
    }
  })

  ipcMain.handle('fs:read', (e, p) => {
    try {
      return { ok: true, content: fs.readFileSync(p, 'utf8') }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:write', (e, p, c) => {
    try {
      fs.writeFileSync(p, c, 'utf8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:tree', (e, root) => listDir(root, 8))

  ipcMain.handle('recent:list', () =>
    loadRecent().filter((p) => {
      try {
        return fs.existsSync(p)
      } catch {
        return false
      }
    })
  )

  ipcMain.handle('recent:add', (e, p) => {
    let list = loadRecent().filter((x) => x !== p)
    list.unshift(p)
    list = list.slice(0, 12)
    saveRecentList(list)
    buildMenu()
  })

  ipcMain.handle('recent:clear', () => {
    saveRecentList([])
    buildMenu()
  })

  ipcMain.handle('read-asset', (e, rel) => {
    const root = path.join(__dirname, 'node_modules')
    const full = path.resolve(root, rel)
    if (!full.startsWith(root)) return { ok: false, error: 'invalid path' }
    try {
      if (/\.(woff2?|ttf|otf)$/i.test(full)) {
        return { ok: true, base64: fs.readFileSync(full).toString('base64') }
      }
      return { ok: true, content: fs.readFileSync(full, 'utf8') }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('export:pdf', async (e, title, html) => {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: (title || '未命名') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    const tmp = path.join(app.getPath('temp'), 'instant-markdown-export.html')
    let pw = null
    try {
      fs.writeFileSync(tmp, html, 'utf8')
      pw = new BrowserWindow({ show: false, webPreferences: { javascript: false } })
      await pw.loadFile(tmp)
      const pdf = await pw.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { marginType: 'custom', top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 },
      })
      fs.writeFileSync(r.filePath, pdf)
      return { ok: true, path: r.filePath }
    } catch (err) {
      return { ok: false, error: String(err) }
    } finally {
      if (pw) pw.destroy()
      fs.unlink(tmp, () => {})
    }
  })

  ipcMain.handle('export:html', async (e, defaultName, html) => {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    try {
      fs.writeFileSync(r.filePath, html, 'utf8')
      return { ok: true, path: r.filePath }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.on('view-state', (e, s) => {
    viewState = { ...viewState, ...s }
    buildMenu()
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (e, argv2) => {
    const a2 = parseArgv(argv2)
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      if (a2.file) win.webContents.send('open-file', a2.file)
    }
  })
  app.whenReady().then(() => {
    buildMenu()
    registerIpc()
    createWindow()
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow()
    })
  })
  app.on('window-all-closed', () => {
    app.quit()
  })
}
