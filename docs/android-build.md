# 安卓离线版本：构建与安全边界

已构建 APK、安装步骤与实际运行证据见 [Android 1.2.0 验收记录](android-validation-2026-10-22.md)。

安卓应用直接加载 APK 中的工作台和 PDF.js，无需电脑、8765 服务或账号。最低 Android 8（API 26），同时要求 Android System WebView / Chrome 内核 120 或以上且支持 AndroidX 的受限消息监听器。过旧内核会显示更新提示。

默认构建和 CI 使用本机生成的**开发签名**，用于侧载验证。GitHub 首次公开 APK 则使用独立维护者发行签名，见 [证书与签名配置](signing.md)。Release 构建关闭调试，两个签名模式均未上架应用商店。不同签名无法直接覆盖安装；卸载会清除应用草稿，先导出 `.folio` 项目。私钥不入库、不作为构建附件。

## 本机工具链

依赖固定为 Gradle 8.13、Android Gradle Plugin 8.11.1、AndroidX WebKit 1.14.0，编译/目标 SDK 35、Build Tools 35.0.0。JDK 21 可用于本次构建；Java 源级别 17。

官方版本依据：[AGP 8.11 兼容表](https://developer.android.com/build/releases/agp-8-11-0-release-notes)、[Android 命令行工具](https://developer.android.com/studio#command-tools)、[Gradle 校验值](https://gradle.org/release-checksums/)、[AndroidX WebKit](https://developer.android.com/jetpack/androidx/releases/webkit)。

工具链应放在仓库外。构建脚本默认使用仓库同级 `.tools`，可通过 `-ToolsRoot` 指定；构建缓存、SDK 用户目录与开发密钥也在此处。工具链需要联网下载，安装后的 APK 不需要网络。

下载并核对以下 ZIP 后解压：

| 工具 | 官方文件 | SHA-256 |
| --- | --- | --- |
| Android command-line tools | `https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip` | `90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a` |
| Gradle | `https://services.gradle.org/distributions/gradle-8.13-bin.zip` | `20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78` |

解压后应存在 `.tools/android-sdk/cmdline-tools/latest/bin/sdkmanager.bat` 与 `.tools/gradle-8.13/bin/gradle.bat`。阅读并接受 SDK 许可后安装平台：

```powershell
$env:JAVA_HOME = 'C:/path/to/your/jdk-21'
$env:ANDROID_USER_HOME = 'C:/folio-tools/android-user'
& C:/folio-tools/android-sdk/cmdline-tools/latest/bin/sdkmanager.bat --sdk_root=C:/folio-tools/android-sdk 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0'
cd C:/path/to/Folio
npm ci
./scripts/build-android.ps1 -ToolsRoot C:/folio-tools
```

可用 `-ToolsRoot` 改变工具位置；已有 SDK 时设置 `ANDROID_HOME`。脚本准备本地网页资源，执行保存状态测试、Android Lint、真实 release APK 构建及 `apksigner verify`，最后输出 APK 和 SHA-256 文件。CI 的手动工作流运行同一脚本并保存 APK；每次 CI 的开发签名不保证连续升级。

## 权限与数据处理

- 清单没有 `INTERNET`、外部存储读写或全盘访问权限；不启动外部导航，不加载外部网页。禁用备份、明文流量、WebView 远程调试、file/content URL 访问和新窗口。
- 页面使用 `https://appassets.androidplatform.net/` 映射 APK assets。仅此精确来源的**主框架**能触发 `FolioAndroid` 消息桥；相同来源的 iframe 也被原生拒绝。没有 `addJavascriptInterface`。
- 系统 `ACTION_OPEN_DOCUMENT` 可多选文件。只向 WebView 的文件输入回调提供系统选择器返回的 `content://` URI；页面不能提供任意本机路径或 URI。安卓目录选择不提供与桌面目录相同的语义，界面改用图片多选。
- 系统 `ACTION_CREATE_DOCUMENT` 决定导出位置。桥校验任务编号、文件名、扩展名与 MIME；一次一项任务，最多 130 MiB；每块解码后最多 128 KiB，Base64 文本最多 200 KiB，每块写入成功后确认。只有实际字节数与声明一致才完成。
- 取消、错误、五分钟无活动超时和正常 Activity 销毁会关闭输出并尝试删除部分文档。文档提供器可能拒绝删除；强制杀进程/断电也可能留下部分文件，请重新导出或手动删除。导出到用户选定的云盘提供器可能由该提供器自行同步，墨页本身没有网络权限。
- 打印将最多 8 MiB 的已排版、自包含 HTML 放入独立 WebView，禁用脚本与 DOM 存储，不安装消息桥，阻断外部资源；调用系统打印服务。实际打印机和 PDF 保存选项由手机的打印服务决定。
- 返回键先尝试关闭网页中的非关键对话框，再弹出退出确认。内核草稿不是永久备份，请保存项目文件。

## 重点验收与已知风险

### 单独运行原生仪器测试

使用独立、英文界面的测试 AVD，确认其已启动；不要对日常手机或其他任务设备运行。默认 serial 为 `emulator-5560`、AVD 名为 `FolioSmoke`，脚本在安装前核对两者，签名不符时停止而不自动卸载。仪器测试会通过恢复界面放弃该测试 AVD 已有草稿以初始化场景，请先备份重要内容；它不是无副作用检查。

```powershell
./scripts/test-android-runtime.ps1
# 额外验证真实系统选择器导入样例 PDF
./scripts/test-android-runtime.ps1 -IncludePdfImport
```

脚本只把开发签名应用/仪器 APK 与日志放在 `artifacts/android-runtime`，不覆盖 `dist` 的发行签名 APK。执行保存、取消、再保存；可选导入使用本任务样例。必须在输出中同时得到明确 PASS 和仪器成功码，FAIL、崩溃或超时会使脚本失败，不能只看 adb shell 的退出码。GitHub Android CI 当前执行构建/Lint/状态检查，未自动运行这个模拟器场景。实际结果见 [外部测试修复验收](audit-fixes-2026-10-22.md)。

1. 系统 WebView/厂商差异：版本门槛只覆盖已知能力，文件选择、打印服务仍需真机验收。
2. 大 PDF 和导出：手机内存、文档提供器速度及系统杀进程可能使任务失败；页面限制解析资源，原生流式保存并设限，失败后重新导出。
3. 开发证书和本机草稿：侧载更新签名变化可能要求卸载；先导出可互通的 `.folio` 项目，正式发行使用稳定密钥。
