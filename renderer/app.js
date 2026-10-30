'use strict'
/* global Vditor */

const $ = (sel) => document.querySelector(sel)

// ---------- 工具函数 ----------

function pathBasename(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

function pathDirname(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(0, i) : ''
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function countText(text) {
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
  const latin = (text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').match(/[A-Za-z0-9_'-]+/g) || []).length
  return { words: cjk + latin, chars: text.length }
}

const fmt = (n) => n.toLocaleString('zh-CN')

function stripExt(name) {
  return name.replace(/\.(md|markdown|txt)$/i, '')
}

// ---------- 图标 ----------

const ICONS = {
  chevron:
    '<svg class="chevron" width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  folder:
    '<svg class="icon-folder" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1.8 4.2c0-.66.54-1.2 1.2-1.2h3.1l1.5 1.6h5.4c.66 0 1.2.54 1.2 1.2v6.8c0 .66-.54 1.2-1.2 1.2H3c-.66 0-1.2-.54-1.2-1.2V4.2z" fill="currentColor"/></svg>',
  file:
    '<svg class="icon-file" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 1.8h5.7l3 3v9.4c0 .55-.45 1-1 1H3.5c-.55 0-1-.45-1-1V2.8c0-.55.45-1 1-1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.2 1.8v3h3" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
}

// ---------- 状态 ----------

const DEFAULT_SETTINGS = { dark: false, focus: false, typewriter: false, sidebar: true, outline: true, codeWrap: true }

const state = {
  tabs: [],
  activeId: null,
  workspace: null,
  expanded: new Set(),
  treeData: [],
  settings: loadSettings(),
}

let tabSeq = 0
let toastTimer = null
const closedStack = []

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('im-settings') || '{}') }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings() {
  localStorage.setItem('im-settings', JSON.stringify(state.settings))
}

function activeTab() {
  return state.tabs.find((t) => t.id === state.activeId) || null
}

// ---------- 设置应用 ----------

function applyBodyClasses() {
  document.body.classList.toggle('theme-dark', state.settings.dark)
  document.body.classList.toggle('no-sidebar', !state.settings.sidebar)
  document.body.classList.toggle('no-outline', !state.settings.outline)
  document.body.classList.toggle('focus-mode', state.settings.focus)
  document.body.classList.toggle('code-wrap', state.settings.codeWrap)
}

function syncViewState() {
  api.syncViewState({
    sidebar: state.settings.sidebar,
    outline: state.settings.outline,
    focus: state.settings.focus,
    typewriter: state.settings.typewriter,
    dark: state.settings.dark,
    codeWrap: state.settings.codeWrap,
  })
}

// ---------- 编辑器 ----------

const ABS_CDN = new URL('../node_modules/vditor', location.href).href
const ABS_CONTENT_THEME = new URL('../node_modules/vditor/dist/css/content-theme', location.href).href

// 文档目录 → file:// base URL。按段编码：目录名中的 #/? 会被 URL 解析为 fragment/query；
// UNC 路径（//server/share）须映射为 file://server/share/ 而非 file:///…
function dirToBaseUrl(dir) {
  if (!dir) return ''
  const d = String(dir).replace(/\\/g, '/')
  if (!d) return ''
  try {
    if (d.startsWith('//')) {
      const segs = d.split('/').filter(Boolean)
      if (segs.length < 2) return ''
      const enc = segs.map((seg, i) => (i < 2 ? seg : encodeURIComponent(seg))).join('/')
      return new URL('file://' + enc + '/').href
    }
    const segs = d.split('/')
    const enc = segs.map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join('/')
    return new URL('file:///' + enc + '/').href
  } catch {
    return ''
  }
}

function updateDocumentBase(tab) {
  let base = document.querySelector('base')
  if (!base) {
    base = document.createElement('base')
    document.head.appendChild(base)
  }
  const href = tab && tab.path ? dirToBaseUrl(pathDirname(tab.path)) : ''
  base.href = href || new URL('.', location.href).href
}

function vditorOptions(tab, content) {
  const dark = state.settings.dark
  return {
    cdn: ABS_CDN,
    mode: 'ir',
    lang: 'zh_CN',
    theme: dark ? 'dark' : 'classic',
    height: '100%',
    cache: { enable: false },
    tab: '    ',
    typewriterMode: state.settings.typewriter,
    outline: { enable: false },
    toolbar: [
      'bold', 'italic', 'strike', 'link', 'inline-code',
      'list', 'ordered-list', 'check', 'outdent', 'indent',
      'quote', 'line', 'code', 'table',
    ],
    placeholder: '开始书写…',
    value: content,
    preview: {
      theme: { current: dark ? 'dark' : 'light' },
      hljs: { enable: true, style: dark ? 'vs2015' : 'github', lineNumber: false },
      math: { engine: 'KaTeX' },
      markdown: { autoSpace: true, toc: true, footnotes: true },
    },
    after: () => {
      tab._initializing = false
      tab.ready = true
      try {
        tab.vditor.vditor.options.typewriterMode = state.settings.typewriter
      } catch {}
      if (state.settings.dark !== tab._initDark) {
        try {
          tab.vditor.setTheme(
            state.settings.dark ? 'dark' : 'classic',
            state.settings.dark ? 'dark' : 'light',
            state.settings.dark ? 'vs2015' : 'github',
            ABS_CONTENT_THEME
          )
        } catch {}
      }
      const irEl = tab.host ? tab.host.querySelector('.vditor-ir') : null
      if (irEl && !tab._inputAttached) {
        tab._inputAttached = true
        irEl.addEventListener('input', () => {
          if (tab._initializing) return
          if (!tab.dirty) {
            tab.dirty = true
            renderTabbar()
          }
          clearTimeout(tab._statusTimer)
          tab._statusTimer = setTimeout(() => updateStatus(), 400)
          clearTimeout(tab._outlineTimer)
          tab._outlineTimer = setTimeout(renderOutlinePanel, 500)
        })
      }
      const resetEl = tab.host ? tab.host.querySelector('.vditor-ir .vditor-reset') : null
      if (resetEl && !tab._moAttached) {
        tab._moAttached = true
        tab._mo = new MutationObserver((muts) => {
          if (tab._initializing) return
          // Vditor 撤销栈快照（undoDelay 800ms 延迟触发）会向编辑区插入/移除 span.vditor-wbr
          // 光标标记；该内部变更不是用户编辑，据此标脏会让「打字后立即保存」的标签假性变脏
          const onlyCaret = muts.every((m) => {
            if (m.type === 'characterData') return true
            if (m.type !== 'childList') return false
            const nodesOk = (nodes) => Array.from(nodes).every((n) => n.nodeType === 3 || (n.nodeType === 1 && n.classList && n.classList.contains('vditor-wbr')))
            return nodesOk(m.addedNodes) && nodesOk(m.removedNodes)
          })
          if (onlyCaret) return
          if (!tab.dirty) {
            tab.dirty = true
            renderTabbar()
          }
        })
        tab._mo.observe(resetEl, { childList: true, subtree: true, characterData: true })
      }
      if (state.activeId === tab.id) {
        try {
          tab.vditor.focus()
        } catch {}
      }
      updateStatus()
      renderOutlinePanel()
    },
  }
}

function createEditorForTab(tab) {
  const host = document.createElement('div')
  host.className = 'editor-instance'
  $('#editor-host').appendChild(host)
  const content = tab.content != null ? tab.content : ''
  if (tab.content != null) delete tab.content
  tab._initializing = true
  tab.ready = false
  tab._initDark = state.settings.dark
  tab.host = host
  tab.vditor = new Vditor(host, vditorOptions(tab, content))
}

// ---------- 标签页 ----------

function newDoc() {
  let name = '未命名'
  const untitled = state.tabs.filter((t) => !t.path)
  if (untitled.length) {
    // 按现存最大编号递增：按数量推算会在关闭中间编号后产生重名
    let max = 0
    for (const t of untitled) {
      const m = /^未命名(?: (\d+))?$/.exec(t.name)
      if (m) max = Math.max(max, m[1] ? Number(m[1]) : 1)
    }
    name = '未命名 ' + (max + 1)
  }
  const tab = { id: ++tabSeq, path: null, name, content: '', dirty: false, encoding: 'utf-8', vditor: null, host: null }
  state.tabs.push(tab)
  activateTab(tab.id)
}

