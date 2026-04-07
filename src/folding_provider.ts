import * as vscode from 'vscode';

export class DialogueFoldingProvider implements vscode.FoldingRangeProvider {
	provideFoldingRanges(
		document: vscode.TextDocument,
		context: vscode.FoldingContext,
		token: vscode.CancellationToken
	): vscode.ProviderResult<vscode.FoldingRange[]> {
		const ranges: vscode.FoldingRange[] = [];
		const lineCount = document.lineCount;

		let currentTitleLine = -1;
		const regionStack: number[] = [];

		// 正则：匹配 #region 和 #endregion（忽略大小写，允许中间有空格）
		const regionStartRegex = /^#\s*region\b/i;
		const regionEndRegex = /^#\s*endregion\b/i;

		for (let i = 0; i < lineCount; i++) {
			const lineText = document.lineAt(i).text;
			const trimmed = lineText.trim();

			// ✅ 1. 处理话题折叠 (~ title)
			if (trimmed.startsWith('~ ')) {
				// 如果已经有一个话题在追踪中，先结束它
				if (currentTitleLine !== -1) {
					const endLine = this.findLastGotoBeforeLine(document, currentTitleLine, i);
					if (endLine > currentTitleLine) {
						ranges.push(new vscode.FoldingRange(currentTitleLine, endLine, vscode.FoldingRangeKind.Region));
					}
				}
				// 开始追踪新的话题
				currentTitleLine = i;
			}

			// ✅ 2. 处理自定义区域折叠 (#region / #endregion)
			if (regionStartRegex.test(trimmed)) {
				regionStack.push(i);
			} else if (regionEndRegex.test(trimmed)) {
				const startLine = regionStack.pop();
				if (startLine !== undefined) {
					ranges.push(new vscode.FoldingRange(startLine, i, vscode.FoldingRangeKind.Region));
				}
			}
		}

		// ✅ 处理文件末尾的最后一个话题折叠
		if (currentTitleLine !== -1) {
			const endLine = this.findLastGotoBeforeLine(document, currentTitleLine, lineCount);
			if (endLine > currentTitleLine) {
				ranges.push(new vscode.FoldingRange(currentTitleLine, endLine, vscode.FoldingRangeKind.Region));
			}
		}

		return ranges;
	}

	/**
	 * 查找从 startLine 到 beforeLine 之间的最后一个 => 标记
	 * @param document 文档对象
	 * @param startLine 开始行（话题定义行）
	 * @param beforeLine 结束行（下一个话题的行号或文件末尾）
	 * @returns 最后一个 => 所在的行号，如果没有找到则返回 beforeLine - 1
	 */
	private findLastGotoBeforeLine(
		document: vscode.TextDocument,
		startLine: number,
		beforeLine: number
	): number {
		let lastGotoLine = -1;

		// 从话题定义的下一行开始扫描到 beforeLine 之前
		for (let i = startLine + 1; i < beforeLine; i++) {
			const lineText = document.lineAt(i).text;
			const trimmed = lineText.trim();

			// ✅ 匹配 => 标记
			// 支持格式：
			// => END
			// => next_scene
			// - 选项 => target
			//   => target (缩进的)
			if (/^\s*(?:-[^=>]*)?=>\s*\S+/.test(lineText)) {
				lastGotoLine = i; // 记录这个 => 的位置，继续向下找
			}
		}

		// 如果找到了 =>，就折叠到那一行；否则折叠到 beforeLine - 1
		return lastGotoLine !== -1 ? lastGotoLine : beforeLine - 1;
	}
}