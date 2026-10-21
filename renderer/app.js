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

const DEFAULT_SETTINGS = { dark: false, focus: false, typewriter: false, sidebar: true, outline: true }

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
}

function syncViewState() {
  api.syncViewState({
    sidebar: state.settings.sidebar,
    outline: state.settings.outline,
    focus: state.settings.focus,
    typewriter: state.settings.typewriter,
    dark: state.settings.dark,
  })
}

// ---------- 编辑器 ----------

const ABS_CDN = new URL('../node_modules/vditor', location.href).href
const ABS_CONTENT_THEME = new URL('../node_modules/vditor/dist/css/content-theme', location.href).href

function updateDocumentBase(tab) {
  let base = document.querySelector('base')
  if (!base) {
    base = document.createElement('base')
    document.head.appendChild(base)
  }
  let href = ''
  if (tab && tab.path) {
    const dir = pathDirname(tab.path).replace(/\\/g, '/')
    if (dir) {
      try {
        // 按段编码：目录名中的 #/? 会被 URL 解析为 fragment/query，导致 base 指向错误目录
        const enc = dir.split('/').map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join('/')
        href = new URL('file:///' + enc + '/').href
      } catch {}
    }
  }
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
  const n = state.tabs.filter((t) => !t.path).length
  if (n > 0) name += ' ' + (n + 1)
  const tab = { id: ++tabSeq, path: null, name, content: '', dirty: false, vditor: null, host: null }
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
  if (tab.vditor) {
    try {
      tab.vditor.destroy()
    } catch {}
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
  return /\.md$/i.test(tab.name) ? tab.name : tab.name + '.md'
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
    api.recentAdd(p)
    maybeRefreshTree(p)
  } else {
    const r = await api.writeFile(tab.path, content)
    if (!r.ok) {
      toast('保存失败：' + r.error)
      return
    }
  }
  tab.dirty = false
  renderTabbar()
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

function updateStatus(value) {
  const tab = activeTab()
  const text = value != null ? value : tabValue(tab)
  const c = countText(text || '')
  $('#st-count').textContent = c.words ? fmt(c.words) + ' 字 · ' + fmt(c.chars) + ' 字符' : ''
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
  let n = 0
  while (n < 500) {
    if (!rawFind(q)) break
    document.execCommand('insertText', false, rep)
    n++
    if (rep.indexOf(q) >= 0 && n >= 20) break
  }
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
    let firstAfter = null
    for (const c of candidates) {
      const im = c.querySelector('img')
      if (!im || im.getAttribute('src')) continue
      if (node.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) {
        if (!firstAfter) firstAfter = c
      } else {
        imgNode = c
      }
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
const INLINE_NODE_TYPES = { bold: 'strong', italic: 'em', strike: 's', 'inline-code': 'code', link: 'a' }

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

function collapseFormattedNodeAtCursor() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  let node = sel.getRangeAt(0).startContainer
  if (node.nodeType === 3) node = node.parentNode
  if (!node.closest) return
  const expanded = node.closest('.vditor-ir__node--expand')
  if (!expanded) return
  const range = document.createRange()
  range.setStartAfter(expanded)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
  expanded.classList.remove('vditor-ir__node--expand')
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

function doAction(name) {
  const tab = activeTab()
  if (!tab || !tab.ready) return
  if (INLINE_FORMAT_ACTIONS.indexOf(name) >= 0) {
    if (!selectionInEditor()) return
    const sel = window.getSelection()
    if (sel && sel.rangeCount && sel.isCollapsed) {
      if (!expandCollapsedSelectionToWord()) return
    }
    syncInlineToolbarState(tab, name)
  }
  clearStaleToolbarDisabled(tab, name)
  switch (name) {
    case 'bold':
    case 'italic':
    case 'strike':
    case 'link':
    case 'inline-code':
    case 'list':
    case 'ordered-list':
    case 'check':
    case 'quote':
    case 'line':
    case 'code':
    case 'indent':
    case 'outdent':
      if (triggerToolbar(name) && INLINE_COLLAPSE_ACTIONS.indexOf(name) >= 0) collapseFormattedNodeAtCursor()
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

function clearFormat() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  let node = sel.getRangeAt(0).startContainer
  if (node.nodeType === 3) node = node.parentNode
  if (!node.closest) return
  const inlineNode = node.closest('.vditor-ir__node')
  if (!inlineNode) return
  if (!/^(SPAN|H[1-6])$/.test(inlineNode.tagName)) return
  const clone = inlineNode.cloneNode(true)
  clone.querySelectorAll('.vditor-ir__marker').forEach((m) => m.remove())
  const text = clone.textContent
  if (!text) return
  const range = document.createRange()
  range.selectNodeContents(inlineNode)
  sel.removeAllRanges()
  sel.addRange(range)
  document.execCommand('insertText', false, text)
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

function buildStandaloneHtml(title, body, css) {
  return (
    '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' +
    escapeHtml(title) +
    '</title>\n<style>\n' +
    css +
    '\n</style>\n</head>\n<body>\n<article class="vditor-reset md-export">\n' +
    body +
    '\n</article>\n</body>\n</html>\n'
  )
}

async function exportHtml() {
  const tab = activeTab()
  if (!tab || !tab.vditor || !tab.ready) {
    toast('没有可导出的文档')
    return
  }
  const md = tabValue(tab)
  const bodyHtml = await renderMarkdownHtml(md)
  const css = await collectExportCss()
  const title = stripExt(tab.name) || '未命名'
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
  const r = await api.exportPdf(title, buildStandaloneHtml(title, bodyHtml, css))
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
    case 'recent-open':
      if (arg) openPath(arg)
      break
    case 'shortcuts':
      showShortcuts()
      break
  }
}

function globalKeydown(e) {
  if (e.key === 'Escape' && !$('#findbar').hidden) {
    closeFind()
    e.preventDefault()
    return
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
  document.addEventListener('selectionchange', updateFocusMark)
  document.addEventListener('dragover', (e) => e.preventDefault())
  document.addEventListener('drop', (e) => {
    e.preventDefault()
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
    if (!f) return
    const p = api.pathForFile(f)
    if (p && /\.(md|markdown|txt)$/i.test(p)) openPath(p)
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
    const bodyHtml = await renderMarkdownHtml(md)
    const css = await collectExportCss()
    return buildStandaloneHtml(stripExt(tab.name) || '未命名', bodyHtml, css)
  },
  tabs: () => state.tabs.map((t) => ({ id: t.id, name: t.name, path: t.path, dirty: t.dirty })),
  active: () => {
    const t = activeTab()
    return t ? t.name : null
  },
}
