const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')

let iconv = null
try {
  iconv = require('iconv-lite')
} catch {}

let win = null
let viewState = { sidebar: true, outline: true, focus: false, typewriter: false, dark: false, codeWrap: true }

// 测试钩子（--eval/--screenshot 等）与 DevTools 菜单只在开发模式或 IM_DEV_TOOLS=1 时开放
const hooksAllowed = !app.isPackaged || process.env.IM_DEV_TOOLS === '1'

const args = parseArgv(process.argv)

if (args.userData) {
  try {
    app.setPath('userData', args.userData)
  } catch {}
}

function parseArgv(argv) {
  const start = app.isPackaged ? 1 : 2
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
    } else if (a === '--fmttest') {
      if (hooksAllowed) out.fmttest = true
    } else if (a === '--imetest') {
      if (hooksAllowed) out.imetest = true
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

function activeWindow() {
  const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  return w && !w.isDestroyed() ? w : null
}

function send(cmd, arg) {
  const target = activeWindow()
  if (target) target.webContents.send('menu-event', cmd, arg)
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
        ...(hooksAllowed ? [{ role: 'toggleDevTools', label: '开发者工具', accelerator: 'Shift+F12' }] : []),
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
  const opts = {
    type: 'info',
    message: 'Instant Markdown',
    detail: '即时渲染 Markdown 编辑器\n版本 0.1.0\n基于 Electron 与 Vditor 构建',
    buttons: ['好'],
  }
  const w = activeWindow()
  if (w) dialog.showMessageBox(w, opts)
  else dialog.showMessageBox(opts)
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
      sandbox: true,
      spellcheck: false,
      additionalArguments: hooksAllowed ? ['im-dev-hooks'] : [],
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
  const thisWin = win
  thisWin.on('close', (e) => {
    if (thisWin.__closeConfirmed || args.shot) return
    e.preventDefault()
    if (!thisWin.__closePending) {
      thisWin.__closePending = true
      thisWin.webContents.send('confirm-close')
    }
  })
  thisWin.webContents.on('render-process-gone', () => {
    // 渲染进程崩溃后 confirm-close 不可能得到回复——放行关闭，避免窗口卡死关不掉
    thisWin.__closeConfirmed = true
    if (thisWin.__closePending) {
      thisWin.__closePending = false
      try {
        thisWin.close()
      } catch {}
    }
  })
  win.on('closed', () => {
    if (win === thisWin) win = null
  })
  if (isPrimary) {
    thisWin.webContents.once('did-finish-load', () => {
      if (args.file) thisWin.webContents.send('open-file', path.resolve(args.file))
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
  if (a.fmttest && win) {
    const wc = win.webContents
    let dbg = null
    try {
      wc.debugger.attach('1.3')
      dbg = wc.debugger
    } catch {}
    if (dbg) {
      // 真实输入链路复现格式化时序：真实键入三段 → 双击选词 → 真实 Ctrl+B（经菜单加速键）
      const dump = async (tag) => {
        const s = await wc.executeJavaScript(
          "(function(){var h=document.querySelector('.editor-instance.active');if(!h)return 'no-host';var r=h.querySelector('.vditor-ir .vditor-reset');var sel=getSelection();var rg=sel.rangeCount?sel.getRangeAt(0):null;return JSON.stringify({blocks:r?r.children.length:-1,html:r?r.innerHTML.slice(0,120):null,sel:String(sel),sc:rg?rg.startContainer.nodeType+'/'+(rg.startContainer.nodeName||'')+'/'+rg.startOffset:null,ec:rg?rg.endContainer.nodeType+'/'+(rg.endContainer.nodeName||'')+'/'+rg.endOffset:null,strong:r?r.querySelectorAll('[data-type=strong]').length:-1})})()"
        )
        console.log('[fmttest:' + tag + ']', s)
      }
      await wc.executeJavaScript('window.__im.newDoc(); "ok"')
      await wait(1000)
      await dump('newdoc')
      const type = async (text) => {
        await dbg.sendCommand('Input.insertText', { text })
        await wait(300)
      }
      const newPara = async () => {
        await wc.executeJavaScript("document.execCommand('insertParagraph')")
        await wait(300)
      }
      await type('first para alpha beta')
      await newPara()
      await type('second para gamma delta')
      await newPara()
      await type('third para epsilon')
      await wait(700)
      await dump('typed')
      const rectJson = await wc.executeJavaScript(
        "(function(){var w=document.createTreeWalker(document.querySelector('.editor-instance.active .vditor-ir .vditor-reset'),NodeFilter.SHOW_TEXT);var n;while((n=w.nextNode())){if(n.data.indexOf('alpha')>=0){var r=document.createRange();r.selectNodeContents(n);var b=r.getBoundingClientRect();return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2})}}return null})()"
      )
      console.log('[fmttest:rect]', rectJson)
      if (rectJson) {
        const { x, y } = JSON.parse(rectJson)
        await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
        await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
        await wait(150)
        await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 2 })
        await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 2 })
        await wait(450)
        await dump('dblclicked')
        // 真实按键链路：CDP 派发可信 keydown → 渲染层 hotkeyIntercept（窗口捕获）→
        // handleMenu → doAction（含选区裁剪修复）。拦截器会 stopPropagation 跳过 Vditor
        // 自身的 ⌘B 处理器并 preventDefault 抑制菜单加速键，动作只走 doAction 一次
        await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66 })
        await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66 })
        await wait(900)
        await dump('ctrlb')
        // 变体B：双击第二段行中词 gamma（带尾随空格）→ 真实 Ctrl+I（斜体）
        const rect2 = await wc.executeJavaScript(
          "(function(){var w=document.createTreeWalker(document.querySelector('.editor-instance.active .vditor-ir .vditor-reset'),NodeFilter.SHOW_TEXT);var n;while((n=w.nextNode())){if(n.data.indexOf('gamma')>=0){var r=document.createRange();r.setStart(n,n.data.indexOf('gamma'));r.setEnd(n,n.data.indexOf('gamma')+5);var b=r.getBoundingClientRect();return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2})}}return null})()"
        )
        console.log('[fmttest:rect2]', rect2)
        if (rect2) {
          const p = JSON.parse(rect2)
          await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 })
          await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 })
          await wait(150)
          await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 2 })
          await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 2 })
          await wait(450)
          await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'i', code: 'KeyI', windowsVirtualKeyCode: 73 })
          await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'i', code: 'KeyI', windowsVirtualKeyCode: 73 })
          await wait(900)
          await dump('ctrli')
        }
        // 变体C：双击第二段行尾词 delta（无尾随空格）→ 真实 Ctrl+B（不回归）
        const rect3 = await wc.executeJavaScript(
          "(function(){var w=document.createTreeWalker(document.querySelector('.editor-instance.active .vditor-ir .vditor-reset'),NodeFilter.SHOW_TEXT);var n;while((n=w.nextNode())){if(n.data.indexOf('delta')>=0){var r=document.createRange();r.setStart(n,n.data.indexOf('delta'));r.setEnd(n,n.data.indexOf('delta')+5);var b=r.getBoundingClientRect();return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2})}}return null})()"
        )
        console.log('[fmttest:rect3]', rect3)
        if (rect3) {
          const p = JSON.parse(rect3)
          await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 })
          await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 })
          await wait(150)
          await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 2 })
          await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 2 })
          await wait(450)
          await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66 })
          await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66 })
          await wait(900)
          await dump('ctrlb2')
        }
        // 变体D：CJK 标点场景——键入「前字，文字文字」，选「，文字文字」（前是文字）→ Ctrl+B
        // CommonMark 侧性规则下 ** 紧跟标点且前是文字无法开启；修复应把逗号移到标记外
        await newPara()
        await type('\u524d\u5b57\uff0c\u6587\u5b57\u6587\u5b57')
        await wait(500)
        const selOk = await wc.executeJavaScript(
          "(function(){var rs=document.querySelector('.editor-instance.active .vditor-ir .vditor-reset');var b=Array.from(rs.children).find(function(x){return x.textContent.indexOf('\u524d\u5b57')>=0});if(!b)return false;var w=document.createTreeWalker(b,NodeFilter.SHOW_TEXT);var n;while((n=w.nextNode())){if(n.data.length>=7){var r=document.createRange();r.setStart(n,2);r.setEnd(n,7);var s=getSelection();s.removeAllRanges();s.addRange(r);return true}}return false})()"
        )
        console.log('[fmttest:punct-sel]', selOk)
        if (selOk) {
          await wait(200)
          await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66 })
          await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66 })
          await wait(900)
          await dump('ctrlb-punct')
        }
      }
      try {
        dbg.detach()
      } catch {}
    }
  }
  if (a.imetest) {
    await runImeTest(a)
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

// IME 输入法链路复现：组字提交 → 双击选词 → 真实 Ctrl+B → 再格式化 → 再 IME 输入
// （用户是中文输入者；合成测试无法复现的渲染延迟高度疑似 IME 组字状态残留）
async function runImeTest(a) {
  const wc = win.webContents
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  let dbg = null
  try {
    wc.debugger.attach('1.3')
    dbg = wc.debugger
  } catch {}
  if (!dbg) return
  const dump = async (tag) => {
    const s = await wc.executeJavaScript(
      "(function(){var h=document.querySelector('.editor-instance.active');if(!h)return 'no-host';var r=h.querySelector('.vditor-ir .vditor-reset');var sel=getSelection();var rg=sel.rangeCount?sel.getRangeAt(0):null;return JSON.stringify({md:window.__im.value(),strong:r?r.querySelectorAll('[data-type=strong]').length:-1,em:r?r.querySelectorAll('[data-type=em]').length:-1,b1:r&&r.children[0]?r.children[0].innerHTML.slice(0,260):null,selText:String(sel).slice(0,20),sc:rg?rg.startContainer.nodeType+'/'+(rg.startContainer.nodeName||'')+'/'+rg.startOffset:null})})()"
    )
    console.log('[imetest:' + tag + ']', s)
  }
  await wc.executeJavaScript('window.__im.newDoc(); "ok"')
  await wait(1000)
  const imeType = async (text) => {
    await dbg.sendCommand('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
    await wait(250)
    await dbg.sendCommand('Input.insertText', { text })
    await wait(350)
  }
  await imeType('\u4e2d\u6587\u8bcd\u7532 \u4e2d\u6587\u8bcd\u4e59')
  await wc.executeJavaScript("document.execCommand('insertParagraph')")
  await wait(300)
  await imeType('\u7b2c\u4e8c\u884c\u6587\u5b57')
  await wait(500)
  await dump('typed')
  const rectOf = async (word) => {
    const r = await wc.executeJavaScript(
      "(function(){var w=document.createTreeWalker(document.querySelector('.editor-instance.active .vditor-ir .vditor-reset'),NodeFilter.SHOW_TEXT);var n;while((n=w.nextNode())){if(n.data.indexOf('" + word + "')>=0){var rg=document.createRange();rg.setStart(n,n.data.indexOf('" + word + "'));rg.setEnd(n,n.data.indexOf('" + word + "')+" + word.length + ');var b=rg.getBoundingClientRect();return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2})}}return null})()'
    )
    return r ? JSON.parse(r) : null
  }
  const dblClick = async (p) => {
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    await wait(150)
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 2 })
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 2 })
    await wait(450)
  }
  const ctrlKey = async (code, key, vk) => {
    await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key, code, windowsVirtualKeyCode: vk })
    await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key, code, windowsVirtualKeyCode: vk })
    await wait(900)
  }
  let p = await rectOf('\u8bcd\u7532')
  console.log('[imetest:rect1]', p ? JSON.stringify(p) : 'null')
  const fails = []
  if (!p) fails.push('rect1-miss')
  if (p) {
    await dblClick(p)
    await dump('sel1')
    await ctrlKey('KeyB', 'b', 66)
    await dump('bold1')
    // 断言：第一次加粗必须立即渲染（旧缺陷：字面 ** 滞留到下一次输入才渲染）
    const v1 = await wc.executeJavaScript(
      "(function(){var h=document.querySelector('.editor-instance.active');var r=h.querySelector('.vditor-ir .vditor-reset');var raw=false;var w=document.createTreeWalker(r,NodeFilter.SHOW_TEXT);var n;while((n=w.nextNode())){if(n.data.indexOf('**')>=0){var p=n.parentNode;if(p&&p.classList&&(p.classList.contains('vditor-ir__marker')||(p.closest&&p.closest('[data-type=code-block]'))))continue;raw=true}}return JSON.stringify({strong:r.querySelectorAll('[data-type=strong]').length,raw:raw})})()"
    )
    const s1 = JSON.parse(v1)
    if (s1.strong < 1) fails.push('bold1-not-rendered')
    if (s1.raw) fails.push('bold1-raw-markers')
  }
  p = await rectOf('\u8bcd\u4e59')
  console.log('[imetest:rect2]', p ? JSON.stringify(p) : 'null')
  if (!p) fails.push('rect2-miss')
  if (p) {
    await dblClick(p)
    await dump('sel2')
    await ctrlKey('KeyB', 'b', 66)
    await dump('bold2')
    const v2 = await wc.executeJavaScript(
      "(function(){var h=document.querySelector('.editor-instance.active');return JSON.stringify({strong:h.querySelector('.vditor-ir .vditor-reset').querySelectorAll('[data-type=strong]').length})})()"
    )
    const s2 = JSON.parse(v2)
    if (s2.strong < 2) fails.push('bold2-not-rendered(' + s2.strong + ')')
  }
  // 第三次修改内容：继续 IME 输入
  await imeType('\u66f4\u591a\u6587\u5b57')
  await wait(500)
  await dump('after-type')
  console.log(fails.length ? 'IMETEST FAIL (' + fails.join(', ') + ')' : 'IMETEST PASS')
  try {
    dbg.detach()
  } catch {}
}

