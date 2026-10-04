# 地博清查

用于博物馆现场清查的 Android 试用 App。支持 Android 8.0 及以上。

## 安装与使用

[下载最新 APK](https://github.com/jy1164039155-a11y/dibo-inventory/releases/latest/download/dibo-inventory.apk)

应用内含全部页面，无需运行电脑服务器。清查记录和附件保存在手机本地。
选择场景，建立箱级记录，再逐件登记、拍照，完成后导出 ZIP 交接包。
包名：cn.hunanmuseum.inventory。

## 当前能力

- 仓库、馆内展柜、设备设施场景入口。
- 箱级、逐件登记以及异常标记；重开应用可继续当前箱。
- 现场拍照或选择已有照片；导出包包含表内照片和单独照片文件。
- 扫描文件导入，JSON 尺寸回填；模型包围盒尺寸需核实单位。
- CSV 与含照片的 Excel 兼容 HTML 表（.xls）导出。
- 启动检查新版，设置中也可手动检查；用户确认下载并覆盖安装。

## 更新

内置版本地址：
https://github.com/jy1164039155-a11y/dibo-inventory/releases/latest/download/version.json

升级使用相同包名、签名和本地数据库名称。请先导出备份，再覆盖安装，不要先卸载旧版。
应用关闭后的系统通知尚未接入；这里实现的是启动时或手动检查更新。
手机需要能够访问 GitHub 及 Release 附件域名；离线状态可继续清查。

## 构建

依赖 JDK 17、Gradle 8.7、Android SDK 35。
准备自己的 keystore.properties 和签名密钥（均在 .gitignore 中），执行：
```text
gradle assembleRelease lintRelease -PappVersionName=1.0.1 -PappVersionCode=10001
```

网页源文件位于 app/src/main/assets/www，原生相机、文件选择和版本检查逻辑位于 MainActivity.java。

### 自动发布

在仓库 Actions Secrets 中配置：
- ANDROID_KEYSTORE_BASE64：用于本应用的签名密钥文件的 Base64 编码。
- ANDROID_KEY_PASSWORD：对应签名密码，alias 固定为 dibo-release。

提交代码后推送 v1.0.2 等标签，会自动构建、签名并发布 APK、version.json 和 SHA256SUMS.txt。
标签格式必须为 v主.次.修订，次和修订小于 100。versionCode = 主×10000 + 次×100 + 修订。
后续版本必须使用相同签名密钥；发布新密钥签名的包无法直接覆盖已安装版本。
公开仓库仅包含应用源码，现场记录和私人签名材料不纳入版本控制。

## 试点边界与验证

- 真实扫描仪 USB/蓝牙/Wi-Fi 接入仍需厂商 SDK，当前提供文件导入。
- 模型外接长方体不代表物体真实体积；体积仅保留扫描测量结果。
- 导出 .xls 实际是 Excel 兼容 HTML，Excel 可能提示格式与扩展名不匹配，并非原生 XLSX。
- 照片文件夹保存的是 App 处理后的照片。
- 本机 Android 编译、静态检查、签名检查通过。浏览器已验证保存、重开续录、照片入库、扫描 JSON 回填、ZIP 内容和手机宽度布局。
- 真机拍照、导出、覆盖安装及实际网络更新仍需试点验证。
