import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 段落信息
 */
export interface TitleInfo {
	name: string;           // 段落名（如 "start"）
	fullName: string;       // 完整名（如 "a1/start"，跨文件时带别名）
	line: number;           // 行号
	uri: vscode.Uri;        // 文件 URI
	comment?: string;       // 上方的注释
	alias?: string;         // 所属文件的别名（跨文件时）
	preview?: string;       // 第一句对话预览
}

/**
 * 段落管理器（支持跨文件）
 */
export class TitleManager {
	private titles: Map<string, TitleInfo[]> = new Map();
	private importedTitles: Map<string, TitleInfo[]> = new Map();

	/**
	 * 扫描文档中的所有段落
	 */
	public scanDocument(document: vscode.TextDocument): void {
		const titles: TitleInfo[] = [];
		const lines = document.getText().split('\n');

		let pendingComment: string | undefined;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();

			// ✅ 修改：收集所有注释（包括 # 和 ##）
			if (trimmed.startsWith('#')) {
				// 提取注释内容（去掉开头的 # 或 ##）
				const commentText = trimmed.replace(/^#+\s*/, '');

				if (pendingComment) {
					pendingComment += '\n' + commentText;
				} else {
					pendingComment = commentText;
				}
				continue;
			}

			// 匹配段落声明
			const titleMatch = trimmed.match(/^~\s+([^\s]+!?)/);
			if (titleMatch) {
				const titleName = titleMatch[1];

				// 获取预览
				const preview = this.getTitlePreview(lines, i + 1);

				titles.push({
					name: titleName,
					fullName: titleName,
					line: i,
					uri: document.uri,
					comment: pendingComment,  // ✅ 这里会包含话题上方的所有注释
					preview: preview
				});

				pendingComment = undefined;
				continue;
			}

			// 如果遇到非注释、非话题的内容，清空待处理的注释
			if (trimmed && !trimmed.startsWith('#')) {
				pendingComment = undefined;
			}
		}

		this.titles.set(document.uri.toString(), titles);
		console.log(`[Dialogue] ✅ 文档 ${path.basename(document.uri.fsPath)} 扫描完成，找到 ${titles.length} 个段落`);

		this.scanImportedTitles(document);
	}

	/**
	 * 获取段落的第一句对话作为预览
	 */
	private getTitlePreview(lines: string[], startLine: number): string | undefined {
		// 从段落定义的下一行开始，找到第一句对话
		for (let i = startLine; i < Math.min(startLine + 10, lines.length); i++) {
			const line = lines[i].trim();

			// 跳过空行和注释
			if (!line || line.startsWith('#')) continue;

			// 匹配旁白（不是选项）
			if (!line.startsWith('-')) {
				let content = line;

				if (content.length > 50) {
					content = content.substring(0, 50) + '...';
				}
				return content;
			}
		}

		return undefined;
	}

	/**
	 * 扫描导入的文件中的段落
	 */
	private scanImportedTitles(document: vscode.TextDocument): void {
		const importedTitles: TitleInfo[] = [];
		const lines = document.getText().split('\n');
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

		if (!workspaceFolder) return;

		for (const line of lines) {
			const importMatch = line.match(/^\s*import\s+"(res:\/\/[^"]+)"\s+as\s+([^\s]+)/);
			if (!importMatch) continue;

			const [, resPath, alias] = importMatch;

			const fsPath = path.join(
				workspaceFolder.uri.fsPath,
				resPath.replace('res://', '')
			);

			if (!fs.existsSync(fsPath)) {
				console.log(`[Dialogue] ⚠️ 导入的文件不存在: ${fsPath}`);
				continue;
			}

			const importedContent = fs.readFileSync(fsPath, 'utf-8');
			const importedLines = importedContent.split('\n');
			const importedUri = vscode.Uri.file(fsPath);

			// ✅ 新增：在导入文件中也收集注释
			let pendingComment: string | undefined;

			for (let i = 0; i < importedLines.length; i++) {
				const importedLine = importedLines[i];
				const trimmed = importedLine.trim();

				// 收集注释
				if (trimmed.startsWith('#')) {
					const commentText = trimmed.replace(/^#+\s*/, '');
					if (pendingComment) {
						pendingComment += '\n' + commentText;
					} else {
						pendingComment = commentText;
					}
					continue;
				}

				const titleMatch = trimmed.match(/^~\s+([^\s]+!?)/);

				if (titleMatch) {
					const titleName = titleMatch[1];

					// 获取导入文件的预览
					const preview = this.getTitlePreview(importedLines, i + 1);

					importedTitles.push({
						name: titleName,
						fullName: `${alias}/${titleName}`,
						line: i,
						uri: importedUri,
						alias: alias,
						comment: pendingComment,  // ✅ 包含注释
						preview: preview
					});

					pendingComment = undefined;
					console.log(`[Dialogue] 📦 导入段落: ${alias}/${titleName}`);
				}

				// 清空注释
				if (trimmed && !trimmed.startsWith('#') && !titleMatch) {
					pendingComment = undefined;
				}
			}
		}

		this.importedTitles.set(document.uri.toString(), importedTitles);
		console.log(`[Dialogue] ✅ 导入了 ${importedTitles.length} 个跨文件段落`);
	}

