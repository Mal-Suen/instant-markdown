'use strict'
// 审计测试：main.js 的 registerIpc 各处理器（用 stub 的 electron 模块加载）。
// 覆盖：fs:read 扩展名校验与解码、fs:write 编码回退、fs:read-image 大小与 MIME、
// read-asset 路径穿越防护、recent:add 去重与 12 条上限、view-state 变更检测。

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { loadFunction } = require('./helpers/extract_fn')

let iconv = null
try {
  iconv = require('iconv-lite')
} catch {}

// —— 提取真实的内部纯函数，注入给 registerIpc ——
const decodeFileText = loadFunction('decodeFileText', {})
const encodeFileText = loadFunction('encodeFileText', { iconv })
const listDir = loadFunction('listDir', { fs, path })
const writeFileAtomic = loadFunction('writeFileAtomic', { fs, path })

function makeHarness() {
  const handlers = {}
  const ipcMain = {
    handle: (ch, fn) => {
      handlers[ch] = fn
    },
    on: (ch, fn) => {
      handlers[ch] = fn
    },
  }
  const dialog = {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true }),
    showMessageBox: async () => ({ response: 2 }),
  }
  class BrowserWindow {
    constructor() {
      this.webContents = {
        loadFile: async () => {},
        printToPDF: async () => Buffer.from('%PDF-fake'),
      }
    }
    loadFile() {}
    destroy() {}
  }
  const app = { getPath: () => os.tmpdir() }

  // recent 列表用内存数组模拟 recent.json
  let recentStore = []
  const loadRecent = () => recentStore
  const saveRecentList = (list) => {
    recentStore = list
  }
  let menuBuilds = 0
  const buildMenu = () => {
    menuBuilds++
  }
  const winFor = () => null

  const registerIpc = loadFunction('registerIpc', {
    ipcMain,
    dialog,
    BrowserWindow,
    app,
    fs,
    path,
    iconv,
    winFor,
    writeFileAtomic,
    decodeFileText,
    encodeFileText,
    listDir,
    loadRecent,
    saveRecentList,
    buildMenu,
    __dirname: path.join(__dirname, '..'),
    viewState: { sidebar: true, outline: true, focus: false, typewriter: false, dark: false, codeWrap: true },
  })
  registerIpc()
  return { handlers, getRecent: () => recentStore, setRecent: (v) => (recentStore = v), getMenuBuilds: () => menuBuilds }
}

const ev = {} // IPC 事件对象（winFor stub 不用它）

