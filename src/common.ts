import path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { GodotClass, GlobalVariable, GodotMethodParam, GlobalVariablesConfig } from './interface';

/** ============ 类缓存管理器 ============ */
export class GodotClassCache {
  private classes: Map<string, GodotClass> = new Map();
  private autoloads: Map<string, string> = new Map(); // 单例名 -> 文件路径
  private workspaceFolder?: vscode.WorkspaceFolder;
  private cachedGlobalClassNames: string = '';

  private globalMembers: Map<string, { className: string; type: 'method' | 'property' | 'signal' }> = new Map();
  /** 全局变量存储 */
  private globalVariables: Map<string, GlobalVariable> = new Map();

  constructor(workspaceFolder?: vscode.WorkspaceFolder) {
    this.workspaceFolder = workspaceFolder;
  }

  /**
   * 新增：解析变量的属性路径
   * 例如：playerStats.equipment.weapon
   * 返回最终属性的类型和注释
    */
  resolveVariableProperty(
    variableName: string,
    propertyPath: string[]
  ): { type: string; comment?: string } | undefined {
    const variable = this.globalVariables.get(variableName);
    if (!variable) {
      console.log(`[Dialogue] ❌ 未找到全局变量: ${variableName}`);
      return undefined;
    }

    console.log(`[Dialogue] 🔍 解析属性路径: ${variableName}.${propertyPath.join('.')}`);

    // 从根变量开始递归查找
    return this.resolvePropertyInSchema(variable, propertyPath, 0);
  }

  /**
   * 新增：在 schema 中递归查找属性
   */
  private resolvePropertyInSchema(
    current: GlobalVariable,
    propertyPath: string[],
    depth: number
  ): { type: string; comment?: string } | undefined {
    // 已经到达路径末尾
    if (depth >= propertyPath.length) {
      return { type: current.type, comment: current.comment };
    }

    const currentProp = propertyPath[depth];

    // 如果当前类型不是 Dictionary，无法继续访问
    if (current.type !== 'Dictionary' || !current.schema) {
      console.log(`[Dialogue] ⚠️ 无法访问 ${current.type} 的属性: ${currentProp}`);
      return undefined;
    }

    // 在 schema 中查找属性
    const nextProp = current.schema[currentProp];
    if (!nextProp) {
      console.log(`[Dialogue] ❌ 属性不存在: ${currentProp}`);
      return undefined;
    }

    // 递归查找下一层
    return this.resolvePropertyInSchema(nextProp, propertyPath, depth + 1);
  }

  /**
   * 新增：获取 Dictionary 的所有属性（用于补全）
   */
  getVariableProperties(variableName: string, propertyPath: string[]): Array<{
    name: string;
    type: string;
    comment?: string;
  }> {
    const variable = this.globalVariables.get(variableName);
    if (!variable) return [];

    // 逐层深入，找到目标 Dictionary
    let current = variable;
    for (const prop of propertyPath) {
      if (current.type !== 'Dictionary' || !current.schema) {
        return [];
      }
      const next = current.schema[prop];
      if (!next) return [];
      current = next;
    }

    // 返回当前层级的所有属性
    if (current.type !== 'Dictionary' || !current.schema) {
      return [];
    }

    return Object.entries(current.schema).map(([name, def]) => ({
      name,
      type: def.type,
      comment: def.comment
    }));
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

    // 4. 加载全局变量
    this.loadGlobalVariables();

    console.log('[Dialogue] 类缓存初始化完成');
    console.log('[Dialogue] 📊 全局类数量:', this.classes.size);
    console.log('[Dialogue] 📊 AutoLoad 数量:', this.autoloads.size);
    console.log('[Dialogue] 📊 全局成员数量:', this.globalMembers.size);
    console.log('[Dialogue] 📊 全局变量数量:', this.globalVariables.size);
  }

