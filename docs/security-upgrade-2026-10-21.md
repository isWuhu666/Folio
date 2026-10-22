# 墨页 Folio：本机安全加固记录

本次围绕实际本机部署加固：监听地址仍为 `127.0.0.1`，没有增加公网入口、账号或上传平台。目标是减少恶意文档、外站网页和资源消耗攻击带来的风险，不作“不可攻击”的承诺。

## 依据和威胁边界

用户体验依据为《墨页Folio_深度优化建议.md》，原文 SHA-256：`D9724ACF22714D206E35E7C2223B6DB1CBBF6A7B656012628DE75AB23457D54B`。该附件明确未做源代码安全审计；本次安全结论来自后续代码检查、恶意输入回归、系统调用验证与依赖公告查询，不能归因于原附件。

攻击面包括不可信 Markdown/HTML、TeX 公式、图片、PDF、本机 HTTP 请求及浏览器持久化草稿。保留正常用户主动打开、编辑和离线导出的能力。已经控制当前 Windows 用户权限的恶意程序不在可完全隔离的边界之内。

## 已落实控制

| 边界 | 控制与验证 |
| --- | --- |
| 不可信 HTML | DOMPurify 清理活动标签、事件和样式；图片必须经本地资源解析；内部公式/段落标记使用每次渲染的随机标识，原文不能伪造有效槽位。测试包含脚本、事件、外链、SVG 和伪造公式标记。 |
| TeX → SVG | MathJax `ui/safe` 禁止公式添加 URL、类、CSS ID 和样式；生成后再次移除事件和非片段链接；限制公式长度、宏展开和公式数量；过期排版任务可提前退出。 |
| 预览与导出 | 预览沙箱不允许脚本或弹窗逃逸；外部链接在预览中禁用。导出前检查活动内容与外部资源，成品使用独立 CSP，目录/脚注等片段导航仍可用。 |
| 外站访问本机 API | 校验唯一 Host、Origin 和 Fetch Metadata；PDF 要求自定义请求头和 `application/pdf`；不开放 CORS/预检；关闭接口另要求随机凭据和当前实例匹配。 |
| HTTP 可用性 | 最多 16 个活动请求；请求行/全部请求头总时限 5 秒，上传总时限 20 秒；拒绝重复 Content-Length 与 Transfer-Encoding；只从公开静态根目录读文件。 |
| PDF 解析 | 文件、页数、像素总量与 180 秒转换上限；一次只处理一项 PDF；独立进程，Windows Job 限制提交内存 1.5 GiB、活动进程数 1；实际验证超额内存分配被拒绝和额外进程启动被拒绝。 |
| 浏览器资源消耗 | Markdown 5 MiB / 500 个公式；图片最多 256 个、共 80 MiB；单个 SVG 2 MiB、其他图片 20 MiB；栅格图解码后检查像素数。像素检查不是浏览器解码前的完整内存沙箱。 |
| 草稿一致性/隐私 | 事务内比较写入版本；放弃旧恢复项也比较版本；清除写入无内容标记阻止旧保存复活；初始读取完成前禁用编辑；保存失败、冲突和清除结果可见。草稿只存浏览器，提供关闭和清除入口。 |

工作台 CSP 仅允许本机脚本和连接；MathJax 所需 Blob Worker 被单独允许，不放开任意页面脚本执行。文档成品 CSP 与工作台 CSP 分离，避免把工作台权限带入成品。

## 依赖公告核验

初次 OSV 查询中，Pillow 12.3.0 命中九个公告，均将 13.0.0 标为修复版本：

`GHSA-462x-pgg6-55fp`、`GHSA-58r4-6rv3-gfh8`、`GHSA-65qm-jvmh-6pqg`、`GHSA-8g5g-8vmr-9782`、`GHSA-c6hw-5grf-ff96`、`GHSA-p4wg-p73j-c528`、`GHSA-pchr-8j38-3x4p`、`GHSA-q45j-58j2-45rg`、`GHSA-vx6w-vv9f-6gvg`。

已升级项目虚拟环境并把 `requirements.txt` 锁定为 Pillow 13.0.0。按实际安装版本重查八个锁定的 Python 运行依赖，OSV 返回零命中；`pip check` 无依赖冲突。npm 在线审计返回零命中。查询只发送公开包名、版本，不发送文档或源码。

这些是依赖层命中，不是九条网站可直接利用路径。当前 PDF 流程使用 PDFium 渲染位图并通过 Pillow 编码 PNG，没有证明公告涉及的 TIFF/GIF/EPS/JPEG 解码分支均能从本工具到达。升级用于去除已知受影响版本；公开数据库零命中也不能证明组件没有漏洞，特别是嵌入的原生引擎与未披露问题。

可重跑 `scripts/audit-dependencies.py` 查询当前锁定与实际安装版本；结果写入 `artifacts/python-dependency-audit-final.json`。网络故障或覆盖不完整时该脚本返回失败，不把“未查到”当作安全通过。

## 独立复核与修复

独立审阅实际复现了四项问题：旧恢复弹窗删除新草稿、初始化示例覆盖刚输入的内容、跨类型改名备份旧文本、慢请求头长期占满连接。均补充失败回归后修复。审阅者随后使用独立临时浏览器上下文和临时端口复验，确认四条原路径均已解决，也确认清除后旧保存不能重新写回资源。

完整测试与体验核验见 [实施验收记录](upgrade-2026-10-21.md)。独立复验不是完整渗透测试，也未穷举恶意 PDF 语料。

## 仍需保留的边界

1. PDF 原生解析仍以当前用户权限运行。内存、进程和超时限制降低资源消耗与扩散机会，不等于完整操作系统沙箱。应持续更新 Python、浏览器、PDFium 和依赖；不要直接将此服务暴露到公网。
2. 草稿可能被浏览器清理、配额或隐私模式影响，也没有加密。重要工作需保存原文和原始资源，共用设备使用后清除；清除不承诺物理介质安全擦除。
3. PDF 阅读重排、搜索文字层和公式排版成功不等于内容语义正确。仍需对照原文；没有新增 OCR 或“任意 PDF 无损重排”承诺。

## 一手参考

- [MathJax 4 Safe Extension](https://docs.mathjax.org/en/latest/options/safe.html)：公式属性过滤配置。
- [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)：自定义请求头与同源边界。
- [Microsoft Job Object 扩展限制](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)：进程提交内存限制语义。
- [Pillow 官方安全公告示例](https://github.com/python-pillow/Pillow/security/advisories/GHSA-8g5g-8vmr-9782)：受影响及修复版本。
- [W3C Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)：功能文字对比度核对依据。
