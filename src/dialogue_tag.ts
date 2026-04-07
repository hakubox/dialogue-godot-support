// dialogue_tag.ts

import * as vscode from 'vscode';

/**
 * Dialogue Manager 标签定义（统一接口）
 */
export interface DialogueTag {
	name: string;
	hasValue: boolean;
	valueType?: string;
	valueHint?: string;
	isPair: boolean;
	description: string;
	example: string;
	category: 'time' | 'audio' | 'effect' | 'ui' | 'metadata' | 'action';  // ✅ 新增 action 分类
	isMetadata?: boolean;
	isInline?: boolean;  // ✅ 新增：标记是否为行内标签
}

/**
 * 元数据分类配置接口
 */
export interface MetadataCategory {
	icon: string;
	description: string;
}

// ============ 关键词定义 (用于悬停提示) ============
const DIALOGUE_KEYWORDS: Record<string, {
	description: string;
	example: string;
	inlineDescription?: string;  // ✅ 新增：行内用法的描述
	inlineExample?: string;      // ✅ 新增：行内用法的示例
}> = {
	'~': { description: '定义一个对话段落的开始（标题）。', example: '~ start' },
	'-': { description: '定义一个对话选项', example: '- 选项1\n- 选项2' },
	'=>': { description: '跳转到指定的对话标题。', example: '=> next_scene\n=> END!' },

	// ✅ do 关键词：区分行首和行内
	'do': {
		description: '（行首）执行一个 Godot 表达式或方法，不阻塞对话流程。',
		example: 'do PlayerState.add_gold(100)\ndo queue_free()',
		inlineDescription: '（行内）在对话文本中执行表达式，立即生效。',
		inlineExample: '张三: 你好[do SaveManager.save()]，我现在存档了。'
	},

	// ✅ do! 关键词
	'do!': {
		description: '（行首）执行表达式并等待其完成（如果返回信号）。',
		example: 'do! play_animation("cutscene")',
		inlineDescription: '（行内）执行并等待完成，会暂停对话显示。',
		inlineExample: '张三: 看这个[do! show_effect()]效果！'
	},

	// ✅ set 关键词：区分行首和行内
	'set': {
		description: '（行首）修改变量或属性的值。',
		example: 'set player.health = 100\nset score += 50',
		inlineDescription: '（行内）在对话文本中修改变量，立即生效。',
		inlineExample: '你获得了 100 金币[set player.gold += 100]！'
	},

	'if': { description: '当条件为真时，执行下方缩进的块。', example: 'if count < 3:' },
	'elif': { description: '当条件为真时，执行下方缩进的块。', example: 'elif count < 3:' },
	'else': { description: '当其他条件全为假时，执行下方缩进的块。', example: 'else:' },
	'while': { description: '当条件为真时，重复执行下方缩进的块。', example: 'while count < 3:' },
	'match': { description: '根据表达式的值执行对应的 when 分支。', example: 'match player_class:' },
	'when': { description: 'match 语句的具体条件分支。', example: 'when warrior:' },
	'{{': { description: '变量插值开始，嵌入 Godot 表达式。', example: '你有 {{gold}} 金币。' },
	'}}': { description: '变量插值结束。', example: '你有 {{gold}} 金币。' },
	'%': { description: '随机选项的权重（如 %2 概率是 %1 的两倍）。', example: '% 结果1。\n%2 结果2。\n%2 结果3。' }
};

