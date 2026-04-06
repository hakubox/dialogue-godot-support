import * as vscode from 'vscode';


/**
 * Dialogue Manager 默认标签定义
 */
export interface DialogueTag {
	name: string;              // 标签名
	hasValue: boolean;         // 是否需要值（如 wait=1）
	valueType?: string;        // 值类型（number/path/string）
	valueHint?: string;        // 值提示
	isPair: boolean;           // 是否是成对标签（如 [wave]...[/wave]）
	description: string;       // 描述
	example: string;           // 示例
	category: 'time' | 'audio' | 'effect' | 'ui';  // 分类
}

export const DIALOGUE_TAGS: DialogueTag[] = [
  // ============ 时间控制 ============
  {
    name: 'wait',
    hasValue: true,
    valueType: 'number',
    valueHint: '秒数（支持小数）',
    isPair: false,
    description: '暂停指定秒数后继续',
    example: '[wait=1.5]',
    category: 'time'
  },
  {
    name: 'speed',
    hasValue: true,
    valueType: 'number',
    valueHint: '速度倍率（1.0为正常）',
    isPair: false,
    description: '设置文字显示速度',
    example: '[speed=2.0]',
    category: 'time'
  },
  {
    name: 'pause',
    hasValue: false,
    isPair: false,
    description: '暂停，等待玩家按键继续',
    example: '[pause]',
    category: 'time'
  },
  {
    name: 'p',
    hasValue: false,
    isPair: false,
    description: '暂停的简写形式',
    example: '[p]',
    category: 'time'
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
    category: 'audio'
  },
  {
    name: 'voice',
    hasValue: true,
    valueType: 'path',
    valueHint: 'res://路径/语音.ogg',
    isPair: false,
    description: '播放角色语音',
    example: '[voice=res://audio/voice/line_001.ogg]',
    category: 'audio'
  },
  // ============ 文本效果 ============
  {
    name: 'wave',
    hasValue: false,
    isPair: true,
    description: '文字波浪效果',
    example: '[wave]波浪文字[/wave]',
    category: 'effect'
  },
  {
    name: 'shake',
    hasValue: false,
    isPair: true,
    description: '文字震动效果',
    example: '[shake]震动文字[/shake]',
    category: 'effect'
  },
  {
    name: 'rainbow',
    hasValue: false,
    isPair: true,
    description: '彩虹渐变效果',
    example: '[rainbow]彩虹文字[/rainbow]',
    category: 'effect'
  },
  {
    name: 'ghost',
    hasValue: false,
    isPair: true,
    description: '幽灵渐隐效果',
    example: '[ghost]幽灵文字[/ghost]',
    category: 'effect'
  },
  {
    name: 'pulse',
    hasValue: false,
    isPair: true,
    description: '脉冲缩放效果',
    example: '[pulse]脉冲文字[/pulse]',
    category: 'effect'
  },
  // ============ UI 控制 ============
  {
    name: 'b',
    hasValue: false,
    isPair: true,
    description: '文字加粗',
    example: '[b]文字加粗[/b]',
    category: 'ui'
  },
  {
    name: 'br',
    hasValue: false,
    isPair: false,
    description: '强制换行',
    example: '[br]',
    category: 'ui'
  },
  {
    name: 'signal',
    hasValue: true,
    valueType: 'string',
    valueHint: '信号名',
    isPair: false,
    description: '发送自定义信号',
    example: '[signal=player_choice]',
    category: 'ui'
  },
  {
    name: 'next',
    hasValue: true,
    valueType: 'string',
    valueHint: '场景ID',
    isPair: false,
    description: '跳转到下一个场景',
    example: '[next=chapter_2]',
    category: 'ui'
  },
  {
    name: 'auto',
    hasValue: false,
    isPair: false,
    description: '开启自动播放模式',
    example: '[auto]',
    category: 'ui'
  },
  {
    name: 'jump',
    hasValue: true,
    valueType: 'string',
    valueHint: '标题名',
    isPair: false,
    description: '立即跳转到指定标题',
    example: '[jump=next_scene]',
    category: 'ui'
  }
];

/**
 * Dialogue 标签补全提供者
 */
