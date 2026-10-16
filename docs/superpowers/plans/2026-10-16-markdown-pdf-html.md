# 墨页 Folio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个本机浏览器工具，将 Markdown 或 PDF 转换为美观、公式专业且能离线打开的单文件 HTML。

**Architecture:** Python 标准库 HTTP 服务只监听 loopback，并在有超时限制的独立子进程中执行 PDF 转换。原生浏览器模块完成 Markdown 解析、资源内嵌、MathJax SVG 排版、受限 iframe 预览和 HTML 导出。三个主题与 PDF 两种模式共用文档模型和导出外壳。

**Tech Stack:** Python（本机已核实为 3.14）、pypdfium2、pdfplumber、Pillow；JavaScript ES modules、markdown-it、markdown-it-footnote、DOMPurify、highlight.js、MathJax 4；Python unittest 与 Playwright。npm（本机 11.19.0）只用于准备本地浏览器依赖和运行开发测试；Node.js 本机版本为 24.21.0。

**Spec:** [2026-10-16-markdown-pdf-html-design.md](../specs/2026-10-16-markdown-pdf-html-design.md)，用户已确认通过。

## Global Constraints

- 项目根目录为 `D:\PyorC\Folio`；优先在当前独立的新项目仓库执行，不修改同级 `BikeCast`。
- 首先支持 Windows、现代 Edge / Chrome；日常启动只需要已准备好的 Python 环境和本地静态资源。
- 服务只监听 loopback；默认端口 8765，可配置，冲突时显示清楚的启动错误。
- 单次处理一份主文档和其关联图片；首次安装依赖需要网络，安装后运行、转换、预览和导出文档阅读可离线。
- PDF 最大 40 MiB、最多 80 页；Markdown 最大 5 MiB；关联图片总量最大 80 MiB；PDF 转换超时默认 180 秒。
- 每次仅运行一个 PDF 转换任务；转换完成、失败或超时均释放工作进程与临时资源。
- PDF 默认 144 DPI，可选 96 / 192 DPI；保真模式使用内嵌 PNG 和可靠时才启用的透明文字层。
- 三个主题为“学术论文、现代阅读、简洁报告”；可调正文字体族、字号、行距和最大内容宽度。
- 公式支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]`，排除代码区域；不完整分隔符保留原文并提示。
- 单美元公式不跨行，起始后与结束前不可空白，结束后不可紧接数字；转义美元作为文字。
- MathJax 4 在本地加载，导出保留已排版的自包含 SVG，不依赖外部脚本和共享字形。
- 导出 HTML 内嵌样式与图片；未解决的图片必须明确提示，完整离线导出不能静默遗漏。
- 不自动下载外链图片、不上传文档、不记录文档内容、不执行输入脚本；正文使用系统中文字体回退。
- 首版不包含 OCR、收费 API、桌面安装包、批量队列或任意 PDF 的可编辑语义恢复。
- 安装后锁定实际验证过的依赖版本；保留第三方许可，不宣称未经执行的测试已通过。

## Review Focus

- 新输入到来时旧转换刚结束：旧结果不能覆盖新结果，也不能使导出按钮恢复为可用。测试归 Task 6。
- 中文 / 空格 / 编码路径与同名图片并存：应精确匹配相对路径，匹配不明确必须报出缺失而不是替错图片。测试归 Task 2。
- 美元货币、代码与公式交错：原文不能被错误吞并，数学片段先于 Markdown 转义处理。测试归 Task 2、3。
- PDF 旋转页、混合页尺寸、扫描页与数学密集页：比例正确，无法定位的文字层关闭，不可信阅读页回退。测试归 Task 4、5。
- 浏览器断网且本地服务停止后打开 HTML：公式与图片仍显示，目录与原页折叠可用，不能产生必需的外部请求。测试归 Task 3、7。

## 文件与接口约定

| 文件 | 责任 |
| --- | --- |
| `server.py`、`folio/http_server.py` | CLI、本地监听、公开静态目录、请求验证与 PDF 工作进程调度 |
| `folio/limits.py`、`folio/models.py` | 共享限额、PDF 结果及诊断数据结构 |
| `folio/pdf_converter.py`、`folio/pdf_reading.py`、`folio/pdf_worker.py` | 页面渲染 / 文字层、阅读重建 / 回退、子进程入口 |
| `web/index.html`、`web/app.js`、`web/workspace.css` | 可访问的工具界面、状态编排与响应式布局 |
| `web/modules/resources.js`、`markdown.js`、`math-plugin.js` | 图片映射、Markdown 结构、公式语法保护 |
| `web/modules/math.js`、`document.js`、`export.js` | 本地数学排版、文档模型与主题外壳、离线检查 / 下载 |
| `web/modules/state.js`、`web/document.css` | 最新任务隔离、三主题 / 字体 / 表格 / 公式 / 打印样式 |
| `scripts/prepare-vendor.mjs`、`scripts/install.ps1`、`安装.cmd`、`启动.cmd` | 准备公开依赖目录、首次安装与日常启动 |
| `requirements.txt`、`package.json`、`package-lock.json` | 运行依赖、测试命令与锁定版本 |
| `tests/`、`examples/`、`README.md`、`THIRD_PARTY_NOTICES.md` | 测试、可复现样例、使用说明与许可 |

JavaScript 共享结构写入 `web/modules/document.js` 的 JSDoc，并在 Python 的 `folio/models.py` 用 TypedDict 表达等价的 PDF 响应字段：

- `Diagnostic = {code:string, message:string, page?:number, source?:string}`。
- `Heading = {id:string, text:string, level:number}`；`MathFragment = {id:string, tex:string, display:boolean}`。
- `DocumentDraft = {title:string, bodyHtml:string, toc:Heading[], diagnostics:Diagnostic[], math:MathFragment[], missingAssets:string[], stats:object}`。
- `DocumentModel` 与 `DocumentDraft` 字段相同，但公式占位符已全部排版或替换为明确错误；`math` 保留源码。
- `PdfResult = {title:string, mode:'faithful'|'reading', pageCount:number, bodyHtml:string, diagnostics:Diagnostic[], pages:object[]}`；由 `pdfResultToDraft(result)` 转为相同文档管线。
- `DocumentOptions = {theme:'academic'|'modern'|'report', fontFamily:'sans'|'serif', fontSize:number, lineHeight:number, contentWidth:number}`，默认 `modern/sans/17/1.8/820`，分别以 px、无单位倍数、px 解释数值。

## Task 1: 可运行的本地服务与依赖准备

**Files:** Create `server.py`、`folio/__init__.py`、`folio/http_server.py`、`folio/limits.py`、`folio/models.py`、`web/index.html`、`scripts/prepare-vendor.mjs`、`scripts/install.ps1`、`安装.cmd`、`启动.cmd`、`requirements.txt`、`package.json`、`package-lock.json`、`.gitignore`、`playwright.config.mjs`、`tests/test_http_server.py`。

**Interfaces:** `create_server(port:int=8765) -> ThreadingHTTPServer` 固定绑定 `127.0.0.1`，允许测试用端口 0；`main(argv:list[str]|None=None) -> int` 支持 `--port` 和 `--no-browser`。公开 `/`、公开目录内资源和 `GET /api/health`；PDF 接口暂返回清楚的未就绪错误，不接受后续未实现行为。`limits.py` 定义 `MAX_PDF_BYTES=40*1024*1024`、`MAX_PAGES=80`、`MAX_MD_BYTES=5*1024*1024`、`MAX_ASSET_BYTES=80*1024*1024`、`PDF_TIMEOUT_SECONDS=180`。

- [ ] **Step 1:** 写 `test_health_is_local_only`、`test_rejects_foreign_host_or_origin`、`test_static_paths_cannot_escape_public_root`。核心断言：`response.json()['status']=='ok'`；外站 Host / Origin 返回 403；`/%2e%2e/server.py` 和符号链接逃逸不能返回源文件内容。
- [ ] **Step 2:** 用 `py -m unittest discover -s tests -p test_http_server.py -v` 跑出缺少服务模块的失败，记录原因。
- [ ] **Step 3:** 实现服务与纯静态起始页；只公开 `web/` 及明确映射的 `examples/`。校验 Host、Origin、Sec-Fetch-Site，不暴露项目根目录；不打印正文。静态 Content-Type 和 UTF-8 正确。
- [ ] **Step 4:** 创建 `.venv`，安装并锁定实际兼容的 pypdfium2、pdfplumber、Pillow；安装 markdown-it、脚注插件、DOMPurify、highlight.js、MathJax 4 和开发用 Playwright。资源脚本只复制必要的浏览器产物、MathJax 动态组件 / 字体与许可到 `web/vendor/`；不向浏览器公开整个 `node_modules`。
- [ ] **Step 5:** 安装脚本检查每一步退出码，失败即停止并显示恢复命令；启动脚本使用 `.venv` Python，窗口只作为用户主动启动的终端出现，后台测试服务使用隐藏进程。设置 `npm.cmd test` 运行已安装 Edge 或 Chrome 的 Playwright；不把下载浏览器作为日常运行条件。
- [ ] **Step 6:** 运行 `.venv\Scripts\python.exe -m unittest discover -s tests -p test_http_server.py -v`，预期全部 PASS；启动后核实健康接口，关闭服务再重启，核实端口占用错误。运行资源准备脚本，确认 vendor 文件存在且不含外部 CDN 配置。
- [ ] **Step 7:** `git add` 本任务明确列出的文件；提交 `feat: add local service and reproducible dependency setup`。不提交 `.venv`、`node_modules`、用户文件或临时输出。

## Task 2: Markdown、公式语法保护与图片解析

**Files:** Create `web/modules/document.js`、`resources.js`、`math-plugin.js`、`markdown.js`、`tests/markdown.spec.mjs`、`tests/resources.spec.mjs`。

**Interfaces:** `buildResourceIndex(files:File[]) -> Promise<ResourceIndex>`，索引保留完整的相对路径和重复项；`resolveResource(index,path,sourcePath) -> {dataUrl:string|null,diagnostic:Diagnostic|null}`。`renderMarkdown(source:string,resources:ResourceIndex,sourcePath:string) -> DocumentDraft`。数学插件只生成 `data-folio-math` 占位符与 `MathFragment[]`，Task 3 负责排版。

- [ ] **Step 1:** 写浏览器测试断言标题重复时锚点不同、脚注往返链接存在、表格与代码结构存在；`$x_1$` 生成一个 TeX 源码为 `x_1` 的片段，`$20 和 $30`、转义美元及代码内 `$x$` 不生成片段；四种分隔符均保留 TeX 反斜杠；未闭合公式保留后续段落并产生诊断。
- [ ] **Step 2:** 写资源测试：`图/实验 图.png` 与百分号编码路径都能解析；不同文件夹的同名图片不得串用；`../` 在导入根内可规范化，在根外拒绝；SVG 的脚本、事件与外部加载被清除；远程图片变成明确占位与缺失项；总量超过 80 MiB 拒绝，Markdown 超过 5 MiB 拒绝。
- [ ] **Step 3:** `npm.cmd test -- tests/markdown.spec.mjs tests/resources.spec.mjs`，预期因模块缺失失败。
- [ ] **Step 4:** 实现 JSDoc 结构与基于 markdown-it 规则的数学保护，不对整个原文进行易误伤代码块的正则替换。用 DOMPurify 清理静态 HTML，再解析 / 替换资源，保证任何外链图片在插入实际 DOM 前已经移除。Markdown 链接、合并单元格和代码高亮遵循规格。
- [ ] **Step 5:** 重跑本任务浏览器测试，预期全部 PASS；另断言输入 `<script>`、`onerror`、`javascript:`、活动 iframe 和恶意 SVG 均不会执行或出现在可执行输出中。
- [ ] **Step 6:** 提交 `feat: parse Markdown and embed validated local assets`。

## Task 3: 专业公式、主题文档外壳与离线导出

**Files:** Create `web/modules/math.js`、`export.js`、`web/document.css`、`tests/math-export.spec.mjs`；Modify `document.js`、Task 1 的本地 MathJax 配置。

**Interfaces:** `typesetDocument(draft:DocumentDraft,options:DocumentOptions) -> Promise<DocumentModel>`；`buildHtml(model:DocumentModel,options:DocumentOptions,{allowMissing:boolean=false}={}) -> string`；`downloadHtml(html:string,filename:string) -> void`；`safeFilename(title:string) -> string`。`buildHtml` 同时供 iframe 与下载使用；导出不重复调用解析器。

- [ ] **Step 1:** 测试分式、积分、矩阵、cases、align、tag / label；断言输出存在 SVG path，公式源码说明存在，SVG use 引用都在导出文档内解析。无效 TeX 显示原式与诊断；前一次文档的编号 / 标签不能污染下一次转换。
- [ ] **Step 2:** 测试图片与公式混合文档：`buildHtml` 的完整结果含 doctype、UTF-8、内嵌 CSS 与 data 图片，不含必需的远程资源或脚本；缺失资源时默认抛出可理解的导出错误，`allowMissing:true` 保留可见缺失标记。代码与图表在三个主题下保持内容一致。
- [ ] **Step 3:** `npm.cmd test -- tests/math-export.spec.mjs`，确认尚未实现的导出 / 数学接口导致失败。
- [ ] **Step 4:** 实现本地 MathJax 4 SVG 管线，串行使用数学引擎并为每份文档重置状态；等待异步字体 / TeX 组件完成后提取结果，使用局部或无共享字体缓存。MathJax 输入 / 扩展只允许本地已准备组件；清除 MathJax 运行 UI，导出不包含运行时脚本。保留源码与错误位置。
- [ ] **Step 5:** 实现三主题、中文字体回退、宽表与长公式横向滚动、图片比例、代码、页容器与打印样式；超宽内容不能把整个工作区撑开。字体控制影响重排正文，PDF 保真页不改变原文字形。
- [ ] **Step 6:** 写临时 HTML 后以 `file://` 打开，用 Playwright 拦截所有非本地资源请求，断言公式 / 图片存在且尺寸非零、目录跳转正常，未出现必需资源请求；重跑本任务测试，预期全部 PASS。
- [ ] **Step 7:** 提交 `feat: typeset math and export self-contained themed HTML`。

