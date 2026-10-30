'use strict'
// 一键回归测试：node tools/run-regression.js [夹具目录]
// 阶段一（--fmttest）：CDP 真实输入链路——键入三段、双击选词、真实 Ctrl+B/Ctrl+I（经渲染层
//                      hotkeyIntercept → handleMenu → doAction 修复路径），断言格式化即时渲染
// 阶段二：注入 tools/regression.js 页面断言（沙箱、CSP、IPC、编码、替换、导出等）
// 阶段三（--imetest）：CDP 模拟 IME 组字提交 → 双击中文词 → 真实 Ctrl+B ×2 → 再 IME 输入，
//                      断言 CJK 邻接加粗即时渲染（Lute 对 **<wbr>+CJK 配对失败的回归防护）
// 依赖 --eval/--screenshot 测试钩子（仅开发模式可用；打包版需 IM_DEV_TOOLS=1）
const { spawn, execSync } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')

const root = path.join(__dirname, '..')
const dir = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'im-regression'))
const electronCli = path.join(root, 'node_modules', 'electron', 'cli.js')

if (!fs.existsSync(electronCli)) {
  console.error('未找到 electron，请先 npm install')
  process.exit(1)
}

// ---------- 夹具 ----------
// 夹具目录会被整目录递归删除重建——只允许位于系统临时目录之下，
// 防止误传参数（如「.」或手滑补全）把用户目录强删；确需其他位置须显式 --force-allow
const forceAllow = process.argv.includes('--force-allow')
if (!forceAllow) {
  const rel = path.relative(os.tmpdir(), dir)
  const inTmp = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
  if (!inTmp) {
    console.error('拒绝删除非临时目录：' + dir + '（夹具目录必须位于 ' + os.tmpdir() + ' 之下；确认无误可加 --force-allow）')
    process.exit(1)
  }
}
fs.rmSync(dir, { recursive: true, force: true })
fs.mkdirSync(path.join(dir, 'tree'), { recursive: true })
fs.mkdirSync(path.join(dir, 'profile'), { recursive: true })
fs.writeFileSync(path.join(dir, 'cat.md'), 'cat cat cat cat cat cat cat cat cat cat\n')
fs.writeFileSync(path.join(dir, 'img.md'), '# Title with pic\n\n![](icon.png)\n\nsome text here\n')
fs.writeFileSync(path.join(dir, 'tree', 'a.md'), 'a\n')
fs.writeFileSync(path.join(dir, 'tree', 'b.md'), 'b\n')
let iconv = null
try {
  iconv = require(path.join(root, 'node_modules', 'iconv-lite'))
} catch {}
if (iconv) {
  fs.writeFileSync(path.join(dir, 'gbk.md'), iconv.encode('# \u4e2d\u6587\u6807\u9898\n\n\u6b63\u6587\u5185\u5bb9 test', 'gbk'))
} else {
  console.error('未找到 iconv-lite，请先 npm install')
  process.exit(1)
}
const icon = path.join(root, 'build', 'icon.png')
if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(dir, 'icon.png'))
else {
  console.error('未找到 build/icon.png，请先运行 node tools/make-icon.js')
  process.exit(1)
}

// ---------- 启动 electron ----------
// 盘符段（E:）不编码，其余段按需编码——与 renderer 的 dirToBaseUrl 约定一致
const urlOf = (p) => {
  const segs = p.replace(/\\/g, '/').split('/')
  return 'file:///' + segs.map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join('/')
}
// 引导串保持纯 ASCII：只用单引号、正斜杠、无空格、无双引号、无反斜杠——
// 避开 node spawn → electron cli → Chromium 命令行解析的多层转义
const bootOf = (script, udir) =>
  "(function(){" + (udir ? "window.__IM_TEST_DIR__='" + udir + "';" : '') +
  "var s=document.createElement('script');s.src='" + urlOf(path.join(__dirname, script)) +
  "';document.head.appendChild(s);return new Promise(function(r){var t=setInterval(function(){if(window.__TEST_DONE__){clearInterval(t);r(0)}},100);setTimeout(function(){clearInterval(t);r(1)},30000)})})()"

// 超时树杀：child.kill() 在 Windows 上只终止 node 包装进程，electron.exe 成孤儿并持有单实例锁，
// 后续阶段全部拿不到锁而假失败——用 taskkill /T 连同子孙进程一并终止
function killTree(child) {
  if (process.platform === 'win32') {
    try {
      execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' })
    } catch {
      try { child.kill() } catch {}
    }
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch {}
    try { child.kill('SIGKILL') } catch {}
  }
}

function runElectron(tag, extraArgs, script, logName, udir) {
  return new Promise((resolve) => {
    const logPath = path.join(dir, logName)
    const logFd = fs.openSync(logPath, 'w')
    const child = spawn(process.execPath, [
      electronCli,
      root,
      '--userdata=' + path.join(dir, 'profile'),
      '--screenshot=' + path.join(dir, tag + '.png'),
      ...extraArgs,
      '--eval=' + bootOf(script, udir),
    ], { stdio: ['ignore', logFd, logFd] })
    const timer = setTimeout(() => {
      console.error(tag + '：超时（90 秒未退出），强制结束')
      killTree(child)
      resolve(false)
    }, 90000)
    child.on('error', (err) => {
      clearTimeout(timer)
      console.error(tag + '：启动 electron 失败：' + err)
      resolve(false)
    })
    child.on('exit', () => {
      clearTimeout(timer)
      fs.closeSync(logFd)
      const log = fs.readFileSync(logPath, 'utf8')
      const verdict = log.split(/\r?\n/).filter((l) => l.indexOf(tag.toUpperCase() + ' PASS') >= 0 || l.indexOf(tag.toUpperCase() + ' FAIL') >= 0).pop()
      if (!verdict) {
        console.error(tag + '：未出现 ' + tag.toUpperCase() + ' 结果——应用可能正在运行（单实例锁）或启动失败。完整日志：' + logPath)
        resolve(false)
        return
      }
      console.log(verdict.replace('[renderer] ', ''))
      if (verdict.indexOf('PASS') < 0) {
        log.split(/\r?\n/).filter((l) => l.indexOf(' FAIL ') >= 0).forEach((l) => console.log(l))
        console.log('完整日志：' + logPath)
      }
      resolve(verdict.indexOf('PASS') >= 0)
    })
  })
}

;(async () => {
  const ok1 = await runElectron('fmttest', ['--fmttest'], 'fmttest-check.js', 'fmttest.log')
  const ok2 = await runElectron('regression', [], 'regression.js', 'run.log', dir.replace(/\\/g, '/'))
  const ok3 = await runElectron('imetest', ['--imetest'], 'ime-wait.js', 'imetest.log')
  process.exit(ok1 && ok2 && ok3 ? 0 : 1)
})()