test('fs:read：合法 .md 文件读取并探测编码', async () => {
  const h = makeHarness()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-ipc-'))
  try {
    const p = path.join(dir, 'doc.md')
    fs.writeFileSync(p, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# hi', 'utf8')]))
    const r = await h.handlers['fs:read'](ev, p)
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.encoding, 'utf-8-bom')
    assert.strictEqual(r.content, '# hi')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('fs:read：拒绝非文本扩展名与非字符串路径', async () => {
  const h = makeHarness()
  const r1 = await h.handlers['fs:read'](ev, 'C:\\x\\evil.exe')
  assert.strictEqual(r1.ok, false)
  assert.match(r1.error, /仅支持读取/)
  const r2 = await h.handlers['fs:read'](ev, 123)
  assert.strictEqual(r2.ok, false)
  const r3 = await h.handlers['fs:read'](ev, null)
  assert.strictEqual(r3.ok, false)
})

test('fs:read：文件不存在时返回错误而非抛异常', async () => {
  const h = makeHarness()
  const r = await h.handlers['fs:read'](ev, 'Z:\\no-such\\file.md')
  assert.strictEqual(r.ok, false)
  assert.ok(typeof r.error === 'string' && r.error.length > 0)
})

test('fs:write：GBK 可表示内容按 gbk 写回', async () => {
  const h = makeHarness()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-ipc-'))
  try {
    const p = path.join(dir, 'out.md')
    const r = await h.handlers['fs:write'](ev, p, '中文abc', 'gbk')
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.encoding, 'gbk')
    assert.strictEqual(fs.readFileSync(p).toString('hex'), 'd6d0cec4' + Buffer.from('abc').toString('hex'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('fs:write：GBK 有损内容自动回退 UTF-8 并如实上报', async () => {
  const h = makeHarness()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-ipc-'))
  try {
    const p = path.join(dir, 'lossy.md')
    const r = await h.handlers['fs:write'](ev, p, '中文😀', 'gbk')
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.encoding, 'utf-8', '有损时应回退 utf-8 并在返回值标明')
    assert.strictEqual(fs.readFileSync(p, 'utf8'), '中文😀')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('fs:write：拒绝非文本扩展名', async () => {
  const h = makeHarness()
  const r = await h.handlers['fs:write'](ev, 'C:\\x\\a.bat', 'x', 'utf-8')
  assert.strictEqual(r.ok, false)
  assert.match(r.error, /仅支持写入/)
})

test('fs:tree：返回目录树且非字符串根返回空数组', async () => {
  const h = makeHarness()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-ipc-'))
  try {
    fs.writeFileSync(path.join(dir, 'a.md'), 'a')
    const tree = await h.handlers['fs:tree'](ev, dir)
    assert.strictEqual(tree.length, 1)
    assert.strictEqual(tree[0].name, 'a.md')
    const empty = await h.handlers['fs:tree'](ev, 42)
    assert.deepStrictEqual(empty, [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('fs:read-image：MIME 映射与 base64 输出', async () => {
  const h = makeHarness()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-ipc-'))
  try {
    const p = path.join(dir, 'pic.png')
    fs.writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const r = await h.handlers['fs:read-image'](ev, p)
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.mime, 'image/png')
    assert.strictEqual(r.base64, Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('fs:read-image：拒绝非图片扩展名', async () => {
  const h = makeHarness()
  const r = await h.handlers['fs:read-image'](ev, 'C:\\x\\a.txt')
  assert.strictEqual(r.ok, false)
  assert.match(r.error, /仅支持读取图片/)
})

test('fs:read-image：超过 20MB 拒绝内嵌', async () => {
  const h = makeHarness()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-ipc-'))
  try {
    const p = path.join(dir, 'big.jpg')
    const buf = Buffer.alloc(20 * 1024 * 1024 + 1, 0)
    fs.writeFileSync(p, buf)
    const r = await h.handlers['fs:read-image'](ev, p)
    assert.strictEqual(r.ok, false)
    assert.match(r.error, /20MB/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('read-asset：合法相对路径读取 node_modules 内文件', async () => {
  const h = makeHarness()
  const r = await h.handlers['read-asset'](ev, 'vditor/package.json')
  assert.strictEqual(r.ok, true)
  assert.ok(r.content.includes('"name"'))
})

test('read-asset：字体扩展名走 base64 分支', async () => {
  const h = makeHarness()
  const r = await h.handlers['read-asset'](ev, 'vditor/dist/js/katex/fonts/KaTeX_AMS-Regular.woff2')
  assert.strictEqual(r.ok, true)
  assert.ok(typeof r.base64 === 'string' && r.base64.length > 0)
})

test('read-asset：路径穿越被拦截', async () => {
  const h = makeHarness()
  const bad = await h.handlers['read-asset'](ev, '../node_modules-evil/x')
  assert.strictEqual(bad.ok, false)
  const bad2 = await h.handlers['read-asset'](ev, '../main.js')
  assert.strictEqual(bad2.ok, false)
  const bad3 = await h.handlers['read-asset'](ev, 123)
  assert.strictEqual(bad3.ok, false)
})

test('recent:add：去重置顶且上限 12 条', async () => {
  const h = makeHarness()
  const paths = Array.from({ length: 14 }, (_, i) => 'C:\\docs\\f' + i + '.md')
  for (const p of paths) await h.handlers['recent:add'](ev, p)
  let list = h.getRecent()
  assert.strictEqual(list.length, 12, '上限 12 条')
  assert.strictEqual(list[0], 'C:\\docs\\f13.md', '最新在前')
  // 重复添加已存在的路径：去重并置顶
  await h.handlers['recent:add'](ev, 'C:\\docs\\f5.md')
  list = h.getRecent()
  assert.strictEqual(list.length, 12)
  assert.strictEqual(list[0], 'C:\\docs\\f5.md')
  assert.strictEqual(list.filter((x) => x === 'C:\\docs\\f5.md').length, 1, '不重复')
})

test('recent:clear：清空列表并重建菜单', async () => {
  const h = makeHarness()
  h.setRecent(['a.md', 'b.md'])
  await h.handlers['recent:clear'](ev)
  assert.deepStrictEqual(h.getRecent(), [])
  assert.ok(h.getMenuBuilds() >= 1)
})

test('view-state：无变化不重建菜单，有变化才重建', async () => {
  const h = makeHarness()
  const before = h.getMenuBuilds()
  // 与初始 viewState 完全一致——不应触发重建
  await h.handlers['view-state'](ev, { sidebar: true, outline: true, focus: false, typewriter: false, dark: false, codeWrap: true })
  assert.strictEqual(h.getMenuBuilds(), before)
  // 改一个键——触发重建
  await h.handlers['view-state'](ev, { dark: true })
  assert.strictEqual(h.getMenuBuilds(), before + 1)
  // 非对象输入被忽略
  await h.handlers['view-state'](ev, null)
  await h.handlers['view-state'](ev, 'x')
  assert.strictEqual(h.getMenuBuilds(), before + 1)
})

test('view-state：未知键不写入状态', async () => {
  const h = makeHarness()
  const before = h.getMenuBuilds()
  await h.handlers['view-state'](ev, { evilKey: true, dark: true })
  assert.strictEqual(h.getMenuBuilds(), before + 1, 'dark 变化触发一次')
  // 再发一次只含未知键的——不触发
  await h.handlers['view-state'](ev, { evilKey: false })
  assert.strictEqual(h.getMenuBuilds(), before + 1)
})