## Task 4: PDF 保真转换、文字层与受限工作进程

**Files:** Create `folio/pdf_converter.py`、`folio/pdf_worker.py`、`tests/pdf_fixtures.py`、`tests/test_pdf_faithful.py`、`tests/test_pdf_api.py`；Modify `folio/models.py`、`folio/http_server.py`。

**Interfaces:** `convert_pdf(data:bytes,mode:str='faithful',dpi:int=144) -> PdfResult`；`render_faithful_page(pdfium_page,plumber_page,dpi:int,page_number:int) -> dict` 返回 `html,width,height,diagnostics`。`POST /api/pdf?mode=faithful&dpi=144` 请求体为 PDF 字节；服务端校验后用当前 `.venv` Python 的 `-m folio.pdf_worker` 子进程处理，stdin 输入 PDF，stdout 只输出 JSON。

- [ ] **Step 1:** 用 pypdfium2 新建页、Pillow 扫描图以及可复现的最小 PDF 对象生成文字 / 表格 / 图片 / 混合页尺寸 / 旋转 / 加密测试样本，不依赖外部用户文件。测试默认 144、96、192 DPI 的图像尺寸与页面比例；可提取文字有文本层，旋转等无法可靠定位的情况应正确变换或关闭文字层并诊断。
- [ ] **Step 2:** 写接口测试：非 PDF、损坏、加密、非法 mode / DPI、超过 40 MiB、超过 80 页、并发忙碌分别返回可操作的 4xx / 503；模拟子进程超时断言被终止、180 秒默认值存在且下一请求能正常执行；源数据不能出现在日志。较小的注入超时只用于测试，生产默认仍为 180 秒。
- [ ] **Step 3:** `.venv\Scripts\python.exe -m unittest discover -s tests -p test_pdf*.py -v`，确认因转换模块缺失而失败。
- [ ] **Step 4:** 实现页面顺序渲染与内嵌 PNG，及时 close 页面、bitmap、textpage、文档对象；文字内容与属性严格转义。限制请求体、页数与渲染任务；校验 PDF 头和解析结果，不仅依赖扩展名。清楚区分加密与损坏错误。
- [ ] **Step 5:** 实现单任务锁、子进程 JSON 通道、超时终止与所有路径的 finally 清理；请求断开也不能遗留失控进程。避免将文档作为命令行字符串参数或日志内容；静态服务仍不得暴露输入 / 输出临时目录。
- [ ] **Step 6:** 重跑 PDF 与服务单元测试，预期全部 PASS；浏览器打开包含转义测试字符的结果，检查页面比例与文字选择，不能产生活动 HTML。
- [ ] **Step 7:** 提交 `feat: convert PDFs faithfully in bounded local workers`。

