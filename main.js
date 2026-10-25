const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')

let win = null
let viewState = { sidebar: true, outline: true, focus: false, typewriter: false, dark: false, codeWrap: true }

const args = parseArgv(process.argv)

if (args.userData) {
  try {
    app.setPath('userData', args.userData)
  } catch {}
}

function parseArgv(argv) {
  const start = app.isPackaged ? 1 : 2
  const hooksAllowed = !app.isPackaged || process.env.IM_DEV_TOOLS === '1'
  const out = { file: null, shot: null, evalJs: null, userData: null }
  for (const a of argv.slice(start)) {
    if (a.startsWith('--screenshot=')) {
      if (hooksAllowed) out.shot = a.slice(13)
    } else if (a.startsWith('--eval=')) {
      if (hooksAllowed) out.evalJs = a.slice(7)
    } else if (a.startsWith('--preeval=')) {
      if (hooksAllowed) out.preeval = a.slice(10)
    } else if (a.startsWith('--userdata=')) out.userData = a.slice(11)
    else if (a === '--keytest') {
      if (hooksAllowed) out.keytest = true
    } else if (!a.startsWith('-') && /\.(md|markdown|txt)$/i.test(a)) out.file = a
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
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  if (target && !target.isDestroyed()) target.webContents.send('menu-event', cmd, arg)
}

function winFor(e) {
  if (e && e.sender) {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (w) return w
  }
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || win
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
        { label: '新建窗口', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
        { label: '打开…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { label: '打开文件夹…', click: () => send('open-dir') },
        { label: '重新打开关闭的文件', accelerator: 'CmdOrCtrl+Shift+T', click: () => send('reopen-closed') },
        { label: '最近使用', submenu: recentSub },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
        { type: 'separator' },
        {
          label: '导出',
          submenu: [
            { label: 'PDF…', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('export-pdf') },
            { label: 'HTML…', click: () => send('export-html') },
          ],
        },
        { type: 'separator' },
        { label: '关闭', accelerator: 'CmdOrCtrl+W', click: () => send('close-tab') },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做', accelerator: 'CmdOrCtrl+Y' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        { label: '查找…', accelerator: 'CmdOrCtrl+F', click: () => send('find') },
        { label: '替换…', accelerator: 'CmdOrCtrl+H', click: () => send('replace') },
        { label: '查找下一个', accelerator: 'F3', click: () => send('find-next') },
        { label: '查找上一个', accelerator: 'Shift+F3', click: () => send('find-prev') },
      ],
    },
    {
      label: '段落',
      submenu: [
        { label: '一级标题', accelerator: 'CmdOrCtrl+1', click: () => send('heading', 1) },
        { label: '二级标题', accelerator: 'CmdOrCtrl+2', click: () => send('heading', 2) },
        { label: '三级标题', accelerator: 'CmdOrCtrl+3', click: () => send('heading', 3) },
        { label: '四级标题', accelerator: 'CmdOrCtrl+4', click: () => send('heading', 4) },
        { label: '五级标题', accelerator: 'CmdOrCtrl+5', click: () => send('heading', 5) },
        { label: '六级标题', accelerator: 'CmdOrCtrl+6', click: () => send('heading', 6) },
        { label: '正文', accelerator: 'CmdOrCtrl+0', click: () => send('heading', 0) },
        { type: 'separator' },
        { label: '提升标题', accelerator: 'CmdOrCtrl+=', click: () => send('heading', 'up') },
        { label: '降低标题', accelerator: 'CmdOrCtrl+-', click: () => send('heading', 'down') },
        { type: 'separator' },
        { label: '表格', accelerator: 'CmdOrCtrl+T', click: () => send('act', 'table') },
        { label: '代码块', accelerator: 'CmdOrCtrl+Shift+K', click: () => send('act', 'code') },
        { label: '数学块', accelerator: 'CmdOrCtrl+Shift+M', click: () => send('act', 'math') },
        { label: '引用', accelerator: 'CmdOrCtrl+Shift+Q', click: () => send('act', 'quote') },
        { type: 'separator' },
        { label: '有序列表', accelerator: 'CmdOrCtrl+Shift+[', click: () => send('act', 'ordered-list') },
        { label: '无序列表', accelerator: 'CmdOrCtrl+Shift+]', click: () => send('act', 'list') },
        { label: '任务列表', click: () => send('act', 'check') },
        { label: '水平分割线', click: () => send('act', 'line') },
        { type: 'separator' },
        { label: '缩进', accelerator: 'CmdOrCtrl+]', click: () => send('act', 'indent') },
        { label: '减少缩进', accelerator: 'CmdOrCtrl+[', click: () => send('act', 'outdent') },
      ],
    },
    {
      label: '格式',
      submenu: [
        { label: '加粗', accelerator: 'CmdOrCtrl+B', click: () => send('act', 'bold') },
        { label: '斜体', accelerator: 'CmdOrCtrl+I', click: () => send('act', 'italic') },
        { label: '代码', accelerator: 'CmdOrCtrl+Shift+`', click: () => send('act', 'inline-code') },
        { label: '删除线', accelerator: 'Alt+Shift+5', click: () => send('act', 'strike') },
        { type: 'separator' },
        { label: '超链接', accelerator: 'CmdOrCtrl+K', click: () => send('act', 'link') },
        { label: '图像', accelerator: 'CmdOrCtrl+Shift+I', click: () => send('act', 'image') },
        { type: 'separator' },
        { label: '清除格式', accelerator: 'CmdOrCtrl+\\', click: () => send('act', 'clear-format') },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '侧边栏', type: 'checkbox', checked: viewState.sidebar, accelerator: 'CmdOrCtrl+Shift+L', click: () => send('toggle-sidebar') },
        { label: '大纲', type: 'checkbox', checked: viewState.outline, accelerator: 'CmdOrCtrl+Shift+1', click: () => send('toggle-outline') },
        { type: 'separator' },
        { label: '专注模式', type: 'checkbox', checked: viewState.focus, accelerator: 'F8', click: () => send('toggle-focus') },
        { label: '打字机模式', type: 'checkbox', checked: viewState.typewriter, accelerator: 'F9', click: () => send('toggle-typewriter') },
        { label: '深色模式', type: 'checkbox', checked: viewState.dark, accelerator: 'CmdOrCtrl+Shift+D', click: () => send('toggle-dark') },
        { label: '代码块自动换行', type: 'checkbox', checked: viewState.codeWrap, click: () => send('toggle-code-wrap') },
        { type: 'separator' },
        { label: '切换文档', click: () => send('cycle-tab') },
        { type: 'separator' },
        { role: 'zoomIn', label: '放大', accelerator: 'CmdOrCtrl+Shift+=' },
        { role: 'zoomOut', label: '缩小', accelerator: 'CmdOrCtrl+Shift+-' },
        { role: 'resetZoom', label: '实际大小', accelerator: 'CmdOrCtrl+Shift+0' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏', accelerator: 'F11' },
        { role: 'toggleDevTools', label: '开发者工具', accelerator: 'Shift+F12' },
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

function createWindow(isPrimary) {
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
    if (win.__closeConfirmed || args.shot) return
    e.preventDefault()
    if (!win.__closePending) {
      win.__closePending = true
      win.webContents.send('confirm-close')
    }
  })
  const thisWin = win
  win.on('closed', () => {
    if (win === thisWin) win = null
  })
  if (isPrimary) {
    win.webContents.once('did-finish-load', () => {
      if (args.file) win.webContents.send('open-file', path.resolve(args.file))
      if (args.shot) runCapture(args)
    })
  }
}

async function runCapture(a) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  await wait(2600)
  if (a.preeval && win) {
    try {
      await win.webContents.executeJavaScript(a.preeval)
    } catch (err) {
      console.log('[preeval error]', String(err))
    }
    await wait(250)
  }
  if (a.keytest && win) {
    const wc = win.webContents
    let dbg = null
    try {
      wc.debugger.attach('1.3')
      dbg = wc.debugger
    } catch {}
    if (dbg) {
      // 阶段A：混合输入——直接 ** ＋ 输入法组字提交中文 ＋ 直接 **
      await dbg.sendCommand('Input.insertText', { text: '**' })
      await wait(200)
      await dbg.sendCommand('Input.imeSetComposition', { text: '加', selectionStart: 1, selectionEnd: 1 })
      await wait(150)
      await dbg.sendCommand('Input.imeSetComposition', { text: '加粗', selectionStart: 2, selectionEnd: 2 })
      await wait(150)
      await dbg.sendCommand('Input.insertText', { text: '加粗' })
      await wait(300)
      await dbg.sendCommand('Input.insertText', { text: '**' })
      await wait(500)
      // 阶段B：整串经输入法组字提交
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
      await wait(150)
      await dbg.sendCommand('Input.imeSetComposition', { text: '**整体', selectionStart: 3, selectionEnd: 3 })
      await wait(150)
      await dbg.sendCommand('Input.imeSetComposition', { text: '**整体提交', selectionStart: 5, selectionEnd: 5 })
      await wait(150)
      await dbg.sendCommand('Input.insertText', { text: '**整体提交**' })
      await wait(600)
      try {
        dbg.detach()
      } catch {}
    }
  }
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

function decodeFileText(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf.subarray(3))
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf.subarray(2))
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf.subarray(2))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('gbk').decode(buf)
  }
}