// ============ 常规标签定义 ============
export const DIALOGUE_TAGS: DialogueTag[] = [
	// ============ 行内动作标签（新增分类）============
	// ✅ 行内 do 标签
	{
		name: 'do',
		hasValue: true,
		valueType: 'expression',
		valueHint: 'Godot 表达式（如 SaveManager.save()）',
		isPair: false,
		description: '在对话文本中执行表达式，不阻塞对话流程',
		example: '张三: 你好[do SaveManager.save()]，我现在存档了。',
		category: 'action',
		isInline: true  // ✅ 标记为行内标签
	},

	// ✅ 行内 do! 标签
	{
		name: 'do!',
		hasValue: true,
		valueType: 'expression',
		valueHint: 'Godot 表达式（返回信号）',
		isPair: false,
		description: '执行表达式并等待完成，会暂停对话显示',
		example: '张三: 看这个[do! show_effect()]效果！',
		category: 'action',
		isInline: true
	},

	// ✅ 行内 set 标签
	{
		name: 'set',
		hasValue: true,
		valueType: 'expression',
		valueHint: 'gold += 100',
		isPair: false,
		description: '在对话文本中修改变量值',
		example: '你获得了 100 金币[set gold += 100]！',
		category: 'action',
		isInline: true
	},

	// ============ 条件控制 ============
	{
		name: 'if',
		hasValue: true,
		valueType: 'expression',
		valueHint: 'has_key',
		isPair: true,
		description: '条件判断开始，如果表达式为真则执行',
		example: '[if player.has_key] 你有钥匙 [/if]',
		category: 'ui',
		isInline: true
	},
	{
		name: 'elif',
		hasValue: true,
		valueType: 'expression',
		valueHint: 'has_key',
		isPair: false,
		description: '条件判断的 else if 分支',
		example: '[if score > 100] 优秀 [elif score > 60] 及格 [else] 不及格 [/if]',
		category: 'ui',
		isInline: true
	},
	{
		name: 'else',
		hasValue: false,
		isPair: false,
		description: '行内条件判断的 else 分支（必须在 [if] 和 [/if] 之间）',
		example: '[if player.has_key] 你有钥匙 [else] 你没有钥匙 [/if]',
		category: 'ui',
		isInline: true
	},

	// ============ 时间控制 ============
	{
		name: 'wait',
		hasValue: true,
		valueType: 'number',
		valueHint: '秒数（支持小数）',
		isPair: false,
		description: '暂停指定秒数后继续',
		example: '[wait=1.5]',
		category: 'time',
		isInline: true
	},
	{
		name: 'speed',
		hasValue: true,
		valueType: 'number',
		valueHint: '速度倍率（1.0为正常）',
		isPair: false,
		description: '设置文字显示速度',
		example: '[speed=2.0]',
		category: 'time',
		isInline: true
	},
	{
		name: 'pause',
		hasValue: false,
		isPair: false,
		description: '暂停，等待玩家按键继续',
		example: '[pause]',
		category: 'time',
		isInline: true
	},
	{
		name: 'p',
		hasValue: false,
		isPair: false,
		description: '暂停的简写形式',
		example: '[p]',
		category: 'time',
		isInline: true
	},

	// ============ 音效 ============
	{
		name: 'sound',
		hasValue: true,
		valueType: 'path',
		valueHint: 'res://路径/音效.ogg',
		isPair: false,
		description: '播放音效文件',
		example: '[sound=res://audio/sfx/click.ogg]',
		category: 'audio',
		isInline: true
	},
	{
		name: 'voice',
		hasValue: true,
		valueType: 'path',
		valueHint: 'res://路径/语音.ogg',
		isPair: false,
		description: '播放角色语音',
		example: '[voice=res://audio/voice/line_001.ogg]',
		category: 'audio',
		isInline: true
	},

	// ============ 文本效果 ============
	{
		name: 'wave',
		hasValue: false,
		isPair: true,
		description: '文字波浪效果',
		example: '[wave]波浪文字[/wave]',
		category: 'effect',
		isInline: true
	},
	{
		name: 'shake',
		hasValue: false,
		isPair: true,
		description: '文字震动效果',
		example: '[shake]震动文字[/shake]',
		category: 'effect',
		isInline: true
	},
	{
		name: 'rainbow',
		hasValue: false,
		isPair: true,
		description: '彩虹渐变效果',
		example: '[rainbow]彩虹文字[/rainbow]',
		category: 'effect',
		isInline: true
	},
	{
		name: 'ghost',
		hasValue: false,
		isPair: true,
		description: '幽灵渐隐效果',
		example: '[ghost]幽灵文字[/ghost]',
		category: 'effect',
		isInline: true
	},
	{
		name: 'pulse',
		hasValue: false,
		isPair: true,
		description: '脉冲缩放效果',
		example: '[pulse]脉冲文字[/pulse]',
		category: 'effect',
		isInline: true
	},

	// ============ UI 控制 ============
	{
		name: 'b',
		hasValue: false,
		isPair: true,
		description: '文字加粗',
		example: '[b]文字加粗[/b]',
		category: 'ui',
		isInline: true
	},
	{
		name: 'br',
		hasValue: false,
		isPair: false,
		description: '强制换行',
		example: '[br]',
		category: 'ui',
		isInline: true
	},
	{
		name: 'signal',
		hasValue: true,
		valueType: 'string',
		valueHint: '信号名',
		isPair: false,
		description: '发送自定义信号',
		example: '[signal=player_choice]',
		category: 'ui',
		isInline: true
	},
	{
		name: 'next',
		hasValue: true,
		valueType: 'string',
		valueHint: '场景ID',
		isPair: false,
		description: '跳转到下一个场景',
		example: '[next=chapter_2]',
		category: 'ui',
		isInline: true
	},
	{
		name: 'auto',
		hasValue: false,
		isPair: false,
		description: '开启自动播放模式',
		example: '[auto]',
		category: 'ui',
		isInline: true
	},
	{
		name: 'jump',
		hasValue: true,
		valueType: 'string',
		valueHint: '标题名',
		isPair: false,
		description: '立即跳转到指定标题',
		example: '[jump=next_scene]',
		category: 'ui',
		isInline: true
	}
];