## Task 5: PDF 阅读模式与页级回退

**Files:** Create `folio/pdf_reading.py`、`tests/test_pdf_reading.py`；Modify `folio/pdf_converter.py`、`tests/pdf_fixtures.py`。

**Interfaces:** `reconstruct_page(plumber_page,page_image,page_number:int) -> {html:str,diagnostics:list,used_fallback:bool}`；`classify_page(plumber_page) -> {safe:bool,reasons:list[str]}`。`convert_pdf(...,mode='reading',...)` 保持 Task 4 的 PdfResult 接口。

- [ ] **Step 1:** 测试简单单栏文字能生成段落、明显的大字号能生成标题、有线表格产生正确单元格且正文不重复表格文字、定位图片能内嵌；每页保留页号与含原页图的 `details`。
- [ ] **Step 2:** 测试扫描、两栏、符号字体 / 明显上下标数学布局、无法解释的矢量图形、跨页表格迹象等保守回退；断言结果有保真图片及对应诊断，不能把分栏文字拼成错误句子或把数学静默改写成普通字符。
- [ ] **Step 3:** `.venv\Scripts\python.exe -m unittest discover -s tests -p test_pdf_reading.py -v`，确认新接口缺失导致失败。
- [ ] **Step 4:** 用 pdfplumber 的字符 / 行分组和有线表格识别构建阅读 HTML；按位置合并段落，先排除表格区域，避免重复；标题层级由页面字号层次与位置推断。无法通过保守检查的页调用 Task 4 保真输出，并在页级报告原因。为所有重建页附原页折叠图。
- [ ] **Step 5:** 运行阅读模式及全部 PDF 测试，预期全部 PASS；人工核对同一页在两种模式中的原页图、表格、图片和警告。没有实际用户 PDF 时记录验证范围。
- [ ] **Step 6:** 提交 `feat: add conservative PDF reading reconstruction and fallbacks`。

