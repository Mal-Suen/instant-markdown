'use strict'
// 审计测试辅助：main.js 未通过 module.exports 导出内部纯函数，
// 这里以只读方式从 main.js 源文本中提取目标函数声明的完整源码片段，
// 再用 new Function 在注入闭包变量的环境下求值，得到可独立调用的函数。
// 不修改仓库任何现有文件。

const fs = require('node:fs')
const path = require('node:path')

const MAIN_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8')

// 括号配平扫描：跳过字符串、模板字面量与注释，截取完整函数声明文本。
function extractFunction(src, name) {
  const marker = 'function ' + name + '('
  const idx = src.indexOf(marker)
  if (idx < 0) throw new Error('function not found: ' + name)
  let start = idx
  if (idx >= 6 && src.slice(idx - 6, idx) === 'async ') start = idx - 6
  let i = src.indexOf('{', start)
  let depth = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c
      i++
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++
        i++
      }
      i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
    i++
  }
  throw new Error('unbalanced braces for ' + name)
}

// deps：函数体引用的模块级闭包变量（如 iconv、fs、path、app、hooksAllowed）。
function loadFunction(name, deps) {
  const src = extractFunction(MAIN_SRC, name)
  const keys = Object.keys(deps)
  const factory = new Function(...keys, 'return (' + src + ')')
  return factory(...keys.map((k) => deps[k]))
}

module.exports = { extractFunction, loadFunction, MAIN_SRC }
