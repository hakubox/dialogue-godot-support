import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { registerExportCommands } from './export_data';
import { ImportHoverProvider, ImportPathCompletionProvider } from './import_file';
import { TitleCompletionProvider, TitleDefinitionProvider, TitleHoverProvider, TitleManager } from './title_manager';
import { registerTagFeatures } from './dialogue_tag';
import { DialogueFoldingProvider } from './folding_provider';
import { GodotClassCache } from './common';
import { GodotCodeActionProvider, GodotDiagnosticProvider } from './error_handler';
import { GodotMethod } from './interface';
import { generateDialogueID } from './utils';

/**
 * 格式化 Godot 风格的文档注释
 * 
 * 输入示例：
 * ```
 * 获取槽位数据
 * @param slot_id: int 槽位ID (1-99)
 * @param include_empty: bool 是否包含空槽位
 * @return Dictionary 槽位数据
 * ```
 * 
 * 输出示例：
 * ```
 * 获取槽位数据
 * 
 * **Parameters:**
 * - `slot_id` (int): 槽位ID (1-99)
 * - `include_empty` (bool): 是否包含空槽位
 * 
 * **Returns:** Dictionary - 槽位数据
 * ```
 */
function formatGodotDocComment(rawComment: string): string {
	const lines = rawComment.split('\n');
	const formatted: string[] = [];
	const params: string[] = [];
	let returnInfo: string | null = null;
	let description: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();

		// 匹配 @param 标签
		// 格式：@param name: Type 描述文字
		const paramMatch = trimmed.match(/^@param\s+(\w+)\s*:\s*(\w+)\s+(.+)$/);
		if (paramMatch) {
			const [, paramName, paramType, paramDesc] = paramMatch;
			params.push(`- \`${paramName}\` (${paramType}): ${paramDesc}`);
			continue;
		}

		// 匹配 @return 标签
		// 格式：@return Type 描述文字
		const returnMatch = trimmed.match(/^@return\s+(\w+)\s+(.+)$/);
		if (returnMatch) {
			const [, returnType, returnDesc] = returnMatch;
			returnInfo = `${returnType} - ${returnDesc}`;
			continue;
		}

		// 其他行视为描述
		if (trimmed && !trimmed.startsWith('@')) {
			description.push(trimmed);
		}
	}

	// 组装格式化后的文档
	if (description.length > 0) {
		formatted.push(description.join('\n'));
		formatted.push('');
	}

	if (params.length > 0) {
		formatted.push('**Parameters:**');
		formatted.push(params.join('\n'));
		formatted.push('');
	}

	if (returnInfo) {
		formatted.push(`**Returns:** ${returnInfo}`);
	}

	return formatted.join('\n').trim();
}



// ============ 扩展激活 ============

