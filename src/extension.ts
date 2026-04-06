import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { registerExportCommands } from './export_data';
import { ImportHoverProvider, ImportPathCompletionProvider } from './import_file';
import { TitleCompletionProvider, TitleDefinitionProvider, TitleHoverProvider, TitleManager } from './title_manager';
import { DialogueTagCompletionProvider, DialogueTagHoverProvider } from './dialogue_tag';

// ============ 类型定义 ============

/** Godot 全局类信息 */
interface GodotClass {
	name: string;           // 类名
	base: string;           // 基类
	path: string;           // 文件路径
	isTool: boolean;        // 是否是工具脚本
	methods: GodotMethod[]; // 方法列表
	properties: GodotProperty[]; // 属性列表
	signals: string[];      // 信号列表
}

/** 方法信息 */
interface GodotMethod {
	name: string;
	returnType: string;
	params: GodotMethodParam[];
	isStatic: boolean;
	docComment?: string;
}

/** 方法参数信息 */
interface GodotMethodParam {
	name: string;
	type: string;
	defaultValue?: string;  // 默认值（如果存在则为可选参数）
	fullText: string;       // 完整文本（如 "slot_id: int = 1"）
}

/** 属性信息 */
interface GodotProperty {
	name: string;
	type: string;
	isExported: boolean;
}

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

		// ✅ 匹配 @param 标签
		// 格式：@param name: Type 描述文字
		const paramMatch = trimmed.match(/^@param\s+(\w+)\s*:\s*(\w+)\s+(.+)$/);
		if (paramMatch) {
			const [, paramName, paramType, paramDesc] = paramMatch;
			params.push(`- \`${paramName}\` (${paramType}): ${paramDesc}`);
			continue;
		}

		// ✅ 匹配 @return 标签
		// 格式：@return Type 描述文字
		const returnMatch = trimmed.match(/^@return\s+(\w+)\s+(.+)$/);
		if (returnMatch) {
			const [, returnType, returnDesc] = returnMatch;
			returnInfo = `${returnType} - ${returnDesc}`;
			continue;
		}

		// ✅ 其他行视为描述
		if (trimmed && !trimmed.startsWith('@')) {
			description.push(trimmed);
		}
	}

	// ✅ 组装格式化后的文档
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
		console.log('[Dialogue] ✅ 工作区路径:', workspaceFolder.uri.fsPath);
	}

	const classCache = new GodotClassCache(workspaceFolder);
	const titleManager = new TitleManager(); // ✅ 新增

	classCache.initialize().then(() => {
		console.log('[Dialogue] ✅ 类缓存初始化完成');
	});

	// ============ 自动闭合 {{ }} ============
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document.languageId !== 'dialogue') return;

			// ✅ 只处理单个字符的插入
			if (event.contentChanges.length !== 1) return;

			const change = event.contentChanges[0];

			// ✅ 检测是否输入了第二个 {
			if (change.text === '{' && change.rangeLength === 0) {
				const beforePosition = change.range.start;
				const beforeChar = event.document.getText(
					new vscode.Range(
						beforePosition.translate(0, -1),
						beforePosition
					)
				);

				// ✅ 如果前一个字符是 {，自动添加 }}
				if (beforeChar === '{') {
					const editor = vscode.window.activeTextEditor;
					if (editor && editor.document === event.document) {
						const insertPosition = change.range.end.translate(0, 1);
						editor.edit(editBuilder => {
							editBuilder.insert(insertPosition, '}}');
						}).then(() => {
							// ✅ 将光标移动到 {{ 和 }} 之间
							const newPosition = insertPosition;
							editor.selection = new vscode.Selection(newPosition, newPosition);
						});
					}
				}
			}
		})
	);

	// ✅ 段落管理：监听文档变化
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
	// ✅ 扫描当前打开的所有 dialogue 文件
	vscode.workspace.textDocuments.forEach(doc => {
		if (doc.languageId === 'dialogue') {
			titleManager.scanDocument(doc);
		}
	});
	// ✅ 注册段落相关功能
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

	// ✅ 注册 Import 路径补全提供者（添加空格触发）
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			{ scheme: 'file', language: 'dialogue' },
			importCompletionProvider,
			' ', '"', '/'  // ✅ 关键修复：添加空格触发
		)
	);

	// ✅ 注册 Import 悬停提示
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			{ scheme: 'file', language: 'dialogue' },
			new ImportHoverProvider(workspaceFolder)
		)
	);

	// ✅ 监听文件系统变化
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

	// ============ Dialogue 标签功能 ============
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			{ scheme: 'file', language: 'dialogue' },
			new DialogueTagCompletionProvider(),
			'['  // 触发字符
		)
	);

	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			{ scheme: 'file', language: 'dialogue' },
			new DialogueTagHoverProvider()
		)
	);

	// ============ Godot 代码诊断 ============
	const diagnosticCollection = vscode.languages.createDiagnosticCollection('dialogue');
	context.subscriptions.push(diagnosticCollection);

	const diagnosticProvider = new GodotDiagnosticProvider(classCache, diagnosticCollection);

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
			new GodotCodeActionProvider(classCache, diagnosticCollection),
			{
				providedCodeActionKinds: [
					vscode.CodeActionKind.QuickFix,
					vscode.CodeActionKind.RefactorRewrite
				]
			}
		)
	);

	// ✅ 对当前打开的所有 dialogue 文件进行初始诊断
	vscode.workspace.textDocuments.forEach(doc => {
		if (doc.languageId === 'dialogue') {
			diagnosticProvider.updateDiagnostics(doc);
		}
	});

	// ============ Godot 类补全 ============
	// ✅ 修复：GodotCompletionProvider 只在特定上下文触发，避免与 Import 冲突
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			{ scheme: 'file', language: 'dialogue' },
			new GodotCompletionProvider(classCache),
			'.'  // ✅ 关键修复：只保留点号触发，移除空格
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
			if (event.affectsConfiguration('dialogue.diagnostics.globalClasses')) {
				console.log('[Dialogue] 🔄 配置已变更，重新构建全局成员索引');
				classCache.refreshGlobalMembers();

				// ✅ 重新诊断所有打开的 dialogue 文件
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

// ============ 类缓存管理器 ============

class GodotClassCache {
	private classes: Map<string, GodotClass> = new Map();
	private autoloads: Map<string, string> = new Map(); // 单例名 -> 文件路径
	private workspaceFolder?: vscode.WorkspaceFolder;

	private globalMembers: Map<string, { className: string; type: 'method' | 'property' | 'signal' }> = new Map();

	constructor(workspaceFolder?: vscode.WorkspaceFolder) {
		this.workspaceFolder = workspaceFolder;
	}

	async initialize(): Promise<void> {
		if (!this.workspaceFolder) {
			console.log('[Dialogue] ❌ 无工作区，跳过初始化');
			return;
		}

		console.log('[Dialogue] -------- 开始初始化类缓存 --------');

		// 1. 解析 global_script_class_cache.cfg
		await this.loadGlobalClasses();

		// 2. 解析 project.godot 获取 AutoLoad
		await this.loadAutoloads();

		this.buildGlobalMembersIndex();

		console.log('[Dialogue] ✅ 类缓存初始化完成');
		console.log('[Dialogue] 📊 全局类数量:', this.classes.size);
		console.log('[Dialogue] 📊 AutoLoad 数量:', this.autoloads.size);
		console.log('[Dialogue] 📊 全局成员数量:', this.globalMembers.size);
	}

	/**
	 * ✅ 新增：构建全局成员索引
	 * 从配置的全局类中提取所有公开成员
	 */
	private buildGlobalMembersIndex(): void {
		this.globalMembers.clear();
		// 获取配置的全局类列表
		const config = vscode.workspace.getConfiguration('dialogue');
		const globalClassNames: string[] = config.get('diagnostics.globalClasses', []);
		console.log('[Dialogue] 🌐 配置的全局类:', globalClassNames);
		for (const className of globalClassNames) {
			const cls = this.classes.get(className);
			if (!cls) {
				console.warn(`[Dialogue] ⚠️ 全局类未找到: ${className}`);
				continue;
			}
			// 索引方法
			for (const method of cls.methods) {
				if (method.name.startsWith('_')) continue; // 跳过私有方法
				if (this.globalMembers.has(method.name)) {
					console.warn(`[Dialogue] ⚠️ 成员名冲突: ${method.name} (在 ${className} 和 ${this.globalMembers.get(method.name)?.className})`);
				} else {
					this.globalMembers.set(method.name, { className, type: 'method' });
				}
			}
			// 索引属性
			for (const property of cls.properties) {
				if (property.name.startsWith('_')) continue;
				if (this.globalMembers.has(property.name)) {
					console.warn(`[Dialogue] ⚠️ 成员名冲突: ${property.name}`);
				} else {
					this.globalMembers.set(property.name, { className, type: 'property' });
				}
			}
			// 索引信号
			for (const signal of cls.signals) {
				if (signal.startsWith('_')) continue;
				if (this.globalMembers.has(signal)) {
					console.warn(`[Dialogue] ⚠️ 成员名冲突: ${signal}`);
				} else {
					this.globalMembers.set(signal, { className, type: 'signal' });
				}
			}
			console.log(`[Dialogue] 📦 已索引全局类: ${className}`);
		}
	}

	/**
	 * ✅ 新增：刷新全局成员索引（配置变更时调用）
	 */
	refreshGlobalMembers(): void {
		console.log('[Dialogue] 🔄 重新构建全局成员索引');
		this.buildGlobalMembersIndex();
	}

	/**
	 * ✅ 新增：根据成员名查找所属的全局类
	 */
	resolveGlobalMember(memberName: string): { className: string; type: 'method' | 'property' | 'signal' } | undefined {
		return this.globalMembers.get(memberName);
	}

	/**
	 * ✅ 新增：获取所有全局成员（用于补全）
	 */
	getGlobalMembers(): Array<{ name: string; className: string; type: 'method' | 'property' | 'signal' }> {
		const members: Array<{ name: string; className: string; type: 'method' | 'property' | 'signal' }> = [];

		for (const [name, info] of this.globalMembers.entries()) {
			members.push({ name, ...info });
		}
		return members;
	}

	/** 加载全局类 */
	private async loadGlobalClasses(): Promise<void> {
		const cachePath = path.join(
			this.workspaceFolder!.uri.fsPath,
			'.godot',
			'global_script_class_cache.cfg'
		);

		if (!fs.existsSync(cachePath)) {
			console.log('[Dialogue] ⚠️ 全局类缓存文件不存在');
			return;
		}

		const content = fs.readFileSync(cachePath, 'utf-8');
		const listMatch = content.match(/list\s*=\s*(\[[\s\S]*\])/);
		if (!listMatch) return;

		let arrayContent = listMatch[1].replace(/&"([^"]+)"/g, '"$1"');
		const classes = JSON.parse(arrayContent);

		for (const cls of classes) {
			const className = cls.class;
			const gdPath = this.resPathToFsPath(cls.path);

			const classInfo: GodotClass = {
				name: className,
				base: cls.base,
				path: cls.path,
				isTool: cls.is_tool,
				methods: [],
				properties: [],
				signals: [],
			};

			// 解析 GDScript 文件
			if (fs.existsSync(gdPath)) {
				this.parseGDScriptFile(gdPath, classInfo);
			}

			this.classes.set(className, classInfo);
			console.log(`[Dialogue] 📦 加载类: ${className} (${classInfo.methods.length} 方法, ${classInfo.properties.length} 属性)`);
		}
	}

	/** 加载 AutoLoad 单例 */
	private async loadAutoloads(): Promise<void> {
		const projectPath = path.join(this.workspaceFolder!.uri.fsPath, 'project.godot');

		if (!fs.existsSync(projectPath)) {
			console.log('[Dialogue] ⚠️ project.godot 不存在');
			return;
		}

		const content = fs.readFileSync(projectPath, 'utf-8');

		// 匹配 AutoLoad 配置
		// 格式: AudioManager="*res://scene/common/audio_manager/audio_manager.gd"
		const autoloadRegex = /^(\w+)="\*?(res:\/\/[^"]+)"$/gm;
		let match;

		while ((match = autoloadRegex.exec(content)) !== null) {
			const singletonName = match[1];
			const resPath = match[2];
			const fsPath = this.resPathToFsPath(resPath);

			this.autoloads.set(singletonName, resPath);
			console.log(`[Dialogue] 🌐 AutoLoad: ${singletonName} -> ${resPath}`);

			// 如果不在全局类中，也加入缓存
			if (!this.classes.has(singletonName) && fs.existsSync(fsPath)) {
				const classInfo: GodotClass = {
					name: singletonName,
					base: 'Node', // 默认基类
					path: resPath,
					isTool: false,
					methods: [],
					properties: [],
					signals: [],
				};

				this.parseGDScriptFile(fsPath, classInfo);
				this.classes.set(singletonName, classInfo);
			}
		}
	}

	/** 解析 GDScript 文件内容 */
	private parseGDScriptFile(fsPath: string, classInfo: GodotClass): void {
		try {
			const content = fs.readFileSync(fsPath, 'utf-8');
			const lines = content.split('\n');

			let pendingDocComment: string | undefined;

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const trimmedLine = line.trim();

				// 收集连续的 ## 注释
				if (trimmedLine.startsWith('##')) {
					const commentText = trimmedLine.substring(2).trim();
					if (pendingDocComment) {
						pendingDocComment += '\n' + commentText;
					} else {
						pendingDocComment = commentText;
					}
					continue;
				}

				// 匹配函数: func xxx() -> Type:
				const funcMatch = line.match(/^\s*(?:static\s+)?func\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\w+))?/);
				if (funcMatch) {
					const params = this.parseMethodParams(funcMatch[2]);  // ✅ 新方法

					classInfo.methods.push({
						name: funcMatch[1],
						returnType: funcMatch[3] || 'void',
						params: params,
						isStatic: line.includes('static'),
						docComment: pendingDocComment,
					});
					pendingDocComment = undefined;
					continue;
				}

				// ... 其他代码保持不变 ...
			}
		} catch (error) {
			console.error(`[Dialogue] ❌ 解析文件失败: ${fsPath}`, error);
		}
	}

	/**
	 * 解析方法参数
	 * 输入示例: "slot_id: int, amount: float = 0.0, force: bool = false"
	 * 输出: [
	 *   { name: "slot_id", type: "int", fullText: "slot_id: int" },
	 *   { name: "amount", type: "float", defaultValue: "0.0", fullText: "amount: float = 0.0" },
	 *   { name: "force", type: "bool", defaultValue: "false", fullText: "force: bool = false" }
	 * ]
	 */
	private parseMethodParams(paramsString: string): GodotMethodParam[] {
		if (!paramsString.trim()) return [];

		const params: GodotMethodParam[] = [];
		const paramList = paramsString.split(',');

		for (const param of paramList) {
			const trimmed = param.trim();
			if (!trimmed) continue;

			// ✅ 匹配格式：name: Type = default_value
			const match = trimmed.match(/^(\w+)\s*:\s*(\w+)(?:\s*=\s*(.+))?$/);

			if (match) {
				params.push({
					name: match[1],
					type: match[2],
					defaultValue: match[3]?.trim(),
					fullText: trimmed
				});
			} else {
				// 降级处理：无法解析的参数
				params.push({
					name: trimmed,
					type: 'Variant',
					fullText: trimmed
				});
			}
		}

		return params;
	}

	/** 将 res:// 路径转换为文件系统路径 */
	private resPathToFsPath(resPath: string): string {
		return path.join(
			this.workspaceFolder!.uri.fsPath,
			resPath.replace('res://', '')
		);
	}

	/** 获取所有类 */
	getClasses(): GodotClass[] {
		return Array.from(this.classes.values());
	}

	/** 根据名称获取类 */
	getClass(name: string): GodotClass | undefined {
		console.log(`[Dialogue] 🔍 查找类: ${name}`);
		const cls = this.classes.get(name);

		if (cls) {
			console.log(`[Dialogue] ✅ 找到: ${cls.name} (${cls.methods.length} 方法, ${cls.properties.length} 属性)`);
		} else {
			console.log(`[Dialogue] ❌ 未找到`);
			console.log(`[Dialogue] 📋 可用类: ${Array.from(this.classes.keys()).join(', ')}`);
		}

		return cls;
	}

	/** 检查是否是 AutoLoad 单例 */
	isAutoload(name: string): boolean {
		return this.autoloads.has(name);
	}
}

