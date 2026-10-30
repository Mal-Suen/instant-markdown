// 页面侧回归断言，由 tools/run-regression.js 经 --eval 注入执行
// 覆盖：沙箱、CSP、IPC 边界、编码往返、替换、标签编号、文件树、导出、弹层
(async () => {
  const results = []
  const check = (key, got, want) => {
    results.push({ key, got, want, pass: JSON.stringify(got) === JSON.stringify(want) })
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const asciiName = (n) => n.replace(/\u672a\u547d\u540d/g, 'UNTITLED')
  try {
    const DIR = window.__IM_TEST_DIR__
    const U = String(DIR).replace(/\\/g, '/')
    if (!DIR) throw new Error('missing __IM_TEST_DIR__')

    // 1. 沙箱：页面上下文不应有 process
    check('sandbox-no-process', typeof process, 'undefined')
    // 2. 测试钩子门控（开发模式应暴露）
    check('dev-hooks', window.api && window.api.devHooks, true)
    check('has-im', typeof window.__im !== 'undefined', true)
    // 3. CSP：data: 允许、远程 http 拦截
    let dataOk = false
    try {
      await fetch('data:text/plain,hi')
      dataOk = true
    } catch (e) {
      dataOk = false
    }
    check('csp-data-allowed', dataOk, true)
    let httpErr = null
    try {
      await fetch('http://127.0.0.1:9/x')
    } catch (e) {
      httpErr = String(e)
    }
    check('csp-http-blocked', !!httpErr, true)
    // 4. read-asset 边界
    const bad = await window.api.readAsset('../node_modules-x/y')
    check('asset-traversal-blocked', !!(bad && bad.ok === false), true)
    const good = await window.api.readAsset('vditor/package.json')
    check('asset-valid', !!(good && good.ok === true), true)
    // 5. GBK 读取
    const g = await window.api.readFile(U + '/gbk.md')
    check('gbk-encoding', g && g.encoding, 'gbk')
    check('gbk-content-ok', !!(g && g.ok && g.content.indexOf('\u4e2d\u6587\u6807\u9898') >= 0), true)
    // 6. GBK 写回 + 有损回退
    const w1 = await window.api.writeFile(U + '/gbk-out.md', '\u4e2d\u6587abc', 'gbk')
    check('gbk-write-enc', w1 && w1.ok && w1.encoding, 'gbk')
    const w2 = await window.api.writeFile(U + '/lossy-out.md', '\u4e2d\u6587\ud83d\ude00', 'gbk')
    check('lossy-fallback-enc', w2 && w2.ok && w2.encoding, 'utf-8')
    // 7. 打开 GBK 文档：状态栏与 tab 编码
    await window.__im.openPath(U + '/gbk.md')
    await sleep(1500)
    const st = document.getElementById('st-count').textContent
    check('status-enc-label', (st.match(/UTF-8 BOM|UTF-16LE|UTF-16BE|UTF-8|GBK/) || [null])[0], 'GBK')
    check('tab-encoding', window.__im.encoding(), 'gbk')
    // 8. 全部替换（替换串包含查找串的自匹配场景）
    await window.__im.openPath(U + '/cat.md')
    await sleep(1500)
    document.getElementById('find-input').value = 'cat'
    document.getElementById('replace-input').value = 'catX'
    replaceAll()
    await sleep(600)
    check('replace-all-value', window.__im.value(), 'catX catX catX catX catX catX catX catX catX catX\n')
    check('replace-all-count', (document.getElementById('toast').textContent.match(/\d+/) || [null])[0], '10')
    // 9. 未命名编号不重复
    await window.__im.newDoc()
    await window.__im.newDoc()
    await window.__im.closeTab(window.__im.tabs()[0].id)
    await window.__im.newDoc()
    check('tab-names', window.__im.tabs().map((t) => asciiName(t.name)), ['cat.md', 'UNTITLED', 'UNTITLED 2', 'UNTITLED 3'])
    // 10. 工作区文件树：列出 md/txt、过滤非文本文件
    await window.__im.setWorkspace(DIR)
    await sleep(500)
    const paths = Array.from(document.querySelectorAll('.tree-item[data-path]')).map((el) => el.dataset.path.replace(/\\/g, '/'))
    check('tree-lists-md', paths.indexOf(U + '/cat.md') >= 0 && paths.indexOf(U + '/gbk.md') >= 0, true)
    check('tree-excludes-non-md', paths.some((p) => p.endsWith('/run.log') || p.endsWith('/icon.png') || p.endsWith('/shot.png')), false)
    // 11. HTML 导出：图片内嵌 + CSP
    await window.__im.openPath(U + '/img.md')
    await sleep(1500)
    check('base-href', document.querySelector('base') ? document.querySelector('base').href : null, 'file:///' + U + '/')
    const html = await window.__im.buildExport()
    check('export-csp', !!(html && html.indexOf("script-src 'none'") >= 0), true)
    check('export-img-inlined', !!(html && html.indexOf('data:image/png;base64,') >= 0), true)
    // 12. PDF 导出 HTML：base 注入
    const pdfHtml = await window.__im.buildPdf()
    check('pdf-base', !!(pdfHtml && pdfHtml.indexOf('<base href="file:///' + U + '/">') >= 0), true)
    // 13. 弹层 Esc 关闭
    showShortcuts()
    check('modal-open', !!document.querySelector('.modal-mask'), true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    check('modal-esc-closed', !document.querySelector('.modal-mask'), true)
  } catch (e) {
    results.push({ key: 'exception', got: String(e && (e.stack || e)), want: 'none', pass: false })
  }
  const fails = results.filter((r) => !r.pass)
  console.log(results.map((r) => r.key + (r.pass ? ' PASS' : ' FAIL got=' + JSON.stringify(r.got) + ' want=' + JSON.stringify(r.want))).join('\n'))
  console.log(fails.length ? 'REGRESSION FAIL (' + fails.length + ' failed)' : 'REGRESSION PASS')
  window.__TEST_DONE__ = true
})()
