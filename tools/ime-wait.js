// imetest 阶段的占位页面脚本：断言在 main.js 的 runImeTest 内联完成（主进程输出 IMETEST 判定），
// 此脚本只负责让 --eval 引导串立即完成
window.__TEST_DONE__ = true