// ============ 补全提供者 ============

class GodotCompletionProvider implements vscode.CompletionItemProvider {
	constructor(private classCache: GodotClassCache) { }

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
		context: vscode.CompletionContext  // ✅ 添加 context 参数
	): Promise<vscode.CompletionItem[]> {
		console.log('[Dialogue] ========== 补全被触发 ==========');

		const line = document.lineAt(position.line).text;
		const beforeCursor = line.substring(0, position.character);

		console.log('[Dialogue] 📝 当前行:', line);
		console.log('[Dialogue] 📝 光标前内容:', beforeCursor);

		// ✅ 检测是否在 import 语句中（如果是，交给 ImportCompletionProvider 处理）
		if (/^\s*import\b/.test(beforeCursor)) {
			console.log('[Dialogue] ⚠️ 在 import 语句中，跳过 Godot 补全');
			return [];
		}
		// ✅ **新增：检测是否在 goto 语句中（=> 或 - xxx =>）**
		if (/(?:^|\s)(?:=>|=)\s*[^\s]*$/.test(beforeCursor)) {
			console.log('[Dialogue] ⚠️ 在 goto 语句中，跳过 Godot 补全');
			return [];
		}
		// ✅ **新增：检测是否在标题声明中（~ xxx）**
		if (/^\s*~\s+/.test(beforeCursor)) {
			console.log('[Dialogue] ⚠️ 在标题声明中，跳过 Godot 补全');
			return [];
		}
		// ✅ **新增：检测是否在选项中（- xxx）**
		if (/^\s*-\s+[^=>]*$/.test(beforeCursor)) {
			console.log('[Dialogue] ⚠️ 在选项文本中，跳过 Godot 补全');
			return [];
		}

		// ✅ **新增：检测是否在角色对话中（角色: 对话内容）**
		// 匹配：Nathan: 你好
		// 不匹配：do Nathan.method()
		if (/^\s*\w+:\s+[^[{]*$/.test(beforeCursor) && !/^\s*(?:do!?|set|if|elif|while|match|when)\s+/.test(beforeCursor)) {
			console.log('[Dialogue] ⚠️ 在对话文本中，跳过 Godot 补全');
			return [];
		}

		// ✅ **新增：检测是否在旁白中（非代码区域的纯文本）**
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

		// ✅ 优先检查成员访问（类名.）
		const memberAccessMatch = beforeCursor.match(/(\w+)\.(\w*)$/);
		if (memberAccessMatch) {
			const className = memberAccessMatch[1];
			return this.getClassMembers(className);
		}

		// ✅ 然后检查是否在代码区域（需要手动触发）
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
			// ✅ 如果用户手动触发（Ctrl+Space），也显示补全
			if (context.triggerKind === vscode.CompletionTriggerKind.Invoke) {
				console.log('[Dialogue] 💡 用户手动触发补全');
				return [...this.getAllClasses(), ...this.getGlobalMembersCompletions()];
			}

			console.log('[Dialogue] ⚠️ 不在代码区域，跳过补全');
			return [];
		}

		console.log('[Dialogue] ✅ 在代码区域，返回所有类');

		return [...this.getAllClasses(), ...this.getGlobalMembersCompletions()];
	}

	/**
	 * ✅ 新增：获取全局成员的补全项
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

	/** 获取所有类的补全项 */
	private getAllClasses(): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];

		for (const cls of this.classCache.getClasses()) {
			const item = new vscode.CompletionItem(cls.name, vscode.CompletionItemKind.Class);
			item.detail = `extends ${cls.base}`;

			const docs: string[] = [
				`**Base Class:** ${cls.base}`,
				`**Path:** \`${cls.path}\``,
			];

			if (this.classCache.isAutoload(cls.name)) {
				docs.push('\n🌐 **AutoLoad Singleton**');
			}

			// ✅ 添加方法和属性概览
			if (cls.methods.length > 0) {
				const publicMethods = cls.methods.filter(m => !m.name.startsWith('_'));
				if (publicMethods.length > 0) {
					docs.push(`\n**Methods:** ${publicMethods.length} public methods`);
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

		console.log(`[Dialogue] ✅ 找到类: ${className}`);
		console.log(`[Dialogue] 📊 方法数量: ${cls.methods.length}`);
		console.log(`[Dialogue] 📊 属性数量: ${cls.properties.length}`);

		const items: vscode.CompletionItem[] = [];

		// ✅ 添加方法（过滤下划线开头）
		for (const method of cls.methods) {
			if (method.name.startsWith('_')) {
				console.log(`[Dialogue] ⏭️ 跳过私有方法: ${method.name}`);
				continue;
			}

			console.log(`[Dialogue] 📦 添加方法: ${method.name}`);

			const item = new vscode.CompletionItem(method.name, vscode.CompletionItemKind.Method);

			// ✅ 修复：正确拼接参数
			const paramTexts = method.params.map(p => p.fullText).join(', ');
			item.detail = `${method.returnType} ${className}.${method.name}(${paramTexts})`;

			item.insertText = new vscode.SnippetString(`${method.name}($0)`);

			const docs: string[] = [];

			// ✅ 格式化文档注释
			if (method.docComment) {
				docs.push(formatGodotDocComment(method.docComment));
				docs.push('');
				docs.push('---');
			}

			// ✅ 修复：显示参数信息
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

// ============ 悬停提示提供者 ============

class GodotHoverProvider implements vscode.HoverProvider {
	constructor(private classCache: GodotClassCache) { }

	async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position
	): Promise<vscode.Hover | undefined> {
		console.log('[Dialogue] ========== 悬停提示被触发 ==========');

		const line = document.lineAt(position.line).text;

		// ✅ 先获取光标位置的单词
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) return undefined;

		const word = document.getText(wordRange);
		console.log(`[Dialogue] 🔍 光标下的单词: ${word}`);

		// ✅ 检测成员访问：向前查找最近的点号
		const beforeWord = line.substring(0, wordRange.start.character);
		const dotIndex = beforeWord.lastIndexOf('.');

		if (dotIndex !== -1) {
			// 提取类名（点号之前的单词）
			const beforeDot = beforeWord.substring(0, dotIndex);
			const classNameMatch = beforeDot.match(/(\w+)$/);

			if (classNameMatch) {
				const className = classNameMatch[1];
				console.log(`[Dialogue] 🔍 检测到成员访问: ${className}.${word}`);

				return this.getMemberHover(className, word);
			}
		}

		const globalMember = this.classCache.resolveGlobalMember(word);

		if (globalMember) {
			console.log(`[Dialogue] 🌐 找到全局成员: ${word} (来自 ${globalMember.className})`);
			return this.getMemberHover(globalMember.className, word);
		}

		// ✅ 检测单独的类名
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
			`**Extends:** \`${cls.base}\``,
			`**Path:** \`${cls.path}\``,
		];

		if (this.classCache.isAutoload(className)) {
			docs.push('\n🌐 **Global Singleton (AutoLoad)**');
		}

		// ✅ 移除方法和属性列表（根据你的要求 2）

		return new vscode.Hover(new vscode.MarkdownString(docs.join('\n')));
	}

	/** 获取成员（方法/属性）的悬停信息 */
	private getMemberHover(className: string, memberName: string): vscode.Hover | undefined {
		const cls = this.classCache.getClass(className);
		if (!cls) return undefined;

		// ✅ 如果是私有成员，不显示提示
		if (memberName.startsWith('_')) {
			console.log(`[Dialogue] ⏭️ 私有成员不显示悬停: ${memberName}`);
			return undefined;
		}

		// ✅ 查找方法
		const method = cls.methods.find(m => m.name === memberName);
		if (method) {
			const docs: string[] = [];

			// 添加函数签名
			docs.push('```gdscript');
			const paramTexts = method.params.map(p => p.fullText).join(', ');
			docs.push(`func ${method.name}(${paramTexts}) -> ${method.returnType}`);
			docs.push('```');

			// ✅ 格式化并添加文档注释
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

		// ✅ 查找属性
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

		// ✅ 查找信号
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

		// ✅ 先查找完整的函数调用（ClassName.method()）
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

		// ✅ 新增：检查全局方法调用（method()）
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
	 * ✅ 新增：创建签名帮助（提取公共逻辑）
	 */
	private createSignatureHelp(method: GodotMethod, paramsText: string): vscode.SignatureHelp {
		console.log(`[Dialogue] ✅ 找到方法: ${method.name}`);
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

		console.log(`[Dialogue] ✅ 返回签名提示`);

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

		// ✅ 获取光标位置的单词
		const range = document.getWordRangeAtPosition(position);
		if (!range) {
			console.log('[Dialogue] ❌ 无法获取光标位置的单词');
			return undefined;
		}

		const word = document.getText(range);
		console.log('[Dialogue] 🔍 光标位置的单词:', word);
		console.log('[Dialogue] 🔍 单词范围:', `[${range.start.character}, ${range.end.character}]`);

		// ✅ 改进的成员访问检测：向前查找完整的调用链
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

				// 检查光标是否在类名上
				const classNameStart = beforeDot - className.length;
				const classNameEnd = beforeDot;

				if (position.character >= classNameStart && position.character <= classNameEnd) {
					console.log(`[Dialogue] ✅ 光标在类名上: ${className}`);
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
							console.log(`[Dialogue] ✅ 光标在成员名上: ${className}.${memberName}`);
							return this.getMemberDefinition(className, memberName);
						}
					}
				}
			}
		}

		// ✅ 检测单独的类名
		console.log(`[Dialogue] 🔍 检测单独的类名: ${word}`);

		// ✅ 新增：检查是否是全局成员
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

		// ✅ 检测单独的类名
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

		console.log('[Dialogue] ✅ 在代码区域，尝试跳转到类定义');
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

		console.log(`[Dialogue] ✅ 跳转到类定义: ${fsPath}`);
		return location;
	}

	/** 获取成员（方法/属性）的定义位置 */
	private getMemberDefinition(className: string, memberName: string): vscode.Definition | undefined {
		const cls = this.classCache.getClass(className);
		if (!cls) return undefined;

		// ✅ 如果是私有成员，不跳转
		if (memberName.startsWith('_')) {
			console.log(`[Dialogue] ⏭️ 私有成员不支持跳转: ${memberName}`);
			return undefined;
		}

		const fsPath = this.resPathToFsPath(cls.path);
		if (!fs.existsSync(fsPath)) return undefined;

		// 查找方法定义
		const method = cls.methods.find(m => m.name === memberName);
		if (method) {
			console.log(`[Dialogue] ✅ 跳转到方法: ${memberName}`);
			return this.findMethodLine(fsPath, memberName);
		}

		// 查找属性定义
		const property = cls.properties.find(p => p.name === memberName);
		if (property) {
			console.log(`[Dialogue] ✅ 跳转到属性: ${memberName}`);
			return this.findPropertyLine(fsPath, memberName);
		}

		// 查找信号定义
		const signal = cls.signals.find(s => s === memberName);
		if (signal) {
			console.log(`[Dialogue] ✅ 跳转到信号: ${memberName}`);
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


// ============ 诊断提供者 ============

/**
 * Godot 代码诊断提供者
 * 负责检查类型错误、方法调用错误等
 */
class GodotDiagnosticProvider {
	private throttleTimer: NodeJS.Timeout | null = null;

	constructor(
		private classCache: GodotClassCache,
		private diagnosticCollection: vscode.DiagnosticCollection
	) { }

	/**
	 * 更新文档的诊断信息（防抖处理）
	 */
	updateDiagnostics(document: vscode.TextDocument): void {
		// ✅ 防抖：500ms 内只执行一次
		if (this.throttleTimer) {
			clearTimeout(this.throttleTimer);
		}

		this.throttleTimer = setTimeout(() => {
			this.performDiagnostics(document);
		}, 500);
	}

	/**
 * 推断变量的类型
 * 
 * 策略：
 * 1. 查找文档中的 set 语句（set player = PlayerState.new()）
 * 2. 查找 Dialogue Manager 的内置变量（可选）
 * 3. 返回 undefined 表示无法推断
 */
	private inferVariableType(
		variableName: string,
		document: vscode.TextDocument,
		currentLine: number
	): string | undefined {
		console.log(`[Dialogue] 🔍 尝试推断变量类型: ${variableName}`);

		const text = document.getText();
		const lines = text.split('\n');

		// ✅ 策略 1：查找 set 语句
		// 格式：set player = PlayerState.new()
		//      set player = SomeClass.get_instance()
		for (let i = 0; i <= currentLine; i++) {
			const line = lines[i];

			// 匹配: set variableName = ClassName.xxx
			const setMatch = line.match(new RegExp(`^\\s*set\\s+${variableName}\\s*=\\s*(\\w+)\\.`));
			if (setMatch) {
				const className = setMatch[1];
				console.log(`[Dialogue] ✅ 从 set 语句推断: ${variableName} -> ${className}`);
				return className;
			}

			// 匹配: set variableName = ClassName()
			const constructorMatch = line.match(new RegExp(`^\\s*set\\s+${variableName}\\s*=\\s*(\\w+)\\s*\\(`));
			if (constructorMatch) {
				const className = constructorMatch[1];
				console.log(`[Dialogue] ✅ 从构造函数推断: ${variableName} -> ${className}`);
				return className;
			}
		}

		// ✅ 策略 2：Dialogue Manager 内置变量
		const builtInVariables: { [key: string]: string } = {
			'dialogue_manager': 'DialogueManager',
			'player': 'CharacterBody2D',  // 根据你的项目调整
			'game': 'Game',
			// 添加更多内置变量...
		};

		if (builtInVariables[variableName]) {
			console.log(`[Dialogue] ✅ 从内置变量推断: ${variableName} -> ${builtInVariables[variableName]}`);
			return builtInVariables[variableName];
		}

		// ✅ 策略 3：检查是否是 AutoLoad 单例（小写形式）
		// 例如：player_state 可能对应 PlayerState
		const pascalCase = variableName
			.split('_')
			.map(word => word.charAt(0).toUpperCase() + word.slice(1))
			.join('');

		if (this.classCache.isAutoload(pascalCase)) {
			console.log(`[Dialogue] ✅ 从 AutoLoad 推断: ${variableName} -> ${pascalCase}`);
			return pascalCase;
		}

		console.log(`[Dialogue] ❌ 无法推断变量类型: ${variableName}`);
		return undefined;
	}

	/**
	 * 执行实际的诊断
	 */
	private performDiagnostics(document: vscode.TextDocument): void {
		console.log('[Dialogue] ========== 开始诊断 ==========');

		const diagnostics: vscode.Diagnostic[] = [];
		const text = document.getText();
		const lines = text.split('\n');

		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			const line = lines[lineIndex];

			// ✅ 检查代码区域
			const codePatterns = [
				/^\s*(while|match|when|do!?)\s+(.+)$/,              // while/do 语句
				/\[do!?\s+[^\]]+\]/g,
				/\{\{(.+?)\}\}/g,                 // {{ }} 插值
				/^\s*set\s+(.+)$/,               // set 语句
				/\[set\s+[^\]]+\]/g,
				/^\s*(?:if|elif)\s+(.+)$/,       // if/elif 条件
				/\[(?:if|elif)\s+([^\]]+)\]/g,   // 行内条件
			];

			for (const pattern of codePatterns) {
				let match;
				const regex = new RegExp(pattern);

				while ((match = regex.exec(line)) !== null) {
					const codeContent = match[1] || match[0].replace(/^\[(?:do!?|set|if|elif)\s+/, '').replace(/\]$/, '');
					const startIndex = match.index + match[0].indexOf(codeContent);

					// ✅ 分析代码内容
					this.analyzeCode(
						codeContent,
						document,
						lineIndex,
						startIndex,
						diagnostics
					);

					// 如果不是全局正则，只匹配一次
					if (!pattern.global) break;
				}
			}
		}

		console.log(`[Dialogue] 📊 发现 ${diagnostics.length} 个问题`);
		this.diagnosticCollection.set(document.uri, diagnostics);
	}

	/**
	 * 分析代码片段
	 */
	/**
 * 分析代码片段
 */
	/**
 * 分析代码片段
 */
	private analyzeCode(
		code: string,
		document: vscode.TextDocument,
		lineIndex: number,
		startColumn: number,
		diagnostics: vscode.Diagnostic[]
	): void {
		// ✅ 记录已经检查过的方法调用位置，避免重复检查
		const checkedRanges = new Set<string>();

		// ============ 第一步：检查方法调用 ============
		const functionCallRegex = /(\w+)\.(\w+)\s*\(([^)]*)\)/g;
		let match;

		while ((match = functionCallRegex.exec(code)) !== null) {
			const identifier = match[1];
			const methodName = match[2];
			const argsString = match[3].trim();
			const matchStart = match.index;
			const matchEnd = match.index + match[0].length;

			// ✅ 记录这个范围
			checkedRanges.add(`${matchStart}-${matchEnd}`);

			console.log(`[Dialogue] 🔍 检查调用: ${identifier}.${methodName}(${argsString})`);

			// 判断是类还是变量
			const isClassName = /^[A-Z]/.test(identifier);
			const isVariable = /^[a-z_]/.test(identifier);

			if (isClassName) {
				// ============ 类名：严格检查 ============
				const cls = this.classCache.getClass(identifier);

				if (!cls) {
					// ❌ 类不存在
					const range = new vscode.Range(
						lineIndex,
						startColumn + matchStart,
						lineIndex,
						startColumn + matchStart + identifier.length
					);

					diagnostics.push(
						this.createDiagnostic(
							range,
							`未找到类 '${identifier}'`,
							vscode.DiagnosticSeverity.Error
						)
					);
					continue;
				}

				// 检查方法是否存在
				const method = cls.methods.find(m => m.name === methodName);
				if (!method) {
					const methodStart = matchStart + identifier.length + 1;
					const range = new vscode.Range(
						lineIndex,
						startColumn + methodStart,
						lineIndex,
						startColumn + methodStart + methodName.length
					);

					diagnostics.push(
						this.createDiagnostic(
							range,
							`类 '${identifier}' 中不存在方法 '${methodName}'`,
							vscode.DiagnosticSeverity.Error
						)
					);
					continue;
				}

				// ✅ 检查参数
				this.validateMethodArguments(
					method,
					identifier,
					methodName,
					argsString,
					document,
					lineIndex,
					startColumn + matchStart,
					diagnostics
				);

			} else if (isVariable) {
				// ============ 变量：宽松检查 ============
				console.log(`[Dialogue] 💡 '${identifier}' 被识别为变量，跳过类检查`);

				// ✅ 尝试推断变量类型
				const inferredType = this.inferVariableType(identifier, document, lineIndex);

				if (inferredType) {
					console.log(`[Dialogue] 🔍 推断类型: ${identifier} -> ${inferredType}`);

					const cls = this.classCache.getClass(inferredType);
					if (cls) {
						const method = cls.methods.find(m => m.name === methodName);
						if (!method) {
							const methodStart = matchStart + identifier.length + 1;
							const range = new vscode.Range(
								lineIndex,
								startColumn + methodStart,
								lineIndex,
								startColumn + methodStart + methodName.length
							);

							diagnostics.push(
								this.createDiagnostic(
									range,
									`类型 '${inferredType}' 中可能不存在方法 '${methodName}'`,
									vscode.DiagnosticSeverity.Warning
								)
							);
							continue;
						}

						// 检查参数
						this.validateMethodArguments(
							method,
							inferredType,
							methodName,
							argsString,
							document,
							lineIndex,
							startColumn + matchStart,
							diagnostics
						);
					}
				} else {
					console.log(`[Dialogue] 💭 无法推断变量 '${identifier}' 的类型，跳过检查`);
				}
			}
		}

		const globalFunctionCallRegex = /\b(\w+)\s*\(([^)]*)\)/g;

		while ((match = globalFunctionCallRegex.exec(code)) !== null) {
			const methodName = match[1];
			const argsString = match[2].trim();
			const matchStart = match.index;
			const matchEnd = match.index + match[0].length;

			// 跳过已经检查过的范围
			let isAlreadyChecked = false;
			for (const range of checkedRanges) {
				const [start, end] = range.split('-').map(Number);
				if (matchStart >= start && matchEnd <= end) {
					isAlreadyChecked = true;
					break;
				}
			}
			if (isAlreadyChecked) continue;

			// 检查是否是全局成员
			const globalMember = this.classCache.resolveGlobalMember(methodName);

			if (globalMember && globalMember.type === 'method') {
				console.log(`[Dialogue] 🌐 检测到全局方法调用: ${methodName} (来自 ${globalMember.className})`);

				const cls = this.classCache.getClass(globalMember.className);
				if (cls) {
					const method = cls.methods.find(m => m.name === methodName);
					if (method) {
						// 验证参数
						this.validateMethodArguments(
							method,
							globalMember.className,
							methodName,
							argsString,
							document,
							lineIndex,
							startColumn + matchStart,
							diagnostics
						);
					}
				}

				checkedRanges.add(`${matchStart}-${matchEnd}`);
			}
		}

		// ============ 第二步：检查属性访问 ============
		const propertyAccessRegex = /(\w+)\.(\w+)/g;

		while ((match = propertyAccessRegex.exec(code)) !== null) {
			const identifier = match[1];
			const memberName = match[2];
			const matchStart = match.index;
			const matchEnd = match.index + match[0].length;

			// ✅ 检查这个位置是否已经被方法调用检查过
			let isAlreadyChecked = false;
			for (const range of checkedRanges) {
				const [start, end] = range.split('-').map(Number);
				// 如果当前匹配在已检查范围内，跳过
				if (matchStart >= start && matchEnd <= end) {
					isAlreadyChecked = true;
					break;
				}
			}

			if (isAlreadyChecked) {
				console.log(`[Dialogue] ⏭️ 跳过已检查的方法调用: ${identifier}.${memberName}`);
				continue;
			}

			// ✅ 检查后面是否紧跟括号（双重保险）
			const nextChar = code[matchEnd];
			if (nextChar === '(') {
				console.log(`[Dialogue] ⏭️ 跳过方法调用（检测到括号）: ${identifier}.${memberName}`);
				continue;
			}

			// 只检查大写开头的类名
			if (!/^[A-Z]/.test(identifier)) {
				console.log(`[Dialogue] 💡 '${identifier}' 被识别为变量，跳过属性检查`);
				continue;
			}

			const cls = this.classCache.getClass(identifier);
			if (!cls) continue;

			const property = cls.properties.find(p => p.name === memberName);
			const method = cls.methods.find(m => m.name === memberName);
			const signal = cls.signals.find(s => s === memberName);

			if (!property && !method && !signal) {
				const memberStart = matchStart + identifier.length + 1;
				const range = new vscode.Range(
					lineIndex,
					startColumn + memberStart,
					lineIndex,
					startColumn + memberStart + memberName.length
				);

				diagnostics.push(
					this.createDiagnostic(
						range,
						`类 '${identifier}' 中不存在成员 '${memberName}'`,
						vscode.DiagnosticSeverity.Error
					)
				);
			}
		}
	}

	/**
	 * 验证方法参数
	 */
	private validateMethodArguments(
		method: GodotMethod,
		className: string,
		methodName: string,
		argsString: string,
		document: vscode.TextDocument,
		lineIndex: number,
		startColumn: number,
		diagnostics: vscode.Diagnostic[]
	): void {
		const actualArgs = this.parseArguments(argsString);
		const expectedParams = method.params;

		// ✅ 计算必需参数和可选参数数量
		const requiredParamsCount = expectedParams.filter(p => !p.defaultValue).length;
		const totalParamsCount = expectedParams.length;

		console.log(`[Dialogue] 📋 必需参数: ${requiredParamsCount}, 可选参数: ${totalParamsCount - requiredParamsCount}, 实际传入: ${actualArgs.length}`);

		// ✅ 检查参数数量
		if (actualArgs.length < requiredParamsCount || actualArgs.length > totalParamsCount) {
			const argsStart = startColumn + className.length + 1 + methodName.length + 1;
			const argsEnd = argsStart + argsString.length;

			const range = new vscode.Range(lineIndex, argsStart, lineIndex, argsEnd);

			// ✅ 修复：正确显示期望的签名
			const expectedSignature = expectedParams.map(p => p.fullText).join(', ');

			diagnostics.push(
				this.createDiagnostic(
					range,
					`方法 '${className}.${methodName}' 需要 ${requiredParamsCount}${totalParamsCount > requiredParamsCount ? `-${totalParamsCount}` : ''} 个参数，但传入了 ${actualArgs.length} 个`,
					vscode.DiagnosticSeverity.Error,
					`期望: ${methodName}(${expectedSignature})`
				)
			);
			return;
		}

		// ✅ 检查每个参数的类型
		for (let i = 0; i < actualArgs.length; i++) {
			const actualArg = actualArgs[i];
			const expectedParam = expectedParams[i];

			const expectedType = expectedParam.type;
			const actualType = this.inferType(actualArg.value);

			console.log(`[Dialogue] 🔍 参数 ${i + 1}: 期望 ${expectedType}, 实际 ${actualType}`);

			if (!this.isTypeCompatible(actualType, expectedType)) {
				const argStart = startColumn + actualArg.startIndex;
				const argEnd = argStart + actualArg.value.length;

				const range = new vscode.Range(lineIndex, argStart, lineIndex, argEnd);

				diagnostics.push(
					this.createDiagnostic(
						range,
						`参数类型不匹配：期望 '${expectedType}'，实际 '${actualType}'`,
						vscode.DiagnosticSeverity.Warning,
						`参数 '${expectedParam.name}' 应该是 ${expectedType} 类型`
					)
				);
			}
		}
	}

	/**
	 * 解析方法参数
	 */
	private parseArguments(argsString: string): Array<{ value: string; startIndex: number }> {
		if (!argsString.trim()) return [];

		const args: Array<{ value: string; startIndex: number }> = [];
		let currentArg = '';
		let startIndex = 0;
		let depth = 0; // 括号深度

		for (let i = 0; i < argsString.length; i++) {
			const char = argsString[i];

			if (char === '(') {
				depth++;
				currentArg += char;
			} else if (char === ')') {
				depth--;
				currentArg += char;
			} else if (char === ',' && depth === 0) {
				// 遇到顶层逗号，分割参数
				args.push({
					value: currentArg.trim(),
					startIndex: startIndex
				});
				currentArg = '';
				startIndex = i + 1;
			} else {
				currentArg += char;
			}
		}

		// 添加最后一个参数
		if (currentArg.trim()) {
			args.push({
				value: currentArg.trim(),
				startIndex: startIndex
			});
		}

		return args;
	}

	/**
	 * 推断表达式的类型
	 */
	private inferType(expr: string): string {
		expr = expr.trim();

		// 字符串字面量
		if (/^["'].*["']$/.test(expr)) {
			return 'String';
		}

		// 数字字面量
		if (/^\d+$/.test(expr)) {
			return 'int';
		}

		if (/^\d+\.\d+$/.test(expr)) {
			return 'float';
		}

		// 布尔字面量
		if (expr === 'true' || expr === 'false') {
			return 'bool';
		}

		// 数组字面量
		if (/^\[.*\]$/.test(expr)) {
			return 'Array';
		}

		// 字典字面量
		if (/^\{.*\}$/.test(expr)) {
			return 'Dictionary';
		}

		// 属性访问：ClassName.property
		const propAccessMatch = expr.match(/^(\w+)\.(\w+)$/);
		if (propAccessMatch) {
			const className = propAccessMatch[1];
			const propertyName = propAccessMatch[2];

			const cls = this.classCache.getClass(className);
			if (cls) {
				const prop = cls.properties.find(p => p.name === propertyName);
				if (prop) {
					return prop.type;
				}
			}
		}

		// 方法调用：ClassName.method()
		const methodCallMatch = expr.match(/^(\w+)\.(\w+)\s*\([^)]*\)$/);
		if (methodCallMatch) {
			const className = methodCallMatch[1];
			const methodName = methodCallMatch[2];

			const cls = this.classCache.getClass(className);
			if (cls) {
				const method = cls.methods.find(m => m.name === methodName);
				if (method) {
					return method.returnType;
				}
			}
		}

		// 默认：未知类型
		return 'Variant';
	}

	/**
	 * 检查类型兼容性
	 */
	/**
	 * 检查类型兼容性（支持继承）
	 */
	private isTypeCompatible(actualType: string, expectedType: string): boolean {
		if (actualType === expectedType) return true;
		if (expectedType === 'Variant') return true;

		// ✅ 检查继承关系
		const actualClass = this.classCache.getClass(actualType);
		if (actualClass) {
			let currentBase = actualClass.base;
			while (currentBase) {
				if (currentBase === expectedType) return true;

				const baseClass = this.classCache.getClass(currentBase);
				if (!baseClass) break;
				currentBase = baseClass.base;
			}
		}

		// 数字兼容性
		if (expectedType === 'float' && actualType === 'int') return true;

		return false;
	}

	/**
	 * 创建诊断信息
	 */
	private createDiagnostic(
		range: vscode.Range,
		message: string,
		severity: vscode.DiagnosticSeverity,
		detail?: string
	): vscode.Diagnostic {
		const diagnostic = new vscode.Diagnostic(range, message, severity);
		diagnostic.source = 'Godot Dialogue';

		// ✅ 为不同严重性设置不同的标签
		switch (severity) {
			case vscode.DiagnosticSeverity.Error:
				diagnostic.code = 'type-error';
				break;
			case vscode.DiagnosticSeverity.Warning:
				diagnostic.code = 'type-warning';
				break;
			case vscode.DiagnosticSeverity.Information:
				diagnostic.code = 'type-info';
				break;
		}

		if (detail) {
			diagnostic.relatedInformation = [
				new vscode.DiagnosticRelatedInformation(
					new vscode.Location(
						vscode.Uri.file(''),
						range
					),
					detail
				)
			];
		}

		return diagnostic;
	}
}