function registerIpc() {
  ipcMain.handle('dialog:open-file', async (e) => {
    const r = await dialog.showOpenDialog(winFor(e), {
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
      properties: ['openFile'],
    })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('dialog:open-dir', async (e) => {
    const r = await dialog.showOpenDialog(winFor(e), { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('dialog:save-file', async (e, defaultName, content) => {
    const r = await dialog.showSaveDialog(winFor(e), {
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

  const TEXT_EXT = /\.(md|markdown|txt)$/i

  ipcMain.handle('fs:read', (e, p) => {
    if (typeof p !== 'string' || !TEXT_EXT.test(p)) {
      return { ok: false, error: '仅支持读取 Markdown/文本文件' }
    }
    try {
      return { ok: true, content: decodeFileText(fs.readFileSync(p)) }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:write', (e, p, c) => {
    if (typeof p !== 'string' || typeof c !== 'string' || !TEXT_EXT.test(p)) {
      return { ok: false, error: '仅支持写入 Markdown/文本文件' }
    }
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
    const r = await dialog.showSaveDialog(winFor(e), {
      defaultPath: (title || '未命名') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    const tmp = path.join(app.getPath('temp'), 'instant-markdown-export-' + Date.now() + '-' + process.pid + '.html')
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
    const r = await dialog.showSaveDialog(winFor(e), {
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

  ipcMain.handle('confirm-unsaved', async (e, message) => {
    const r = await dialog.showMessageBox(winFor(e), {
      type: 'question',
      message: message || '有未保存的修改。',
      buttons: ['保存', '不保存', '取消'],
      defaultId: 0,
      cancelId: 2,
    })
    return ['save', 'discard', 'cancel'][r.response]
  })

  ipcMain.on('close-reply', (e, action) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    if (action === 'close') {
      w.__closeConfirmed = true
      w.close()
    } else {
      w.__closePending = false
    }
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (e, argv2) => {
    const a2 = parseArgv(argv2)
    const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (target) {
      if (target.isMinimized()) target.restore()
      target.focus()
      if (a2.file) target.webContents.send('open-file', path.resolve(a2.file))
    }
  })
  app.whenReady().then(() => {
    buildMenu()
    registerIpc()
    createWindow(true)
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow()
    })
  })
  app.on('window-all-closed', () => {
    app.quit()
  })
}