  /**
   * 新增：构建全局成员索引
   * 从配置的全局类中提取所有公开成员
   */
  private buildGlobalMembersIndex(): void {
    // 获取配置的全局类列表
    const config = vscode.workspace.getConfiguration('dialogue');
    const globalClassNames: string[] = config.get('diagnostics.globalClasses', []);

    // 优化：检查配置是否变化
    const currentConfig = JSON.stringify(globalClassNames);
    if (this.cachedGlobalClassNames === currentConfig && this.globalMembers.size > 0) {
      console.log('[Dialogue] 🔄 配置未变化，跳过重建索引');
      return;
    }

    console.log('[Dialogue] 🌐 配置已变化，重新构建全局成员索引');
    console.log('[Dialogue] 📋 配置的全局类:', globalClassNames);

    // 更新缓存
    this.cachedGlobalClassNames = currentConfig;

    // 清空旧索引
    this.globalMembers.clear();

    // 以下代码保持不变
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
   * 新增：刷新全局成员索引（配置变更时调用）
   */
  refreshGlobalMembers(): void {
    console.log('[Dialogue] 🔄 配置变更，触发索引刷新');

    // 强制清除缓存，触发重建
    this.cachedGlobalClassNames = '';

    this.buildGlobalMembersIndex();
  }

  /**
   * 新增：根据成员名查找所属的全局类
   */
  resolveGlobalMember(memberName: string): { className: string; type: 'method' | 'property' | 'signal' } | undefined {
    return this.globalMembers.get(memberName);
  }

  /**
   * 新增：获取所有全局成员（用于补全）
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

      classInfo.classComment = this.extractClassComment(lines);

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
          const params = this.parseMethodParams(funcMatch[2]);  // 新方法

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
   * 提取文件顶部的类注释（连续的 ##）
   */
  private extractClassComment(lines: string[]): string | undefined {
    const comments: string[] = [];
    let started = false;
    for (const line of lines) {
      const trimmed = line.trim();
      // 遇到第一个 ## 时开始收集
      if (trimmed.startsWith('##')) {
        started = true;
        const text = trimmed.substring(2).trim();
        if (text) {  // 跳过空注释行
          comments.push(text);
        }
        continue;
      }
      // 遇到非注释行时停止
      if (started && trimmed && !trimmed.startsWith('#')) {
        break;
      }
    }
    return comments.length > 0 ? comments.join('\n') : undefined;
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

      // 匹配格式：name: Type = default_value
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
      console.log(`[Dialogue] 找到: ${cls.name} (${cls.methods.length} 方法, ${cls.properties.length} 属性)`);
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

  /**
   * 加载全局变量配置
   */
  loadGlobalVariables(): void {
    const config = vscode.workspace.getConfiguration('dialogue');
    const varsConfig: GlobalVariablesConfig = config.get('diagnostics.globalVariables', {});
    this.globalVariables.clear();
    for (const [name, def] of Object.entries(varsConfig)) {
      // 检查类型是否是内置类型或已定义的类
      const isBuiltIn = ['String', 'int', 'float', 'bool', 'Array', 'Dictionary', 'Variant', 'Node', 'Node2D', 'Node3D'].includes(def.type);
      const isCustomClass = this.classes.has(def.type);
      if (!isBuiltIn && !isCustomClass) {
        console.warn(`[Dialogue] ⚠️ 全局变量 '${name}' 的类型 '${def.type}' 未找到`);
      }
      this.globalVariables.set(name, def);
      console.log(`[Dialogue] 🌐 全局变量: ${name} (${def.type})`);
    }
    console.log(`[Dialogue] 📊 全局变量数量: ${this.globalVariables.size}`);
  }
  /**
   * 获取全局变量
   */
  getGlobalVariable(name: string): GlobalVariable | undefined {
    return this.globalVariables.get(name);
  }
  /**
   * 获取所有全局变量(用于补全)
   */
  getAllGlobalVariables(): Array<{ name: string; def: GlobalVariable }> {
    return Array.from(this.globalVariables.entries()).map(([name, def]) => ({ name, def }));
  }
  /**
   * 刷新全局变量(配置变更时调用)
   */
  refreshGlobalVariables(): void {
    console.log('[Dialogue] 🔄 刷新全局变量配置');
    this.loadGlobalVariables();
  }
}