/**
 * 注册标签相关功能
 */
export function registerTagFeatures(context: vscode.ExtensionContext): void {
	console.log('[Dialogue] 📦 注册标签功能...');

	// 注册统一的标签补全和悬停提供者
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			{ scheme: 'file', language: 'dialogue' },
			new DialogueTagCompletionProvider(),
			'[', '#'
		)
	);

	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			{ scheme: 'file', language: 'dialogue' },
			new DialogueTagHoverProvider()
		)
	);

	// 注册标签配置命令
	const tagConfigManager = TagConfigManager.getInstance();

	context.subscriptions.push(
		vscode.commands.registerCommand('dialogue.openTagSettings', () => {
			tagConfigManager.openSettings();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('dialogue.addNewTag', () => {
			tagConfigManager.addNewTag();
		})
	);

	console.log('[Dialogue] 标签功能注册完成');
}

/**
 * 标签配置管理器（统一管理常规标签和自定义元数据标签）
 */
export class TagConfigManager {
	private static instance: TagConfigManager;

	private allTags: Map<string, DialogueTag> = new Map();
	private metadataCategories: Map<string, MetadataCategory> = new Map();
	private enabled: boolean = true;

	private constructor() {
		this.loadConfiguration();

		// 监听配置变化
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('dialogue.diagnostics.customTags') ||
				event.affectsConfiguration('dialogue.diagnostics.enableCustomTags') ||
				event.affectsConfiguration('dialogue.diagnostics.metadataCategories')) {
				console.log('[Dialogue] 🔄 配置已更新，重新加载');
				this.loadConfiguration();
			}
		});
	}

	public static getInstance(): TagConfigManager {
		if (!TagConfigManager.instance) {
			TagConfigManager.instance = new TagConfigManager();
		}
		return TagConfigManager.instance;
	}

	/**
	 * 加载配置（合并常规标签和自定义标签）
	 */
	private loadConfiguration(): void {
		this.allTags.clear();
		this.metadataCategories.clear();

		// ✅ 1. 加载所有常规标签
		for (const tag of DIALOGUE_TAGS) {
			this.allTags.set(tag.name, tag);
		}

		const config = vscode.workspace.getConfiguration('dialogue');
		this.enabled = config.get<boolean>('enableCustomTags', true);
		if (!this.enabled) {
			console.log('[Dialogue] ⚠️ 自定义标签已禁用');
			return;
		}

		// ✅ 2. 加载元数据分类配置
		const categoriesConfig = config.get<Record<string, MetadataCategory>>('diagnostics.metadataCategories', {});
		for (const [categoryKey, categoryConfig] of Object.entries(categoriesConfig)) {
			this.metadataCategories.set(categoryKey, categoryConfig);
		}
		console.log(`[Dialogue] ✅ 已加载 ${this.metadataCategories.size} 个元数据分类`);

		// ✅ 3. 加载用户自定义的元数据标签
		const customTagsConfig = config.get<Record<string, {
			description: string;
			example?: string;
			category?: string;
		}>>('diagnostics.customTags', {});

		for (const [tagName, tagConfig] of Object.entries(customTagsConfig)) {
			const metadataTag: DialogueTag = {
				name: tagName,
				hasValue: false,
				isPair: false,
				description: tagConfig.description,
				example: tagConfig.example || `[#${tagName}]`,
				category: 'metadata',
				isMetadata: true
			};

			if (tagConfig.category) {
				(metadataTag as any).metadataCategory = tagConfig.category;
			}
			this.allTags.set(tagName, metadataTag);
		}

		console.log(`[Dialogue] ✅ 已加载 ${this.allTags.size} 个标签`);
	}

	/**
	 * 获取元数据标签的分类信息
	 */
	public getMetadataCategory(categoryKey: string): MetadataCategory | undefined {
		return this.metadataCategories.get(categoryKey);
	}

	/**
	 * 获取所有元数据分类
	 */
	public getAllMetadataCategories(): Map<string, MetadataCategory> {
		return this.metadataCategories;
	}

	/**
	 * 获取所有标签
	 */
	public getAllTags(): Map<string, DialogueTag> {
		return this.allTags;
	}

	/**
	 * 获取单个标签
	 */
	public getTag(tagName: string): DialogueTag | undefined {
		return this.allTags.get(tagName);
	}

	/**
	 * 按分类获取标签
	 */
	public getTagsByCategory(category: DialogueTag['category']): DialogueTag[] {
		return Array.from(this.allTags.values()).filter(tag => tag.category === category);
	}

	/**
	 * 是否启用自定义标签
	 */
	public isEnabled(): boolean {
		return this.enabled;
	}

	/**
	 * 打开配置文件
	 */
	public async openSettings(): Promise<void> {
		await vscode.commands.executeCommand(
			'workbench.action.openSettings',
			'dialogue.customTags'
		);
	}

	/**
	 * 添加新的元数据标签
	 */
	public async addNewTag(): Promise<void> {
		const tagName = await vscode.window.showInputBox({
			prompt: '输入标签名称（不含 # 号）',
			placeHolder: '例如: happy',
			validateInput: (value) => {
				if (!value) return '标签名称不能为空';
				if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
					return '标签名称只能包含字母、数字和下划线，且不能以数字开头';
				}
				if (this.allTags.has(value)) {
					return '标签已存在';
				}
				return null;
			}
		});

		if (!tagName) return;

		const description = await vscode.window.showInputBox({
			prompt: '输入标签说明',
			placeHolder: '例如: 快乐表情'
		});

		if (!description) return;

		const example = await vscode.window.showInputBox({
			prompt: '输入使用示例（可选）',
			placeHolder: `例如: NPC: 你好！[#${tagName}]`
		});

		// ✅ 显示分类选择
		const categoryItems = Array.from(this.metadataCategories.entries()).map(([key, config]) => ({
			label: `${config.icon} ${key}`,
			description: config.description,
			value: key
		}));

		const categoryPick = await vscode.window.showQuickPick(categoryItems, {
			placeHolder: '选择标签分类（可选）'
		});

		// 获取当前配置
		const config = vscode.workspace.getConfiguration('dialogue');
		const currentTags = config.get<Record<string, any>>('customTags', {});

		// 添加新标签
		currentTags[tagName] = {
			description: description,
			example: example || `[#${tagName}]`,
			category: categoryPick?.value
		};

		// 保存配置
		await config.update('customTags', currentTags, vscode.ConfigurationTarget.Global);
		vscode.window.showInformationMessage(`✅ 元数据标签 [#${tagName}] 已添加！`);
	}
}