	// ... 其他方法保持不变 ...

	public getTitles(documentUri: vscode.Uri): TitleInfo[] {
		const localTitles = this.titles.get(documentUri.toString()) || [];
		const importedTitles = this.importedTitles.get(documentUri.toString()) || [];

		return [...localTitles, ...importedTitles];
	}

	public findTitle(documentUri: vscode.Uri, titleName: string): TitleInfo | undefined {
		const allTitles = this.getTitles(documentUri);

		const exactMatch = allTitles.find(t => t.fullName === titleName);
		if (exactMatch) return exactMatch;

		return allTitles.find(t => t.name === titleName);
	}

	public clearDocument(documentUri: vscode.Uri): void {
		this.titles.delete(documentUri.toString());
		this.importedTitles.delete(documentUri.toString());
	}
}


// ============ 段落跳转补全提供者 ============

export class TitleCompletionProvider implements vscode.CompletionItemProvider {
	constructor(private titleManager: TitleManager) { }

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position
	): Promise<vscode.CompletionItem[]> {
		const line = document.lineAt(position.line).text;
		const beforeCursor = line.substring(0, position.character);

		console.log('[Dialogue] ========== 段落补全被触发 ==========');

		// 检测 => 或 = 后面
		const gotoMatch = beforeCursor.match(/(?:^|\s)(=>)(\s*)([^\s]*)$/);
		if (!gotoMatch) {
			console.log('[Dialogue] ⚠️ 不在 => 上下文中');
			return [];
		}

		const operator = gotoMatch[1];
		const spaceAfter = gotoMatch[2];
		const partialInput = gotoMatch[3];

		console.log(`[Dialogue] 📝 操作符: "${operator}", 空格: "${spaceAfter}", 已输入: "${partialInput}"`);

		const needsSpace = spaceAfter === '';
		const prefix = needsSpace ? ' ' : '';

		console.log(`[Dialogue] ${needsSpace ? '✅ 需要添加空格' : '❌ 已有空格'}`);

		const titles = this.titleManager.getTitles(document.uri);

		const items: vscode.CompletionItem[] = [];

		// 添加 END 特殊标记
		const endItem = new vscode.CompletionItem('END', vscode.CompletionItemKind.Keyword);
		endItem.detail = '🛑 结束对话';
		endItem.documentation = new vscode.MarkdownString('**结束当前对话流程**');
		endItem.insertText = `${prefix}END`;
		endItem.sortText = '0_END';
		items.push(endItem);

		const endForceItem = new vscode.CompletionItem('END!', vscode.CompletionItemKind.Keyword);
		endForceItem.detail = '🛑 强制结束对话';
		endForceItem.documentation = new vscode.MarkdownString('**强制结束对话（忽略后续逻辑）**');
		endForceItem.insertText = `${prefix}END!`;
		endForceItem.sortText = '0_END!';
		items.push(endForceItem);

		// ✅ 添加所有段落（带预览）
		for (const title of titles) {
			const item = new vscode.CompletionItem(
				title.fullName,
				vscode.CompletionItemKind.Reference
			);

			// 区分本地和导入的段落
			if (title.alias) {
				item.detail = `📦 ${title.alias} (导入)`;
			} else {
				item.detail = `📍 ${title.fullName}`;
			}

			const docs: string[] = [];
			docs.push(`### ${title.fullName}`);

			// ✅ 添加预览
			if (title.preview) {
				docs.push('');
				docs.push('**预览:** `' + title.preview + '`');
			}

			if (title.comment) {
				docs.push('');
				docs.push('**说明:**');
				docs.push(title.comment);
			}

			if (title.alias) {
				docs.push('');
				docs.push(`**来源:** \`${path.basename(title.uri.fsPath)}\``);
			} else {
				docs.push('');
				docs.push(`**位置:** 第 ${title.line + 1} 行`);
			}

			item.documentation = new vscode.MarkdownString(docs.join('\n'));
			item.insertText = `${prefix}${title.fullName}`;
			item.sortText = title.alias ? `2_${title.fullName}` : `1_${title.fullName}`;

			items.push(item);
		}

		console.log(`[Dialogue] 📦 返回 ${items.length} 个段落补全项`);
		return items;
	}
}

