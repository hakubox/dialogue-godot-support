import * as vscode from 'vscode';
import * as path from 'path';

// ============ 文案导出功能 ============

/**
 * 导出的文案项
 */
interface ExportedDialogue {
	id: string;              // 唯一ID（自动生成）
	type: 'character' | 'narration' | 'choice';  // 类型
	speaker?: string;        // 角色名（仅当 type='character' 时）
	text: string;            // 文本内容（已移除标签）
	rawText: string;         // 原始文本（保留标签）
	line: number;            // 行号
	tags: string[];          // 包含的标签列表
	hasInlineCode: boolean;  // 是否包含内联代码（{{}} / [if] 等）
}

/**
 * Dialogue 文案导出器
 */
export class DialogueExporter {
	/**
	 * 导出当前文档的所有文案
	 */
	static exportDialogues(document: vscode.TextDocument): ExportedDialogue[] {
		const dialogues: ExportedDialogue[] = [];
		const lines = document.getText().split('\n');

		let idCounter = 1;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmedLine = line.trim();

			// ✅ 跳过空行和注释
			if (!trimmedLine || trimmedLine.startsWith('#')) {
				continue;
			}

			// ✅ 跳过控制语句
			if (this.isControlStatement(trimmedLine)) {
				continue;
			}

			// ✅ 解析角色对话
			const characterMatch = trimmedLine.match(/^(\w+|\?\?\?)\s*:\s*(.+)$/);
			if (characterMatch) {
				const speaker = characterMatch[1];
				const rawText = characterMatch[2];

				const dialogue = this.parseDialogueText(rawText, i + 1, idCounter++, 'character');
				dialogue.speaker = speaker;

				dialogues.push(dialogue);
				continue;
			}

			// ✅ 解析旁白（非角色对话的文本行）
			if (this.isNarrationLine(trimmedLine)) {
				const dialogue = this.parseDialogueText(trimmedLine, i + 1, idCounter++, 'narration');
				dialogues.push(dialogue);
				continue;
			}

			// ✅ 解析选项
			const choiceMatch = trimmedLine.match(/^-\s*(.+?)(?:\s*=>|\s*=)/);
			if (choiceMatch) {
				const choiceText = choiceMatch[1];
				const dialogue = this.parseDialogueText(choiceText, i + 1, idCounter++, 'choice');
				dialogues.push(dialogue);
				continue;
			}
		}