export function activate(context: vscode.ExtensionContext) {
	console.log('[Dialogue] ============ 扩展开始激活 ============');

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (workspaceFolder) {
		console.log('[Dialogue] 工作区路径:', workspaceFolder.uri.fsPath);
	}

	const classCache = new GodotClassCache(workspaceFolder);
	const titleManager = new TitleManager(); // 新增

	classCache.initialize().then(() => {
		console.log('[Dialogue] 类缓存初始化完成');
	});

	// ============ 注册 "添加台词 ID" 命令 ============
	context.subscriptions.push(
		vscode.commands.registerCommand('dialogue.addDialogueIDs', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== 'dialogue') {
				vscode.window.showWarningMessage('请在 .dialogue 文件中使用此命令');
				return;
			}

			const document = editor.document;
			const edit = new vscode.WorkspaceEdit();
			let addedCount = 0;

			for (let i = 0; i < document.lineCount; i++) {
				const line = document.lineAt(i);
				const text = line.text;

				// ============ 新增：跳过所有注释行 ============
				if (text.trimStart().startsWith('#')) {
					continue;
				}

				// 识别台词行：格式为 "角色名: 对话内容"
				// 排除：标题(~)、跳转(=>)、选项(-)、注释(#)、代码块(do/set/if等)
				const dialoguePattern = /^\s*([^\s]*)\s*:?\s*(.+)$/;
				const match = text.match(dialoguePattern);

				if (!match) continue; // 不是台词行

				// 排除已有 ID 的行
				if (/\[ID:[A-F0-9]{12}\]/.test(text)) {
					continue;
				}

				// 排除特殊关键字开头的行（如 if:、set: 等）
				const speaker = match[1];
				if (['~', '=>', 'if', 'elif', 'else', 'do', 'set', 'while', 'match', 'when'].includes(speaker.toLowerCase())) {
					continue;
				}

				// 生成 12 位十六进制 ID
				const id = generateDialogueID();

				// 在行尾插入 ID
				const endPosition = line.range.end;
				edit.insert(document.uri, endPosition, ` [ID:${id}]`);
				addedCount++;
			}

			if (addedCount === 0) {
				vscode.window.showInformationMessage('未找到需要添加 ID 的台词行');
				return;
			}

			// 应用编辑
			await vscode.workspace.applyEdit(edit);
			vscode.window.showInformationMessage(`✅ 成功为 ${addedCount} 行台词添加 ID`);
		})
	);

	// ============ 新增：注册 "清除台词 ID" 命令 ============
	context.subscriptions.push(
		vscode.commands.registerCommand('dialogue.removeDialogueIDs', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== 'dialogue') {
				vscode.window.showWarningMessage('请在 .dialogue 文件中使用此命令');
				return;
			}
			const document = editor.document;
			const edit = new vscode.WorkspaceEdit();
			let removedCount = 0;
			// 正则匹配：[ID:XXXXXXXXXXXX] (支持任意长度的十六进制ID)
			const idPattern = /\s*\[ID:[^\s]+\]/g;
			for (let i = 0; i < document.lineCount; i++) {
				const line = document.lineAt(i);
				const text = line.text;
				// 查找行中的所有 ID 标记
				const matches = [...text.matchAll(idPattern)];
				if (matches.length === 0) continue;
				// 移除所有 ID 标记
				let newText = text;
				for (const match of matches) {
					newText = newText.replace(match[0], '');
				}
				// 替换整行
				const fullRange = new vscode.Range(
					line.range.start,
					line.range.end
				);
				edit.replace(document.uri, fullRange, newText);
				removedCount += matches.length;
			}
			if (removedCount === 0) {
				vscode.window.showInformationMessage('未找到任何台词 ID');
				return;
			}
			// 应用编辑
			await vscode.workspace.applyEdit(edit);
			vscode.window.showInformationMessage(`✅ 成功移除 ${removedCount} 个台词 ID`);
		})
	);

	// ============ Dialogue 标签功能 ============
	registerTagFeatures(context);

	// ============ 注册代码折叠提供者 ============
	context.subscriptions.push(
		vscode.languages.registerFoldingRangeProvider(
			{ scheme: 'file', language: 'dialogue' },
			new DialogueFoldingProvider()
		)
	);

	// ============ 自动闭合 {{ }} ============
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document.languageId !== 'dialogue') return;

			// 只处理单个字符的插入
			if (event.contentChanges.length !== 1) return;

			const change = event.contentChanges[0];

			// 检测是否输入了第二个 {
			if (change.text === '{' && change.rangeLength === 0) {
				const beforePosition = change.range.start;
				const beforeChar = event.document.getText(
					new vscode.Range(
						beforePosition.translate(0, -1),
						beforePosition
					)
				);

				// 如果前一个字符是 {，自动添加 }}
				if (beforeChar === '{') {
					const editor = vscode.window.activeTextEditor;
					if (editor && editor.document === event.document) {
						const insertPosition = change.range.end.translate(0, 1);
						editor.edit(editBuilder => {
							editBuilder.insert(insertPosition, '}}');
						}).then(() => {
							// 将光标移动到 {{ 和 }} 之间
							const newPosition = insertPosition;
							editor.selection = new vscode.Selection(newPosition, newPosition);
						});
					}
				}
			}
		})
	);

	// 段落管理：监听文档变化
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(doc => {
			if (doc.languageId === 'dialogue') {
				titleManager.scanDocument(doc);
			}
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document.languageId === 'dialogue') {
				titleManager.scanDocument(event.document);
			}
		}),
		vscode.workspace.onDidCloseTextDocument(doc => {
			if (doc.languageId === 'dialogue') {
				titleManager.clearDocument(doc.uri);
			}
		})
	);
	// 扫描当前打开的所有 dialogue 文件
	vscode.workspace.textDocuments.forEach(doc => {
		if (doc.languageId === 'dialogue') {
			titleManager.scanDocument(doc);
		}
	});
	// 注册段落相关功能
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			{ scheme: 'file', language: 'dialogue' },
			new TitleCompletionProvider(titleManager),
			'>', '=', ' '  // 触发字符
		)
	);
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			{ scheme: 'file', language: 'dialogue' },
			new TitleHoverProvider(titleManager)
		)
	);
	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider(
			{ scheme: 'file', language: 'dialogue' },
			new TitleDefinitionProvider(titleManager)
		)
	);

	// ============ Import 相关功能 ============
	const importCompletionProvider = new ImportPathCompletionProvider(workspaceFolder);

	// 注册 Import 路径补全提供者（添加空格触发）
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			{ scheme: 'file', language: 'dialogue' },
			importCompletionProvider,
			' ', '"', '/'  // 关键修复：添加空格触发
		)
	);

	// 注册 Import 悬停提示
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			{ scheme: 'file', language: 'dialogue' },
			new ImportHoverProvider(workspaceFolder)
		)
	);

	// 监听文件系统变化
	const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.dialogue');

	fileWatcher.onDidCreate(() => {
		console.log('[Dialogue] 📝 检测到新文件，刷新列表');
		importCompletionProvider.refresh();
	});

	fileWatcher.onDidDelete(() => {
		console.log('[Dialogue] 🗑️ 检测到文件删除，刷新列表');
		importCompletionProvider.refresh();
	});

	context.subscriptions.push(fileWatcher);


	// ============ Godot 代码诊断 ============
	const diagnosticCollection = vscode.languages.createDiagnosticCollection('dialogue');
	context.subscriptions.push(diagnosticCollection);

	const diagnosticProvider = new GodotDiagnosticProvider(classCache, diagnosticCollection, titleManager);

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(doc => {
			if (doc.languageId === 'dialogue') {
				diagnosticProvider.updateDiagnostics(doc);
			}
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document.languageId === 'dialogue') {
				diagnosticProvider.updateDiagnostics(event.document);
			}
		}),
		vscode.workspace.onDidCloseTextDocument(doc => {
			if (doc.languageId === 'dialogue') {
				diagnosticCollection.delete(doc.uri);
			}
		})
	);

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			{ scheme: 'file', language: 'dialogue' },
			new GodotCodeActionProvider(classCache, diagnosticCollection, titleManager),
			{
				providedCodeActionKinds: [
					vscode.CodeActionKind.QuickFix,
					vscode.CodeActionKind.RefactorRewrite
				]
			}
		)
	);

	// 对当前打开的所有 dialogue 文件进行初始诊断
	vscode.workspace.textDocuments.forEach(doc => {
		if (doc.languageId === 'dialogue') {
			diagnosticProvider.updateDiagnostics(doc);
		}
	});

	// ============ Godot 类补全 ============
	// 修复：GodotCompletionProvider 只在特定上下文触发，避免与 Import 冲突
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			{ scheme: 'file', language: 'dialogue' },
			new GodotCompletionProvider(classCache),
			'.'  // 关键修复：只保留点号触发，移除空格
		)
	);

	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			{ scheme: 'file', language: 'dialogue' },
			new GodotHoverProvider(classCache)
		)
	);

	context.subscriptions.push(
		vscode.languages.registerSignatureHelpProvider(
			{ scheme: 'file', language: 'dialogue' },
			new GodotSignatureHelpProvider(classCache),
			'(', ','
		)
	);

	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider(
			{ scheme: 'file', language: 'dialogue' },
			new GodotDefinitionProvider(classCache)
		)
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(event => {
			// 现有:全局类配置变更
			if (event.affectsConfiguration('dialogue.diagnostics.globalClasses')) {
				console.log('[Dialogue] 🔄 配置已变更，重新构建全局成员索引');
				classCache.refreshGlobalMembers();
				// 重新诊断所有打开的 dialogue 文件
				vscode.workspace.textDocuments.forEach(doc => {
					if (doc.languageId === 'dialogue') {
						diagnosticProvider.updateDiagnostics(doc);
					}
				});
			}
			// 新增:全局变量配置变更
			if (event.affectsConfiguration('dialogue.diagnostics.globalVariables')) {
				console.log('[Dialogue] 🔄 全局变量配置已变更');
				classCache.refreshGlobalVariables();

				// 重新诊断所有打开的文件
				vscode.workspace.textDocuments.forEach(doc => {
					if (doc.languageId === 'dialogue') {
						diagnosticProvider.updateDiagnostics(doc);
					}
				});
			}
		})
	);

	registerExportCommands(context);

	console.log('[Dialogue] ============ 扩展激活完成 ============');
}