// ============ 段落悬停提示提供者 ============

export class TitleHoverProvider implements vscode.HoverProvider {
	constructor(private titleManager: TitleManager) { }

	async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position
	): Promise<vscode.Hover | undefined> {
		const line = document.lineAt(position.line).text;

		// 匹配 => xxx 或 - xxx => yyy
		const gotoMatch = line.match(/(?:^|\s)(?:=>|=)\s+([^\s]+!?)/);
		if (!gotoMatch) return undefined;

		const titleNameWithBang = gotoMatch[1];
		const titleStart = line.indexOf(titleNameWithBang);
		const titleEnd = titleStart + titleNameWithBang.length;

		if (position.character < titleStart || position.character > titleEnd) {
			return undefined;
		}

		const hasInstantJump = titleNameWithBang.endsWith('!');
		const titleName = hasInstantJump
			? titleNameWithBang.slice(0, -1)
			: titleNameWithBang;

		// 特殊处理 END 和 END!
		if (titleName === 'END') {
			const docs: string[] = [];

			docs.push(hasInstantJump ? '### 🛑 END!' : '### 🛑 END');
			docs.push('');

			if (hasInstantJump) {
				docs.push('**强制立即结束对话**');
				docs.push('');
				docs.push('立即终止对话，跳过所有后续逻辑和清理代码。');
			} else {
				docs.push('**结束当前对话流程**');
				docs.push('');
				docs.push('对话将正常结束，触发 `dialogue_ended` 信号。');
			}
			docs.push('');
			docs.push('---');
			docs.push('');
			docs.push('💡 **提示:** 这是一个特殊的内置标记，不需要定义段落');
			return new vscode.Hover(new vscode.MarkdownString(docs.join('\n')));
		}

		// 查找普通段落
		const title = this.titleManager.findTitle(document.uri, titleName);
		if (title) {
			const docs: string[] = [];
			docs.push(`### 📍 ${title.fullName}`);

			docs.push('');
			docs.push('**类型:** 对话段落');

			// ✅ 添加预览
			if (title.preview) {
				docs.push('');
				docs.push('**预览:** `' + title.preview + '`');
			}

			if (title.comment) {
				docs.push('');
				docs.push('**说明:**');
				docs.push(title.comment);
			}

			if (title.alias) {
				docs.push('');
				docs.push(`**来源:** \`${path.basename(title.uri.fsPath)}\` (别名: \`${title.alias}\`)`);
			} else {
				docs.push('');
				docs.push(`**位置:** 第 ${title.line + 1} 行`);
			}

			docs.push('');
			docs.push('---');
			docs.push('');
			docs.push('💡 **提示:** 按 `Ctrl + 点击` 可跳转到定义');

			return new vscode.Hover(new vscode.MarkdownString(docs.join('\n')));
		}

		return undefined;
	}
}

// ============ 段落定义跳转提供者（保持不变）============

export class TitleDefinitionProvider implements vscode.DefinitionProvider {
	constructor(private titleManager: TitleManager) { }

	async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position
	): Promise<vscode.Definition | undefined> {
		const line = document.lineAt(position.line).text;

		const gotoMatch = line.match(/(?:^|\s)(?:=>|=)\s+([^\s]+!?)/);
		if (!gotoMatch) return undefined;

		const titleNameWithBang = gotoMatch[1];
		const titleStart = line.indexOf(titleNameWithBang);
		const titleEnd = titleStart + titleNameWithBang.length;

		if (position.character < titleStart || position.character > titleEnd) {
			return undefined;
		}

		const titleName = titleNameWithBang.endsWith('!')
			? titleNameWithBang.slice(0, -1)
			: titleNameWithBang;

		if (titleName === 'END') {
			console.log(`[Dialogue] 💡 ${titleNameWithBang} 是内置标记，无需跳转`);
			return undefined;
		}

		const title = this.titleManager.findTitle(document.uri, titleName);
		if (!title) {
			console.log(`[Dialogue] ⚠️ 未找到段落: ${titleName}`);
			return undefined;
		}

		console.log(`[Dialogue] ✅ 跳转到段落: ${title.fullName} (${title.uri.fsPath}:${title.line})`);
		const targetPosition = new vscode.Position(title.line, 0);
		return new vscode.Location(title.uri, targetPosition);
	}
}