		console.log(`[Dialogue] ✅ 导出了 ${dialogues.length} 条文案`);
		return dialogues;
	}

	/**
	 * 解析对话文本
	 */
	private static parseDialogueText(
		rawText: string,
		lineNumber: number,
		id: number,
		type: 'character' | 'narration' | 'choice'
	): ExportedDialogue {
		// ✅ 提取所有标签
		const tags: string[] = [];
		const tagRegex = /\[([^\]]+)\]/g;
		let match;

		while ((match = tagRegex.exec(rawText)) !== null) {
			const tagContent = match[1];

			// 跳过内联代码标签
			if (this.isInlineCodeTag(tagContent)) {
				continue;
			}

			tags.push(tagContent);
		}

		// ✅ 移除标签和内联代码，得到纯文本
		let cleanText = rawText;

		// 移除标签（但保留被标签包裹的文本）
		cleanText = cleanText.replace(/\[(?:wait|speed|pause|p|sound|voice|br|signal|next|auto|jump)(?:=[^\]]+)?\]/g, '');
		cleanText = cleanText.replace(/\[\/?(wave|shake|rainbow|ghost|pulse|b|i|u|s|code|center|right|color|font|size)\]/g, '');
		cleanText = cleanText.replace(/\[#[^\]]+\]/g, '');  // 移除情绪标签
		cleanText = cleanText.replace(/\[ID:[^\]]+\]/g, ''); // 移除ID标签

		// 移除内联条件（但保留条件内的文本）
		cleanText = cleanText.replace(/\[if\s+[^\]]+\]\s*/g, '');
		cleanText = cleanText.replace(/\[elif\s+[^\]]+\]\s*/g, '');
		cleanText = cleanText.replace(/\[else\]\s*/g, '');
		cleanText = cleanText.replace(/\[endif\]\s*/g, '');

		// 移除内联 set/do
		cleanText = cleanText.replace(/\[set\s+[^\]]+\]\s*/g, '');
		cleanText = cleanText.replace(/\[do!?\s+[^\]]+\]\s*/g, '');

		// 展开变量插值（保留占位符）
		cleanText = cleanText.replace(/\{\{([^}]+)\}\}/g, '{$1}');

		// 展开随机选项（取第一个）
		cleanText = cleanText.replace(/\[\[([^\]|]+)(?:\|[^\]]+)*\]\]/g, '$1');

		// 清理多余空格
		cleanText = cleanText.replace(/\s+/g, ' ').trim();

		// ✅ 检查是否包含内联代码
		const hasInlineCode = /\{\{[^}]+\}\}|\[(?:if|elif|else|endif|set|do)\s+[^\]]*\]/.test(rawText);

		return {
			id: `DLG_${id.toString().padStart(4, '0')}`,
			type: type,
			text: cleanText,
			rawText: rawText,
			line: lineNumber,
			tags: tags,
			hasInlineCode: hasInlineCode
		};
	}

	/**
	 * 判断是否是控制语句
	 */
	private static isControlStatement(line: string): boolean {
		const patterns = [
			/^~\s*/,                          // 标题
			/^=>/,                             // goto
			/^import\s+/,                      // import
			/^using\s+/,                       // using
			/^(?:if|elif|else|while)\s+/,     // 控制流
			/^(?:do|set)\s+/,                  // 突变
		];

		return patterns.some(p => p.test(line));
	}

	/**
	 * 判断是否是旁白行
	 */
	private static isNarrationLine(line: string): boolean {
		// 不包含冒号，或者冒号前不是单词
		return !/^\w+\s*:/.test(line);
	}

	/**
	 * 判断是否是内联代码标签
	 */
	private static isInlineCodeTag(tagContent: string): boolean {
		return /^(?:if|elif|else|endif|set|do!?)\s+/.test(tagContent);
	}

	/**
	 * 生成 JSON 字符串
	 */
	static generateJSON(dialogues: ExportedDialogue[], format: 'pretty' | 'compact'): string {
		if (format === 'pretty') {
			return JSON.stringify(dialogues, null, 2);
		} else {
			return JSON.stringify(dialogues);
		}
	}

	/**
	 * 生成 CSV 字符串
	 */
	static generateCSV(dialogues: ExportedDialogue[]): string {
		const header = 'ID,类型,角色,文本,原始文本,行号,标签,包含代码\n';

		const rows = dialogues.map(d => {
			const speaker = d.speaker || '';
			const tags = d.tags.join('; ');
			const hasCode = d.hasInlineCode ? '是' : '否';

			// ✅ CSV 转义（处理逗号和引号）
			const escapeCSV = (str: string) => {
				if (str.includes(',') || str.includes('"') || str.includes('\n')) {
					return `"${str.replace(/"/g, '""')}"`;
				}
				return str;
			};

			return [
				d.id,
				d.type,
				speaker,
				escapeCSV(d.text),
				escapeCSV(d.rawText),
				d.line.toString(),
				escapeCSV(tags),
				hasCode
			].join(',');
		});

		return header + rows.join('\n');
	}

	/**
	 * 生成 Markdown 表格
	 */
	static generateMarkdown(dialogues: ExportedDialogue[]): string {
		const header = '| ID | 类型 | 角色 | 文本 | 行号 | 标签 |\n|---|---|---|---|---|---|\n';

		const rows = dialogues.map(d => {
			const speaker = d.speaker || '-';
			const tags = d.tags.length > 0 ? d.tags.map(t => `\`${t}\``).join(', ') : '-';
			const text = d.text.replace(/\|/g, '\\|');  // 转义管道符

			return `| ${d.id} | ${d.type} | ${speaker} | ${text} | ${d.line} | ${tags} |`;
		});

		return header + rows.join('\n');
	}
}

/**
 * 注册导出命令
 */
