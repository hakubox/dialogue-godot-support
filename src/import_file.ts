// ============ Import 路径补全提供者 ============

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// ============ 增强的 Import 补全提供者 ============

/**
 * 递归搜索所有 .dialogue 文件
 */
interface DialogueFileInfo {
	relativePath: string;  // 相对于工作区的路径
	resPath: string;       // res:// 路径
	fileName: string;      // 文件名（不含扩展名）
	fullPath: string;      // 完整文件系统路径
	depth: number;         // 目录深度
}


/**
 * Import 语句补全提供者（增强版）
 */
export class ImportPathCompletionProvider implements vscode.CompletionItemProvider {
	private dialogueFiles: DialogueFileInfo[] = [];
	private workspaceFolder?: vscode.WorkspaceFolder;

	constructor(workspaceFolder?: vscode.WorkspaceFolder) {
		this.workspaceFolder = workspaceFolder;
		
		// ✅ 初始化时扫描所有 .dialogue 文件
		if (workspaceFolder) {
			this.scanDialogueFiles();
		}
	}

	/**
	 * 扫描工作区中所有 .dialogue 文件
	 */
	private scanDialogueFiles(): void {
		if (!this.workspaceFolder) return;

		console.log('[Dialogue] 🔍 开始扫描 .dialogue 文件...');

		this.dialogueFiles = [];
		const rootPath = this.workspaceFolder.uri.fsPath;

		this.scanDirectory(rootPath, '', 0);

		console.log(`[Dialogue] ✅ 找到 ${this.dialogueFiles.length} 个 .dialogue 文件`);
	}

	/**
	 * 递归扫描目录
	 */
	private scanDirectory(absolutePath: string, relativePath: string, depth: number): void {
		// ✅ 限制递归深度，避免性能问题
		if (depth > 10) return;

		// ✅ 跳过隐藏目录和特殊目录
		const skipDirs = ['.godot', '.git', 'node_modules', 'addons'];
		const dirName = path.basename(absolutePath);
		
		if (dirName.startsWith('.') || skipDirs.includes(dirName)) {
			return;
		}

		try {
			const entries = fs.readdirSync(absolutePath, { withFileTypes: true });

			for (const entry of entries) {
				const entryAbsolutePath = path.join(absolutePath, entry.name);
				const entryRelativePath = relativePath 
					? path.join(relativePath, entry.name)
					: entry.name;

				if (entry.isDirectory()) {
					// 递归扫描子目录
					this.scanDirectory(entryAbsolutePath, entryRelativePath, depth + 1);
				} else if (entry.isFile() && entry.name.endsWith('.dialogue')) {
					// 添加 .dialogue 文件
					const resPath = 'res://' + entryRelativePath.replace(/\\/g, '/');
					const fileName = entry.name.replace('.dialogue', '');

					this.dialogueFiles.push({
						relativePath: entryRelativePath,
						resPath: resPath,
						fileName: fileName,
						fullPath: entryAbsolutePath,
						depth: depth
					});
				}
			}
		} catch (error) {
			console.error(`[Dialogue] ❌ 扫描目录失败: ${absolutePath}`, error);
		}
	}