// ============ 快速修复提供者 ============

/**
 * Godot 代码快速修复提供者
 */
class GodotCodeActionProvider implements vscode.CodeActionProvider {
	constructor(
		private classCache: GodotClassCache,
		private diagnosticCollection: vscode.DiagnosticCollection
	) { }

	provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];

		// ✅ 遍历当前行的所有诊断
		for (const diagnostic of context.diagnostics) {
			// 只处理我们自己生成的诊断
			if (diagnostic.source !== 'Godot Dialogue') continue;

			// ✅ 1. 修复类名拼写错误
			if (diagnostic.message.startsWith('未找到类')) {
				actions.push(...this.createClassNameFixes(document, diagnostic));
			}

			// ✅ 2. 修复方法名拼写错误
			if (diagnostic.message.includes('不存在方法')) {
				actions.push(...this.createMethodNameFixes(document, diagnostic));
			}

			// ✅ 3. 修复参数数量错误
			if (diagnostic.message.includes('需要') && diagnostic.message.includes('个参数')) {
				actions.push(...this.createParameterCountFixes(document, diagnostic));
			}

			// ✅ 4. 修复参数类型错误
			if (diagnostic.message.startsWith('参数类型不匹配')) {
				actions.push(...this.createParameterTypeFixes(document, diagnostic));
			}
		}

		return actions;
	}

	/**
	 * 修复类名拼写错误
	 */
	private createClassNameFixes(
		document: vscode.TextDocument,
		diagnostic: vscode.Diagnostic
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];
		const wrongClassName = document.getText(diagnostic.range);

		console.log(`[Dialogue] 🔧 生成类名修复建议: ${wrongClassName}`);

		// 获取所有类名
		const allClasses = this.classCache.getClasses();

		// 计算编辑距离，找出相似的类名
		const suggestions = allClasses
			.map(cls => ({
				name: cls.name,
				distance: this.levenshteinDistance(wrongClassName.toLowerCase(), cls.name.toLowerCase())
			}))
			.filter(s => s.distance <= 3)  // 只显示编辑距离 <= 3 的建议
			.sort((a, b) => a.distance - b.distance)
			.slice(0, 5);  // 最多显示 5 个建议

		for (const suggestion of suggestions) {
			const fix = new vscode.CodeAction(
				`将 '${wrongClassName}' 改为 '${suggestion.name}'`,
				vscode.CodeActionKind.QuickFix
			);
			fix.edit = new vscode.WorkspaceEdit();
			fix.edit.replace(document.uri, diagnostic.range, suggestion.name);
			fix.diagnostics = [diagnostic];
			fix.isPreferred = suggestion.distance === Math.min(...suggestions.map(s => s.distance));

			actions.push(fix);
		}

		return actions;
	}

	/**
	 * 修复方法名拼写错误
	 */
	private createMethodNameFixes(
		document: vscode.TextDocument,
		diagnostic: vscode.Diagnostic
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];
		const line = document.lineAt(diagnostic.range.start.line).text;
		const wrongMethodName = document.getText(diagnostic.range);

		// 提取类名
		const match = diagnostic.message.match(/类 '(\w+)'/);
		if (!match) return actions;

		const className = match[1];
		const cls = this.classCache.getClass(className);
		if (!cls) return actions;

		console.log(`[Dialogue] 🔧 生成方法名修复建议: ${className}.${wrongMethodName}`);

		// 找出相似的方法名
		const suggestions = cls.methods
			.filter(m => !m.name.startsWith('_'))  // 排除私有方法
			.map(m => ({
				name: m.name,
				distance: this.levenshteinDistance(wrongMethodName.toLowerCase(), m.name.toLowerCase())
			}))
			.filter(s => s.distance <= 3)
			.sort((a, b) => a.distance - b.distance)
			.slice(0, 5);

		for (const suggestion of suggestions) {
			const fix = new vscode.CodeAction(
				`将 '${wrongMethodName}' 改为 '${suggestion.name}'`,
				vscode.CodeActionKind.QuickFix
			);
			fix.edit = new vscode.WorkspaceEdit();
			fix.edit.replace(document.uri, diagnostic.range, suggestion.name);
			fix.diagnostics = [diagnostic];
			fix.isPreferred = suggestion.distance === Math.min(...suggestions.map(s => s.distance));

			actions.push(fix);
		}

		return actions;
	}

	/**
	 * 修复参数数量错误
	 */
	private createParameterCountFixes(
		document: vscode.TextDocument,
		diagnostic: vscode.Diagnostic
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];
		const line = document.lineAt(diagnostic.range.start.line).text;

		// 提取方法调用信息
		const callMatch = line.match(/(\w+)\.(\w+)\s*\(([^)]*)\)/);
		if (!callMatch) return actions;

		const [, className, methodName, argsString] = callMatch;
		const cls = this.classCache.getClass(className);
		if (!cls) return actions;

		const method = cls.methods.find(m => m.name === methodName);
		if (!method) return actions;

		console.log(`[Dialogue] 🔧 生成参数数量修复建议: ${className}.${methodName}`);

		// ✅ 建议 1：填充缺失的必需参数
		const currentArgs = this.parseArguments(argsString);
		const requiredParams = method.params.filter(p => !p.defaultValue);

		if (currentArgs.length < requiredParams.length) {
			const missingParams = requiredParams.slice(currentArgs.length);
			const placeholders = missingParams.map((p, i) => `\${${i + 1}:${p.name}}`).join(', ');

			const newArgs = argsString ? `${argsString}, ${placeholders}` : placeholders;

			const fix = new vscode.CodeAction(
				`添加缺失的参数 (${missingParams.map(p => p.name).join(', ')})`,
				vscode.CodeActionKind.QuickFix
			);

			fix.edit = new vscode.WorkspaceEdit();

			// 找到参数区域的范围
			const argsStart = line.indexOf('(', line.indexOf(methodName)) + 1;
			const argsEnd = line.indexOf(')', argsStart);

			const argsRange = new vscode.Range(
				diagnostic.range.start.line,
				argsStart,
				diagnostic.range.start.line,
				argsEnd
			);

			fix.edit.replace(document.uri, argsRange, newArgs);
			fix.diagnostics = [diagnostic];
			fix.isPreferred = true;

			actions.push(fix);
		}

		// ✅ 建议 2：移除多余的参数
		if (currentArgs.length > method.params.length) {
			const validArgs = currentArgs.slice(0, method.params.length);
			const newArgs = validArgs.map(a => a.value).join(', ');

			const fix = new vscode.CodeAction(
				`移除多余的参数`,
				vscode.CodeActionKind.QuickFix
			);

			fix.edit = new vscode.WorkspaceEdit();
			fix.edit.replace(document.uri, diagnostic.range, newArgs);
			fix.diagnostics = [diagnostic];

			actions.push(fix);
		}

		return actions;
	}

	/**
	 * 修复参数类型错误
	 */
	private createParameterTypeFixes(
		document: vscode.TextDocument,
		diagnostic: vscode.Diagnostic
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];
		const wrongValue = document.getText(diagnostic.range);

		// 提取期望的类型
		const match = diagnostic.message.match(/期望 '(\w+)'/);
		if (!match) return actions;

		const expectedType = match[1];

		console.log(`[Dialogue] 🔧 生成类型转换建议: ${wrongValue} -> ${expectedType}`);

		// ✅ 建议类型转换
		const conversions: { [key: string]: (val: string) => string } = {
			'int': (val) => {
				// 如果是字符串，去掉引号
				if (/^"' [<sup>1</sup>](\d+)["']$/.test(val)) {
					return val.replace(/["']/g, '');
				}
				// 如果是浮点数，转为 int(x)
				if (/^\d+\.\d+$/.test(val)) {
					return `int(${val})`;
				}
				return val;
			},
			'float': (val) => {
				if (/^"' [<sup>2</sup>](\d+(?:\.\d+)?)["']$/.test(val)) {
					return val.replace(/["']/g, '');
				}
				if (/^\d+$/.test(val)) {
					return `${val}.0`;
				}
				return val;
			},
			'String': (val) => {
				if (!/^["']/.test(val)) {
					return `"${val}"`;
				}
				return val;
			},
			'bool': (val) => {
				if (val === '1' || val === '"true"') return 'true';
				if (val === '0' || val === '"false"') return 'false';
				return `bool(${val})`;
			}
		};

		const converter = conversions[expectedType];
		if (converter) {
			const converted = converter(wrongValue);

			if (converted !== wrongValue) {
				const fix = new vscode.CodeAction(
					`转换为 ${expectedType} 类型: ${converted}`,
					vscode.CodeActionKind.QuickFix
				);
				fix.edit = new vscode.WorkspaceEdit();
				fix.edit.replace(document.uri, diagnostic.range, converted);
				fix.diagnostics = [diagnostic];
				fix.isPreferred = true;

				actions.push(fix);
			}
		}

		return actions;
	}

	/**
	 * 解析参数（复用诊断提供者的实现）
	 */
	private parseArguments(argsString: string): Array<{ value: string; startIndex: number }> {
		if (!argsString.trim()) return [];

		const args: Array<{ value: string; startIndex: number }> = [];
		let currentArg = '';
		let startIndex = 0;
		let depth = 0;

		for (let i = 0; i < argsString.length; i++) {
			const char = argsString[i];

			if (char === '(') {
				depth++;
				currentArg += char;
			} else if (char === ')') {
				depth--;
				currentArg += char;
			} else if (char === ',' && depth === 0) {
				args.push({
					value: currentArg.trim(),
					startIndex: startIndex
				});
				currentArg = '';
				startIndex = i + 1;
			} else {
				currentArg += char;
			}
		}

		if (currentArg.trim()) {
			args.push({
				value: currentArg.trim(),
				startIndex: startIndex
			});
		}

		return args;
	}

	/**
	 * 计算编辑距离（Levenshtein Distance）
	 */
	private levenshteinDistance(a: string, b: string): number {
		const matrix: number[][] = [];

		for (let i = 0; i <= b.length; i++) {
			matrix[i] = [i];
		}

		for (let j = 0; j <= a.length; j++) {
			matrix[0][j] = j;
		}

		for (let i = 1; i <= b.length; i++) {
			for (let j = 1; j <= a.length; j++) {
				if (b.charAt(i - 1) === a.charAt(j - 1)) {
					matrix[i][j] = matrix[i - 1][j - 1];
				} else {
					matrix[i][j] = Math.min(
						matrix[i - 1][j - 1] + 1,  // 替换
						matrix[i][j - 1] + 1,      // 插入
						matrix[i - 1][j] + 1       // 删除
					);
				}
			}
		}

		return matrix[b.length][a.length];
	}
}
