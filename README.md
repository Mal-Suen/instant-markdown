# Instant Markdown

即时渲染的 Markdown 编辑器，对标 Typora 的所见即所得体验。基于 Electron 与 Vditor 构建，完全离线运行。

## 功能

- 即时渲染编辑：标题、列表、任务列表、表格、代码块高亮、LaTeX 数学公式、引用、链接与图片
- 大纲面板：文档标题导航，点击跳转
- 文件树侧栏：打开文件夹作为工作区，快速切换文档
- 多标签页：每页独立撤销栈，未保存标记，Ctrl+Tab 切换
- 自动保存：输入停顿 800 毫秒后写盘，关闭窗口前自动落盘
- 最近文件：菜单与欢迎页双入口
- 导出：PDF（A4 排版）与自包含单文件 HTML（内嵌样式与公式字体）
- 明暗主题、专注模式（F8）、打字机模式（F9）
- Typora 式六组菜单：文件／编辑／段落／格式／视图／帮助，含全套 Typora 快捷键
- 查找与替换（Ctrl+F / Ctrl+H，支持全部替换）
- 多窗口（Ctrl+Shift+N 新建窗口）、重新打开关闭的文件（Ctrl+Shift+T）
- 状态栏字数统计、拖拽 .md 文件进窗口打开

## 运行

```
npm install
npm start
```

依赖安装需要下载 Electron 二进制，国内网络建议使用镜像：

```
set ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/&& npm install --registry=https://registry.npmmirror.com
```

注意 `set` 赋值与 `&&` 之间不能有空格，否则镜像地址末尾带上空格会导致 404。

## 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 新建 / 新建窗口 | Ctrl+N / Ctrl+Shift+N |
| 打开 / 重新打开关闭的文件 | Ctrl+O / Ctrl+Shift+T |
| 保存 / 另存为 | Ctrl+S / Ctrl+Shift+S |
| 关闭 / 切换文档 | Ctrl+W / Ctrl+Tab |
| 查找 / 替换 | Ctrl+F / Ctrl+H |
| 查找下一个 / 上一个 | F3 / Shift+F3 |
| 一级~六级标题 / 正文 | Ctrl+1~6 / Ctrl+0 |
| 提升 / 降低标题 | Ctrl+= / Ctrl+- |
| 表格 / 代码块 / 数学块 | Ctrl+T / Ctrl+Shift+K / Ctrl+Shift+M |
| 引用 / 有序 / 无序 / 任务列表 | Ctrl+Shift+Q / Ctrl+Shift+[ / Ctrl+Shift+] |
| 加粗 / 斜体 / 行内代码 | Ctrl+B / Ctrl+I / Ctrl+Shift+\` |
| 删除线 / 超链接 / 图像 | Alt+Shift+5 / Ctrl+K / Ctrl+Shift+I |
| 清除格式 | Ctrl+\\ |
| 侧边栏 / 大纲 | Ctrl+Shift+L / Ctrl+Shift+1 |
| 专注模式 / 打字机模式 | F8 / F9 |
| 放大 / 缩小 / 实际大小 | Ctrl+Shift+= / Ctrl+Shift+- / Ctrl+Shift+0 |
| 导出 PDF | Ctrl+Shift+E |

## 技术

- Electron 44：窗口、菜单、文件对话框、PDF 导出
- Vditor 4：即时渲染编辑内核（IR 模式），KaTeX 公式与 highlight.js 代码高亮全部从本地 node_modules 加载
- 原生 JavaScript 与 CSS，无构建步骤

## 目录结构

```
├── main.js          Electron 主进程：窗口、菜单、IPC、导出
├── preload.js       上下文桥
├── renderer/
│   ├── index.html   界面结构
│   ├── app.js       渲染层逻辑：标签页、文件树、模式切换、导出
│   └── style.css    界面样式（Apple 设计语言）
└── DESIGN.md        设计规范
```

## 打包

```
npm run dist
```

构建产物在 `dist/` 目录：

- `win-unpacked/Instant Markdown.exe`：免安装，双击直接运行
- `InstantMarkdown-Setup-0.1.0.exe`：NSIS 安装包，可选安装目录

打包需要下载 Electron 与 NSIS 工具，国内网络建议使用镜像：

```
set ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/&& set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/&& npm run dist
```

应用图标 `build/icon.png` 由 `tools/make-icon.js` 纯 Node 生成，可修改脚本后重新运行再打包。

## 后续计划

- .md 文件关联双击打开
- 文件外部变更监听与冲突提示
- 图片粘贴保存到本地相对路径
- 自定义主题与更多内容主题