async function openPath(filePath) {
  const existing = state.tabs.find((t) => t.path === filePath)
  if (existing) {
    activateTab(existing.id)
    return
  }
  const r = await api.readFile(filePath)
  if (!r.ok) {
    toast('无法读取文件：' + r.error)
    return
  }
  const tab = {
    id: ++tabSeq,
    path: filePath,
    name: pathBasename(filePath),
    content: r.content,
    dirty: false,
    encoding: r.encoding || 'utf-8',
    vditor: null,
    host: null,
  }
  state.tabs.push(tab)
  api.recentAdd(filePath)
  activateTab(tab.id)
}

function activateTab(id) {
  const tab = state.tabs.find((t) => t.id === id)
  if (!tab) return
  state.activeId = id
  updateDocumentBase(tab)
  if (!tab.vditor) {
    createEditorForTab(tab)
  } else {
    setTimeout(() => {
      try {
        tab.vditor.focus()
      } catch {}
    }, 60)
  }
  for (const t of state.tabs) {
    if (t.host) t.host.classList.toggle('active', t.id === id)
  }
  renderTabbar()
  renderTreeActive()
  updateStatus()
  updateTitle()
  updateWelcome()
  renderOutlinePanel()
}

async function closeTab(id) {
  const tab = state.tabs.find((t) => t.id === id)
  if (!tab) return
  if (tab.dirty) {
    const choice = await confirmUnsaved('「' + tab.name + '」有未保存的修改。')
    if (choice === 'cancel') return
    if (choice === 'save') {
      await saveTab(tab)
      if (tab.dirty) return
    }
  }
  if (tab._mo) {
    try {
      tab._mo.disconnect()
    } catch {}
  }
  clearTimeout(tab._statusTimer)
  clearTimeout(tab._outlineTimer)
  if (tab.vditor) {
    try {
      tab.vditor.destroy()
    } catch {}
    // destroy 会移除 #vditorIconScript 标签；下一个编辑器构造时会以内联脚本方式重载
    // 图标（被 CSP 拦截，产生一条警告）。图标 SVG 精灵仍在 body 中，补一个空占位标签
    // 让构造函数的 getElementById 检查跳过内联注入
    if (!document.getElementById('vditorIconScript')) {
      const s = document.createElement('script')
      s.id = 'vditorIconScript'
      document.head.appendChild(s)
    }
  }
  if (tab.host) tab.host.remove()
  const idx = state.tabs.findIndex((t) => t.id === id)
  state.tabs.splice(idx, 1)
  if (tab.path) {
    closedStack.unshift(tab.path)
    if (closedStack.length > 10) closedStack.pop()
  }
  if (state.activeId === id) {
    const next = state.tabs[idx] || state.tabs[idx - 1]
    if (next) {
      activateTab(next.id)
    } else {
      state.activeId = null
      renderTabbar()
      renderTreeActive()
      updateStatus('')
      updateTitle()
      updateWelcome()
      renderOutlinePanel()
    }
  } else {
    renderTabbar()
  }
}

function cycleTab(dir) {
  if (state.tabs.length < 2) return
  const idx = state.tabs.findIndex((t) => t.id === state.activeId)
  const next = (idx + dir + state.tabs.length) % state.tabs.length
  activateTab(state.tabs[next].id)
}

function renderTabbar() {
  const bar = $('#tabbar')
  bar.innerHTML = ''
  for (const tab of state.tabs) {
    const el = document.createElement('button')
    el.className = 'tab' + (tab.id === state.activeId ? ' active' : '') + (tab.dirty ? ' dirty' : '')
    const dot = document.createElement('span')
    dot.className = 'dot'
    const label = document.createElement('span')
    label.className = 'tab-label'
    label.textContent = tab.name
    const close = document.createElement('span')
    close.className = 'tab-close'
    close.textContent = '✕'
    close.title = '关闭（Ctrl+W）'
    el.append(dot, label, close)
    el.addEventListener('click', (e) => {
      if (e.target === close) return
      activateTab(tab.id)
    })
    close.addEventListener('click', (e) => {
      e.stopPropagation()
      closeTab(tab.id)
    })
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault()
        closeTab(tab.id)
      }
    })
    bar.appendChild(el)
  }
}

// ---------- 保存 ----------

function suggestName(tab) {
  return /\.(md|markdown|txt)$/i.test(tab.name) ? tab.name : tab.name + '.md'
}

let saveInProgress = false

async function saveTab(tab) {
  if (saveInProgress) return
  if (!tab.vditor || !tab.dirty || !tab.ready) return
  const content = tabValue(tab)
  if (!tab.path) {
    saveInProgress = true
    let p
    try {
      p = await api.saveFileDialog(suggestName(tab), content)
    } finally {
      saveInProgress = false
    }
    if (!p) return
    tab.path = p
    tab.name = pathBasename(p)
    tab.encoding = 'utf-8'
    api.recentAdd(p)
    maybeRefreshTree(p)
  } else {
    saveInProgress = true
    try {
      const r = await api.writeFile(tab.path, content, tab.encoding || 'utf-8')
      if (!r.ok) {
        toast('保存失败：' + r.error)
        return
      }
      if (r.encoding && r.encoding !== (tab.encoding || 'utf-8')) {
        tab.encoding = r.encoding
        toast('原编码无法表示全部字符，已改按 UTF-8 保存')
      }
    } finally {
      saveInProgress = false
    }
  }
  tab.dirty = false
  renderTabbar()
  updateStatus()
}

async function saveAs() {
  if (saveInProgress) return
  const tab = activeTab()
  if (!tab || !tab.vditor || !tab.ready) return
  const content = tabValue(tab)
  saveInProgress = true
  let p
  try {
    p = await api.saveFileDialog(suggestName(tab), content)
  } finally {
    saveInProgress = false
  }
  if (!p) return
  const dup = state.tabs.find((t) => t !== tab && t.path === p)
  if (dup) await closeTab(dup.id)
  tab.path = p
  tab.name = pathBasename(p)
  tab.encoding = 'utf-8'
  tab.dirty = false
  api.recentAdd(p)
  maybeRefreshTree(p)
  renderTabbar()
  updateTitle()
}

// ---------- 文件树 ----------

async function openWorkspace() {
  const dir = await api.openDir()
  if (!dir) return
  state.workspace = dir
  state.expanded = new Set([dir])
  localStorage.setItem('im-workspace', dir)
  await refreshTree()
}

async function refreshTree() {
  if (!state.workspace) return
  state.treeData = await api.readTree(state.workspace)
  $('#workspace-name').textContent = pathBasename(state.workspace) || state.workspace
  renderTree()
  renderTreeActive()
}

function closeWorkspace() {
  state.workspace = null
  state.treeData = []
  state.expanded = new Set()
  localStorage.removeItem('im-workspace')
  $('#workspace-name').textContent = '未打开文件夹'
  renderTree()
}

function renderTree() {
  const tree = $('#file-tree')
  tree.innerHTML = ''
  if (!state.workspace) {
    const empty = document.createElement('div')
    empty.className = 'tree-empty'
    empty.innerHTML = '通过「文件 → 打开文件夹」<br>建立工作区'
    tree.appendChild(empty)
    return
  }
  renderTreeNodes(state.treeData, tree)
}

function renderTreeNodes(nodes, parent) {
  for (const node of nodes) {
    const row = document.createElement('div')
    row.className = 'tree-item'
    if (node.type === 'dir') {
      const expanded = state.expanded.has(node.path)
      row.innerHTML = ICONS.chevron + ICONS.folder + '<span class="tree-label"></span>'
      row.querySelector('.tree-label').textContent = node.name
      row.querySelector('.chevron').classList.toggle('open', expanded)
      row.addEventListener('click', () => {
        if (state.expanded.has(node.path)) state.expanded.delete(node.path)
        else state.expanded.add(node.path)
        renderTree()
      })
      parent.appendChild(row)
      if (expanded) {
        const children = document.createElement('div')
        children.className = 'tree-children'
        renderTreeNodes(node.children || [], children)
        parent.appendChild(children)
      }
    } else {
      row.dataset.path = node.path
      row.innerHTML = ICONS.file + '<span class="tree-label"></span>'
      row.querySelector('.tree-label').textContent = node.name
      row.addEventListener('click', () => openPath(node.path))
      parent.appendChild(row)
    }
  }
}

