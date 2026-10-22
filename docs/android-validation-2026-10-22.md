# Android 1.2.0 验收记录

> 这是首次开发签名 APK 的历史验收。后续 GitHub 公开包改用独立发行签名，最终哈希与构建结果见 [公开发行说明](public-release-1.2.0.md) 和 Release 附件；下列旧哈希不适用于新签名包。

本次交付 `dist/Folio-1.2.0-android.apk`，26,033,271 字节（约 24.83 MiB）。开发证书签名，仅用于侧载试用，未发布应用商店或 GitHub Release。

SHA-256：`1d35d6fe0092a7cafff80a1918dfdad900cdcdf8fcd0da884e89b182edf1808d`。

## 安装与使用

将 APK 传到手机，用文件管理器打开并按系统提示允许该来源安装。安装后打开“墨页 Folio”，无需电脑、Python、命令行窗口或 8765 服务。最低 Android 8 / API 26，同时要求 System WebView / Chrome 内核 120 以上和受限消息监听能力；建议使用可获得的最新安全版本。最低版本配置不代表已在所有 Android 8 手机验证。

打开 Markdown、PDF 或 `.folio` 项目；图片可多选补齐。原文、预览和设置在手机上分栏切换。导出 HTML、ZIP、原文、项目时通过系统选择保存位置；打印由系统打印服务完成。项目应定期导出，草稿不能替代备份。

## 自动验证

| 检查 | 实际结果 |
| --- | --- |
| 完整 Playwright 浏览器回归 | 54 / 54 通过，含 7 项 Android 专项 |
| Python 真实后端回归 | 44 / 44 通过，最终重新运行耗时 33.391 秒 |
| 原生 ExportState 保存状态检查 | 26 项通过 |
| Android Lint release | 0 errors、6 warnings；主要为界面字符串国际化和兼容 API 提示，未宣称零警告 |
| Gradle release APK、签名 | 成功构建，apksigner 校验通过，release 禁用调试 |
| APK 内容 | ZIP CRC 完整，1,466 个 web 文件逐字节与最终源资源一致 |
| 清单 | package `app.folio.offline`，versionCode 10200，minSdk 26、targetSdk 35；没有网络、外部存储读取或写入权限 |

Android 专项覆盖保存消息分块与确认、用户取消、错误恢复、离线 PDF.js worker、选页、进度、大小限制、扫描/表格/公式/旋转文字的保守回退、侧向文字变换，以及手机界面在不请求 Python API 时完成转换。共享后端修复了取消响应早于工作进程清理释放锁的问题，并增加取消后立即重提任务的回归。

## 原生运行验收

使用专用 FolioSmoke 模拟器（API 37，1080 × 2400，System WebView 145.0.7632.218）。测试时关闭该模拟器 Wi-Fi 和移动数据。实际安装运行 APK，操作 Android 系统文档选择器和打印服务，没有用桌面消息模拟代替这些结果。

- 实际保存 HTML 并取回：241,355 字节，含 13 个 SVG，零 script 标签，公式可离线阅读。
- 系统选择器打开 `simple.pdf`，本机 PDF.js worker 成功渲染原页并生成 HTML；应用重新启动后可恢复 PDF 草稿。
- 从桌面编码器生成的项目传入 Android，正文、academic 主题、SVG 插图恢复成功。Android 保存后取回，ZIP CRC、正文、主题参数和图片字节一致。
- 最终 APK 重复保存生成 `android-cross-platform (1).folio`，保留可识别的项目扩展名。安卓项目导出使用 `application/octet-stream`，避免文档提供器自动追加 `.zip` 或将冲突编号加到扩展名后。
- 系统打印服务选择“Save as PDF”，真实生成 425,396 字节、3 页 PDF；第一页渲染检查确认中文、分式、希腊字母和表格可见。
- 最终 APK 安装后再次恢复项目、预览和保存项目成功。部分打印和 HTML 验收使用同日上一构建，最终构建仅更改项目导出 MIME 及对应状态测试，相关打印/HTML代码未变。

截图：[手机预览](screenshots-android-2026-10-22/preview.png)、[PDF 原页](screenshots-android-2026-10-22/pdf-original.png)、[系统打印](screenshots-android-2026-10-22/system-print.png)、[打印 PDF 第一页](screenshots-android-2026-10-22/printed-page1.png)。生成的样例文件和 UI 原始记录在本机被忽略的 `artifacts/` 中；不包含用户文档。

## 安全与最可能失败的三个点

1. **厂商 WebView / 文档提供器差异**：旧内核或特定文件提供器可能导致文件选择、打印或保存失败。应用检测内核能力并提示；请更新 WebView，优先保存到手机本地目录，再手动分享。尚未验证实体手机、Android 8 设备或实际打印机。
2. **手机内存与系统回收**：大型 PDF 和高清图像可能导致耗时或中断。PDF 限 20 MiB、每次 30 页、默认 96 DPI、每页 400 万/总 4,000 万像素，限时并可取消；必要时拆分或减少页数。没有 OCR，复杂内容阅读重排会保守回退，不能保证任意 PDF 的结构识别。
3. **签名与草稿丢失**：不同机器生成的开发签名不能连续覆盖升级，卸载会清除草稿。先保存 `.folio`；正式发行时由维护者持有稳定发行密钥。密钥在仓库外，不随源码或产物分发。

WebView 不开放网络、file/content URL、远程调试或任意导航；只有精确本地 HTTPS 来源的主框架可调用保存桥，预览 iframe 无权调用。保存有大小、类型、分块及状态校验，并在取消/错误时清理输出；断电或文件提供器拒绝删除仍可能留下不完整文件。用户选择云盘目录后的同步由该提供器负责。详细边界见 [构建与安全说明](android-build.md)。
