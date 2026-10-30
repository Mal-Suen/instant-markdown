'use strict'
// 审计测试：main.js 的 listDir 目录树构建逻辑。
// 覆盖：目录优先排序、隐藏项过滤、扩展名过滤（md/markdown/txt）、
// 深度限制、条目预算耗尽、不存在目录返回空、zh-CN localeCompare 排序。

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { loadFunction } = require('./helpers/extract_fn')

const listDir = loadFunction('listDir', { fs, path })

function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'im-listdir-'))
  fs.mkdirSync(path.join(root, 'zdir'))
  fs.mkdirSync(path.join(root, 'adir'))
  fs.mkdirSync(path.join(root, '.hidden'))
  fs.writeFileSync(path.join(root, 'b.md'), 'b')
  fs.writeFileSync(path.join(root, 'a.txt'), 'a')
  fs.writeFileSync(path.join(root, 'c.markdown'), 'c')
  fs.writeFileSync(path.join(root, 'd.exe'), 'nope')
  fs.writeFileSync(path.join(root, '.dotfile.md'), 'nope')
  fs.mkdirSync(path.join(root, 'zdir', 'inner'))
  fs.writeFileSync(path.join(root, 'zdir', 'inner', 'deep.md'), 'deep')
  fs.writeFileSync(path.join(root, 'zdir', 'top.md'), 'top')
  return root
}

test('listDir：目录排在文件前，隐藏项与非文本扩展名被过滤', async () => {
  const root = makeTree()
  try {
    const tree = await listDir(root, 8, { left: 20000 })
    // 顶层可见项：adir、zdir（目录在前）＋ a.txt、b.md、c.markdown（文件在后）
    assert.strictEqual(tree.length, 5)
    assert.strictEqual(tree[0].type, 'dir')
    assert.strictEqual(tree[0].name, 'adir')
    assert.strictEqual(tree[1].type, 'dir')
    assert.strictEqual(tree[1].name, 'zdir')
    const names = tree.map((n) => n.name)
    assert.ok(!names.includes('.hidden'))
    assert.ok(!names.includes('d.exe'))
    assert.ok(!names.includes('.dotfile.md'))
    assert.ok(names.includes('a.txt'))
    assert.ok(names.includes('b.md'))
    assert.ok(names.includes('c.markdown'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('listDir：递归展开子目录，children 为文件数组', async () => {
  const root = makeTree()
  try {
    const tree = await listDir(root, 8, { left: 20000 })
    const zdir = tree.find((n) => n.name === 'zdir')
    assert.ok(zdir, 'zdir 应在顶层')
    assert.ok(Array.isArray(zdir.children))
    const childNames = zdir.children.map((c) => c.name)
    assert.ok(childNames.includes('inner'))
    assert.ok(childNames.includes('top.md'))
    const inner = zdir.children.find((c) => c.name === 'inner')
    assert.deepStrictEqual(inner.children.map((c) => c.name), ['deep.md'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('listDir：depth=0 不递归，children 保持空数组', async () => {
  const root = makeTree()
  try {
    const tree = await listDir(root, 0, { left: 20000 })
    const zdir = tree.find((n) => n.name === 'zdir')
    assert.deepStrictEqual(zdir.children, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('listDir：预算耗尽时停止展开（budget.left 归零）', async () => {
  const root = makeTree()
  try {
    const tree = await listDir(root, 8, { left: 3 })
    // 预算 3：adir、zdir、a.txt 消耗后归零，b.md/c.markdown 不再出现
    assert.strictEqual(tree.length, 3)
    const names = tree.map((n) => n.name)
    assert.ok(!names.includes('b.md'))
    // 递归阶段 budget.left<=0，children 不展开
    const zdir = tree.find((n) => n.name === 'zdir')
    assert.deepStrictEqual(zdir.children, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('listDir：不存在的目录返回空数组', async () => {
  const tree = await listDir('Z:\\definitely-not-exist-xyz', 8, { left: 100 })
  assert.deepStrictEqual(tree, [])
})

test('listDir：文件节点带绝对路径，目录节点带 children 字段', async () => {
  const root = makeTree()
  try {
    const tree = await listDir(root, 8, { left: 20000 })
    const fileNode = tree.find((n) => n.name === 'b.md')
    assert.strictEqual(fileNode.type, 'file')
    assert.strictEqual(fileNode.path, path.join(root, 'b.md'))
    const dirNode = tree.find((n) => n.name === 'adir')
    assert.strictEqual(dirNode.type, 'dir')
    assert.ok(Array.isArray(dirNode.children))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