function renderTreeActive() {
  const tab = activeTab()
  document.querySelectorAll('.tree-item[data-path]').forEach((el) => {
    el.classList.toggle('active', !!tab && el.dataset.path === tab.path)
  })
}

function maybeRefreshTree(p) {
  if (state.workspace && p && String(p).toLowerCase().startsWith(String(state.workspace).toLowerCase())) {
    refreshTree()
  }
}

// ---------- 欢迎页 ----------

async function updateWelcome() {
  const welcome = $('#welcome')
  if (state.tabs.length > 0) {
    welcome.classList.add('hidden')
    return
  }
  welcome.classList.remove('hidden')
  const list = await api.recentList()
  // 等待期间若打开了文档，保持隐藏（activateTab 的调用已处理），不要把欢迎页再亮出来
  if (state.tabs.length > 0) return
  const wrap = $('#w-recent-wrap')
  const box = $('#w-recent')
  box.innerHTML = ''
  if (!list.length) {
    wrap.style.display = 'none'
    return
  }
  wrap.style.display = ''
  for (const p of list.slice(0, 6)) {
    const row = document.createElement('div')
    row.className = 'recent-row'
    const name = document.createElement('span')
    name.className = 'rr-name'
    name.textContent = pathBasename(p)
    const dir = document.createElement('span')
    dir.className = 'rr-dir'
    dir.textContent = pathDirname(p)
    row.append(name, dir)
    row.addEventListener('click', () => openPath(p))
    box.appendChild(row)
  }
}

// ---------- 状态栏与标题 ----------

function tabValue(tab) {
  if (!tab || !tab.vditor || !tab.ready) return ''
  try {
    return tab.vditor.getValue()
  } catch {
    return ''
  }
}

const ENC_LABELS = { 'utf-8': 'UTF-8', 'utf-8-bom': 'UTF-8 BOM', 'utf-16le': 'UTF-16LE', 'utf-16be': 'UTF-16BE', gbk: 'GBK' }

function updateStatus(value) {
  const tab = activeTab()
  const text = value != null ? value : tabValue(tab)
  const c = countText(text || '')
  let count = c.words ? fmt(c.words) + ' 字 · ' + fmt(c.chars) + ' 字符' : ''
  if (tab) {
    const label = ENC_LABELS[tab.encoding || 'utf-8'] || 'UTF-8'
    count = count ? count + ' · ' + label : label
  }
  $('#st-count').textContent = count
  $('#st-path').textContent = tab ? tab.path || tab.name + '（未保存）' : ''
}

function updateTitle() {
  const tab = activeTab()
  document.title = tab ? tab.name + ' — Instant Markdown' : 'Instant Markdown'
}

// ---------- 大纲面板 ----------

function renderOutlinePanel() {
  const panel = $('#outline-panel')
  const tab = activeTab()
  if (!tab || !tab.ready || !tab.host) {
    panel.innerHTML = ''
    return
  }
  const reset = tab.host.querySelector('.vditor-ir .vditor-reset')
  if (!reset) {
    panel.innerHTML = ''
    return
  }
  const heads = reset.querySelectorAll('h1,h2,h3,h4,h5,h6')
  const frag = document.createDocumentFragment()
  heads.forEach((h, i) => {
    const text = h.textContent.replace(/^#+\s*/, '').trim()
    if (!text) return
    const item = document.createElement('div')
    item.className = 'outline-item outline-l' + h.tagName[1]
    item.dataset.idx = i
    item.textContent = text
    frag.appendChild(item)
  })
  panel.innerHTML = ''
  panel.appendChild(frag)
}

// ---------- 查找 ----------

function openFind(withReplace) {
  if (!activeTab()) return
  $('#findbar').hidden = false
  $('#findbar').classList.toggle('with-replace', !!withReplace)
  const input = $('#find-input')
  input.focus()
  input.select()
}

function closeFind() {
  $('#findbar').hidden = true
}

function selectionInEditor() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !sel.anchorNode) return false
  let node = sel.anchorNode
  if (node.nodeType === 3) node = node.parentNode
  return !!(node.closest && node.closest('.vditor-ir'))
}

function doFind(backwards) {
  const q = $('#find-input').value
  if (!q) return
  try {
    for (let i = 0; i < 50; i++) {
      if (!window.find(q, false, backwards, true)) return
      if (selectionInEditor()) return
    }
  } catch {}
}

function rawFind(q) {
  try {
    for (let i = 0; i < 50; i++) {
      if (!window.find(q, false, false, true)) return false
      if (selectionInEditor()) return true
    }
    return false
  } catch {
    return false
  }
}

function replaceOne() {
  const q = $('#find-input').value
  const rep = $('#replace-input').value
  if (!q) return
  const sel = window.getSelection()
  if (!sel || sel.toString() !== q || !selectionInEditor()) {
    if (!rawFind(q)) return
  }
  document.execCommand('insertText', false, rep)
}

function replaceAll() {
  const q = $('#find-input').value
  const rep = $('#replace-input').value
  if (!q) return
  const tab = activeTab()
  if (!tab || !tab.vditor || !tab.ready) {
    toast('没有打开的文档')
    return
  }
  // 在源文本上整体替换：DOM 逐处 insertText 在「替换串包含查找串」时会自匹配循环
  // （实测 10 处替换撞 20 处上限后文档被破坏），且每处一条撤销记录。源替换一次成型、
  // 计数精确，并作为单条撤销记录可整体撤销
  const parts = tabValue(tab).split(q)
  const n = parts.length - 1
  if (!n) {
    toast('未找到匹配内容')
    return
  }
  tab.vditor.setValue(parts.join(rep))
  updateStatus()
  renderOutlinePanel()
  toast('已替换 ' + n + ' 处')
}

// ---------- 编辑动作 ----------

function triggerToolbar(name) {
  const tab = activeTab()
  if (!tab || !tab.ready || !tab.host) return false
  const btn = tab.host.querySelector('.vditor-toolbar button[data-type="' + name + '"]')
  if (btn) {
    btn.click()
    return true
  }
  return false
}

function insertAtCursor(text) {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  let node = sel.getRangeAt(0).startContainer
  if (node.nodeType === 3) node = node.parentNode
  if (!node.closest || !node.closest('.vditor-ir')) return
  document.execCommand('insertText', false, text)
}

function moveCursorBack(n) {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return
  const node = sel.getRangeAt(0).startContainer
  if (node.nodeType !== 3) return
  const off = sel.getRangeAt(0).startOffset
  if (off < n) return
  const range = document.createRange()
  range.setStart(node, off - n)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

function placeCursorInImageUrl() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return false
  let node = sel.getRangeAt(0).startContainer
  if (node.nodeType === 3) node = node.parentNode
  if (!node || !node.closest) return false
  const reset = node.closest('.vditor-reset')
  if (!reset) return false
  let imgNode = node.closest('.vditor-ir__node[data-type="img"]')
  if (!imgNode) {
    // 取离光标最近的空 src 图片节点：刚插入的图片紧邻光标之前，
    // 不能取文档中第一张未填 URL 的旧图片
    const candidates = reset.querySelectorAll('.vditor-ir__node[data-type="img"]')
    const cursor = sel.getRangeAt(0)
    let firstAfter = null
    for (const c of candidates) {
      const im = c.querySelector('img')
      if (!im || im.getAttribute('src')) continue
      // comparePoint 按光标实际边界判定候选先后；不能用 compareDocumentPosition 对光标
      // 父元素比较——子节点候选恒返回 CONTAINED_BY|FOLLOWING，全部误入「光标之后」分支
      let after = false
      try { after = cursor.comparePoint(c, 0) > 0 } catch {}
      if (after) { if (!firstAfter) firstAfter = c } else { imgNode = c }
    }
    if (!imgNode) imgNode = firstAfter
  }
  if (!imgNode) return false
  const markers = imgNode.querySelectorAll('.vditor-ir__marker')
  const last = markers.length ? markers[markers.length - 1] : null
  if (!last) return false
  const range = document.createRange()
  range.setStartBefore(last)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
  return true
}

