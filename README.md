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
- 首页“本机记录”按箱、展厅、楼层与位置列出已保存批次，点开可查看物品、修改信息或继续补充登记。
- 仓库使用开箱表单；馆内展柜填写展厅与展柜位置；设备设施填写楼层与具体位置，分别保存场景信息与照片。
- 修改物品保留编号、创建时间及已有附件；主动更换照片或扫描文件时在同一事务中替换旧附件。
- 现场拍照或选择已有照片；导出包包含表内照片和单独照片文件。
- 扫描文件导入，JSON 尺寸回填；模型包围盒尺寸需核实单位。
- 扫描仪接入独立入口，可保存待选型号和连接方式，当前状态为“待适配”。
- 珠宝重量校验，设备数量和账面价值登记；箱目录单独导出。
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
gradle assembleRelease lintRelease -PappVersionName=1.0.5 -PappVersionCode=10005
```

网页源文件位于 app/src/main/assets/www，原生相机、文件选择和版本检查逻辑位于 MainActivity.java。

### 自动发布

在仓库 Actions Secrets 中配置：
- ANDROID_KEYSTORE_BASE64：用于本应用的签名密钥文件的 Base64 编码。
- ANDROID_KEY_PASSWORD：对应签名密码，alias 固定为 dibo-release。

提交代码后推送未使用的新版本标签，会自动执行扫描解析测试、构建、签名并发布 APK、version.json 和 SHA256SUMS.txt。推送前完成下列浏览器及导出回归检查。
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

## 扫描接入范围

设备型号尚未确定。本版保留“设备接入”和“文件导入”两个页签；保存 USB、蓝牙、Wi-Fi 或电脑中转选项不会触发硬件连接。取得具体型号的 SDK 或协议后再实现驱动。

文件解析支持 JSON、单行数据的 CSV、尺寸文本或 XYZ 点云 TXT、OBJ、ASCII/二进制 STL、ASCII/大小端二进制 PLY、OFF。每个文件上限 20 MB。PLY 只读取声明的顶点段；模型计算外接尺寸，不推算真实体积。未声明单位时必须选择单位。Xpro 只保存原文件。

## 回归测试

```text
node --test tests/scanner-format.test.cjs
npm install --no-save playwright
node tests/app-regression.cjs
python tests/check-export.py apk-build/verification/full/all-functions.zip
node tests/records-regression.cjs
python tests/check-records-export.py
```

浏览器测试默认使用 Windows 上的 Chrome，可通过 CHROME_PATH 指定可执行文件，PLAYWRIGHT_MODULE 指定 Playwright 模块路径。测试会创建隔离的浏览器上下文和合成数据，不访问现场清查数据。Android 桥调用使用替身验证参数；不代替真机相机、文件选择器和覆盖安装测试。

1.0.4 验证：26 项扫描解析测试、25 组浏览器流程检查通过，导出包内容核验通过。后续新增功能应扩充相应回归测试。

### 1.0.5 升级与旧记录

保持 applicationId、签名、WebView 本地来源、IndexedDB 名称与版本不变。新字段 `hallName`、`floorName`、`updatedAt` 为可选字段，旧记录可直接读取，不需要重建数据库。旧展柜或设备记录仍保留原位置，首页显示“展厅待补全”或“楼层待补全”，进入“修改登记信息”后填写真实名称。

首页 → 本机记录 → 选择箱 / 展厅 / 楼层位置 → 查看物品；点物品进入修改，或点“继续登记物品”追加。底部第二项统一为“场景登记”，页面标题随场景切换。

新增 `场景记录目录.csv`，清查 CSV 和兼容表包含场景关联及展厅、楼层信息；`箱目录.csv` 和清查 CSV 原有列保留兼容，其中旧“箱号”列作为各场景关联编号。升级前导出备份，使用新 APK 覆盖安装。

## 界面文案

参考 [GitHub Primer Content](https://primer-docs-preview.github.com/product/getting-started/foundations/content/) 的清晰、简洁、统一用词原则，删除重复副标题和卡片说明，按钮直接描述动作。技术说明收进设置中的“使用帮助”，保留单位、导出内容、操作结果和错误提示。设计系统源码见 [primer/design](https://github.com/primer/design)。