/**
 * Dialogue 标签补全提供者（统一处理常规标签和元数据标签）
 */
export class DialogueTagCompletionProvider implements vscode.CompletionItemProvider {
	private tagConfigManager: TagConfigManager;

	constructor() {
		this.tagConfigManager = TagConfigManager.getInstance();
	}

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
		context: vscode.CompletionContext
	): Promise<vscode.CompletionItem[]> {
		const line = document.lineAt(position.line).text;
		const beforeCursor = line.substring(0, position.character);

		console.log('[Dialogue] ========== 标签补全被触发 ==========');
		console.log('[Dialogue] 📝 光标前内容:', beforeCursor);

		// ✅ 1. 检测是否在行首（最高优先级）
		// 行首定义：只有空白字符 + 可能的部分关键词
		const trimmedBeforeCursor = beforeCursor.trimStart();
		const isAtLineStart = beforeCursor === '' || /^\s+$/.test(beforeCursor) || /^\s*\w*$/.test(beforeCursor);

		if (isAtLineStart) {
			console.log('[Dialogue] 💡 在行首位置');

			// 提取已输入的部分文本（去除前导空格）
			const partialInput = trimmedBeforeCursor;

			// 检查是否可能是关键词
			const lineStartKeywords = ['if', 'elif', 'else', 'while', 'match', 'when', 'do', 'do!', 'set', '~', '=>', '-'];
			const isPossibleKeyword = lineStartKeywords.some(kw => kw.startsWith(partialInput));

			if (partialInput === '' || isPossibleKeyword) {
				console.log('[Dialogue] ✅ 提供行首关键词补全');
				return this.getLineStartKeywordCompletions(partialInput);
			}

			// 如果输入的不是关键词，就不提供补全
			console.log('[Dialogue] ⚠️ 输入内容不是关键词，跳过补全');
			return [];
		}

		// ✅ 2. 检测是否在输入行内标签
		const isRegularTag = beforeCursor.endsWith('[');
		const isMetadataTag = /\[#\w*$/.test(beforeCursor);

		if (!isRegularTag && !isMetadataTag) {
			console.log('[Dialogue] ⚠️ 不在标签输入位置，跳过补全');
			return [];
		}

		console.log('[Dialogue] 提供行内标签补全');

		const items: vscode.CompletionItem[] = [];

		// 分类图标
		const categoryIcons: Record<string, string> = {
			time: '⏱️',
			audio: '🔊',
			effect: '✨',
			ui: '🎮',
			metadata: '🏷️',
			action: '⚡'
		};

		// 获取所有标签
		const allTags = this.tagConfigManager.getAllTags();

		for (const [tagName, tag] of allTags.entries()) {
			// 过滤：如果输入了 [#，只显示元数据标签
			if (isMetadataTag && !tag.isMetadata) continue;

			// ✅ 如果是行内标签（isInline: true），才在 [ 触发时显示
			if (isRegularTag && !tag.isInline) continue;

			const item = new vscode.CompletionItem(
				tag.isMetadata ? `#${tagName}` : tagName,
				vscode.CompletionItemKind.Keyword
			);

			// 设置插入文本
			if (tag.isMetadata) {
				item.insertText = `#${tagName}]`;
			} else if (tag.hasValue) {
				// ✅ 特殊处理 do/do!/set 标签（使用空格而非 =）
				if (['do', 'do!', 'set', 'if', 'elif'].includes(tagName)) {
					item.insertText = new vscode.SnippetString(`${tagName} \${1:${tag.valueHint}}\]`);
				} else {
					item.insertText = new vscode.SnippetString(`${tagName}=\${1:${tag.valueHint}}\]`);
				}
			} else if (tag.isPair) {
				item.insertText = new vscode.SnippetString(`${tagName}\]$1[/${tagName}]`);
			} else {
				item.insertText = `${tagName}]`;
			}

			// 设置详细信息
			if (tag.isMetadata) {
				const metadataCategory = (tag as any).metadataCategory;
				const categoryConfig = metadataCategory
					? this.tagConfigManager.getMetadataCategory(metadataCategory)
					: undefined;

				const icon = categoryConfig?.icon || '🏷️';
				const categoryDesc = categoryConfig?.description || '其他';
				item.detail = `${icon} ${categoryDesc} - ${tag.description}`;
			} else {
				item.detail = `${categoryIcons[tag.category]} ${tag.description}`;
			}

			// 设置文档
			const docs: string[] = [];
			docs.push(`## ${categoryIcons[tag.category]} ${tag.isMetadata ? '#' : ''}${tagName}`);
			docs.push('');
			docs.push(`**类别:** ${tag.category}`);
			docs.push('');
			docs.push(`**描述:** ${tag.description}`);
			docs.push('');
			docs.push('**示例:**');
			docs.push('```dialogue');
			docs.push(tag.example);
			docs.push('```');

			if (tag.hasValue) {
				docs.push('');
				docs.push(`**参数类型:** \`${tag.valueType}\``);
				docs.push(`**参数说明:** ${tag.valueHint}`);
			}

			if (tag.isPair) {
				docs.push('');
				docs.push('⚠️ **成对标签**，需要闭合标签 `[/' + tagName + ']`');
			}

			item.documentation = new vscode.MarkdownString(docs.join('\n'));

			// 排序
			const categoryOrder: Record<string, string> = {
				action: '0',
				time: '1',
				audio: '2',
				effect: '3',
				ui: '4',
				metadata: '5'
			};
			item.sortText = `${categoryOrder[tag.category]}_${tagName}`;

			items.push(item);
		}

		console.log(`[Dialogue] 📦 返回 ${items.length} 个标签补全项`);
		return items;
	}

	/**
	 * 获取行首关键词补全
	 */
	private getLineStartKeywordCompletions(partialInput: string): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];

		// 需要补全的行首关键词
		const lineStartKeywords = ['if', 'elif', 'else', 'while', 'match', 'when', 'do', 'do!', 'set', '~', '=>', '-'];

		for (const keyword of lineStartKeywords) {
			// 过滤：只显示匹配的关键词
			if (partialInput !== '' && !keyword.startsWith(partialInput)) {
				continue;
			}

			const kwDef = DIALOGUE_KEYWORDS[keyword];

			if (!kwDef) {
				console.log(`[Dialogue] ⚠️ 关键词 ${keyword} 没有定义`);
				continue;
			}

			const item = new vscode.CompletionItem(
				keyword,
				vscode.CompletionItemKind.Keyword
			);

			// 设置插入文本
			if (['if', 'elif', 'while', 'match', 'when'].includes(keyword)) {
				item.insertText = new vscode.SnippetString(`${keyword} \${1:condition}`);
			} else if (keyword === 'do') {
				item.insertText = new vscode.SnippetString(`do \${1:expression}`);
			} else if (keyword === 'do!') {
				item.insertText = new vscode.SnippetString(`do! \${1:expression}`);
			} else if (keyword === 'set') {
				item.insertText = new vscode.SnippetString(`set \${1:variable} = \${2:value}`);
			} else if (keyword === '~') {
				item.insertText = new vscode.SnippetString(`~ \${1:title_name}`);
			} else if (keyword === '=>') {
				item.insertText = new vscode.SnippetString(`=> \${1:title_name}`);
			} else if (keyword === '-') {
				item.insertText = new vscode.SnippetString(`- \${1:option_text} => \${2:title_name}`);
			} else {
				item.insertText = keyword;
			}

			item.detail = `🔑 ${kwDef.description}`;

			const docs: string[] = [];
			docs.push(`## 🔑 ${keyword}`);
			docs.push('');
			docs.push(`**描述:** ${kwDef.description}`);
			docs.push('');
			docs.push('**示例:**');
			docs.push('```dialogue');
			docs.push(kwDef.example);
			docs.push('```');

			if (kwDef.inlineDescription) {
				docs.push('');
				docs.push('---');
				docs.push('');
				docs.push('### 💡 行内用法');
				docs.push('');
				docs.push(`**描述:** ${kwDef.inlineDescription}`);
				docs.push('');
				docs.push('**示例:**');
				docs.push('```dialogue');
				docs.push(kwDef.inlineExample || '');
				docs.push('```');
			}

			item.documentation = new vscode.MarkdownString(docs.join('\n'));

			const keywordPriority: Record<string, string> = {
				'if': '0',
				'elif': '1',
				'else': '2',
				'while': '3',
				'match': '4',
				'when': '5',
				'do': '6',
				'do!': '7',
				'set': '8',
				'~': '9',
				'=>': '10',
				'-': '11'
			};
			item.sortText = `0_keyword_${keywordPriority[keyword] || '99'}_${keyword}`;

			items.push(item);
		}

		console.log(`[Dialogue] 📦 返回 ${items.length} 个行首关键词补全项`);
		return items;
	}
}