const INLINE_FORMAT_ACTIONS = ['bold', 'italic', 'strike', 'inline-code', 'link']
const INLINE_COLLAPSE_ACTIONS = ['bold', 'italic', 'strike', 'inline-code']

function closestBlockElement(node) {
  let el = node.nodeType === 3 ? node.parentNode : node
  while (el && el !== document.body) {
    if (/^(P|H[1-6]|LI|BLOCKQUOTE|TD|TH)$/.test(el.tagName)) return el
    el = el.parentNode
  }
  return null
}

// 跨块选区会让 Vditor 工具栏 ADD 路径把选区内容拍平成行内（段落分隔被吞、下一段并入当前段），
// 行内格式动作前把选区截断到起始块末尾
function clampSelectionToBlock() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  const range = sel.getRangeAt(0)
  if (range.collapsed) return
  const startBlock = closestBlockElement(range.startContainer)
  const endBlock = closestBlockElement(range.endContainer)
  if (!startBlock || !endBlock || startBlock === endBlock) return
  if (startBlock.contains(endBlock) || endBlock.contains(startBlock)) return
  const clamped = document.createRange()
  clamped.setStart(range.startContainer, range.startOffset)
  clamped.setEnd(startBlock, startBlock.childNodes.length)
  sel.removeAllRanges()
  sel.addRange(clamped)
}

// 双击选词会带上尾随空格（浏览器词选择的标准行为）；`**词 **` 因闭合标记前是空白
// 违反 CommonMark 分隔符配对规则，Lute 拒绝解析——字面 ** 永不渲染（实测：行中词双击
// 加粗不渲染、行尾词正常）。行内格式化前把选区边缘空白裁到标记外。
// 返回 false 表示选区全是空白，格式化无意义应跳过。
function trimSelectionEdges() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || sel.isCollapsed) return true
  const range = sel.getRangeAt(0)
  const text = range.toString()
  if (!text) return true
  const lead = text.length - text.replace(/^\s+/, '').length
  const trail = text.length - text.replace(/\s+$/, '').length
  if (!lead && !trail) return true
  if (lead + trail >= text.length) return false
  try {
    const sc = range.startContainer
    const ec = range.endContainer
    if (lead && sc.nodeType === 3 && range.startOffset + lead <= sc.data.length) {
      range.setStart(sc, range.startOffset + lead)
    }
    if (trail && ec.nodeType === 3 && range.endOffset - trail >= 0) {
      range.setEnd(ec, range.endOffset - trail)
    }
    sel.removeAllRanges()
    sel.addRange(range)
  } catch {}
  return true
}
const INLINE_NODE_TYPES = { bold: 'strong', italic: 'em', strike: 's', 'inline-code': 'code', link: 'a' }

// 行内格式的纯文本标记对（添加分支用 execCommand 插入，避开 Vditor 的 <wbr> 路径）
const INLINE_MARKER_PAIRS = { bold: ['**', '**'], italic: ['*', '*'], strike: ['~~', '~~'], 'inline-code': ['`', '`'] }

// 选区是否已在同类行内格式节点内（是→按 Ctrl+B 应走移除分支）
function selectionInsideFormat(name) {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return false
  let node = sel.getRangeAt(0).startContainer
  if (node.nodeType === 3) node = node.parentNode
  const type = INLINE_NODE_TYPES[name]
  return !!(type && node.closest && node.closest('.vditor-ir__node[data-type="' + type + '"]'))
}

// 选区前一个字符（无法确定时返回 null，调用方保守处理）
function charBeforeSelection() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const r = sel.getRangeAt(0)
  if (r.startContainer.nodeType === 3) {
    if (r.startOffset > 0) return r.startContainer.data[r.startOffset - 1]
    let sib = r.startContainer.previousSibling
    while (sib) {
      if (sib.nodeType === 3 && sib.data.length) return sib.data[sib.data.length - 1]
      if (sib.nodeType === 1) {
        const t = sib.textContent
        if (t) return t[t.length - 1]
      }
      sib = sib.previousSibling
    }
  }
  return null
}

// 选区后一个字符（无法确定时返回 null）
function charAfterSelection() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const r = sel.getRangeAt(0)
  if (r.endContainer.nodeType === 3) {
    if (r.endOffset < r.endContainer.data.length) return r.endContainer.data[r.endOffset]
    let sib = r.endContainer.nextSibling
    while (sib) {
      if (sib.nodeType === 3 && sib.data.length) return sib.data[0]
      if (sib.nodeType === 1) {
        const t = sib.textContent
        if (t) return t[0]
      }
      sib = sib.nextSibling
    }
  }
  return null
}

// CommonMark 分隔符侧性规则：开标记 ** 紧跟标点且前一字符是文字→无法开启（字**，文字** 不渲染）；
// 闭标记 ** 前是标点且后一字符是文字→无法闭合（**文字，**字 不渲染）。块首／前是空格或
// 标点／后是行尾时不受影响。会破坏配对的边缘标点移到标记外（标点不参与加粗），保证即时渲染
function splitPunctEdges(text, prev, next) {
  let lead = ''
  let trail = ''
  let body = text
  const breaksFlank = (c) => !!c && /\S/u.test(c) && !/\p{P}/u.test(c)
  if (body && /^\p{P}/u.test(body) && breaksFlank(prev)) {
    const m = /^\p{P}+/u.exec(body)
    lead = m[0]
    body = body.slice(lead.length)
  }
  if (body && /\p{P}$/u.test(body) && breaksFlank(next)) {
    const m = /\p{P}+$/u.exec(body)
    trail = m[0]
    body = body.slice(0, body.length - trail.length)
  }
  return { lead, trail, body }
}

function isWordChar(ch) {
  const code = ch.charCodeAt(0)
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39) || ch === '_' || (code >= 0x3040 && code <= 0x30ff) || (code >= 0x3130 && code <= 0x318f) || (code >= 0xac00 && code <= 0xd7af)
}

function expandCollapsedSelectionToWord() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return false
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  if (node.nodeType !== 3) return false
  const text = node.data
  let start = range.startOffset
  let end = start
  while (start > 0 && isWordChar(text[start - 1])) start--
  while (end < text.length && isWordChar(text[end])) end++
  if (start === end) return false
  const newRange = document.createRange()
  newRange.setStart(node, start)
  newRange.setEnd(node, end)
  sel.removeAllRanges()
  sel.addRange(newRange)
  return true
}

function syncInlineToolbarState(tab, name) {
  if (!tab.host) return
  const btn = tab.host.querySelector('.vditor-toolbar button[data-type="' + name + '"]')
  if (!btn) return
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  let node = sel.getRangeAt(0).startContainer
  if (node.nodeType === 3) node = node.parentNode
  const inside = node.closest ? node.closest('.vditor-ir__node[data-type="' + INLINE_NODE_TYPES[name] + '"]') : null
  if (inside) btn.classList.add('vditor-menu--current')
  else btn.classList.remove('vditor-menu--current')
}

function collapseFormattedNodeAtCursor(name) {
  const tab = activeTab()
  const irEl = tab && tab.host ? tab.host.querySelector('.vditor-ir') : null
  if (!irEl) return
  // 按动作类型定位刚格式化的展开节点用于光标放置——不依赖光标位置：复杂文本中
  // Vditor 的光标恢复可能落在节点外（标记配对错位时），按光标找会落空
  let expanded = null
  if (name && INLINE_NODE_TYPES[name]) {
    expanded = irEl.querySelector('.vditor-ir__node--expand[data-type="' + INLINE_NODE_TYPES[name] + '"]')
  }
  if (!expanded) {
    const sel = window.getSelection()
    if (sel && sel.rangeCount) {
      let node = sel.getRangeAt(0).startContainer
      if (node.nodeType === 3) node = node.parentNode
      if (node && node.closest) expanded = node.closest('.vditor-ir__node--expand')
    }
  }
  if (expanded) {
    const range = document.createRange()
    range.setStartAfter(expanded)
    range.collapse(true)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  }
  // 清除全部展开态：spin 在标记配对错位时会把多个节点标为展开（实测 2 个），
  // 只清首个会残留——与 Vditor input() 的全局清除行为一致
  irEl.querySelectorAll('.vditor-ir__node--expand').forEach((n) => n.classList.remove('vditor-ir__node--expand'))
}

