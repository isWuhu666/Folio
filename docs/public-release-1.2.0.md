# 1.2.0 首次公开发行

本次以 `v1.2.0-beta.1` 标签发布源码及 Windows / Android 安装附件，定位为可试用的预发布版。1.2.0 是应用内版本；GitHub beta 标签说明发行成熟度，二者不矛盾。

## 发行内容

- Windows x64 ZIP：完整解压后启动 Folio.exe，无需额外 Python / Node。
- Android APK：独立离线运行，使用项目发行证书；证书和指纹见 [签名说明](signing.md)。
- 单独及汇总 SHA-256 校验文件，公开 Android 证书。
- 源码、MIT 许可、第三方说明、使用/贡献/构建文档和自动化工作流。

发布附件的最终文件哈希以对应 GitHub Release 的 `SHA256SUMS.txt` 为准；历史验收记录中的旧哈希不用于本次附件。

## 验证与限制

Android 功能验收见 [原生验收记录](android-validation-2026-10-22.md)，Windows 早期 1.1.0 验收记录保留作历史对照。本次重新构建两平台 1.2.0；构建期间执行 Python / 浏览器回归、原生保存状态检查、Lint、签名检查和 Windows 冻结包冒烟，实际结果更新到 [verification.md](verification.md)。

实体手机、Android 8 设备、实际打印机、无 Python/Node 的干净 Windows 机器及全部厂商文件提供器尚未完成验证。发布为预发布，不等同于兼容性认证、代码安全认证或商店审核。

## 后续发行

1. 维护相同 Android 发行密钥，先备份再升级；Windows 如增加代码签名应补充真实证书信息。
2. 验证文档转换、项目互通、导出取消和数据保留，更新 CHANGELOG 与测试证据。
3. 在干净环境构建并检查许可、资源、秘密和打包内容；重新生成校验值。
4. 让 GitHub Actions 完成后再判断远端检查状态；本地通过不能代替远端结果。

历史文档中“未发布”指各阶段记录时的状态；本次公开状态以 GitHub 仓库和 Release 页面为准。
