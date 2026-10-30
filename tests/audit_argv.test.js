'use strict'
// 审计测试：main.js 的 parseArgv 命令行解析（文件名、截图/eval 钩子门控）。
// 覆盖：.md/.markdown/.txt 文件识别、非文件参数忽略、钩子门控（hooksAllowed）、
// --userdata= 无条件生效、多参数组合。

const test = require('node:test')
const assert = require('node:assert')
const { loadFunction } = require('./helpers/extract_fn')

// parseArgv 依赖闭包变量 app（app.isPackaged）与 hooksAllowed。
function makeParseArgv(isPackaged, hooksAllowed) {
  const app = { isPackaged }
  return loadFunction('parseArgv', { app, hooksAllowed })
}

test('parseArgv：开发模式跳过前两个参数（electron . file.md）', () => {
  const p = makeParseArgv(false, true)
  const r = p(['electron', '.', 'D:\\docs\\note.md'])
  assert.strictEqual(r.file, 'D:\\docs\\note.md')
})

test('parseArgv：打包模式跳过第一个参数', () => {
  const p = makeParseArgv(true, true)
  const r = p(['InstantMarkdown.exe', 'note.txt'])
  assert.strictEqual(r.file, 'note.txt')
})

test('parseArgv：识别 .markdown 与 .txt，忽略其他扩展名', () => {
  const p = makeParseArgv(false, true)
  const r = p(['e', '.', 'a.md', 'b.markdown', 'c.txt', 'd.exe', 'e.pdf'])
  assert.strictEqual(r.file, 'c.txt', '多个合法文件参数时后出现的覆盖先出现的')
  const r2 = p(['e', '.', 'b.exe'])
  assert.strictEqual(r2.file, null, '仅非法扩展名时 file 保持 null')
})

test('parseArgv：以 - 开头的参数不作为文件', () => {
  const p = makeParseArgv(false, true)
  const r = p(['e', '.', '-x.md', '--flag', 'real.md'])
  assert.strictEqual(r.file, 'real.md')
})

test('parseArgv：钩子开放时解析 --screenshot= 与 --eval=', () => {
  const p = makeParseArgv(false, true)
  const r = p(['e', '.', '--screenshot=C:\\out\\s.png', '--eval=window.__im.value()'])
  assert.strictEqual(r.shot, 'C:\\out\\s.png')
  assert.strictEqual(r.evalJs, 'window.__im.value()')
})

test('parseArgv：钩子关闭时忽略 --screenshot/--eval/--keytest/--fmttest/--imetest', () => {
  const p = makeParseArgv(false, false)
  const r = p(['e', '.', '--screenshot=s.png', '--eval=1', '--keytest', '--fmttest', '--imetest', 'doc.md'])
  assert.strictEqual(r.shot, null)
  assert.strictEqual(r.evalJs, null)
  assert.strictEqual(r.keytest, undefined)
  assert.strictEqual(r.fmttest, undefined)
  assert.strictEqual(r.imetest, undefined)
  assert.strictEqual(r.file, 'doc.md')
})

test('parseArgv：--preeval= 门控与解析', () => {
  const pOpen = makeParseArgv(false, true)
  const r1 = pOpen(['e', '.', '--preeval=window.scrollTo(0,0)'])
  assert.strictEqual(r1.preeval, 'window.scrollTo(0,0)')
  const pClosed = makeParseArgv(false, false)
  const r2 = pClosed(['e', '.', '--preeval=x'])
  assert.strictEqual(r2.preeval, undefined)
})

test('parseArgv：--userdata= 不受钩子门控（打包版也生效）', () => {
  const p = makeParseArgv(true, false)
  const r = p(['exe', '--userdata=D:\\data', 'note.md'])
  assert.strictEqual(r.userData, 'D:\\data')
  assert.strictEqual(r.file, 'note.md')
})

test('parseArgv：无任何可识别参数时返回全空结果', () => {
  const p = makeParseArgv(false, true)
  const r = p(['e', '.'])
  assert.deepStrictEqual(r, { file: null, shot: null, evalJs: null, userData: null })
})

test('parseArgv：大写扩展名 .MD 也识别', () => {
  const p = makeParseArgv(false, true)
  const r = p(['e', '.', 'README.MD'])
  assert.strictEqual(r.file, 'README.MD')
})
