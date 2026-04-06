# Godot Dialogue Manager - VSCode Extension

一个为 Godot Engine 的 Dialogue Manager [<sup>1</sup>](https://github.com/hakubox/dialogue-godot-support) 插件提供完整开发支持的 VSCode 扩展。

<p align="center">
  <img src="icon.png" alt="Logo" width="200"/>
</p>

---

## ✨ 主要特性

### 🎨 语法高亮
- 完整支持 Dialogue Manager 语法
- 支持角色对话、旁白、选项、条件分支等
- 内置标签和 BBCode 高亮
- 代码块和表达式语法着色

### 🧠 智能补全

#### 1️⃣ Godot 类和方法补全
- 自动识别项目中的全局类（`class_name`）
- 支持 AutoLoad 单例补全
- 方法、属性、信号的智能提示
- 参数类型提示和函数签名帮助

```dialogue
do PlayerState.add_gold(100)  # ← 自动补全 PlayerState 的方法
set player.health += 10        # ← 补全属性
if AudioManager.is_playing()   # ← 补全 AutoLoad 单例
```

#### 2️⃣ Import 路径补全
- 智能扫描工作区中所有 `.dialogue` 文件
- 自动生成 PascalCase 别名
- 支持目录层级导航
- 实时文件系统监听

```dialogue
import "res://dialogues/chapter1/scene_a.dialogue" as SceneA
```

#### 3️⃣ 段落跳转补全
- 自动补全当前文件的段落（`~ xxx`）
- 支持跨文件段落引用（`import` 的文件）
- 内置 `END` 和 `END!` 关键字
- 支持立即跳转标识符（`!`）

```dialogue
=> start           # 跳转到本地段落
=> SceneA/intro    # 跳转到导入文件的段落
=> END!            # 强制结束对话
=> next_scene!     # 立即跳转（不等待当前对话显示完成）
```

#### 4️⃣ Dialogue 标签补全
- 内置 20+ 个常用标签
- 按类别分组（时间控制、音效、文本效果、UI）
- 智能占位符和成对标签自动闭合
- 参数类型提示

```dialogue
NPC: 你好[wait=1.5]，欢迎！  # ← 输入 [ 自动提示标签
这是[wave]波浪文字[/wave]      # ← 成对标签自动补全
```

---

### 🔍 悬停提示

#### Godot 类和成员
- 显示类的继承关系和路径
- 方法参数、返回值详细信息
- 支持 GDScript 风格的文档注释（`##`）
- 属性类型和导出标记

```dialogue
# 悬停在 PlayerState.add_gold 上：
📦 add_gold(amount: int, reason: String = "") -> void

增加玩家金币
参数:
  - amount (int): 增加的金币数量
  - reason (String): 增加原因（可选）

返回: void
```

#### Import 路径
- 显示文件大小和对话标题数量
- 完整的文件路径信息
- 一键跳转到文件

#### 段落引用
- 显示段落的注释说明
- 标注来源文件（本地或导入）
- 支持 `END` / `END!` 特殊标记

```dialogue
# 悬停在 => start 上：
📍 start

标题节点
位置: 第 4 行

💡 提示: 按 Ctrl + 点击 可跳转到定义
```

#### Dialogue 标签
- 标签用途说明和示例
- 参数类型和取值范围
- 当前值验证

---

### ⚙️ 高级配置

#### 全局成员访问（无需类名前缀）

在 VSCode 的 `settings.json` 中配置：

```json
{
  "dialogue.diagnostics.globalClasses": [
    "PlayerState",
    "AudioManager",
    "SaveManager"
  ]
}
```

---

### 🚀 跳转到定义

#### Godot 类和成员
- `Ctrl + 点击` 跳转到 GDScript 源文件
- 精确定位到类名、方法、属性、信号的定义行

#### Import 路径
- 快速打开导入的 `.dialogue` 文件

#### 段落引用
- 跳转到段落定义（`~ xxx`）
- 支持跨文件跳转

---

### 🔧 代码诊断和快速修复

#### 实时错误检测
1. **类名拼写错误**
   - ❌ `PlayerStat.add_gold(100)` → 未找到类 'PlayerStat'
   - ✅ 建议：`PlayerState`

2. **方法名拼写错误**
   - ❌ `PlayerState.add_gld(100)` → 方法不存在
   - ✅ 建议：`add_gold`

3. **参数数量错误**
   - ❌ `PlayerState.add_gold()` → 需要 1-2 个参数，但传入了 0 个
   - ✅ 快速修复：自动填充必需参数

4. **参数类型错误**
   - ⚠️ `PlayerState.add_gold("100")` → 期望 int，实际 String
   - ✅ 快速修复：转换为 `int("100")`

#### 智能快速修复
- 拼写错误纠正（基于编辑距离算法）
- 自动填充缺失参数
- 类型转换建议
- 移除多余参数

---

## 📦 安装

### 方法 1：从 VSCode 市场安装
1. 打开 VSCode
2. 按 `Ctrl+Shift+X` 打开扩展面板
3. 搜索 `Godot Dialogue Manager`
4. 点击 **Install**

### 方法 2：手动安装
1. 从 GitHub Releases [<sup>3</sup>](https://github.com/hakubox/dialogue-godot-support/releases) 下载最新 `.vsix` 文件
2. 在 VSCode 中按 `Ctrl+Shift+P`
3. 输入 `Extensions: Install from VSIX...`
4. 安装下载的 `.vsix` 文件

### 方法 3: 手动打包
1. 从 GitHub获取代码
2. 执行命令 `vsce package --out ./dist/`
3. 安装生成的 `.vsix` 文件

---

## 🎯 使用示例

### 基础对话
```dialogue
~ start
# 开场对话

NPC: 你好，欢迎来到这个世界！[#happy]
这是一段旁白文字。

Sophie: 我是 Sophie，很高兴认识你。[#neutral]

=> next_scene
```

### 条件分支和变量
```dialogue
~ check_level

if PlayerState.level >= 5
	NPC: 你的等级很高啊！[wave]真厉害[/wave]
elif PlayerState.level >= 3
	NPC: 你还需要多加努力。
else
	NPC: 新手村欢迎你！

set PlayerState.gold += 100
do AudioManager.play_sfx("coin")

=> END
```

### 跨文件引用
```dialogue
import "res://dialogues/common.dialogue" as Common
import "res://dialogues/chapter1.dialogue" as Ch1

~ start
NPC: 让我们开始冒险吧！

- 前往第一章 => Ch1/intro
- 查看通用对话 => Common/help
- 离开 => END

~ help
这是帮助信息...
=> start
```

### 选项分支
```dialogue
~ choice_example

NPC: 你想要什么？

- 我要金币 => give_gold [if PlayerState.can_afford(50)]
- 我要装备 => give_equipment
- 算了，我不需要 => END

~ give_gold
do PlayerState.add_gold(100)
NPC: 给你 100 金币！
=> END!

~ give_equipment
do! InventoryManager.add_item("sword")
NPC: 这把剑送给你。
=> END
```

---

## 🏗️ 工作原理

### 类缓存机制
1. 读取 `.godot/global_script_class_cache.cfg` 获取全局类
2. 解析 `project.godot` 获取 AutoLoad 单例
3. 扫描所有 GDScript 文件，提取：
   - 方法签名（参数、返回值、静态标记）
   - 属性类型和 `@export` 标记
   - 信号定义
   - 文档注释（`##`）

### 段落管理
1. 监听 `.dialogue` 文件的打开、修改、关闭事件
2. 实时扫描段落定义（`~ xxx`）
3. 解析 `import` 语句，递归扫描导入的文件
4. 构建段落索引（支持本地和跨文件引用）

### 智能触发
- 只在特定上下文触发补全（`do`、`set`、`if`、`{{`、`[`、`=>`）
- 避免在对话文本、旁白、注释中干扰用户

---

## 📋 支持的 Dialogue Manager 语法

### 核心语法
- ✅ 段落定义（`~ title`）
- ✅ 角色对话（`NPC: 对话内容`）
- ✅ 旁白（直接文本）
- ✅ 选项（`- 选项文本 => target`）
- ✅ 跳转（`=> title`、`=> END`）
- ✅ 条件分支（`if`、`elif`、`else`）
- ✅ 循环（`while`）
- ✅ 匹配（`match`、`when`）
- ✅ 变量操作（`set`、`do`、`do!`）
- ✅ Import 和 Using

### 内联语法
- ✅ 变量插值（`{{expression}}`）
- ✅ 行内条件（`[if]...[elif]...[else]...[endif]`）
- ✅ 行内突变（`[set]`、`[do]`）
- ✅ 随机选项（`[[A|B|C]]`）
- ✅ ID 标签（`[ID:xxx]`）

### 特殊标签
- ✅ 时间控制（`[wait]`、`[speed]`、`[pause]`）
- ✅ 音效（`[sound]`、`[voice]`）
- ✅ 文本效果（`[wave]`、`[shake]`、`[rainbow]`、`[ghost]`、`[pulse]`）
- ✅ UI 控制（`[b]`、`[br]`、`[signal]`、`[next]`、`[auto]`、`[jump]`）

### BBCode 支持
- ✅ 所有 Godot RichTextLabel 的 BBCode 标签

---

## 🐛 已知问题

1. **首次打开项目时，补全可能需要等待几秒**
   - 原因：需要扫描 GDScript 文件并构建类缓存
   - 解决方案：等待日志输出 `✅ 类缓存初始化完成`

2. **跨文件段落引用在首次编辑时可能不生效**
   - 原因：导入的文件尚未被扫描
   - 解决方案：打开一次导入的 `.dialogue` 文件

3. **私有成员（`_` 开头）不显示在补全列表中**
   - 这是预期行为，符合 GDScript 的可见性规则

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

### 开发环境设置
```bash
git clone https://github.com/hakubox/dialogue-godot-support.git
cd dialogue-godot-support
npm install
```

### 调试
1. 在 VSCode 中打开项目
2. 按 `F5` 启动扩展开发主机
3. 在新窗口中打开 Godot 项目测试

---

## 📄 许可证

MIT License - 详见 LICENSE [<sup>4</sup>](LICENSE) 文件

---

## 🙏 致谢

- Godot Engine [<sup>5</sup>](https://godotengine.org/)
- Dialogue Manager Plugin [<sup>1</sup>](https://github.com/NPChoad/godot_dialogue_manager) by NPC Hoad
- VSCode Extension API [<sup>6</sup>](https://code.visualstudio.com/api)

---

## 📧 联系方式

- GitHub Issues: 提交问题 [<sup>7</sup>](https://github.com/hakubox/dialogue-godot-support/issues)
- 作者: hakubox
- 邮箱: hakubox@outlook.com