## Task 6: 完整工作区、导入预览与状态管理

**Files:** Create `web/app.js`、`web/modules/state.js`、`web/workspace.css`、`tests/workspace.spec.mjs`、`examples/showcase.md`、`examples/assets/circuit.svg`；Modify `web/index.html`、`web/modules/document.js`。

**Interfaces:** `createTaskState() -> {begin():number,isCurrent(id:number):boolean,finish(id:number,model:DocumentModel):boolean}`；`pdfResultToDraft(result:PdfResult) -> DocumentDraft`。界面通过此接口阻止过期结果写入；导出仅使用当前已完成的 model 与当前选项。

- [ ] **Step 1:** 写端到端测试覆盖粘贴、文件 / 文件夹导入、拖拽、内置示例、编辑、主题与字号调整、PDF 模式 / DPI、更换文件、下载。用受控慢任务证明旧结果不会覆盖新输入，编辑或转换未完成时导出按钮禁用；失败后输入仍在并能重试。
- [ ] **Step 2:** `npm.cmd test -- tests/workspace.spec.mjs`，确认界面缺失导致失败。
- [ ] **Step 3:** 实现左侧设置、中央原文、右侧预览；窄屏原文 / 结果标签切换。默认 820 px 内容宽、17 px 字号、1.8 行距。采用浅色与墨绿强调色，统一间距、边框和状态；所有图标有可访问名称，操作有键盘焦点，状态使用 aria-live。
- [ ] **Step 4:** 把 Task 2 / 3 / 4 / 5 串接到同一文档管线；Markdown 约 300 ms 防抖；MathJax 使用序列化队列，PDF 请求使用 AbortController，过期 ID 检查仍在任务完成时执行。iframe 使用 `sandbox` 限制，预览不执行输入脚本；输入 PDF 的本地 object URL 在更换文档时释放。
- [ ] **Step 5:** 实现资源缺失清单、公式错误定位、页级回退与保真分辨率说明；明确提供“补充图片”和“带缺失标记导出”路径。导出文件名从源文件名派生，设置选项与最新完成结果一致。
- [ ] **Step 6:** 重跑工作区测试并在 1440×1000 与 390×844 尺寸截图；检查三个主题、中文、长公式、宽表、PDF 比例、焦点与滚动。截图供实际查看，不能只保存而不检查。
- [ ] **Step 7:** 提交 `feat: deliver the local conversion workspace`。