export function deactivate() {
	console.log('[Dialogue] 扩展已停用');
}

// ============ 补全提供者 ============
class GodotCompletionProvider implements vscode.CompletionItemProvider {
	constructor(private classCache: GodotClassCache) { }

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
		context: vscode.CompletionContext  // 添加 context 参数
	): Promise<vscode.CompletionItem[]> {
		console.log('[Dialogue] ========== 补全被触发 ==========');

		const line = document.lineAt(position.line).text;
		const beforeCursor = line.substring(0, position.character);

		console.log('[Dialogue] 📝 当前行:', line);
		console.log('[Dialogue] 📝 光标前内容:', beforeCursor);

		// 检测是否在 import 语句中（如果是，交给 ImportCompletionProvider 处理）
		if (/^\s*import\b/.test(beforeCursor)) {
			console.log('[Dialogue] ⚠️ 在 import 语句中，跳过 Godot 补全');
			return [];
		}
		// **新增：检测是否在 goto 语句中（=> 或 - xxx =>）**
		if (/(?:^|\s)(?:=>|=)\s*[^\s]*$/.test(beforeCursor)) {
			console.log('[Dialogue] ⚠️ 在 goto 语句中，跳过 Godot 补全');
			return [];
		}
		// **新增：检测是否在标题声明中（~ xxx）**
		if (/^\s*~\s+/.test(beforeCursor)) {
			console.log('[Dialogue] ⚠️ 在标题声明中，跳过 Godot 补全');
			return [];
		}
		// **新增：检测是否在选项中（- xxx）**
		if (/^\s*-\s+[^=>]*$/.test(beforeCursor)) {
			console.log('[Dialogue] ⚠️ 在选项文本中，跳过 Godot 补全');
			return [];
		}

		// **新增：检测是否在角色对话中（角色: 对话内容）**
		// 匹配：NPC: 你好
		// 不匹配：do NPC.method()
		if (/^\s*\w+:\s+[^[{]*$/.test(beforeCursor) && !/^\s*(?:do!?|set|if|elif|while|match|when)\s+/.test(beforeCursor)) {
			console.log('[Dialogue] ⚠️ 在对话文本中，跳过 Godot 补全');
			return [];
		}

		// **新增：检测是否在旁白中（非代码区域的纯文本）**
		const textLinePatterns = [
			/^\s*~\s+/,                    // 标题
			/^\s*=>/,                      // goto
			/^\s*-\s*/,                    // 选项
			/^\s*#/,                       // 注释
			/^\s*import\s+/,               // import
			/^\s*using\s+/,                // using
			/^\s*(?:if|elif|else|while|match|when)\s+/, // 控制流（块级）
			/^\s*(?:do!?|set)\s+/,         // 突变（块级）
		];

		const isBlockLevelCode = textLinePatterns.some(p => p.test(beforeCursor));

		// 如果不是块级代码，且没有代码标记，说明是旁白
		if (!isBlockLevelCode &&
			!/\[(?:do!?|set|if|elif)\s+/.test(beforeCursor) &&
			!/\{\{/.test(beforeCursor)) {
			console.log('[Dialogue] ⚠️ 在旁白文本中，跳过 Godot 补全');
			return [];
		}

		// 优先检查成员访问（类名.）
		// 优先检查成员访问（支持多层：objA.b.c）
		const memberAccessMatch = beforeCursor.match(/(\w+(?:\.\w+)*)\.(\w*)$/);
		if (memberAccessMatch) {
			const fullPath = memberAccessMatch[1];  // 例如：playerStats.equipment
			const partialMember = memberAccessMatch[2];

			console.log(`[Dialogue] 🔍 成员访问: ${fullPath}.${partialMember}`);

			// 分割路径
			const pathParts = fullPath.split('.');
			const rootIdentifier = pathParts[0];

			// 检查是否是全局变量
			const globalVar = this.classCache.getGlobalVariable(rootIdentifier);
			if (globalVar) {
				console.log(`[Dialogue] 🌐 全局变量成员访问: ${fullPath}`);

				// 如果只有一层（playerStats.xxx）
				if (pathParts.length === 1) {
					return this.getVariableMembers(rootIdentifier, []);
				}

				// 多层访问（playerStats.equipment.xxx）
				const propertyPath = pathParts.slice(1);  // ['equipment']
				return this.getVariableMembers(rootIdentifier, propertyPath);
			}

			// 否则当作类名处理
			return this.getClassMembers(rootIdentifier);
		}

		// 然后检查是否在代码区域（需要手动触发）
		const triggerPatterns = [
			/^\s*do!?\s+[\w.]*$/,              // do 后可能有类名和点
			/\{\{[^}]*$/,                      // {{ 插值
			/^\s*set\s+[\w.]*$/,               // set 变量
			/^\s*(?:if|elif)\s+[\S.]*$/,      // if/elif 条件
			/\[(?:if|elif)\s+[^\]]*$/,        // 行内条件
		];

		const shouldTrigger = triggerPatterns.some(p => p.test(beforeCursor));

		console.log('[Dialogue] 🔍 是否在代码区域:', shouldTrigger);

		if (!shouldTrigger) {
			// 如果用户手动触发（Ctrl+Space），也显示补全
			if (context.triggerKind === vscode.CompletionTriggerKind.Invoke) {
				console.log('[Dialogue] 💡 用户手动触发补全');
				return [
					...this.getAllClasses(),
					...this.getGlobalVariablesCompletions(),
					...this.getGlobalMembersCompletions()
				];
			}

			console.log('[Dialogue] ⚠️ 不在代码区域，跳过补全');
			return [];
		}

		console.log('[Dialogue] 在代码区域，返回所有类');

		return [
			...this.getAllClasses(),
			...this.getGlobalVariablesCompletions(),
			...this.getGlobalMembersCompletions()
		];
	}

	/**
	 * 新增：获取全局成员的补全项
	 */
	private getGlobalMembersCompletions(): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];
		const globalMembers = this.classCache.getGlobalMembers();

		for (const member of globalMembers) {
			const cls = this.classCache.getClass(member.className);
			if (!cls) continue;

			if (member.type === 'method') {
				const method = cls.methods.find(m => m.name === member.name);
				if (!method) continue;

				const item = new vscode.CompletionItem(
					member.name,
					vscode.CompletionItemKind.Method
				);

				const paramTexts = method.params.map(p => p.fullText).join(', ');
				item.detail = `${method.returnType} ${member.className}.${member.name}(${paramTexts})`;
				item.insertText = new vscode.SnippetString(`${member.name}($0)`);

				const docs: string[] = [];
				docs.push(`🌐 **全局方法**（来自 \`${member.className}\`）`);
				docs.push('');

				if (method.docComment) {
					docs.push(formatGodotDocComment(method.docComment));
					docs.push('');
					docs.push('---');
				}

				docs.push(`**Returns:** \`${method.returnType}\``);

				if (method.params.length > 0) {
					docs.push(`**Parameters:**`);
					for (const param of method.params) {
						const defaultValue = param.defaultValue ? ` = ${param.defaultValue}` : '';
						docs.push(`- \`${param.name}: ${param.type}${defaultValue}\``);
					}
				}

				item.documentation = new vscode.MarkdownString(docs.join('\n'));
				item.sortText = `0_global_${member.name}`; // 全局成员优先显示

				items.push(item);

			} else if (member.type === 'property') {
				const property = cls.properties.find(p => p.name === member.name);
				if (!property) continue;

				const item = new vscode.CompletionItem(
					member.name,
					vscode.CompletionItemKind.Property
				);

				item.detail = `${property.type} ${member.className}.${member.name}`;
				item.documentation = new vscode.MarkdownString(
					`🌐 **全局属性**（来自 \`${member.className}\`）\n\n**Type:** ${property.type}`
				);
				item.sortText = `0_global_${member.name}`;

				items.push(item);
			}
		}

		return items;
	}

	/**
	 * 新增:获取全局变量的补全项
	 */
	private getGlobalVariablesCompletions(): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];
		const globalVars = this.classCache.getAllGlobalVariables();
		for (const { name, def } of globalVars) {
			const item = new vscode.CompletionItem(
				name,
				vscode.CompletionItemKind.Variable
			);
			item.detail = `${def.type} (全局变量)`;

			const docs: string[] = [];
			docs.push(`🌐 **全局变量** (在 settings.json 中配置)`);
			docs.push('');
			docs.push(`**类型:** \`${def.type}\``);

			if (def.comment) {
				docs.push('');
				docs.push(`**说明:**`);
				// 支持多行注释
				docs.push(def.comment);
			}
			item.documentation = new vscode.MarkdownString(docs.join('\n'));
			item.sortText = `0_var_${name}`;  // 最高优先级
			items.push(item);
		}
		return items;
	}

	/**
	 * 新增：获取变量属性的补全项
	 */
	private getVariableMembers(
		variableName: string,
		propertyPath: string[]
	): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];
		const properties = this.classCache.getVariableProperties(variableName, propertyPath);

		console.log(`[Dialogue] 📦 获取变量成员: ${variableName}.${propertyPath.join('.')}`);
		console.log(`[Dialogue] 📊 找到 ${properties.length} 个属性`);

		for (const prop of properties) {
			// 移除可选标记（String? -> String）
			const cleanType = prop.type.replace('?', '');
			const isOptional = prop.type.endsWith('?');

			const item = new vscode.CompletionItem(
				prop.name,
				vscode.CompletionItemKind.Property
			);

			item.detail = `${prop.type} (变量属性)`;

			const docs: string[] = [];
			docs.push(`**类型:** \`${cleanType}\``);

			if (isOptional) {
				docs.push(`**可选:** 是`);
			}

			if (prop.comment) {
				docs.push('');
				docs.push(`**说明:** ${prop.comment}`);
			}

			item.documentation = new vscode.MarkdownString(docs.join('\n'));
			item.sortText = `0_prop_${prop.name}`;

			items.push(item);
		}

		return items;
	}

	/** 获取所有类的补全项 */
	private getAllClasses(): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];

		for (const cls of this.classCache.getClasses()) {
			const item = new vscode.CompletionItem(cls.name, vscode.CompletionItemKind.Class);
			item.detail = `extends ${cls.base}`;

			const docs: string[] = [];

			// 显示类注释
			if (cls.classComment) {
				docs.push('');
				const _comments = cls.classComment.split('\n');
				for (let i = 0; i < _comments.length; i++) {
					const _comment = _comments[i];
					docs.push(_comment);
					docs.push('');
				}
				docs.push('---');
				docs.push('');
			}

			docs.push(`**Base Class:** \`${cls.base}\``);
			docs.push('');
			docs.push(`**Path:** \`${cls.path}\``);

			if (this.classCache.isAutoload(cls.name)) {
				docs.push('');
				docs.push('🌐 **AutoLoad Singleton**');
			}

			// 添加方法和属性概览
			if (cls.methods.length > 0) {
				const publicMethods = cls.methods.filter(m => !m.name.startsWith('_'));
				if (publicMethods.length > 0) {
					docs.push('');
					docs.push(`**Methods:** ${publicMethods.length} public methods`);
				}
			}

			if (cls.properties.length > 0) {
				const publicProps = cls.properties.filter(p => !p.name.startsWith('_'));
				if (publicProps.length > 0) {
					docs.push(`**Properties:** ${publicProps.length} public properties`);
				}
			}

			item.documentation = new vscode.MarkdownString(docs.join('\n'));
			item.sortText = this.classCache.isAutoload(cls.name) ? `0_${cls.name}` : `1_${cls.name}`;

			items.push(item);
		}

		return items;
	}

	/** 获取类成员的补全项 */
	private getClassMembers(className: string): vscode.CompletionItem[] {
		console.log(`[Dialogue] -------- 获取 ${className} 的成员 --------`);

		const cls = this.classCache.getClass(className);

		if (!cls) {
			console.log(`[Dialogue] ❌ 未找到类: ${className}`);
			return [];
		}

		console.log(`[Dialogue] 找到类: ${className}`);
		console.log(`[Dialogue] 📊 方法数量: ${cls.methods.length}`);
		console.log(`[Dialogue] 📊 属性数量: ${cls.properties.length}`);

		const items: vscode.CompletionItem[] = [];

		// 添加方法（过滤下划线开头）
		for (const method of cls.methods) {
			if (method.name.startsWith('_')) {
				console.log(`[Dialogue] ⏭️ 跳过私有方法: ${method.name}`);
				continue;
			}

			console.log(`[Dialogue] 📦 添加方法: ${method.name}`);

			const item = new vscode.CompletionItem(method.name, vscode.CompletionItemKind.Method);

			// 修复：正确拼接参数
			const paramTexts = method.params.map(p => p.fullText).join(', ');
			item.detail = `${method.returnType} ${className}.${method.name}(${paramTexts})`;

			item.insertText = new vscode.SnippetString(`${method.name}($0)`);

			const docs: string[] = [];

			// 格式化文档注释
			if (method.docComment) {
				docs.push(formatGodotDocComment(method.docComment));
				docs.push('');
				docs.push('---');
			}

			// 修复：显示参数信息
			docs.push(`**Returns:** \`${method.returnType}\``);

			if (method.params.length > 0) {
				docs.push(`**Parameters:**`);
				for (const param of method.params) {
					const defaultValue = param.defaultValue ? ` = ${param.defaultValue}` : '';
					docs.push(`- \`${param.name}: ${param.type}${defaultValue}\``);
				}
			} else {
				docs.push(`**Parameters:** _none_`);
			}

			if (method.isStatic) {
				docs.push('\n🔒 **Static method**');
			}

			item.documentation = new vscode.MarkdownString(docs.join('\n'));

			items.push(item);
		}

		// 添加属性（✅ 过滤下划线开头）
		for (const prop of cls.properties) {
			if (prop.name.startsWith('_')) {
				console.log(`[Dialogue] ⏭️ 跳过私有属性: ${prop.name}`);
				continue;
			}

			console.log(`[Dialogue] 📦 添加属性: ${prop.name}`);

			const item = new vscode.CompletionItem(prop.name, vscode.CompletionItemKind.Property);
			item.detail = `${prop.type} ${className}.${prop.name}`;

			const docs = [`**Type:** ${prop.type}`];
			if (prop.isExported) {
				docs.push('\n🔧 **Exported property**');
			}

			item.documentation = new vscode.MarkdownString(docs.join('\n'));

			items.push(item);
		}

		// 添加信号（✅ 过滤下划线开头）
		for (const signal of cls.signals) {
			if (signal.startsWith('_')) {
				console.log(`[Dialogue] ⏭️ 跳过私有信号: ${signal}`);
				continue;
			}

			console.log(`[Dialogue] 📦 添加信号: ${signal}`);

			const item = new vscode.CompletionItem(signal, vscode.CompletionItemKind.Event);
			item.detail = `signal ${className}.${signal}`;
			item.documentation = new vscode.MarkdownString('📡 **Signal**');

			items.push(item);
		}

		console.log(`[Dialogue] 📊 总共返回 ${items.length} 个成员`);

		return items;
	}
}