  async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
		context: vscode.CompletionContext
	): Promise<vscode.CompletionItem[]> {
		const line = document.lineAt(position.line).text;
		const beforeCursor = line.substring(0, position.character);

		console.log('[Dialogue] ========== Import 补全被触发 ==========');
		console.log('[Dialogue] 📝 光标前内容:', beforeCursor);

		// ✅ 严格检查：必须是 import 语句开头
		if (!/^\s*import\b/.test(line)) {
			console.log('[Dialogue] ⚠️ 不是 import 语句，跳过');
			return [];
		}

		// ✅ 场景 1: 刚输入 import（后面可能有空格）
		if (/^\s*import\s*$/.test(beforeCursor)) {
			console.log('[Dialogue] 💡 检测到 import，显示所有 .dialogue 文件');
			return this.provideAllDialogueFiles();
		}

		// ✅ 场景 2: 正在输入路径
		const pathMatch = beforeCursor.match(/^\s*import\s+"(res:\/\/[^"]*)$/);
		if (pathMatch) {
			const currentPath = pathMatch[1];
			console.log('[Dialogue] 📂 正在输入路径:', currentPath);
			return this.provideFilteredFiles(currentPath);
		}

		// ✅ 场景 3: 路径输入完成，等待 as
		const completedPathMatch = beforeCursor.match(/^\s*import\s+"(res:\/\/[^"]+)"\s*$/);
		if (completedPathMatch) {
			const filePath = completedPathMatch[1];
			console.log('[Dialogue] 💡 路径已完成，提示 as');
			return this.provideAsAliasCompletion(filePath);
		}

		// ✅ 场景 4: 正在输入别名
		const aliasMatch = beforeCursor.match(/^\s*import\s+"(res:\/\/[^"]+)"\s+as\s+(\w*)$/);
		if (aliasMatch) {
			const filePath = aliasMatch[1];
			console.log('[Dialogue] 💡 正在输入别名');
			return this.provideAsAliasCompletion(filePath);
		}

		console.log('[Dialogue] ⚠️ 不在 import 补全上下文中');
		return [];
	}

	/**
	 * 提供所有 .dialogue 文件的补全
	 */
	private provideAllDialogueFiles(): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];

		// ✅ 按目录深度排序（浅层目录优先）
		const sortedFiles = [...this.dialogueFiles].sort((a, b) => {
			if (a.depth !== b.depth) return a.depth - b.depth;
			return a.fileName.localeCompare(b.fileName);
		});

		for (const file of sortedFiles) {
			const item = new vscode.CompletionItem(
				file.fileName,
				vscode.CompletionItemKind.File
			);

			// ✅ 生成别名
			const alias = this.generateAlias(file.fileName);

			// ✅ 使用 Snippet 插入完整的 import 语句
			item.insertText = new vscode.SnippetString(
				`"${file.resPath}" as \${1:${alias}}`
			);

			// ✅ 显示详细信息
			const pathParts = file.relativePath.split(path.sep);
			const dirPath = pathParts.slice(0, -1).join('/') || '根目录';

			item.detail = `📄 ${dirPath}`;
			item.filterText = `${file.fileName} ${file.relativePath}`;  // 支持路径搜索

			// ✅ 文档
			const docs: string[] = [];
			docs.push(`## 📄 ${file.fileName}.dialogue`);
			docs.push('');
			docs.push(`**完整路径:** \`${file.resPath}\``);
			docs.push(`**目录:** \`${dirPath}\``);
			docs.push(`**建议别名:** \`${alias}\``);
			docs.push('');
			docs.push('---');
			docs.push('');
			docs.push('💡 **自动生成:** `import "' + file.resPath + '" as ' + alias + '`');

			item.documentation = new vscode.MarkdownString(docs.join('\n'));

			// ✅ 排序：根目录优先，然后按深度
			item.sortText = `${file.depth}_${file.fileName}`;

			items.push(item);
		}

		console.log(`[Dialogue] 📦 返回 ${items.length} 个文件补全项`);
		return items;
	}

	/**
	 * 提供过滤后的文件补全（根据当前输入的路径）
	 */
	private provideFilteredFiles(currentPath: string): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];

		// ✅ 提取当前目录路径
		const pathWithoutProtocol = currentPath.replace('res://', '');
		const currentDir = pathWithoutProtocol.endsWith('/') 
			? pathWithoutProtocol 
			: path.dirname(pathWithoutProtocol) + '/';

		console.log('[Dialogue] 📂 当前目录:', currentDir);

		// ✅ 1. 添加子目录补全
		const uniqueDirs = new Set<string>();
		
		for (const file of this.dialogueFiles) {
			const fileDir = path.dirname(file.relativePath).replace(/\\/g, '/') + '/';
			
			// 如果文件在当前目录的子目录中
			if (fileDir.startsWith(currentDir) && fileDir !== currentDir) {
				const subDir = fileDir.substring(currentDir.length).split('/')[0];
				
				if (subDir && !uniqueDirs.has(subDir)) {
					uniqueDirs.add(subDir);

					const item = new vscode.CompletionItem(
						subDir,
						vscode.CompletionItemKind.Folder
					);

					const newPath = `res://${currentDir}${subDir}/`;
					item.insertText = newPath;
					item.detail = '📁 目录';
					item.sortText = `0_${subDir}`;

					items.push(item);
				}
			}
		}

		// ✅ 2. 添加当前目录中的文件
		for (const file of this.dialogueFiles) {
			const fileDir = path.dirname(file.relativePath).replace(/\\/g, '/') + '/';

			if (fileDir === currentDir) {
				const item = new vscode.CompletionItem(
					file.fileName,
					vscode.CompletionItemKind.File
				);

				const alias = this.generateAlias(file.fileName);

				item.insertText = new vscode.SnippetString(
					`${file.resPath}" as \${1:${alias}}`
				);

				item.detail = '📄 Dialogue 文件';
				item.documentation = new vscode.MarkdownString(
					`**路径:** \`${file.resPath}\`\n\n**别名:** \`${alias}\``
				);

				item.sortText = `1_${file.fileName}`;

				items.push(item);
			}
		}

		console.log(`[Dialogue] 📦 返回 ${items.length} 个过滤后的补全项`);
		return items;
	}

	/**
	 * 提供 as 别名补全
	 */
	private provideAsAliasCompletion(filePath: string): vscode.CompletionItem[] {
		const items: vscode.CompletionItem[] = [];

		// ✅ 从路径中提取文件名
		const fileName = path.basename(filePath, '.dialogue');
		const alias = this.generateAlias(fileName);

		console.log('[Dialogue] 💡 建议别名:', alias);

		// ✅ 创建补全项
		const item = new vscode.CompletionItem(
			`as ${alias}`,
			vscode.CompletionItemKind.Keyword
		);

		item.insertText = new vscode.SnippetString(`as \${1:${alias}}`);
		item.detail = '📝 导入别名';
		item.documentation = new vscode.MarkdownString(
			`根据文件名 \`${fileName}\` 自动生成的别名\n\n` +
			`完整语句:\n\`\`\`dialogue\nimport "${filePath}" as ${alias}\n\`\`\``
		);

		items.push(item);

		return items;
	}

	/**
	 * 生成别名（PascalCase）
	 */
	private generateAlias(fileName: string): string {
		// 移除扩展名
		const nameWithoutExt = fileName.replace(/\.dialogue$/, '');

		// 分割下划线、连字符或空格
		const words = nameWithoutExt.split(/[-_\s]/);

		// 转为 PascalCase
		const pascalCase = words.join('');

		return pascalCase;
	}

	/**
	 * 刷新文件列表（当文件系统变化时调用）
	 */
	public refresh(): void {
		console.log('[Dialogue] 🔄 刷新 .dialogue 文件列表');
		this.scanDialogueFiles();
	}
}