function clearStaleToolbarDisabled(tab, name) {
  if (!tab.host) return
  const btn = tab.host.querySelector('.vditor-toolbar button[data-type="' + name + '"]')
  if (!btn || !btn.classList.contains('vditor-menu--disabled')) return
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  let node = sel.getRangeAt(0).startContainer
  if (node.nodeType === 3) node = node.parentNode
  if (!node || !node.closest) return
  // 与 Vditor highlightToolbarIR 的禁用上下文一致：光标在代码块/行内代码内保持禁用
  if (node.closest('[data-type="code-block"]') || node.closest('.vditor-ir__node[data-type="code"]')) return
  // 光标在表格内时保持 Vditor 对这些动作的禁用
  if (node.closest('[data-type="table"]') && ['headings', 'list', 'ordered-list', 'check', 'line', 'quote', 'code', 'table'].indexOf(name) >= 0) return
  btn.classList.remove('vditor-menu--disabled')
}

function isStarMarkerElement(el) {
  return !!(el && el.nodeType === 1 && el.classList && el.classList.contains('vditor-ir__marker') && el.textContent.indexOf('*') >= 0)
}

function inlineMarkerConflict(name) {
  // Lute 对 ≥3 连排的 * 系标记配对失败（实测：相邻加粗 **** 新加粗不渲染、嵌套 *** 斜体不渲染）——
  // 检测插入 * 系标记是否会与既有标记连排，是则改走下划线变体插入
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return false
  const r = sel.getRangeAt(0)
  let node = r.startContainer
  if (node.nodeType === 3) node = node.parentNode
  if (!node || !node.closest) return false
  const sameType = INLINE_NODE_TYPES[name] ? node.closest('.vditor-ir__node[data-type="' + INLINE_NODE_TYPES[name] + '"]') : null
  if (sameType) return false
  if (node.closest('.vditor-ir__node[data-type="strong"], .vditor-ir__node[data-type="em"]')) return true
  const sn = r.startContainer
  if (sn.nodeType === 3 && r.startOffset === 0 && sn.previousSibling) {
    const prev = sn.previousSibling
    if (isStarMarkerElement(prev) || (prev.nodeType === 1 && prev.lastElementChild && isStarMarkerElement(prev.lastElementChild))) return true
  }
  const en = r.endContainer
  if (en.nodeType === 3 && r.endOffset === en.data.length && en.nextSibling) {
    const next = en.nextSibling
    if (isStarMarkerElement(next) || (next.nodeType === 1 && next.firstElementChild && isStarMarkerElement(next.firstElementChild))) return true
  }
  return false
}

function doAction(name) {
  const tab = activeTab()
  if (!tab || !tab.ready) return
  if (!selectionInEditor()) return
  if (INLINE_FORMAT_ACTIONS.indexOf(name) >= 0) {
    const sel = window.getSelection()
    if (sel && sel.rangeCount && sel.isCollapsed) {
      if (!expandCollapsedSelectionToWord()) return
    } else {
      clampSelectionToBlock()
      if (!trimSelectionEdges()) return
    }
    syncInlineToolbarState(tab, name)
  }
  clearStaleToolbarDisabled(tab, name)
  switch (name) {
    case 'bold':
    case 'italic':
    case 'strike':
    case 'inline-code': {
      // Vditor 工具栏 ADD 路径插入 **<wbr>词<wbr>**（带光标标记元素）——Lute 对
      // 「标记紧邻 CJK 字符＋内部含 <wbr>」的组合配对失败（实测：中文词**<wbr>甲<wbr>**
      // 不解析、中文词**甲** 正常、英文空格邻接＋wbr 正常），导致中文文本加粗后不渲染，
      // 直到下次输入触发整块重解析才出现。添加分支改用 execCommand 插入纯文本标记
      // （自然触发 input 事件→input() 重解析，无 wbr，必可配对）；移除分支（光标已在
      // 同类格式内）保留工具栏路径（removeInline 自带重解析）
      const selC = window.getSelection()
      let textC = selC && selC.rangeCount ? String(selC) : ''
      if (selectionInsideFormat(name)) {
        if (triggerToolbar(name) && INLINE_COLLAPSE_ACTIONS.indexOf(name) >= 0) collapseFormattedNodeAtCursor(name)
        break
      }
      // 边缘标点调整（行内代码无侧性规则，不需要）：会破坏开/闭标记配对的标点移到标记外
      let punctLead = ''
      let punctTrail = ''
      if (textC && name !== 'inline-code') {
        const adj = splitPunctEdges(textC, charBeforeSelection(), charAfterSelection())
        punctLead = adj.lead
        punctTrail = adj.trail
        textC = adj.body
      }
      if (textC && (name === 'bold' || name === 'italic') && inlineMarkerConflict(name)) {
        const u = name === 'bold' ? '__' : '_'
        insertAtCursor(punctLead + u + textC + u + punctTrail)
        collapseFormattedNodeAtCursor(name)
        break
      }
      if (textC) {
        const pair = INLINE_MARKER_PAIRS[name]
        insertAtCursor(punctLead + pair[0] + textC + pair[1] + punctTrail)
        collapseFormattedNodeAtCursor(name)
      }
      break
    }
    case 'link':
    case 'list':
    case 'ordered-list':
    case 'check':
    case 'quote':
    case 'line':
    case 'code':
    case 'indent':
    case 'outdent':
      if (triggerToolbar(name) && INLINE_COLLAPSE_ACTIONS.indexOf(name) >= 0) collapseFormattedNodeAtCursor(name)
      break
    case 'table': {
      const selT = window.getSelection()
      if (!selT || !selT.rangeCount) break
      let nodeT = selT.getRangeAt(0).startContainer
      if (nodeT.nodeType === 3) nodeT = nodeT.parentNode
      if (!nodeT.closest || !nodeT.closest('.vditor-ir')) break
      // Vditor IR 的 spin 会把模板中的文本 \n 转成段落分隔（表格行被空行隔开），
      // <br> 则被原样保留——两者都无法经 spin 解析成表格。直接插入真实 <table> 元素：
      // 浏览器自动分块，渲染正确，DOM2Md 也能转出正确的表格 markdown
      document.execCommand('insertHTML', false, '<table><thead><tr><th>col1</th><th>col2</th><th>col3</th></tr></thead><tbody><tr><td> </td><td> </td><td> </td></tr></tbody></table>')
      break
    }
    case 'math':
      insertAtCursor('$$\n\n$$')
      break
    case 'image':
      insertAtCursor('![]()')
      if (!placeCursorInImageUrl()) moveCursorBack(1)
      break
    case 'clear-format':
      clearFormat()
      break
  }
}

function currentHeadingLevel() {
  const b = currentBlock()
  if (!b) return 0
  const m = /^H([1-6])$/.exec(b.tagName)
  return m ? Number(m[1]) : 0
}

function applyHeading(level) {
  const b = currentBlock()
  if (!b) return
  if (!/^(P|H[1-6])$/.test(b.tagName)) return
  if (level === 'up' || level === 'down') {
    const cur = currentHeadingLevel()
    if (level === 'up') {
      if (cur <= 1) return
      level = cur - 1
    } else {
      if (cur === 0) return
      level = cur >= 6 ? 0 : cur + 1
    }
  }
  const sel = window.getSelection()
  if (!sel) return
  const isHeading = /^H[1-6]$/.test(b.tagName)
  const marker = isHeading ? b.querySelector('.vditor-ir__marker') : null
  if (marker) {
    const range = document.createRange()
    range.selectNodeContents(marker)
    sel.removeAllRanges()
    sel.addRange(range)
    if (level === 0) document.execCommand('delete')
    else document.execCommand('insertText', false, '#'.repeat(level))
  } else if (level > 0) {
    const range = document.createRange()
    range.setStart(b, 0)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
    document.execCommand('insertText', false, '#'.repeat(level) + ' ')
  }
}