export function registerExportCommands(context: vscode.ExtensionContext) {
	// ✅ 命令 1：导出为 JSON（弹出选择框）
	const exportJSONCommand = vscode.commands.registerCommand(
		'dialogue.exportJSON',
		async () => {
			const editor = vscode.window.activeTextEditor;

			if (!editor || editor.document.languageId !== 'dialogue') {
				vscode.window.showErrorMessage('请先打开一个 .dialogue 文件');
				return;
			}

			console.log('[Dialogue] ========== 开始导出文案 ==========');

			// ✅ 导出文案
			const dialogues = DialogueExporter.exportDialogues(editor.document);

			if (dialogues.length === 0) {
				vscode.window.showWarningMessage('当前文件没有可导出的文案');
				return;
			}

			// ✅ 选择导出格式
			const format = await vscode.window.showQuickPick(
				[
					{ label: 'JSON (格式化)', value: 'json-pretty', description: '适合阅读和编辑' },
					{ label: 'JSON (紧凑)', value: 'json-compact', description: '适合程序读取，体积小' },
					{ label: 'CSV', value: 'csv', description: '可用 Excel 打开' },
					{ label: 'Markdown', value: 'markdown', description: '表格格式' }
				],
				{
					placeHolder: '选择导出格式'
				}
			);

			if (!format) return;

			let content: string;
			let fileExtension: string;

			switch (format.value) {
				case 'json-pretty':
					content = DialogueExporter.generateJSON(dialogues, 'pretty');
					fileExtension = 'json';
					break;
				case 'json-compact':
					content = DialogueExporter.generateJSON(dialogues, 'compact');
					fileExtension = 'json';
					break;
				case 'csv':
					content = DialogueExporter.generateCSV(dialogues);
					fileExtension = 'csv';
					break;
				case 'markdown':
					content = DialogueExporter.generateMarkdown(dialogues);
					fileExtension = 'md';
					break;
				default:
					return;
			}

			// ✅ 选择保存位置
			const currentFileName = path.basename(editor.document.fileName, '.dialogue');
			const defaultFileName = `${currentFileName}_export.${fileExtension}`;

			const saveUri = await vscode.window.showSaveDialog({
				defaultUri: vscode.Uri.file(
					path.join(path.dirname(editor.document.fileName), defaultFileName)
				),
				filters: {
					[format.label]: [fileExtension]
				}
			});

			if (!saveUri) return;

			// ✅ 写入文件
			await vscode.workspace.fs.writeFile(
				saveUri,
				Buffer.from(content, 'utf-8')
			);

			vscode.window.showInformationMessage(
				`✅ 成功导出 ${dialogues.length} 条文案到 ${path.basename(saveUri.fsPath)}`
			);

			// ✅ 询问是否打开文件
			const openFile = await vscode.window.showInformationMessage(
				'是否打开导出的文件?',
				'打开',
				'取消'
			);

			if (openFile === '打开') {
				const doc = await vscode.workspace.openTextDocument(saveUri);
				await vscode.window.showTextDocument(doc);
			}
		}
	);

	// ✅ 命令 2：快速预览（在新标签页显示 JSON）
	const previewJSONCommand = vscode.commands.registerCommand(
		'dialogue.previewJSON',
		async () => {
			const editor = vscode.window.activeTextEditor;

			if (!editor || editor.document.languageId !== 'dialogue') {
				vscode.window.showErrorMessage('请先打开一个 .dialogue 文件');
				return;
			}

			const dialogues = DialogueExporter.exportDialogues(editor.document);

			if (dialogues.length === 0) {
				vscode.window.showWarningMessage('当前文件没有可导出的文案');
				return;
			}

			// ✅ 在新标签页显示
			const content = DialogueExporter.generateJSON(dialogues, 'pretty');
			const doc = await vscode.workspace.openTextDocument({
				content: content,
				language: 'json'
			});

			await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
		}
	);

	// ✅ 命令 3：复制到剪贴板
	const copyJSONCommand = vscode.commands.registerCommand(
		'dialogue.copyJSON',
		async () => {
			const editor = vscode.window.activeTextEditor;

			if (!editor || editor.document.languageId !== 'dialogue') {
				vscode.window.showErrorMessage('请先打开一个 .dialogue 文件');
				return;
			}

			const dialogues = DialogueExporter.exportDialogues(editor.document);

			if (dialogues.length === 0) {
				vscode.window.showWarningMessage('当前文件没有可导出的文案');
				return;
			}

			const content = DialogueExporter.generateJSON(dialogues, 'pretty');
			await vscode.env.clipboard.writeText(content);

			vscode.window.showInformationMessage(
				`✅ 已复制 ${dialogues.length} 条文案到剪贴板`
			);
		}
	);

	context.subscriptions.push(
		exportJSONCommand,
		previewJSONCommand,
		copyJSONCommand
	);
}