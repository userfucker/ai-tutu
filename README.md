# ai-tutu · 电商 AI 作图

复刻电商 AI 作图的常用功能（产品精修、详情图组、图片翻译等），供公司内部运营使用。

- 项目背景和已经讨论过的方案：[docs/项目记忆.md](docs/项目记忆.md)
- 目前阶段：用 agy（Google Antigravity CLI）做生图能力测试

## 目录

| 目录 | 内容 |
| --- | --- |
| `docs/` | 项目记忆、设计文档 |
| `tools/agy-refine-test/` | 测试程序：一键智能产品精修（agy 生图），见里面的《使用说明.md》 |
| `extension/` | 浏览器插件：在 Gemini 网页版里批量抠白底图 / 精修（半自动），见里面的《使用说明.md》 |
| `extension-probe/` | Gemini 页面探测插件（开发插件时收集页面结构用） |