## Task 7: 离线验收、使用说明与交付整理

**Files:** Create `tests/offline.spec.mjs`、`scripts/make-examples.py`、`README.md`、`THIRD_PARTY_NOTICES.md`、`docs/verification.md`；Modify 安装 / 启动脚本、样例与实现中由验证暴露的问题。

- [ ] **Step 1:** 写离线验收：Markdown 公式 / 图片与 PDF 两模式各导出一份 HTML，停止服务后用文件 URL 重开，禁止所有网络请求；断言公式、图片、目录、原页折叠和中文内容可用。模拟缺少 vendor 及依赖安装失败，要求显示恢复方法而非空白页或成功提示。
- [ ] **Step 2:** `npm.cmd test -- tests/offline.spec.mjs`；若任何要求未实现，先记录可复现失败，再针对原因修复。测试可通过时不人为破坏已经实现的正确行为来制造失败。
- [ ] **Step 3:** 运行全部 Python 单元测试与 `npm.cmd test`；检查 git diff；重新运行 vendor 准备及安装后健康检查；测试端口冲突与非 ASCII 项目路径 / 含空格路径的启动逻辑。将真实命令、结果和限制写入 verification，失败项不可标记为通过。
- [ ] **Step 4:** 实际查看桌面 / 窄屏 / 打印截图，修正遮挡、溢出、错误字形和空白；生成可以直接试用的 Markdown、图片和 PDF 样例与对应 HTML 结果，不把用户文档放进仓库。
- [ ] **Step 5:** README 写明安装与启动命令、首次联网和以后离线的区别、公式分隔符、资源导入、两种 PDF 模式差异、分辨率限制、字体回退、限额和故障恢复。许可清单包括 Python PDFium 绑定 / PDFium 第三方许可与复制的浏览器库许可。
- [ ] **Step 6:** 按所选执行流程完成代码审阅，处理影响规格的发现；修复后只重跑相关检查，最终重新确认整体验证状态。记录尚未用用户真实 PDF 验证这一边界。
- [ ] **Step 7:** 提交 `docs: add examples, offline verification, and usage guide`；检查工作区；交付启动入口、样例、已执行测试和已知限制。未经用户要求，不发布、推送或创建 PR。

## 计划自审结果

- 规格 1–3、7–8 的服务、交互、模块边界与资源限制由 Task 1 / 4 / 6 覆盖；规格 4 由 Task 2 / 3 覆盖；规格 5 由 Task 4 / 5 覆盖；规格 6、9–12 由 Task 3 / 7 覆盖。
- Review Focus 五项分别落入明确测试；共享模式名称、结果字段、限额与文件路径保持一致。
- 不预设任意 PDF 重排成功；数学密集页和扫描件的回退本身属于必须验证的正确结果。
- 执行状态：用户已选择当前会话逐项实现；七项任务、独立审阅及修复后验证均已完成。具体运行证据见 `docs/verification.md` 和 `docs/code-review.md`。
- 上方保留最初的实施步骤作为设计记录，实际执行结果与边界以验证记录为准。