/**
 * Dialogue 标签悬停提示提供者（统一处理）
 */
class DialogueTagHoverProvider implements vscode.HoverProvider {
	private tagConfigManager: TagConfigManager;

	constructor() {
		this.tagConfigManager = TagConfigManager.getInstance();
	}

	async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position
	): Promise<vscode.Hover | undefined> {
		const line = document.lineAt(position.line).text;

		console.log('[Dialogue] ========== 标签/关键词悬停被触发 ==========');

		// 1. 优先检测行首关键词（if/elif/else/while/match/when/do/set）
		const lineFirstKeywordMatch = line.match(/^\s*(if|elif|else|while|match|when|do!?|set)\b/);
		if (lineFirstKeywordMatch) {
			const keywordStart = line.indexOf(lineFirstKeywordMatch[1]);
			const keywordEnd = keywordStart + lineFirstKeywordMatch[1].length;

			if (position.character >= keywordStart && position.character <= keywordEnd) {
				let keyword = lineFirstKeywordMatch[1];

				const kwDef = DIALOGUE_KEYWORDS[keyword];
				if (kwDef) {
					console.log(`[Dialogue] 🔍 找到行首关键词: ${keyword}`);
					const docs: string[] = [];
					docs.push(`## 🔑 ${keyword}`);
					docs.push('');
					docs.push(`**描述:** ${kwDef.description}`);
					docs.push('');
					docs.push('**示例:**');
					docs.push('```dialogue');
					docs.push(kwDef.example);
					docs.push('```');

					// ✅ 如果有行内用法，也显示出来
					if (kwDef.inlineDescription) {
						docs.push('');
						docs.push('---');
						docs.push('');
						docs.push('### 💡 行内用法');
						docs.push('');
						docs.push(`**描述:** ${kwDef.inlineDescription}`);
						docs.push('');
						docs.push('**示例:**');
						docs.push('```dialogue');
						docs.push(kwDef.inlineExample || '');
						docs.push('```');
					}

					return new vscode.Hover(new vscode.MarkdownString(docs.join('\n')));
				}
			}
		}

		// ✅ 2. 检测其他特殊关键词（~, =>, {{, }}, %）
		const keywordRange = document.getWordRangeAtPosition(
			position,
			/~|=>|\{\{|\}\}|%\d*/
		);

		if (keywordRange) {
			let word = document.getText(keywordRange);
			if (word.startsWith('%')) word = '%';

			const kwDef = DIALOGUE_KEYWORDS[word];
			if (kwDef) {
				console.log(`[Dialogue] 🔍 找到特殊关键词: ${word}`);
				const docs: string[] = [];
				docs.push(`## 🔑 ${word}`);
				docs.push('');
				docs.push(`**描述:** ${kwDef.description}`);
				docs.push('');
				docs.push('**示例:**');
				docs.push('```dialogue');
				docs.push(kwDef.example);
				docs.push('```');
				return new vscode.Hover(new vscode.MarkdownString(docs.join('\n')));
			}
		}

		// ✅ 3. 检测行内标签
		const inlineTagRegex = /\[(do!?|set)\s+([^\]]+)\]|\[(\/?[a-zA-Z_][a-zA-Z0-9_]*)(?:[\s=]([^\]]+))?\]/g;
		let match;

		while ((match = inlineTagRegex.exec(line)) !== null) {
			const tagStart = match.index;
			const tagEnd = match.index + match[0].length;

			if (position.character >= tagStart && position.character <= tagEnd) {
				if (match[1]) {
					const tagName = match[1];
					const tagValue = match[2]?.trim();
					console.log(`[Dialogue] 🔍 找到行内动作标签: [${tagName} ${tagValue}]`);
					return this.getInlineTagHover(tagName, tagValue);
				}

				const tagName = match[3]?.replace(/^\//, '');
				const tagValue = match[4]?.trim();
				console.log(`[Dialogue] 🔍 找到行内标签: [${match[3]}${tagValue ? ' ' + tagValue : ''}]`);
				return this.getInlineTagHover(tagName, tagValue);
			}
		}

		// ✅ 4. 检测元数据标签
		const metadataTagRegex = /\[#([\w\s,]+)\]/g;
		while ((match = metadataTagRegex.exec(line)) !== null) {
			const tagStart = match.index;
			const tagEnd = match.index + match[0].length;

			if (position.character >= tagStart && position.character <= tagEnd) {
				const tagsText = match[1];
				const tags = tagsText.split(',').map(t => t.trim());

				let currentPos = tagStart + 2;
				for (const tag of tags) {
					const thisTagStart = currentPos;
					const thisTagEnd = thisTagStart + tag.length;

					if (position.character >= thisTagStart && position.character <= thisTagEnd) {
						console.log(`[Dialogue] 🔍 找到元数据标签: #${tag}`);
						return this.getInlineTagHover(tag, undefined);
					}

					currentPos = thisTagEnd + 2;
				}
			}
		}

		return undefined;
	}

	/**
	 * 获取行内标签悬停信息
	 */
	private getInlineTagHover(tagName: string, tagValue?: string): vscode.Hover | undefined {
		const tagDef = this.tagConfigManager.getTag(tagName);

		if (!tagDef) {
			console.log(`[Dialogue] ⚠️ 未知标签: ${tagName}`);
			return new vscode.Hover(
				new vscode.MarkdownString(
					`⚠️ **未定义的标签:** \`${tagName}\`\n\n` +
					`💡 你可以在设置中添加此标签的说明`
				)
			);
		}

		// ✅ 对于 do/do!/set，优先显示行内用法说明
		const kwDef = DIALOGUE_KEYWORDS[tagName];
		const useInlineDescription = kwDef?.inlineDescription && tagDef.isInline;

		// 生成悬停文档
		const docs: string[] = [];

		// 分类图标
		const categoryIcons: Record<string, string> = {
			time: '⏱️',
			audio: '🔊',
			effect: '✨',
			ui: '🎮',
			metadata: '🏷️',
			action: '⚡'
		};

		// ✅ 为元数据标签显示分类信息
		if (tagDef.isMetadata) {
			const metadataCategory = (tagDef as any).metadataCategory;
			const categoryConfig = metadataCategory
				? this.tagConfigManager.getMetadataCategory(metadataCategory)
				: undefined;
			const icon = categoryConfig?.icon || '🏷️';
			const categoryDesc = categoryConfig?.description || '其他';
			docs.push(`## ${icon} #${tagDef.name}`);
			docs.push('');
			docs.push(`**类别:** ${categoryDesc}`);
			docs.push('');
		} else {
			docs.push(`## ${categoryIcons[tagDef.category]} [${tagDef.name}]`);
			docs.push('');
		}

		// ✅ 显示行内描述（如果有）
		if (useInlineDescription && kwDef) {
			docs.push(`**描述:** ${kwDef.inlineDescription}`);
		} else {
			docs.push(`**描述:** ${tagDef.description}`);
		}

		if (tagDef.hasValue) {
			docs.push('');
			docs.push(`**参数类型:** \`${tagDef.valueType}\``);
			docs.push('');
			docs.push(`**参数说明:** ${tagDef.valueHint}`);

			if (tagValue) {
				docs.push('');
				docs.push(`**当前值:** \`${tagValue}\``);

				// 验证值
				if (tagDef.valueType === 'number' && isNaN(Number(tagValue))) {
					docs.push('');
					docs.push('⚠️ **警告:** 当前值不是有效的数字');
				}
			}
		}

		docs.push('');
		docs.push('**示例:**');
		docs.push('```dialogue');
		// ✅ 优先显示行内示例
		if (useInlineDescription && kwDef?.inlineExample) {
			docs.push(kwDef.inlineExample);
		} else {
			docs.push(tagDef.example);
		}
		docs.push('```');

		// ✅ 如果是 do/set，额外显示行首用法
		if (kwDef && (tagName === 'do' || tagName === 'do!' || tagName === 'set')) {
			docs.push('');
			docs.push('---');
			docs.push('');
			docs.push('### 💡 行首用法');
			docs.push('');
			docs.push(`**描述:** ${kwDef.description}`);
			docs.push('');
			docs.push('**示例:**');
			docs.push('```dialogue');
			docs.push(kwDef.example);
			docs.push('```');
		}

		if (tagDef.isPair) {
			docs.push('');
			docs.push('⚠️ **成对标签**，需要闭合标签 `[/' + tagDef.name + ']`');
		}

		return new vscode.Hover(new vscode.MarkdownString(docs.join('\n')));
	}
}