const CLEARABLE_INLINE_TYPES = ['strong', 'em', 's', 'code', 'a', 'mark', 'tag', 'sub', 'sup', 'kbd']

function rangeIntersectsNode(range, node) {
  const r2 = document.createRange()
  r2.selectNodeContents(node)
  return range.comparePoint(r2.startContainer, r2.startOffset) <= 0 &&
    range.comparePoint(r2.endContainer, r2.endOffset) >= 0
}

function clearFormat() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  const tab = activeTab()
  if (!tab || !tab.host) return
  const root = tab.host.querySelector('.vditor-ir .vditor-reset')
  if (!root) return
  const range = sel.getRangeAt(0)
  let targets = []
  if (range.collapsed) {
    let node = range.startContainer
    if (node.nodeType === 3) node = node.parentNode
    const inlineNode = node.closest ? node.closest('.vditor-ir__node') : null
    if (inlineNode && CLEARABLE_INLINE_TYPES.indexOf(inlineNode.getAttribute('data-type')) >= 0) targets = [inlineNode]
  } else {
    // 选区可能起于纯文本（旧实现只看 startContainer 会直接无动作）——收集整个选区相交的行内格式节点
    root.querySelectorAll('.vditor-ir__node').forEach((n) => {
      if (CLEARABLE_INLINE_TYPES.indexOf(n.getAttribute('data-type')) < 0) return
      if (rangeIntersectsNode(range, n)) targets.push(n)
    })
    targets = targets.filter((n) => !targets.some((m) => m !== n && m.contains(n)))
  }
  if (!targets.length) return
  let anchorText = null
  for (const node of targets) {
    const clone = node.cloneNode(true)
    clone.querySelectorAll('.vditor-ir__marker').forEach((m) => m.remove())
    const textNode = document.createTextNode(clone.textContent)
    node.replaceWith(textNode)
    if (!anchorText) anchorText = textNode
  }
  if (anchorText && anchorText.parentNode) {
    const r = document.createRange()
    r.setStart(anchorText, 0)
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
  }
  // DOM 手术不触发原生 input，合成一个让 Vditor 重新解析渲染
  root.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }))
}

function reopenClosed() {
  const p = closedStack.shift()
  if (p) openPath(p)
  else toast('没有已关闭的文件')
}

function confirmUnsaved(message) {
  return api.confirmUnsaved(message)
}

async function handleConfirmClose() {
  const dirty = state.tabs.filter((t) => t.dirty)
  if (!dirty.length) {
    api.closeReply('close')
    return
  }
  const msg = dirty.length === 1 ? '「' + dirty[0].name + '」有未保存的修改。' : '有 ' + dirty.length + ' 个文档未保存。'
  const choice = await confirmUnsaved(msg)
  if (choice === 'cancel') {
    api.closeReply('cancel')
    return
  }
  if (choice === 'save') {
    for (const t of dirty) {
      await saveTab(t)
      if (t.dirty) {
        api.closeReply('cancel')
        return
      }
    }
  }
  api.closeReply('close')
}

// ---------- 专注模式 ----------

function currentBlock() {
  const sel = window.getSelection()
  if (!sel || !sel.anchorNode) return null
  let node = sel.anchorNode
  if (node.nodeType === 3) node = node.parentNode
  if (!node.closest) return null
  const reset = node.closest('.vditor-reset')
  if (!reset) return null
  let el = node
  while (el && el.parentElement !== reset) el = el.parentElement
  return el && el.parentElement === reset ? el : null
}

function updateFocusMark() {
  const prev = document.querySelector('.fm-current')
  if (prev) prev.classList.remove('fm-current')
  if (!state.settings.focus) return
  const b = currentBlock()
  if (b) b.classList.add('fm-current')
}

// ---------- 视图切换 ----------

function setDark(on) {
  state.settings.dark = on
  saveSettings()
  document.body.classList.toggle('theme-dark', on)
  const contentPath = ABS_CONTENT_THEME
  for (const t of state.tabs) {
    if (t.vditor) {
      try {
        t.vditor.setTheme(on ? 'dark' : 'classic', on ? 'dark' : 'light', on ? 'vs2015' : 'github', contentPath)
      } catch (err) {
        console.warn('setTheme 失败', err)
      }
    }
  }
  syncViewState()
}

function setFocus(on) {
  state.settings.focus = on
  saveSettings()
  document.body.classList.toggle('focus-mode', on)
  if (on) updateFocusMark()
  else {
    const prev = document.querySelector('.fm-current')
    if (prev) prev.classList.remove('fm-current')
  }
  syncViewState()
}

function setTypewriter(on) {
  state.settings.typewriter = on
  saveSettings()
  for (const t of state.tabs) {
    if (t.vditor) {
      try {
        t.vditor.vditor.options.typewriterMode = on
      } catch (err) {
        console.warn('typewriterMode 切换失败', err)
      }
    }
  }
  syncViewState()
}

function setOutline(on) {
  state.settings.outline = on
  saveSettings()
  document.body.classList.toggle('no-outline', !on)
  if (on) renderOutlinePanel()
  syncViewState()
}

function setSidebar(on) {
  state.settings.sidebar = on
  saveSettings()
  document.body.classList.toggle('no-sidebar', !on)
  syncViewState()
}

function setCodeWrap(on) {
  state.settings.codeWrap = on
  saveSettings()
  document.body.classList.toggle('code-wrap', on)
  syncViewState()
}

// ---------- 导出 ----------

function exportBaseCss(dark) {
  const bg = dark ? '#1e1e20' : '#ffffff'
  return [
    'html { -webkit-font-smoothing: antialiased; }',
    'body { margin: 0; background: ' + bg + '; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }',
    '.md-export { max-width: 800px; margin: 0 auto; padding: 48px 32px; font-size: 16px; line-height: 1.65; }',
    '.md-export img { max-width: 100%; }',
    '.md-export pre { overflow-x: auto; }',
    '.md-export table { display: block; overflow-x: auto; max-width: 100%; }',
    '@media print {',
    '  .md-export { max-width: none; padding: 0; }',
    '  pre, table, blockquote, figure { break-inside: avoid; }',
    '  pre { white-space: pre-wrap; word-break: break-word; }',
    '  h1, h2, h3, h4, h5, h6 { break-after: avoid; }',
    '}',
  ].join('\n')
}

