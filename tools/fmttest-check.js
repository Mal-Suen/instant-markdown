// 真实输入链路的格式化断言，由 tools/run-regression.js 第一阶段（--fmttest）注入执行
// 前置：main.js 的 fmttest 已用 CDP 完成真实键入、双击选词、真实 Ctrl+B/Ctrl+I 按键
// （经渲染层 hotkeyIntercept → handleMenu → doAction 修复路径）
(async () => {
  const results = []
  const check = (key, got, want) => {
    results.push({ key, got, want, pass: JSON.stringify(got) === JSON.stringify(want) })
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  try {
    await sleep(300)
    const host = document.querySelector('.editor-instance.active')
    const reset = host.querySelector('.vditor-ir .vditor-reset')
    const md = window.__im.value()
    // 变体A：行中词双击（带尾随空格）加粗——修复后空格应留在标记外
    check('alpha-bold-rendered', md.indexOf('**alpha** beta') >= 0, true)
    check('alpha-no-broken-marker', md.indexOf('**alpha **') >= 0, false)
    // 变体B：行中词双击（带尾随空格）斜体
    check('gamma-italic-rendered', md.indexOf('*gamma* **delta**') >= 0, true)
    check('gamma-no-broken-marker', md.indexOf('*gamma *') >= 0, false)
    // 变体C：行尾词双击（无尾随空格）加粗——原有正确行为不回归
    check('delta-bold-rendered', md.indexOf('**delta**') >= 0, true)
    // 变体D：CJK 标点场景——选「，文字文字」（前是文字）加粗，逗号应移到标记外
    check('punct-lead-bold', md.indexOf('\u524d\u5b57\uff0c**\u6587\u5b57\u6587\u5b57**') >= 0, true)
    check('punct-lead-no-broken', md.indexOf('**\uff0c') >= 0, false)
    // DOM：三个 strong 节点（alpha、delta、标点场景）＋一个 em 节点，无非 marker 文本残留字面标记
    check('strong-nodes', reset.querySelectorAll('.vditor-ir__node[data-type="strong"]').length, 3)
    check('em-nodes', reset.querySelectorAll('.vditor-ir__node[data-type="em"]').length, 1)
    let raw = false
    const walker = document.createTreeWalker(reset, NodeFilter.SHOW_TEXT)
    let n
    while ((n = walker.nextNode())) {
      if (/\*\*|__|~~/.test(n.data)) {
        const p = n.parentNode
        if (p && p.classList && (p.classList.contains('vditor-ir__marker') || p.closest('[data-type="code-block"]'))) continue
        raw = true
      }
    }
    check('no-raw-markers', raw, false)
  } catch (e) {
    results.push({ key: 'exception', got: String(e && (e.stack || e)), want: 'none', pass: false })
  }
  const fails = results.filter((r) => !r.pass)
  console.log(results.map((r) => r.key + (r.pass ? ' PASS' : ' FAIL got=' + JSON.stringify(r.got) + ' want=' + JSON.stringify(r.want))).join('\n'))
  console.log(fails.length ? 'FMTTEST FAIL (' + fails.length + ' failed)' : 'FMTTEST PASS')
  window.__TEST_DONE__ = true
})()