// 异步遍历＋条目预算：同步递归会在大目录上卡死主进程，预算防止超大目录无界展开
async function listDir(dir, depth, budget) {
  const out = []
  let entries
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  entries.sort((a, b) => {
    const ad = a.isDirectory()
    const bd = b.isDirectory()
    if (ad !== bd) return ad ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  const dirs = []
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue
    if (budget.left <= 0) break
    budget.left--
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      const node = { type: 'dir', name: ent.name, path: full, children: [] }
      out.push(node)
      dirs.push([node, full])
    } else if (/\.(md|markdown|txt)$/i.test(ent.name)) {
      out.push({ type: 'file', name: ent.name, path: full })
    }
  }
  if (depth > 0 && budget.left > 0) {
    await Promise.all(dirs.map(async ([node, full]) => {
      node.children = await listDir(full, depth - 1, budget)
    }))
  }
  return out
}

function decodeFileText(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { content: new TextDecoder('utf-8').decode(buf.subarray(3)), encoding: 'utf-8-bom' }
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { content: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'utf-16le' }
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { content: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'utf-16be' }
  }
  try {
    return { content: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8' }
  } catch {
    return { content: new TextDecoder('gbk').decode(buf), encoding: 'gbk' }
  }
}

// 按来源编码写回；GBK 无法表示全部字符时返回 null（调用方回退 UTF-8 并上报实际编码）
function encodeFileText(content, enc) {
  switch (enc) {
    case 'utf-8-bom':
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, 'utf8')])
    case 'utf-16le':
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')])
    case 'utf-16be': {
      const le = Buffer.from(content, 'utf16le')
      const be = Buffer.alloc(le.length)
      for (let i = 0; i + 1 < le.length; i += 2) {
        be[i] = le[i + 1]
        be[i + 1] = le[i]
      }
      return Buffer.concat([Buffer.from([0xfe, 0xff]), be])
    }
    case 'gbk': {
      if (!iconv) return null
      const buf = iconv.encode(content, 'gbk')
      return iconv.decode(buf, 'gbk') === content ? buf : null
    }
    default:
      return Buffer.from(content, 'utf8')
  }
}

