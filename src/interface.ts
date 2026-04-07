/** Godot 全局类信息 */
export interface GodotClass {
	name: string;           // 类名
	base: string;           // 基类
	path: string;           // 文件路径
	isTool: boolean;        // 是否是工具脚本
	methods: GodotMethod[]; // 方法列表
	properties: GodotProperty[]; // 属性列表
	signals: string[];      // 信号列表
	classComment?: string;  // 类级别的文档注释
}

/** 方法信息 */
export interface GodotMethod {
	name: string;
	returnType: string;
	params: GodotMethodParam[];
	isStatic: boolean;
	docComment?: string;
}

/** 方法参数信息 */
export interface GodotMethodParam {
	name: string;
	type: string;
	defaultValue?: string;  // 默认值（如果存在则为可选参数）
	fullText: string;       // 完整文本（如 "slot_id: int = 1"）
}

/** 属性信息 */
export interface GodotProperty {
	name: string;
	type: string;
	isExported: boolean;
}

/** 全局变量定义（支持复杂嵌套类型） */
export interface GlobalVariable {
	type: string;       // 基础类型
	comment?: string;   // 说明
	schema?: GlobalVariableSchema;  // 新增：Dictionary 的内部结构
	itemType?: string;  // 新增：Array 的元素类型
}

/** 变量结构定义（支持递归） */
export interface GlobalVariableSchema {
	[key: string]: GlobalVariable;  // 递归定义，支持无限嵌套
}

/** 全局变量配置(从 settings.json 读取) */
export interface GlobalVariablesConfig {
	[variableName: string]: GlobalVariable;
}