'use strict'
// 审计测试：main.js 的 writeFileAtomic 临时文件＋rename 原子替换。
// 覆盖：正常写入、失败时清理临时文件、并发写同一目标不产生残留 .im-tmp 文件。

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { loadFunction } = require('./helpers/extract_fn')

const writeFileAtomic = loadFunction('writeFileAtomic', { fs, path })

test('writeFileAtomic：正常写入并替换目标文件', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-atomic-'))
  try {
    const p = path.join(dir, 'doc.md')
    fs.writeFileSync(p, 'old')
    await writeFileAtomic(p, Buffer.from('new content', 'utf8'))
    assert.strictEqual(fs.readFileSync(p, 'utf8'), 'new content')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('writeFileAtomic：失败时抛错并清理临时文件', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-atomic-'))
  try {
    const p = path.join(dir, 'no-such-sub', 'doc.md')
    await assert.rejects(() => writeFileAtomic(p, Buffer.from('x')))
    // 临时文件写在 no-such-sub 目录里，目录不存在时 writeFile 直接失败，无残留
    assert.ok(!fs.existsSync(path.join(dir, 'no-such-sub')))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('writeFileAtomic：rename 失败时清理临时文件不留残骸', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-atomic-'))
  try {
    // 目标是一个已存在的目录——rename(tmp, dir) 会失败（EPERM/EEXIST）
    const target = path.join(dir, 'target-is-dir')
    fs.mkdirSync(target)
    await assert.rejects(() => writeFileAtomic(target, Buffer.from('x')))
    const leftovers = fs.readdirSync(dir).filter((n) => n.includes('.im-tmp-'))
    assert.deepStrictEqual(leftovers, [], '失败后不应残留 .im-tmp 临时文件')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('writeFileAtomic：并发写同一文件——已知缺陷见证（临时文件名仅含 pid，同进程并发冲突）', async () => {
  // 根因见证（确定性）：用假 fs 记录并发写实际使用的临时文件路径。
  // tmp 名 = .<basename>.im-tmp-<pid>，不含随机成分——同一进程内并发写同一
  // 目标文件时两次写共用同一个 tmp，后写覆盖先写，先写的 rename 报 ENOENT。
  // 实测复现记录见审计报告「疑似 bug」一节；修复（tmp 名加随机后缀）后本断言应失败。
  const tmpPaths = []
  const fakeFs = {
    promises: {
      writeFile: async (p) => {
        tmpPaths.push(p)
      },
      rename: async () => {},
      unlink: async () => {},
    },
  }
  const writeFileAtomicFake = loadFunction('writeFileAtomic', { fs: fakeFs, path })
  const target = 'C:\\x\\doc.md'
  await Promise.all([writeFileAtomicFake(target, 'a'), writeFileAtomicFake(target, 'b')])
  assert.strictEqual(tmpPaths.length, 2)
  assert.strictEqual(tmpPaths[0], tmpPaths[1], '并发写同一目标共用同一临时文件名——冲突根因')
})

test('writeFileAtomic：并发写后目标文件仍是某一次完整写入（无交错损坏、无残留）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-atomic-'))
  try {
    const p = path.join(dir, 'doc.md')
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => writeFileAtomic(p, Buffer.from('content-' + i)))
    )
    // 已知缺陷：部分并发写会因 tmp 名冲突被拒（见上一测试与报告），此处只验证不变量：
    // 目标文件要么不存在要么是完整单次写入，绝不出现交错损坏；失败路径清理生效。
    const final = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
    assert.ok(final === '' || /^content-\d$/.test(final), '最终内容应是某一次完整写入')
    const leftovers = fs.readdirSync(dir).filter((n) => n.includes('.im-tmp-'))
    assert.deepStrictEqual(leftovers, [], '失败路径的 unlink 清理生效，无残留')
    assert.ok(results.every((r) => r.status === 'fulfilled' || /ENOENT|EPERM|EEXIST/.test(String(r.reason?.code ?? r.reason))))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