// ============ Import 悬停提示提供者 ============

export class ImportHoverProvider implements vscode.HoverProvider {
	constructor(private workspaceFolder?: vscode.WorkspaceFolder) {}

	async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position
	): Promise<vscode.Hover | undefined> {
		const line = document.lineAt(position.line).text;

		// ✅ 匹配 import 语句
		const importMatch = line.match(/^\s*import\s+"(res:\/\/[^"]+)"\s+as\s+(\w+)/);
		if (!importMatch) return undefined;

		const [, filePath, alias] = importMatch;

		// 检查光标是否在路径或别名上
		const pathStart = line.indexOf(filePath);
		const pathEnd = pathStart + filePath.length;
		const aliasStart = line.lastIndexOf(alias);
		const aliasEnd = aliasStart + alias.length;

		const isOnPath = position.character >= pathStart && position.character <= pathEnd;
		const isOnAlias = position.character >= aliasStart && position.character <= aliasEnd;

		if (!isOnPath && !isOnAlias) return undefined;

		// ✅ 获取文件信息
		if (!this.workspaceFolder) return undefined;

		const fsPath = path.join(
			this.workspaceFolder.uri.fsPath,
			filePath.replace('res://', '')
		);

		if (!fs.existsSync(fsPath)) {
			return new vscode.Hover(
				new vscode.MarkdownString(`⚠️ **文件不存在**\n\n路径: \`${filePath}\``)
			);
		}

		// ✅ 读取文件信息
		const stat = fs.statSync(fsPath);
		const content = fs.readFileSync(fsPath, 'utf-8');
		const lines = content.split('\n');

		// 统计标题数量
		const titleCount = lines.filter(line => line.trim().startsWith('~')).length;

		const docs: string[] = [];
		docs.push(`## 📄 ${path.basename(filePath)}`);
		docs.push('');
		docs.push(`**路径:** \`${filePath}\``);
		docs.push(`**别名:** \`${alias}\``);
		docs.push(`**大小:** ${(stat.size / 1024).toFixed(2)} KB`);
		docs.push(`**对话标题数量:** ${titleCount}`);
		docs.push('');
		docs.push('---');
		docs.push('');
		docs.push('💡 **提示:** 使用 `Ctrl + 点击` 可以跳转到文件');

		return new vscode.Hover(new vscode.MarkdownString(docs.join('\n')));
	}
}

