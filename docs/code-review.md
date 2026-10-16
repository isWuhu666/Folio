# 独立代码审阅与修复记录

日期：2026-10-16。审阅由独立上下文的代码审阅代理执行，只读检查 `0905308..dddf71a`，并对关键输入在实际 Edge / PDF 解析器中复现。审阅者没有修改分支，也没有另行委派审阅。

| 发现 | 实际影响 | 修复与证据 |
| --- | --- | --- |
| 货币前缀跨越后续美元或代码 | `Price $20 and formula $x$.` 吞掉正文；包含反引号代码时也会误识别 | 不继续跨越不合法的第一个闭合候选，单美元识别不能跨入反引号代码；`currency prefix cannot swallow later code or formulas` RED→GREEN |
| 文件路径无条件 URL 解码 | `a%20b.svg` 与 `a b.svg` 被错配或合并 | 文件系统路径保持原始字符，Markdown URL 引用只解码一次，主文档目录不解码；`literal percent filenames and URL encoded spaces stay distinct` RED→GREEN |
| CropBox 与 MediaBox 坐标未统一 | 裁切页的文字选择层偏离可见原文 | 统一检查页面坐标条件，裁切 / 原点 / UserUnit 变换不可靠时关闭文字层并在阅读模式回退；`test_cropped_page_disables_untransformed_text_layer` 与阅读裁切样例 RED→GREEN |
| 普通字体上标跨垂直桶 | Helvetica 的 `E = mc` 上标 2 被拆为错误段落 | 在相邻水平位置和重叠垂直区间之间检查不同字号，跨行桶识别上下标并保守回退；普通字体上标阅读样例 RED→GREEN |
| 标题序号后缀碰撞 | `Foo / Foo / Foo-2` 产生重复锚点，目录跳到错误位置 | 对最终生成的标题 ID 做占用检查；`heading slugs cannot collide with numbered headings` RED→GREEN |

前四项由审阅者标为 Important；最后一项原标 Minor，执行者基于“稳定且去重的标题锚点”及实际错误导航行为，升级为 Important。没有借此扩大产品功能。

修复采取一次集中修复流程，每项都有先失败后通过的证据；最终执行完整 Python 15 项与浏览器 19 项套件，全部通过。没有进行重复审阅或把作者验证说成独立审阅确认。

审阅额外核实：旧公式完成时不能恢复新任务的导出按钮；已提交 HTML 在浏览器网络离线状态下仍能显示 SVG、图片和目录。Declined to judge：空列表。未测试用户实际 PDF、全新机器安装或第三方解析器内部漏洞。