export class DialogueTagCompletionProvider implements vscode.CompletionItemProvider {
	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position
	): Promise<vscode.CompletionItem[]> {
		const line = document.lineAt(position.line).text;
		const beforeCursor = line.substring(0, position.character);

		console.log('[Dialogue] ========== 标签补全被触发 ==========');
		console.log('[Dialogue] 📝 光标前内容:', beforeCursor);

		// ✅ 检测是否在对话文本区域（非代码区域）
		const codePatterns = [
			/^\s*~\s*/,                    // 标题
			/^\s*=>/,                      // goto
			/^\s*-\s*/,                    // 选项
			/^\s*#/,                       // 注释
			/^\s*import\s+/,               // import
			/^\s*using\s+/,                // using
			/^\s*(?:if|elif|else|while|match)\s+/, // 控制流
			/^\s*(?:while|match|when|do|set)\s+/,           // 突变
		];

		const isCodeArea = codePatterns.some(p => p.test(beforeCursor));
		if (isCodeArea) {
			console.log('[Dialogue] ⚠️ 在代码区域，跳过标签补全');
			return [];
		}

		// ✅ 检测是否在输入标签（[）
		if (!beforeCursor.endsWith('[')) {
			console.log('[Dialogue] ⚠️ 未检测到 [ 符号');
			return [];
		}

		console.log('[Dialogue] ✅ 在对话区域且输入了 [，提供标签补全');

		// ✅ 生成补全项
		const items: vscode.CompletionItem[] = [];

		for (const tag of DIALOGUE_TAGS) {
			const item = new vscode.CompletionItem(
				tag.name,
				vscode.CompletionItemKind.Keyword
			);

			// ✅ 设置插入文本（带占位符）
			if (tag.hasValue) {
				item.insertText = new vscode.SnippetString(`${tag.name}=\${1:${tag.valueHint}}\]`);
			} else if (tag.isPair) {
				item.insertText = new vscode.SnippetString(`${tag.name}\]$1[/${tag.name}]`);
			} else {
				item.insertText = `${tag.name}]`;
			}

			// ✅ 设置详细信息
			const categoryIcons = {
				time: '⏱️',
				audio: '🔊',
				effect: '✨',
				ui: '🎮'
			};

			item.detail = `${categoryIcons[tag.category]} ${tag.description}`;

			// ✅ 设置文档
			const docs: string[] = [];
			docs.push(`## ${tag.name}`);
			docs.push(`**类别:** ${tag.category}`);
			docs.push(`**描述:** ${tag.description}`);
			docs.push('');
			docs.push('**示例:**');
			docs.push('```');
			docs.push(tag.example);
			docs.push('```');

			if (tag.hasValue) {
				docs.push('');
				docs.push(`**参数类型:** \`${tag.valueType}\``);
				docs.push(`**参数说明:** ${tag.valueHint}`);
			}

			if (tag.isPair) {
				docs.push('');
				docs.push('⚠️ **成对标签**，需要闭合标签 `[/' + tag.name + ']`');
			}

			item.documentation = new vscode.MarkdownString(docs.join('\n'));

			// ✅ 设置排序（按分类）
			const categoryOrder = { time: '0', audio: '1', effect: '2', ui: '3' };
			item.sortText = `${categoryOrder[tag.category]}_${tag.name}`;

			items.push(item);
		}

		console.log(`[Dialogue] 📦 返回 ${items.length} 个标签补全项`);
		return items;
	}
}

// ============ Dialogue 标签悬停提示提供者 ============

export class DialogueTagHoverProvider implements vscode.HoverProvider {
	async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position
	): Promise<vscode.Hover | undefined> {
		const line = document.lineAt(position.line).text;

		console.log('[Dialogue] ========== 标签悬停被触发 ==========');

		// ✅ 匹配光标位置的标签
		const tagRegex = /\[(\/?[a-zA-Z_][a-zA-Z0-9_]*)(?:=([^\]]+))?\]/g;
		let match;

		while ((match = tagRegex.exec(line)) !== null) {
			const tagStart = match.index;
			const tagEnd = match.index + match[0].length;
			const tagName = match[1].replace(/^\//, '');  // 去掉闭合标签的 /
			const tagValue = match[2];

			// 检查光标是否在标签范围内
			if (position.character >= tagStart && position.character <= tagEnd) {
				console.log(`[Dialogue] 🔍 找到标签: [${match[1]}${tagValue ? '=' + tagValue : ''}]`);

				// 查找标签定义
				const tagDef = DIALOGUE_TAGS.find(t => t.name === tagName);
				if (!tagDef) {
					console.log(`[Dialogue] ⚠️ 未知标签: ${tagName}`);
					return undefined;
				}

				// ✅ 生成悬停文档
				const docs: string[] = [];

				const categoryIcons = {
					time: '⏱️',
					audio: '🔊',
					effect: '✨',
					ui: '🎮'
				};

				docs.push(`## ${categoryIcons[tagDef.category]} ${tagDef.name}`);
				docs.push('');
				docs.push(`**描述:** ${tagDef.description}`);
				docs.push('');
				docs.push('**示例:**');
				docs.push('```dialogue');
				docs.push(tagDef.example);
				docs.push('```');

				if (tagDef.hasValue) {
					docs.push('');
					docs.push(`**参数类型:** \`${tagDef.valueType}\``);
					docs.push(`**参数说明:** ${tagDef.valueHint}`);

					// ✅ 显示当前值
					if (tagValue) {
						docs.push('');
						docs.push(`**当前值:** \`${tagValue}\``);

						// ✅ 验证值（可选）
						if (tagDef.valueType === 'number' && isNaN(Number(tagValue))) {
							docs.push('');
							docs.push('⚠️ **警告:** 当前值不是有效的数字');
						}
					}
				}

				if (tagDef.isPair) {
					docs.push('');
					docs.push('⚠️ **成对标签**，需要闭合标签 `[/' + tagDef.name + ']`');
				}

				return new vscode.Hover(new vscode.MarkdownString(docs.join('\n')));
			}
		}

		return undefined;
	}
}