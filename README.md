# RSU Cost Basis Reconciler

本地运行的 RSU 成本基础核对与工作底稿原型。采用 TypeScript、React、Decimal.js、PDF.js 和 ExcelJS；确定性引擎负责计算，输出可复核的 XLSX 底稿。

当前真实券商文档流程尚未完成验证，内置合成案例可用于演示。产品不执行税务申报；现有测试通过不代表所有业务边界已验证。

## 目录

- `rsu-basis/`：应用源码、测试、锁定的依赖版本及构建配置。
- `files/`：产品规格、设计决策与合成示例。部分历史文档状态可能滞后于代码。

## 安装与验证

需要 Node.js（本地已在 Node 24 验证）、npm 和 Python 3。

```sh
cd rsu-basis
npm ci
npm run ci
```

完整检查包括 TypeScript、Vite 构建、Vitest 和独立 Python 样例验算。

## 构建

```sh
cd rsu-basis
npm run build
```

产物为 `rsu-basis/dist/index.html`，可用浏览器打开。真实 PDF 路径仍需完成浏览器 worker 与券商版式验证。

## 数据与版本管理

仅提交源码、规格、合成测试数据和已注明来源的公开样本 PDF。不要提交真实 W-2、1099-B、账户资料、密钥或个人报税底稿；其他形式的敏感文件也须在提交前检查。

依赖目录、构建产物、本机设置和本地评审资料已从 Git 排除。将源码推送至 Git 托管平台不会自动发布网站或部署在线服务。
