# PT-depiler 站点定义受控同步报告

基线：PT-depiler `15f9c4db00b673ff825d4969f1a05f7b54e95ea9`（2026-08-23）

## 文件清单

| 项目 | 数量 | 说明 |
| --- | ---: | --- |
| PT-depiler `src/packages/site/definitions` | 300 | 基线工作树中的站点定义 |
| PTPP `app/src/packages/site/definitions` | 298 | 同步前已有定义 |
| 仅 PT-depiler 存在 | 2 | `fhpt.ts`、`yzyy.ts` |
| 仅 PTPP 存在 | 0 | 未发现 |
| 同名但内容不同 | 21 | 不在本批次覆盖 |

## 本批次同步范围

- 新增 `app/src/packages/site/definitions/fhpt.ts`（凤凰 PT）：NexusPHP 静态元数据、分类和等级要求。
- 新增 `app/src/packages/site/definitions/yzyy.ts`（YzYY）：静态搜索/列表/详情/用户数据 selectors，以及受控下载链接解析。
- 两个定义均使用 PTPP 当前 `../types.ts`、schema 和导出约定；站点发现继续由 `import.meta.glob("./definitions/*.ts")` 完成。
- 未覆盖任何已有同名定义，也未修改站点运行时、动态脚本、权限或产品 UI。

## 待人工审查的同名差异

`azusa.ts`、`btschool.ts`、`cdfile.ts`、`hares.ts`、`hdarea.ts`、`hdcity.ts`、
`hdsky.ts`、`hdvideo.ts`、`keepfrds.ts`、`morethantv.ts`、`nexushd.ts`、
`piggo.ts`、`pter.ts`、`pttime.ts`、`pussytorrents.ts`、`sewerpt.ts`、
`simurg.ts`、`sunnypt.ts`、`u2.ts`、`yemapt.ts`、`zmpt.ts`。

这些文件包含 PTPP 本地签到声明、死站/等级数据、HDSky/Azusa 修复、下载链接
兼容和其他迁移定制，不能用 PTD 文件直接覆盖。后续更新必须先生成字段级差异，
逐项保留 PTPP 行为，再分别做定义加载、搜索和用户数据回归。

## 验收边界

本批次先验证静态定义能被构建和站点注册器加载。凤凰 PT 与 YzYY 的真实搜索、
用户数据和下载链接仍需要可用站点会话后再做实机验收；在此之前不将网络不可达或
缺少登录凭据记为代码失败，也不伪造成功结果。
