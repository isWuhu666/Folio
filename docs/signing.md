# 签名、密钥与发行

Folio 不需要 API Key。开源仓库不包含服务凭据、私钥或签名密码。MIT 许可证授权使用代码，不会授予冒用维护者发行签名的能力。

## 当前公开版本

Android 1.2.0 使用独立的 RSA 3072 / SHA256withRSA 自签名证书；它提供版本更新连续性，不等同于证书机构身份认证或应用商店审核。

- 公开证书：[folio-android-release.pem](signing/folio-android-release.pem)。只含公钥，不具备签署 APK 的能力。
- 证书 SHA-256：`71951d432b2d4fa2adc53f7292c027593b376210f13ea2b6e1057ef44e42c39e`。
- 发行包文件校验值见 GitHub Release 的 `SHA256SUMS.txt`。证书指纹和文件哈希是不同对象。
- 本次新签名不能覆盖旧开发签名试用包；先备份项目，再卸载旧包。后续官方版本应使用同一发行密钥。
- Windows 包目前没有 Authenticode 签名；不提供虚假的签名、付费证书或“系统已信任”承诺。

核对 APK：

```powershell
apksigner verify --verbose --print-certs Folio-1.2.0-android.apk
keytool -printcert -file docs/signing/folio-android-release.pem
```

## 维护者生成自己的签名

脚本在 Windows 上使用 JDK 的 `keytool`。默认目录为仓库同级的 `.folio-signing`；必须在仓库外，已有配置或密钥时拒绝覆盖。密码随机生成，Windows DPAPI 按当前登录账户保护，命令行不打印密码。

```powershell
# 使用自己安装的 JDK，或先配置 JAVA_HOME
./scripts/create-android-signing.ps1 -KeyDirectory ../.folio-signing/my-release

# 使用该配置构建。脚本加载密码后只传入 Gradle 子进程，退出恢复环境变量。
./scripts/build-android.ps1 -SigningProfile ../.folio-signing/my-release/signing-profile.json
```

创建后保存 `folio-release.p12`、`signing-profile.json` 和公开证书。**DPAPI 配置不是跨机器密码备份**：仅复制这些文件到另一账户通常无法解密。发行维护者应将 P12 及解密后的密码分别备份到自己控制的加密离线介质和密码管理器，再做一次恢复验证。不要把明文密码复制到 issue、终端日志、聊天或仓库。尚未完成跨机器恢复验收。

未传自定义签名时，构建脚本生成本地开发证书；仅用于开发，不能把该产物当作同一官方签名升级包。首次执行不要在已配置的发行环境中随意重建密钥。

## 自动构建与环境变量

Gradle 支持以下环境变量；`.env.example` 只说明名称，应用和脚本**不自动读取 `.env`**。

| 变量 | 用途 |
| --- | --- |
| `FOLIO_ANDROID_KEYSTORE` | P12 / JKS 私钥库的绝对路径 |
| `FOLIO_ANDROID_STORE_PASSWORD` | 私钥库密码 |
| `FOLIO_ANDROID_KEY_ALIAS` | 密钥别名 |
| `FOLIO_ANDROID_KEY_PASSWORD` | 私钥密码，未设置则沿用库密码 |

自定义私钥库不存在或必要变量缺失时构建失败，不静默替换。CI 默认生成开发签名测试 APK，artifact 名称明确含 `development`；**不会自动发布 Release**。正式签名可由维护者在可信机器执行，或自行配置受保护的 GitHub Environment / Secrets；本次没有将私钥上传 GitHub Secrets。不要对不受信任的 PR 注入发行密钥。

`.gitignore` 排除 P12、JKS、keystore、私钥、环境文件和签名配置。发布前还应检查提交历史及发行 ZIP 内容；忽略规则不会自动从历史删除旧秘密。发现密钥泄露后不能只删文件，应停止使用并评估换钥及用户迁移。

官方依据：[Android 应用签名](https://developer.android.com/studio/publish/app-signing)、[GitHub Actions Secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)。