async function inlineKatexFonts(css) {
  const matches = [...css.matchAll(/url\((['"]?)(fonts\/[^)'"]+\.woff2)\1\)/g)]
  let out = css
  for (const m of matches) {
    const r = await api.readAsset('vditor/dist/js/katex/' + m[2])
    if (r.ok && r.base64) {
      out = out.split(m[0]).join('url(data:font/woff2;base64,' + r.base64 + ')')
    }
  }
  return out
}

async function collectExportCss() {
  const dark = state.settings.dark
  let css = exportBaseCss(dark)
  const themeCss = await api.readAsset('vditor/dist/css/content-theme/' + (dark ? 'dark' : 'light') + '.css')
  if (themeCss.ok) css += '\n' + themeCss.content
  const hljsCss = await api.readAsset('vditor/dist/js/highlight.js/styles/' + (dark ? 'vs2015' : 'github') + '.min.css')
  if (hljsCss.ok) css += '\n' + hljsCss.content
  const katexCss = await api.readAsset('vditor/dist/js/katex/katex.min.css')
  if (katexCss.ok) css += '\n' + (await inlineKatexFonts(katexCss.content))
  return css
}

async function renderMarkdownHtml(md) {
  const dark = state.settings.dark
  try {
    const html = await Vditor.md2html(md, {
      mode: dark ? 'dark' : 'light',
      cdn: ABS_CDN,
      hljs: { enable: true, style: dark ? 'vs2015' : 'github', lineNumber: false },
      math: { engine: 'KaTeX' },
      markdown: { autoSpace: true, toc: false, footnotes: true },
    })
    if (html && html.trim()) return html
  } catch (err) {
    console.warn('md2html 失败，改用编辑器 DOM', err)
  }
  const tab = activeTab()
  return tab && tab.vditor ? tab.vditor.getHTML() : ''
}

function buildStandaloneHtml(title, body, css, opts) {
  opts = opts || {}
  // 导出产物是纯静态内容：禁脚本／插件，防止 markdown 内嵌 HTML 在产物里执行
  const csp = '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'; object-src \'none\'">\n'
  const baseTag = opts.baseHref ? '<base href="' + escapeHtml(opts.baseHref) + '">\n' : ''
  return (
    '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
    baseTag +
    csp +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' +
    escapeHtml(title) +
    '</title>\n<style>\n' +
    css +
    '\n</style>\n</head>\n<body>\n<article class="vditor-reset md-export">\n' +
    body +
    '\n</article>\n</body>\n</html>\n'
  )
}

function fileUrlToPath(u) {
  try {
    const url = new URL(u)
    if (url.protocol !== 'file:') return null
    let p = decodeURIComponent(url.pathname)
    if (url.host) p = '\\\\' + url.host + p
    else if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
    return p.replace(/\//g, '\\')
  } catch {
    return null
  }
}

// HTML 导出内嵌本地图片为 data URI，兑现「自包含单文件」；远程图片保留原 URL
async function inlineLocalImages(html, dir) {
  if (!html || !dir) return html
  const base = dirToBaseUrl(dir)
  if (!base) return html
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const imgs = Array.from(doc.querySelectorAll('img[src]'))
    let changed = false
    for (const img of imgs) {
      const src = img.getAttribute('src') || ''
      if (!src || /^(https?:|data:|blob:|file:)/i.test(src)) continue
      const p = fileUrlToPath(new URL(src, base).href)
      if (!p) continue
      const r = await api.readImage(p)
      if (r.ok && r.base64) {
        img.setAttribute('src', 'data:' + r.mime + ';base64,' + r.base64)
        changed = true
      }
    }
    return changed ? doc.body.innerHTML : html
  } catch {
    return html
  }
}

async function exportHtml() {
  const tab = activeTab()
  if (!tab || !tab.vditor || !tab.ready) {
    toast('没有可导出的文档')
    return
  }
  const md = tabValue(tab)
  let bodyHtml = await renderMarkdownHtml(md)
  const css = await collectExportCss()
  const title = stripExt(tab.name) || '未命名'
  bodyHtml = await inlineLocalImages(bodyHtml, tab.path ? pathDirname(tab.path) : '')
  const r = await api.exportHtml(title + '.html', buildStandaloneHtml(title, bodyHtml, css))
  if (r.ok) toast('已导出 HTML：' + r.path)
}

async function exportPdf() {
  const tab = activeTab()
  if (!tab || !tab.vditor || !tab.ready) {
    toast('没有可导出的文档')
    return
  }
  const md = tabValue(tab)
  const bodyHtml = await renderMarkdownHtml(md)
  const css = await collectExportCss()
  const title = stripExt(tab.name) || '未命名'
  // PDF 经 %TEMP% 中的临时页打印，相对图片必须靠 base 指回文档目录才能加载
  const baseHref = tab.path ? dirToBaseUrl(pathDirname(tab.path)) : ''
  const r = await api.exportPdf(title, buildStandaloneHtml(title, bodyHtml, css, { baseHref }))
  if (r.ok) toast('已导出 PDF：' + r.path)
}

// ---------- 菜单与事件 ----------

async function handleMenu(cmd, arg) {
  switch (cmd) {
    case 'new':
      newDoc()
      break
    case 'open': {
      const p = await api.openFile()
      if (p) openPath(p)
      break
    }
    case 'open-dir':
      openWorkspace()
      break
    case 'save': {
      const t = activeTab()
      if (!t) toast('没有打开的文档')
      else if (!t.ready) toast('文档尚未加载完成，请稍候')
      else saveTab(t)
      break
    }
    case 'save-as':
      saveAs()
      break
    case 'export-pdf':
      exportPdf()
      break
    case 'export-html':
      exportHtml()
      break
    case 'find':
      openFind(false)
      break
    case 'replace':
      openFind(true)
      break
    case 'find-next':
      doFind(false)
      break
    case 'find-prev':
      doFind(true)
      break
    case 'close-tab':
      if (state.activeId != null) closeTab(state.activeId)
      break
    case 'reopen-closed':
      reopenClosed()
      break
    case 'heading':
      applyHeading(arg)
      break
    case 'act':
      doAction(arg)
      break
    case 'cycle-tab':
      cycleTab(1)
      break
    case 'toggle-sidebar':
      setSidebar(!state.settings.sidebar)
      break
    case 'toggle-outline':
      setOutline(!state.settings.outline)
      break
    case 'toggle-focus':
      setFocus(!state.settings.focus)
      break
    case 'toggle-typewriter':
      setTypewriter(!state.settings.typewriter)
      break
    case 'toggle-dark':
      setDark(!state.settings.dark)
      break
    case 'toggle-code-wrap':
      setCodeWrap(!state.settings.codeWrap)
      break
    case 'recent-open':
      if (arg) openPath(arg)
      break
    case 'shortcuts':
      showShortcuts()
      break
  }
}

function globalKeydown(e) {
  if (e.key === 'Escape') {
    const mask = document.querySelector('.modal-mask')
    if (mask) {
      mask.remove()
      e.preventDefault()
      return
    }
    if (!$('#findbar').hidden) {
      closeFind()
      e.preventDefault()
      return
    }
  }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyW') {
    e.preventDefault()
    if (state.activeId != null) closeTab(state.activeId)
    return
  }
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault()
    e.stopPropagation()
    cycleTab(e.shiftKey ? -1 : 1)
  }
}

// ---------- 快捷键冲突拦截 ----------
// Vditor hotkeyEvent 对其工具栏快捷键（⌘B/⌘I/⌘K/⌘D/⌘G/⌘O/⇧⌘I）命中后自行处理并
// preventDefault——按键被标记已处理，Electron 菜单加速键（未处理路径）被整体抑制，
// 应用侧的修复路径（选区边缘空白裁剪等）被绕过；带空白的选区（双击选词的尾随空格）
// 产生无法配对的字面 ** 标记，永不渲染——即「快捷键加粗后不渲染」的根因。
// 窗口捕获阶段先于 Vditor 的元素级监听器拦截这些组合：stopPropagation 跳过 Vditor，
// preventDefault 抑制菜单加速键避免双触发，动作统一转交 handleMenu/doAction 修复路径。
const HOTKEY_ACTIONS = [
  { code: 'KeyB', ctrl: true, shift: false, cmd: 'act', arg: 'bold' },
  { code: 'KeyI', ctrl: true, shift: false, cmd: 'act', arg: 'italic' },
  { code: 'KeyK', ctrl: true, shift: false, cmd: 'act', arg: 'link' },
  { code: 'KeyD', ctrl: true, shift: false, cmd: 'act', arg: 'strike' },
  { code: 'KeyG', ctrl: true, shift: false, cmd: 'act', arg: 'inline-code' },
  { code: 'KeyO', ctrl: true, shift: false, cmd: 'open' },
  { code: 'KeyI', ctrl: true, shift: true, cmd: 'act', arg: 'image' },
]

function hotkeyIntercept(e) {
  if (e.isComposing || e.altKey || e.metaKey || !e.ctrlKey) return
  const hit = HOTKEY_ACTIONS.find((h) => e.code === h.code && e.shiftKey === h.shift)
  if (!hit) return
  e.preventDefault()
  e.stopPropagation()
  handleMenu(hit.cmd, hit.arg)
}

function bindStaticEvents() {
  $('#w-new').addEventListener('click', newDoc)
  $('#w-open').addEventListener('click', async () => {
    const p = await api.openFile()
    if (p) openPath(p)
  })
  $('#w-dir').addEventListener('click', openWorkspace)
  $('#btn-refresh').addEventListener('click', refreshTree)
  $('#btn-closedir').addEventListener('click', closeWorkspace)

  $('#find-next').addEventListener('click', () => doFind(false))
  $('#find-prev').addEventListener('click', () => doFind(true))
  $('#find-close').addEventListener('click', closeFind)
  $('#replace-one').addEventListener('click', replaceOne)
  $('#replace-all').addEventListener('click', replaceAll)
  $('#find-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      doFind(e.shiftKey)
    } else if (e.key === 'Escape') {
      closeFind()
    }
  })
  $('#replace-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      replaceOne()
    } else if (e.key === 'Escape') {
      closeFind()
    }
  })
  window.addEventListener('focus', syncViewState)

  $('#outline-panel').addEventListener('click', (e) => {
    const item = e.target.closest('.outline-item')
    if (!item) return
    const tab = activeTab()
    if (!tab || !tab.host) return
    const reset = tab.host.querySelector('.vditor-ir .vditor-reset')
    if (!reset) return
    const heads = reset.querySelectorAll('h1,h2,h3,h4,h5,h6')
    const h = heads[Number(item.dataset.idx)]
    if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })

  window.addEventListener('keydown', globalKeydown, true)
  window.addEventListener('keydown', hotkeyIntercept, true)
  document.addEventListener('selectionchange', updateFocusMark)
  // Typora 式链接点击：普通点击展开为编辑，Ctrl+点击才访问
  // 捕获阶段先于 Vditor 冒泡处理器运行——普通点击预先加 --expand 使其跳过
  // 内置的 window.open 分支、落到 expandMarker 放光标；Ctrl+点击则自行外开
  document.addEventListener('click', (e) => {
    const t = e.target
    if (!t || t.nodeType !== 1 || !t.closest || !t.closest('.vditor-ir')) return
    const node = t.closest('.vditor-ir__node[data-type="a"]')
    if (!node) return
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      e.stopPropagation()
      const markerLink = node.querySelector(':scope > .vditor-ir__marker--link')
      const anchor = node.querySelector('a[href]')
      const url = String((markerLink && markerLink.textContent) || (anchor && anchor.getAttribute('href')) || '').trim()
      if (/^https?:/i.test(url)) window.open(url, '_blank')
      return
    }
    e.preventDefault()
    if (!node.classList.contains('vditor-ir__node--expand')) node.classList.add('vditor-ir__node--expand')
  }, true)
  document.addEventListener('dragover', (e) => e.preventDefault())
  document.addEventListener('drop', (e) => {
    e.preventDefault()
    const files = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : []
    const paths = []
    for (const f of files) {
      const p = api.pathForFile(f)
      if (p && /\.(md|markdown|txt)$/i.test(p)) paths.push(p)
    }
    if (!paths.length) return
    if (paths.length === 1) {
      openPath(paths[0])
    } else {
      ;(async () => {
        for (const p of paths) await openPath(p)
      })()
    }
  })

  api.onMenuEvent((cmd, arg) => handleMenu(cmd, arg))
  api.onOpenFile((p) => {
    if (p) openPath(p)
  })
  api.onConfirmClose(handleConfirmClose)
}