// 临时文件＋rename 原子替换：崩溃/断电时不会把原文件截断成半个
async function writeFileAtomic(p, data) {
  const tmp = path.join(path.dirname(p), '.' + path.basename(p) + '.im-tmp-' + process.pid)
  try {
    await fs.promises.writeFile(tmp, data)
    await fs.promises.rename(tmp, p)
  } catch (err) {
    try {
      await fs.promises.unlink(tmp)
    } catch {}
    throw err
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
      await writeFileAtomic(r.filePath, String(content))
      return r.filePath
    } catch {
      return null
    }
  })

  const TEXT_EXT = /\.(md|markdown|txt)$/i

  ipcMain.handle('fs:read', async (e, p) => {
    if (typeof p !== 'string' || !TEXT_EXT.test(p)) {
      return { ok: false, error: '仅支持读取 Markdown/文本文件' }
    }
    try {
      const { content, encoding } = decodeFileText(await fs.promises.readFile(p))
      return { ok: true, content, encoding }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:write', async (e, p, c, enc) => {
    if (typeof p !== 'string' || typeof c !== 'string' || !TEXT_EXT.test(p)) {
      return { ok: false, error: '仅支持写入 Markdown/文本文件' }
    }
    let usedEnc = enc || 'utf-8'
    let buf
    try {
      buf = encodeFileText(c, enc)
    } catch {
      buf = null
    }
    if (!buf) {
      buf = Buffer.from(c, 'utf8')
      usedEnc = 'utf-8'
    }
    try {
      await writeFileAtomic(p, buf)
      return { ok: true, encoding: usedEnc }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:tree', async (e, root) => {
    if (typeof root !== 'string') return []
    return listDir(root, 8, { left: 20000 })
  })

  const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i
  const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif' }

  ipcMain.handle('fs:read-image', async (e, p) => {
    if (typeof p !== 'string' || !IMG_EXT.test(p)) {
      return { ok: false, error: '仅支持读取图片文件' }
    }
    try {
      const buf = await fs.promises.readFile(p)
      if (buf.length > 20 * 1024 * 1024) return { ok: false, error: '图片超过 20MB，跳过内嵌' }
      const ext = IMG_EXT.exec(p)[1].toLowerCase()
      return { ok: true, mime: IMG_MIME[ext] || 'application/octet-stream', base64: buf.toString('base64') }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

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

  ipcMain.handle('read-asset', async (e, rel) => {
    if (typeof rel !== 'string') return { ok: false, error: 'invalid path' }
    const root = path.join(__dirname, 'node_modules')
    const full = path.resolve(root, rel)
    // 前缀必须带路径分隔符：不带时 ../node_modules-evil/x 这类兄弟目录能通过校验
    if (full !== root && !full.startsWith(root + path.sep)) return { ok: false, error: 'invalid path' }
    try {
      if (/\.(woff2?|ttf|otf)$/i.test(full)) {
        return { ok: true, base64: (await fs.promises.readFile(full)).toString('base64') }
      }
      return { ok: true, content: await fs.promises.readFile(full, 'utf8') }
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
      await fs.promises.writeFile(tmp, html, 'utf8')
      pw = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } })
      await pw.loadFile(tmp)
      const pdf = await pw.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { marginType: 'custom', top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 },
      })
      await writeFileAtomic(r.filePath, pdf)
      return { ok: true, path: r.filePath }
    } catch (err) {
      return { ok: false, error: String(err) }
    } finally {
      if (pw) pw.destroy()
      fs.promises.unlink(tmp).catch(() => {})
    }
  })

  ipcMain.handle('export:html', async (e, defaultName, html) => {
    const r = await dialog.showSaveDialog(winFor(e), {
      defaultPath: defaultName,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    try {
      await writeFileAtomic(r.filePath, html)
      return { ok: true, path: r.filePath }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.on('view-state', (e, s) => {
    if (!s || typeof s !== 'object') return
    // 窗口每次 focus 都会同步一次视图状态——无变化时跳过菜单重建（重建会重读 recent.json 并逐项 existsSync）
    let changed = false
    const next = { ...viewState }
    for (const k of Object.keys(viewState)) {
      if (k in s && s[k] !== viewState[k]) {
        next[k] = s[k]
        changed = true
      }
    }
    if (!changed) return
    viewState = next
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
