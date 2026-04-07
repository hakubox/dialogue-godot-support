import * as vscode from 'vscode';
import { GodotClassCache } from './common';
import { TitleManager } from './title_manager';
import { GodotMethod } from './interface';

// ============ 快速修复提供者 ============
export class GodotCodeActionProvider implements vscode.CodeActionProvider {
	constructor(
		private classCache: GodotClassCache,
		private diagnosticCollection: vscode.DiagnosticCollection,
		private titleManager: TitleManager
	) { }

	provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];

		// 遍历当前行的所有诊断
		for (const diagnostic of context.diagnostics) {
			// 只处理我们自己生成的诊断
			if (diagnostic.source !== 'Godot Dialogue') continue;

			// 1. 修复类名拼写错误
			if (diagnostic.message.startsWith('未找到类')) {
				actions.push(...this.createClassNameFixes(document, diagnostic));
			}

			// 2. 修复方法名拼写错误
			if (diagnostic.message.includes('不存在方法')) {
				actions.push(...this.createMethodNameFixes(document, diagnostic));
			}

			// 3. 修复参数数量错误
			if (diagnostic.message.includes('需要') && diagnostic.message.includes('个参数')) {
				actions.push(...this.createParameterCountFixes(document, diagnostic));
			}

			// 4. 修复参数类型错误
			if (diagnostic.message.startsWith('参数类型不匹配')) {
				actions.push(...this.createParameterTypeFixes(document, diagnostic));
			}

			// 新增：修复段落跳转错误
			if (diagnostic.message.startsWith('⚠️ 未找到段落:')) {
				actions.push(...this.createTitleJumpFixes(document, diagnostic));
			}
		}

		return actions;
	}

	/**
	 * 修复段落跳转错误
	 */
	private createTitleJumpFixes(
		document: vscode.TextDocument,
		diagnostic: vscode.Diagnostic
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];
		const rawTitle = document.getText(diagnostic.range);  // 例如：END! 或 bbb

		// 去除末尾的 ! 符号
		const wrongTitle = rawTitle.replace(/!$/, '');

		console.log(`[Dialogue] 🔧 生成段落跳转修复建议: ${rawTitle} -> ${wrongTitle}`);

		// 建议 1：创建新段落
		const createFix = new vscode.CodeAction(
			`创建段落 '${wrongTitle}'`,
			vscode.CodeActionKind.QuickFix
		);

		createFix.edit = new vscode.WorkspaceEdit();

		// 在文档末尾添加段落
		const lastLine = document.lineCount;
		const insertPosition = new vscode.Position(lastLine, 0);
		const newTitle = `\n~ ${wrongTitle}\n\nNPC: (待补充对话)\n\n=> END\n`;

		createFix.edit.insert(document.uri, insertPosition, newTitle);
		createFix.diagnostics = [diagnostic];
		createFix.isPreferred = true;

		actions.push(createFix);

		// 查找相似段落名
		const allTitles = this.titleManager.getTitles(document.uri).map(t => t.name);
		const suggestions = allTitles
			.map(title => ({
				name: title,
				distance: this.levenshteinDistance(wrongTitle.toLowerCase(), title.toLowerCase())
			}))
			.filter(s => s.distance <= 3)
			.sort((a, b) => a.distance - b.distance)
			.slice(0, 5);

		for (const suggestion of suggestions) {
			const fix = new vscode.CodeAction(
				`将 '${wrongTitle}' 改为 '${suggestion.name}'`,
				vscode.CodeActionKind.QuickFix
			);

			fix.edit = new vscode.WorkspaceEdit();
			// 如果原始名称有 !，保留它
			const newName = rawTitle.endsWith('!') ? `${suggestion.name}!` : suggestion.name;
			fix.edit.replace(document.uri, diagnostic.range, newName);
			fix.diagnostics = [diagnostic];

			actions.push(fix);
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

		// 建议 1：填充缺失的必需参数
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

		// 建议 2：移除多余的参数
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

		// 建议类型转换
		const conversions: { [key: string]: (val: string) => string } = {
			'int': (val) => {
				// 如果是字符串，去掉引号
				if (/^["']?\s?(\d+)["']?$/.test(val)) {
					return val.replace(/["']/g, '');
				}
				// 如果是浮点数，转为 int(x)
				if (/^\d+\.\d+$/.test(val)) {
					return `int(${val})`;
				}
				return val;
			},
			'float': (val) => {
				if (/^["']?\s?(\d+(?:\.\d+)?)["']?$/.test(val)) {
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

// ============ 诊断提供者 ============

/**
 * Godot 代码诊断提供者
 * 负责检查类型错误、方法调用错误等
 */
export class GodotDiagnosticProvider {
	private throttleTimer: NodeJS.Timeout | null = null;

	constructor(
		private classCache: GodotClassCache,
		private diagnosticCollection: vscode.DiagnosticCollection,
		private titleManager: TitleManager
	) { }

	/**
	 * 更新文档的诊断信息（防抖处理）
	 */
	updateDiagnostics(document: vscode.TextDocument): void {
		// 防抖：500ms 内只执行一次
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

		// 策略 1：查找 set 语句
		// 格式：set player = PlayerState.new()
		//      set player = SomeClass.get_instance()
		for (let i = 0; i <= currentLine; i++) {
			const line = lines[i];

			// 匹配: set variableName = ClassName.xxx
			const setMatch = line.match(new RegExp(`^\\s*set\\s+${variableName}\\s*=\\s*(\\w+)\\.`));
			if (setMatch) {
				const className = setMatch[1];
				console.log(`[Dialogue] 从 set 语句推断: ${variableName} -> ${className}`);
				return className;
			}

			// 匹配: set variableName = ClassName()
			const constructorMatch = line.match(new RegExp(`^\\s*set\\s+${variableName}\\s*=\\s*(\\w+)\\s*\\(`));
			if (constructorMatch) {
				const className = constructorMatch[1];
				console.log(`[Dialogue] 从构造函数推断: ${variableName} -> ${className}`);
				return className;
			}
		}

		// 策略 2：Dialogue Manager 内置变量
		const builtInVariables: { [key: string]: string } = {
			'dialogue_manager': 'DialogueManager',
			'player': 'CharacterBody2D',  // 根据你的项目调整
			'game': 'Game',
			// 添加更多内置变量...
		};

		if (builtInVariables[variableName]) {
			console.log(`[Dialogue] 从内置变量推断: ${variableName} -> ${builtInVariables[variableName]}`);
			return builtInVariables[variableName];
		}

		// 策略 3：检查是否是 AutoLoad 单例（小写形式）
		// 例如：player_state 可能对应 PlayerState
		const pascalCase = variableName
			.split('_')
			.map(word => word.charAt(0).toUpperCase() + word.slice(1))
			.join('');

		if (this.classCache.isAutoload(pascalCase)) {
			console.log(`[Dialogue] 从 AutoLoad 推断: ${variableName} -> ${pascalCase}`);
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
			// 统一的代码区域检测和提取
			const codeBlocks = this.extractCodeBlocks(line, lineIndex);
			for (const block of codeBlocks) {
				this.analyzeCode(
					block.code,
					document,
					lineIndex,
					block.startColumn,
					diagnostics
				);
			}

			// 2. 检查段落跳转
			this.checkTitleJumps(line, lineIndex, document, diagnostics);
		}
		console.log(`[Dialogue] 📊 发现 ${diagnostics.length} 个问题`);
		this.diagnosticCollection.set(document.uri, diagnostics);
	}

	/**
	 * 检查段落跳转是否有效
	 */
	private checkTitleJumps(
		line: string,
		lineIndex: number,
		document: vscode.TextDocument,
		diagnostics: vscode.Diagnostic[]
	): void {
		// 匹配 goto 语句：=> title 或 - option => title
		const gotoPatterns = [
			/^\s*=>\s+(\S+)/,           // => title
			/^\s*-\s+[^=>]+=>\s+(\S+)/, // - option => title
		];

		for (const pattern of gotoPatterns) {
			const match = line.match(pattern);
			if (!match) continue;

			const rawTitle = match[1];  // 例如：END! 或 battle
			// 新增：去除末尾的 ! 符号
			const targetTitle = rawTitle.replace(/!$/, '');

			// 跳过 END（特殊标记）
			if (targetTitle.toUpperCase() === 'END') continue;

			console.log(`[Dialogue] 🔍 检查段落跳转: ${targetTitle}`);

			// 检查是否是 Import 引用（OtherFile/title）
			const isImportRef = targetTitle.includes('/');

			if (isImportRef) {
				// 暂时跳过 Import 引用的检查（需要跨文件分析）
				console.log(`[Dialogue] 💡 跳过 Import 引用: ${targetTitle}`);
				continue;
			}

			const titleInfo = this.titleManager.findTitle(document.uri, targetTitle);

			if (!titleInfo) {
				const titleStart = line.indexOf(rawTitle);
				const range = new vscode.Range(
					lineIndex,
					titleStart,
					lineIndex,
					titleStart + rawTitle.length
				);

				diagnostics.push(
					this.createDiagnostic(
						range,
						`⚠️ 未找到段落: ${targetTitle}`,
						vscode.DiagnosticSeverity.Error,
						'请检查段落名是否正确，或创建该段落'
					)
				);
			}
		}
	}

	/**
	 * 提取一行中的所有代码块
	 */
	private extractCodeBlocks(
		line: string,
		lineIndex: number
	): Array<{ code: string; startColumn: number }> {
		const blocks: Array<{ code: string; startColumn: number }> = [];
		// 1️⃣ 块级语句（优先级最高，避免与行内语法冲突）
		const blockPatterns = [
			{ regex: /^\s*(while|match|when|do!?)\s+(.+)$/, codeIndex: 2 },
			{ regex: /^\s*set\s+(.+)$/, codeIndex: 1 },
			{ regex: /^\s*(if|elif)\s+(.+)$/, codeIndex: 2 },
		];
		for (const { regex, codeIndex } of blockPatterns) {
			const match = line.match(regex);
			if (match) {
				const code = match[codeIndex].trim();
				const startColumn = line.indexOf(code);
				blocks.push({ code, startColumn });
				return blocks; // 块级语句独占一行，直接返回
			}
		}
		// 2️⃣ 行内语法（可以有多个）
		const inlinePatterns = [
			/\[do!?\s+([^\]]+)\]/g,
			/\[set\s+([^\]]+)\]/g,
			/\[(?:if|elif)\s+([^\]]+)\]/g,
			/\{\{([^}]+)\}\}/g,
		];
		for (const pattern of inlinePatterns) {
			let match;
			while ((match = pattern.exec(line)) !== null) {
				const code = match[1].trim();
				const startColumn = match.index + match[0].indexOf(code);
				blocks.push({ code, startColumn });
			}
		}
		return blocks;
	}

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
		// 记录已经检查过的方法调用位置，避免重复检查
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

			// 记录这个范围
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

				// 检查参数
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

				// 新增:优先检查是否是全局变量
				const globalVar = this.classCache.getGlobalVariable(identifier);
				if (globalVar) {
					console.log(`[Dialogue] 🌐 全局变量调用: ${identifier}.${methodName}()`);

					const cls = this.classCache.getClass(globalVar.type);
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
									`类型 '${globalVar.type}' 中不存在方法 '${methodName}'`,
									vscode.DiagnosticSeverity.Error
								)
							);
							continue;
						}

						// 验证参数
						this.validateMethodArguments(
							method,
							globalVar.type,
							methodName,
							argsString,
							document,
							lineIndex,
							startColumn + matchStart,
							diagnostics
						);
					}
					continue;
				}

				// 尝试推断变量类型
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
		const propertyAccessRegex = /(\w+(?:\.\w+)*)\.(\w+)/g;

		while ((match = propertyAccessRegex.exec(code)) !== null) {
			const fullPath = match[1];  // 例如：playerStats.equipment
			const memberName = match[2];
			const matchStart = match.index;
			const matchEnd = match.index + match[0].length;

			// 跳过已检查的方法调用
			let isAlreadyChecked = false;
			for (const range of checkedRanges) {
				const [start, end] = range.split('-').map(Number);
				if (matchStart >= start && matchEnd <= end) {
					isAlreadyChecked = true;
					break;
				}
			}
			if (isAlreadyChecked) continue;

			// 检查后面是否紧跟括号
			const nextChar = code[matchEnd];
			if (nextChar === '(') continue;

			const pathParts = fullPath.split('.');
			const rootIdentifier = pathParts[0];

			// 检查是否是全局变量
			const globalVar = this.classCache.getGlobalVariable(rootIdentifier);
			if (globalVar) {
				console.log(`[Dialogue] 🌐 检查全局变量属性: ${fullPath}.${memberName}`);

				const propertyPath = [...pathParts.slice(1), memberName];
				const result = this.classCache.resolveVariableProperty(rootIdentifier, propertyPath);

				if (!result) {
					const memberStart = matchStart + fullPath.length + 1;
					const range = new vscode.Range(
						lineIndex,
						startColumn + memberStart,
						lineIndex,
						startColumn + memberStart + memberName.length
					);

					diagnostics.push(
						this.createDiagnostic(
							range,
							`全局变量 '${rootIdentifier}' 的路径 '${propertyPath.join('.')}' 不存在`,
							vscode.DiagnosticSeverity.Error
						)
					);
				}
				continue;
			}

			// 只检查大写开头的类名
			if (!/^[A-Z]/.test(rootIdentifier)) {
				console.log(`[Dialogue] 💡 '${rootIdentifier}' 被识别为变量，跳过属性检查`);
				continue;
			}

			const cls = this.classCache.getClass(rootIdentifier);
			if (!cls) continue;

			const property = cls.properties.find(p => p.name === memberName);
			const method = cls.methods.find(m => m.name === memberName);
			const signal = cls.signals.find(s => s === memberName);

			if (!property && !method && !signal) {
				const memberStart = matchStart + rootIdentifier.length + 1;
				const range = new vscode.Range(
					lineIndex,
					startColumn + memberStart,
					lineIndex,
					startColumn + memberStart + memberName.length
				);

				diagnostics.push(
					this.createDiagnostic(
						range,
						`类 '${rootIdentifier}' 中不存在成员 '${memberName}'`,
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

		// 计算必需参数和可选参数数量
		const requiredParamsCount = expectedParams.filter(p => !p.defaultValue).length;
		const totalParamsCount = expectedParams.length;

		console.log(`[Dialogue] 📋 必需参数: ${requiredParamsCount}, 可选参数: ${totalParamsCount - requiredParamsCount}, 实际传入: ${actualArgs.length}`);

		// 检查参数数量
		if (actualArgs.length < requiredParamsCount || actualArgs.length > totalParamsCount) {
			const argsStart = startColumn + className.length + 1 + methodName.length + 1;
			const argsEnd = argsStart + argsString.length;

			const range = new vscode.Range(lineIndex, argsStart, lineIndex, argsEnd);

			// 修复：正确显示期望的签名
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

		// 检查每个参数的类型
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

		// 检查继承关系
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

		// 为不同严重性设置不同的标签
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