// ---------- 弹层 ----------

function toast(msg) {
  const el = $('#toast')
  el.textContent = msg
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    el.hidden = true
  }, 2600)
}

function showShortcuts() {
  const rows = [
    ['新建 / 新建窗口', 'Ctrl+N / Ctrl+Shift+N'],
    ['打开 / 重新打开关闭的文件', 'Ctrl+O / Ctrl+Shift+T'],
    ['保存 / 另存为', 'Ctrl+S / Ctrl+Shift+S'],
    ['关闭 / 切换文档', 'Ctrl+W / Ctrl+Tab'],
    ['查找 / 替换', 'Ctrl+F / Ctrl+H'],
    ['查找下一个 / 上一个', 'F3 / Shift+F3'],
    ['一级~六级标题 / 正文', 'Ctrl+1~6 / Ctrl+0'],
    ['提升 / 降低标题', 'Ctrl+= / Ctrl+-'],
    ['表格 / 代码块 / 数学块', 'Ctrl+T / Ctrl+Shift+K / Ctrl+Shift+M'],
    ['引用 / 有序 / 无序 / 任务列表', 'Ctrl+Shift+Q / Ctrl+Shift+[ / Ctrl+Shift+]'],
    ['加粗 / 斜体 / 行内代码', 'Ctrl+B / Ctrl+I / Ctrl+Shift+`'],
    ['删除线 / 超链接 / 图像', 'Alt+Shift+5 / Ctrl+K / Ctrl+Shift+I'],
    ['清除格式', 'Ctrl+\\'],
    ['侧边栏 / 大纲', 'Ctrl+Shift+L / Ctrl+Shift+1'],
    ['专注模式 / 打字机模式', 'F8 / F9'],
    ['放大 / 缩小 / 实际大小', 'Ctrl+Shift+= / Ctrl+Shift+- / Ctrl+Shift+0'],
    ['导出 PDF', 'Ctrl+Shift+E'],
  ]
  const mask = document.createElement('div')
  mask.className = 'modal-mask'
  mask.innerHTML =
    '<div class="modal"><h3>快捷键</h3><table class="kbd-table">' +
    rows.map((r) => '<tr><td>' + r[0] + '</td><td><kbd>' + r[1] + '</kbd></td></tr>').join('') +
    '</table></div>'
  mask.addEventListener('click', (e) => {
    if (e.target === mask) mask.remove()
  })
  document.body.appendChild(mask)
}

// ---------- 初始化 ----------

async function init() {
  window.addEventListener('error', (e) => {
    console.error('[im-error]', e.message, e.error && e.error.stack)
  })
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[im-rejection]', e.reason && (e.reason.stack || String(e.reason)))
  })
  applyBodyClasses()
  bindStaticEvents()
  syncViewState()
  renderTabbar()
  updateTitle()
  const ws = localStorage.getItem('im-workspace')
  if (ws) {
    state.workspace = ws
    state.expanded = new Set([ws])
    refreshTree()
  }
  await updateWelcome()
}

init()

// ---------- 关闭前落盘与测试钩子 ----------

// 与主进程 --eval 门控同源：仅开发模式（或打包后 IM_DEV_TOOLS=1）暴露
if (api.devHooks) {
  window.__im = {
    openPath,
    newDoc,
    activateTab,
    closeTab,
    applyHeading,
    doAction,
    replaceAll,
    setDark,
    setFocus,
    setTypewriter,
    setOutline,
    setSidebar,
    setCodeWrap,
    exportHtml,
    exportPdf,
    setWorkspace: (p) => {
      state.workspace = p
      state.expanded = new Set([p])
      return refreshTree()
    },
    buildExport: async () => {
      const tab = activeTab()
      if (!tab || !tab.vditor || !tab.ready) return null
      const md = tabValue(tab)
      let bodyHtml = await renderMarkdownHtml(md)
      const css = await collectExportCss()
      bodyHtml = await inlineLocalImages(bodyHtml, tab.path ? pathDirname(tab.path) : '')
      return buildStandaloneHtml(stripExt(tab.name) || '未命名', bodyHtml, css)
    },
    buildPdf: async () => {
      const tab = activeTab()
      if (!tab || !tab.vditor || !tab.ready) return null
      const md = tabValue(tab)
      const bodyHtml = await renderMarkdownHtml(md)
      const css = await collectExportCss()
      const baseHref = tab.path ? dirToBaseUrl(pathDirname(tab.path)) : ''
      return buildStandaloneHtml(stripExt(tab.name) || '未命名', bodyHtml, css, { baseHref })
    },
    value: () => tabValue(activeTab()),
    encoding: () => {
      const t = activeTab()
      return t ? t.encoding || 'utf-8' : null
    },
    tabs: () => state.tabs.map((t) => ({ id: t.id, name: t.name, path: t.path, dirty: t.dirty, encoding: t.encoding || 'utf-8' })),
    active: () => {
      const t = activeTab()
      return t ? t.name : null
    },
  }
}