// ============ 悬停提示提供者 ============
class GodotHoverProvider implements vscode.HoverProvider {
	constructor(private classCache: GodotClassCache) { }

	async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position
	): Promise<vscode.Hover | undefined> {
		console.log('[Dialogue] ========== 悬停提示被触发 ==========');

		const line = document.lineAt(position.line).text;

		// 先获取光标位置的单词
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) return undefined;

		const word = document.getText(wordRange);
		console.log(`[Dialogue] 🔍 光标下的单词: ${word}`);

		// 检测成员访问：支持多层嵌套
		const beforeWord = line.substring(0, wordRange.start.character);
		const fullPathMatch = beforeWord.match(/(\w+(?:\.\w+)*)\.$/);

		if (fullPathMatch) {
			const fullPath = fullPathMatch[1];  // 例如：playerStats.equipment
			const pathParts = fullPath.split('.');
			const rootIdentifier = pathParts[0];

			console.log(`[Dialogue] 🔍 悬停在成员上: ${fullPath}.${word}`);

			// 检查是否是全局变量
			const globalVar = this.classCache.getGlobalVariable(rootIdentifier);
			if (globalVar) {
				console.log(`[Dialogue] 🌐 全局变量属性悬停`);

				const propertyPath = [...pathParts.slice(1), word];
				const result = this.classCache.resolveVariableProperty(rootIdentifier, propertyPath);

				if (result) {
					const cleanType = result.type.replace('?', '');
					const isOptional = result.type.endsWith('?');

					const docs: string[] = [];
					docs.push(`## ${word}`);
					docs.push('');
					docs.push(`**类型:** \`${cleanType}\`${isOptional ? ' (可选)' : ''}`);

					if (result.comment) {
						docs.push('');
						docs.push(`**说明:** ${result.comment}`);
					}

					docs.push('');
					docs.push('---');
					docs.push(`💡 来自全局变量 \`${rootIdentifier}\``);

					return new vscode.Hover(new vscode.MarkdownString(docs.join('\n')));
				}
			}

			// 否则当作类成员处理
			return this.getMemberHover(rootIdentifier, word);
		}

		const globalMember = this.classCache.resolveGlobalMember(word);

		if (globalMember) {
			console.log(`[Dialogue] 🌐 找到全局成员: ${word} (来自 ${globalMember.className})`);
			return this.getMemberHover(globalMember.className, word);
		}

		// 新增:检查是否是全局变量本身
		const globalVar = this.classCache.getGlobalVariable(word);

		if (globalVar) {
			const docs: string[] = [];
			docs.push(`## 🌐 ${word}`);
			docs.push('');
			docs.push(`**类型:** \`${globalVar.type}\``);

			if (globalVar.comment) {
				docs.push('');
				docs.push(`**说明:**`);
				docs.push(globalVar.comment);
			}
			docs.push('');
			docs.push('---');
			docs.push('💡 **全局变量** (在 settings.json 中配置)');
			return new vscode.Hover(new vscode.MarkdownString(docs.join('\n')));
		}

		// 检测单独的类名
		console.log(`[Dialogue] 🔍 检测单独的类名: ${word}`);

		// 检查是否在代码区域
		const codePatterns = [
			/^\s*(while|match|when|do!?)\s+/,
			/\[do!?\s+/,
			/\{\{[^}]*/,
			/^\s*set\s+/,
			/\[set\s+/,
			/^\s*(?:if|elif)\s+/,
			/\[(?:if|elif)\s+[^\]]*/,
		];

		const inCodeArea = codePatterns.some(p => p.test(line));
		if (!inCodeArea) {
			console.log('[Dialogue] ⚠️ 不在代码区域，跳过悬停');
			return undefined;
		}

		return this.getClassHover(word);
	}

	/** 获取类的悬停信息 */
	private getClassHover(className: string): vscode.Hover | undefined {
		const cls = this.classCache.getClass(className);
		if (!cls) return undefined;

		const docs: string[] = [
			`## ${cls.name}`,
		];

		// 显示类注释
		if (cls.classComment) {
			docs.push('');
			const _comments = cls.classComment.split('\n');
			for (let i = 0; i < _comments.length; i++) {
				const _comment = _comments[i];
				docs.push(_comment);
				docs.push('');
			}
			docs.push('---');
			docs.push('');
		}

		docs.push(`**Base Class:** \`${cls.base}\``);
		docs.push('');
		docs.push(`**Path:** \`${cls.path}\``);

		if (this.classCache.isAutoload(className)) {
			docs.push('\n🌐 **Global Singleton (AutoLoad)**');
		}

		return new vscode.Hover(new vscode.MarkdownString(docs.join('\n')));
	}

	/** 获取成员（方法/属性）的悬停信息 */
	private getMemberHover(className: string, memberName: string): vscode.Hover | undefined {
		const cls = this.classCache.getClass(className);
		if (!cls) return undefined;

		// 如果是私有成员，不显示提示
		if (memberName.startsWith('_')) {
			console.log(`[Dialogue] ⏭️ 私有成员不显示悬停: ${memberName}`);
			return undefined;
		}

		// 查找方法
		const method = cls.methods.find(m => m.name === memberName);
		if (method) {
			const docs: string[] = [];

			// 添加函数签名
			docs.push('```gdscript');
			const paramTexts = method.params.map(p => p.fullText).join(', ');
			docs.push(`func ${method.name}(${paramTexts}) -> ${method.returnType}`);
			docs.push('```');

			// 格式化并添加文档注释
			if (method.docComment) {
				docs.push('');
				docs.push(formatGodotDocComment(method.docComment));
			}

			// 添加元信息
			docs.push('');
			docs.push('---');
			docs.push(`**Class:** \`${className}\``);

			if (method.isStatic) {
				docs.push('🔒 **Static method**');
			}

			return new vscode.Hover(new vscode.MarkdownString(docs.join('\n')));
		}

		// 查找属性
		const property = cls.properties.find(p => p.name === memberName);
		if (property) {
			const docs: string[] = [];

			docs.push('```gdscript');
			docs.push(`var ${property.name}: ${property.type}`);
			docs.push('```');

			docs.push('');
			docs.push('---');
			docs.push(`**Class:** \`${className}\``);
			docs.push(`**Type:** \`${property.type}\``);

			if (property.isExported) {
				docs.push('🔧 **Exported property**');
			}

			return new vscode.Hover(new vscode.MarkdownString(docs.join('\n')));
		}

		// 查找信号
		const signal = cls.signals.find(s => s === memberName);
		if (signal) {
			const docs: string[] = [];

			docs.push('```gdscript');
			docs.push(`signal ${signal}`);
			docs.push('```');

			docs.push('');
			docs.push('---');
			docs.push(`**Class:** \`${className}\``);
			docs.push('📡 **Signal**');

			return new vscode.Hover(new vscode.MarkdownString(docs.join('\n')));
		}

		return undefined;
	}
}

// ============ 参数提示提供者 ============
class GodotSignatureHelpProvider implements vscode.SignatureHelpProvider {
	constructor(private classCache: GodotClassCache) { }

	async provideSignatureHelp(
		document: vscode.TextDocument,
		position: vscode.Position
	): Promise<vscode.SignatureHelp | undefined> {
		console.log('[Dialogue] ========== 参数提示被触发 ==========');

		const line = document.lineAt(position.line).text;
		const beforeCursor = line.substring(0, position.character);

		console.log('[Dialogue] 📝 当前行:', line);
		console.log('[Dialogue] 📝 光标前内容:', beforeCursor);

		// 先查找完整的函数调用（ClassName.method()）
		const fullFunctionCallMatch = beforeCursor.match(/(?:^|\[do!?\s+|\[set\s+|\{\{)[\s\S]*?(\w+)\.(\w+)\s*\(([^)]*)$/);

		if (fullFunctionCallMatch) {
			const className = fullFunctionCallMatch[1];
			const methodName = fullFunctionCallMatch[2];
			const paramsText = fullFunctionCallMatch[3];

			console.log(`[Dialogue] 🔍 检测到函数: ${className}.${methodName}`);

			const cls = this.classCache.getClass(className);
			if (cls) {
				const method = cls.methods.find(m => m.name === methodName);
				if (method) {
					return this.createSignatureHelp(method, paramsText);
				}
			}
		}

		// 新增：检查全局方法调用（method()）
		const globalFunctionCallMatch = beforeCursor.match(/(?:^|\[do!?\s+|\[set\s+|\{\{)[\s\S]*?(\w+)\s*\(([^)]*)$/);

		if (globalFunctionCallMatch) {
			const methodName = globalFunctionCallMatch[1];
			const paramsText = globalFunctionCallMatch[2];

			console.log(`[Dialogue] 🔍 检测到可能的全局方法: ${methodName}`);

			const globalMember = this.classCache.resolveGlobalMember(methodName);

			if (globalMember && globalMember.type === 'method') {
				console.log(`[Dialogue] 🌐 确认为全局方法: ${methodName} (来自 ${globalMember.className})`);

				const cls = this.classCache.getClass(globalMember.className);
				if (cls) {
					const method = cls.methods.find(m => m.name === methodName);
					if (method) {
						return this.createSignatureHelp(method, paramsText);
					}
				}
			}
		}

		console.log('[Dialogue] ⚠️ 未检测到函数调用');
		return undefined;
	}

	/**
	 * 新增：创建签名帮助（提取公共逻辑）
	 */
	private createSignatureHelp(method: GodotMethod, paramsText: string): vscode.SignatureHelp {
		console.log(`[Dialogue] 找到方法: ${method.name}`);
		console.log(`[Dialogue] 📊 参数列表:`, method.params.map(p => p.fullText));

		const commaCount = (paramsText.match(/,/g) || []).length;
		const activeParameter = Math.min(commaCount, method.params.length - 1);

		console.log(`[Dialogue] 📍 当前参数位置: ${activeParameter}`);

		const signatureHelp = new vscode.SignatureHelp();

		const paramTexts = method.params.map(p => p.fullText).join(', ');
		const signature = new vscode.SignatureInformation(
			`${method.name}(${paramTexts}) -> ${method.returnType}`
		);

		if (method.docComment) {
			signature.documentation = new vscode.MarkdownString(formatGodotDocComment(method.docComment));
		}

		for (const param of method.params) {
			const paramInfo = new vscode.ParameterInformation(param.fullText);

			const paramDocs: string[] = [`**Type:** \`${param.type}\``];

			if (param.defaultValue) {
				paramDocs.push(`**Default:** \`${param.defaultValue}\``);
			}

			paramInfo.documentation = new vscode.MarkdownString(paramDocs.join('\n'));

			signature.parameters.push(paramInfo);
		}

		signatureHelp.signatures.push(signature);
		signatureHelp.activeSignature = 0;
		signatureHelp.activeParameter = activeParameter;

		console.log(`[Dialogue] 返回签名提示`);

		return signatureHelp;
	}
}

// ============ 定义跳转提供者 ============
class GodotDefinitionProvider implements vscode.DefinitionProvider {
	constructor(private classCache: GodotClassCache) { }

	async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position
	): Promise<vscode.Definition | undefined> {
		console.log('[Dialogue] ========== 定义跳转被触发 ==========');

		const line = document.lineAt(position.line).text;
		const beforeCursor = line.substring(0, position.character);
		const afterCursor = line.substring(position.character);

		console.log('[Dialogue] 📝 当前行:', line);
		console.log('[Dialogue] 📝 光标前内容:', beforeCursor);
		console.log('[Dialogue] 📝 光标后内容:', afterCursor);
		console.log('[Dialogue] 📝 光标位置:', position.character);

		// 获取光标位置的单词
		const range = document.getWordRangeAtPosition(position);
		if (!range) {
			console.log('[Dialogue] ❌ 无法获取光标位置的单词');
			return undefined;
		}

		const word = document.getText(range);
		console.log('[Dialogue] 🔍 光标位置的单词:', word);
		console.log('[Dialogue] 🔍 单词范围:', `[${range.start.character}, ${range.end.character}]`);

		// 改进的成员访问检测：向前查找完整的调用链
		// 例如：PlayerState.add_gold(100) 中，光标可能在任意位置
		const fullLine = line;

		// 查找光标前最近的点号位置
		const beforeDot = beforeCursor.lastIndexOf('.');
		if (beforeDot !== -1) {
			// 提取类名（点号之前的单词）
			const beforeDotText = beforeCursor.substring(0, beforeDot);
			const classNameMatch = beforeDotText.match(/(\w+)$/);

			if (classNameMatch) {
				const className = classNameMatch[1];

				// 新增:先检查是否是全局变量
				const globalVar = this.classCache.getGlobalVariable(className);

				// 检查光标是否在类名上
				const classNameStart = beforeDot - className.length;
				const classNameEnd = beforeDot;

				if (position.character >= classNameStart && position.character <= classNameEnd) {
					console.log(`[Dialogue] 光标在${globalVar ? '全局变量' : '类名'}上: ${className}`);

					// 全局变量不支持跳转到定义
					if (globalVar) {
						console.log(`[Dialogue] ⚠️ 全局变量不支持跳转(在配置中定义)`);
						return undefined;
					}

					return this.getClassDefinition(className);
				}

				// 检查光标是否在成员名上（点号之后）
				if (position.character > beforeDot) {
					const afterDotText = line.substring(beforeDot + 1);
					const memberNameMatch = afterDotText.match(/^(\w+)/);

					if (memberNameMatch) {
						const memberName = memberNameMatch[1];
						const memberStart = beforeDot + 1;
						const memberEnd = memberStart + memberName.length;

						if (position.character >= memberStart && position.character <= memberEnd) {
							// 如果是全局变量,使用其类型
							const targetClass = globalVar ? globalVar.type : className;
							console.log(`[Dialogue] 光标在成员名上: ${targetClass}.${memberName}`);
							return this.getMemberDefinition(targetClass, memberName);
						}
					}
				}
			}
		}

		// 检测单独的类名
		console.log(`[Dialogue] 🔍 检测单独的类名: ${word}`);

		// 新增：检查是否是全局成员
		const globalMember = this.classCache.resolveGlobalMember(word);

		if (globalMember) {
			console.log(`[Dialogue] 🌐 找到全局成员: ${word} (来自 ${globalMember.className})`);

			// 检查是否在代码区域
			const codePatterns = [
				/^\s*(while|match|when|do!?)\s+/,
				/\[do!?\s+/,
				/\{\{[^}]*/,
				/^\s*set\s+/,
				/\[set\s+/,
				/^\s*(?:if|elif)\s+/,
				/\[(?:if|elif)\s+[^\]]*/,
			];
			const inCodeArea = codePatterns.some(p => p.test(line));
			if (inCodeArea) {
				return this.getMemberDefinition(globalMember.className, word);
			}
		}

		// 检测单独的类名
		console.log(`[Dialogue] 🔍 检测单独的类名: ${word}`);

		// 检查是否在代码区域
		const codePatterns = [
			/^\s*(while|match|when|do!?)\s+/,
			/\[do!?\s+/,
			/\{\{[^}]*/,
			/^\s*set\s+/,
			/\[set\s+/,
			/^\s*(?:if|elif)\s+/,
			/\[(?:if|elif)\s+[^\]]*/,
		];

		const inCodeArea = codePatterns.some(p => p.test(line));
		if (!inCodeArea) {
			console.log('[Dialogue] ⚠️ 不在代码区域，跳过跳转');
			return undefined;
		}

		console.log('[Dialogue] 在代码区域，尝试跳转到类定义');
		return this.getClassDefinition(word);
	}

	/** 获取类的定义位置 */
	private getClassDefinition(className: string): vscode.Definition | undefined {
		const cls = this.classCache.getClass(className);
		if (!cls) {
			console.log(`[Dialogue] ❌ 未找到类: ${className}`);
			return undefined;
		}

		const fsPath = this.resPathToFsPath(cls.path);
		if (!fs.existsSync(fsPath)) {
			console.log(`[Dialogue] ❌ 文件不存在: ${fsPath}`);
			return undefined;
		}

		// 跳转到 class_name 声明行
		const location = this.findClassNameLine(fsPath, className);

		console.log(`[Dialogue] 跳转到类定义: ${fsPath}`);
		return location;
	}

	/** 获取成员（方法/属性）的定义位置 */
	private getMemberDefinition(className: string, memberName: string): vscode.Definition | undefined {
		const cls = this.classCache.getClass(className);
		if (!cls) return undefined;

		// 如果是私有成员，不跳转
		if (memberName.startsWith('_')) {
			console.log(`[Dialogue] ⏭️ 私有成员不支持跳转: ${memberName}`);
			return undefined;
		}

		const fsPath = this.resPathToFsPath(cls.path);
		if (!fs.existsSync(fsPath)) return undefined;

		// 查找方法定义
		const method = cls.methods.find(m => m.name === memberName);
		if (method) {
			console.log(`[Dialogue] 跳转到方法: ${memberName}`);
			return this.findMethodLine(fsPath, memberName);
		}

		// 查找属性定义
		const property = cls.properties.find(p => p.name === memberName);
		if (property) {
			console.log(`[Dialogue] 跳转到属性: ${memberName}`);
			return this.findPropertyLine(fsPath, memberName);
		}

		// 查找信号定义
		const signal = cls.signals.find(s => s === memberName);
		if (signal) {
			console.log(`[Dialogue] 跳转到信号: ${memberName}`);
			return this.findSignalLine(fsPath, memberName);
		}

		return undefined;
	}

	/** 查找 class_name 声明行 */
	private findClassNameLine(fsPath: string, className: string): vscode.Location | undefined {
		try {
			const content = fs.readFileSync(fsPath, 'utf-8');
			const lines = content.split('\n');

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const match = line.match(new RegExp(`^\\s*class_name\\s+${className}\\b`));
				if (match) {
					const uri = vscode.Uri.file(fsPath);
					const position = new vscode.Position(i, line.indexOf(className));
					const range = new vscode.Range(position, position.translate(0, className.length));
					return new vscode.Location(uri, range);
				}
			}

			// 如果没有 class_name，跳转到文件开头
			const uri = vscode.Uri.file(fsPath);
			return new vscode.Location(uri, new vscode.Position(0, 0));
		} catch (error) {
			console.error(`[Dialogue] ❌ 查找类定义失败:`, error);
			return undefined;
		}
	}

	/** 查找方法定义行 */
	private findMethodLine(fsPath: string, methodName: string): vscode.Location | undefined {
		try {
			const content = fs.readFileSync(fsPath, 'utf-8');
			const lines = content.split('\n');

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const match = line.match(new RegExp(`^\\s*(?:static\\s+)?func\\s+${methodName}\\s*\\(`));
				if (match) {
					const uri = vscode.Uri.file(fsPath);
					const position = new vscode.Position(i, line.indexOf(methodName));
					const range = new vscode.Range(position, position.translate(0, methodName.length));
					return new vscode.Location(uri, range);
				}
			}
		} catch (error) {
			console.error(`[Dialogue] ❌ 查找方法定义失败:`, error);
		}
		return undefined;
	}

	/** 查找属性定义行 */
	private findPropertyLine(fsPath: string, propertyName: string): vscode.Location | undefined {
		try {
			const content = fs.readFileSync(fsPath, 'utf-8');
			const lines = content.split('\n');

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const match = line.match(new RegExp(`^\\s*(?:@export\\s+)?var\\s+${propertyName}\\b`));
				if (match) {
					const uri = vscode.Uri.file(fsPath);
					const position = new vscode.Position(i, line.indexOf(propertyName));
					const range = new vscode.Range(position, position.translate(0, propertyName.length));
					return new vscode.Location(uri, range);
				}
			}
		} catch (error) {
			console.error(`[Dialogue] ❌ 查找属性定义失败:`, error);
		}
		return undefined;
	}

	/** 查找信号定义行 */
	private findSignalLine(fsPath: string, signalName: string): vscode.Location | undefined {
		try {
			const content = fs.readFileSync(fsPath, 'utf-8');
			const lines = content.split('\n');

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const match = line.match(new RegExp(`^\\s*signal\\s+${signalName}\\b`));
				if (match) {
					const uri = vscode.Uri.file(fsPath);
					const position = new vscode.Position(i, line.indexOf(signalName));
					const range = new vscode.Range(position, position.translate(0, signalName.length));
					return new vscode.Location(uri, range);
				}
			}
		} catch (error) {
			console.error(`[Dialogue] ❌ 查找信号定义失败:`, error);
		}
		return undefined;
	}

	/** 将 res:// 路径转换为文件系统路径 */
	private resPathToFsPath(resPath: string): string {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) return '';

		return path.join(
			workspaceFolder.uri.fsPath,
			resPath.replace('res://', '')
		);
	}
}

