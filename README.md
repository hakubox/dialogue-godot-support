# Godot Dialogue Manager - VSCode 扩展

<p align="center">
  <img src="icon.png" alt="Logo" width="200"/>
</p>

<p align="center">
  <strong>为 Godot 4.x Dialogue Manager 提供完整开发支持的 VSCode 扩展</strong>
</p>

<p align="center">
  <a href="https://github.com/hakubox/dialogue-godot-support">GitHub</a> •
  <a href="https://github.com/hakubox/dialogue-godot-support/issues">报告问题</a> •
  <a href="https://github.com/hakubox/dialogue-godot-support/releases">下载</a>
</p>

---

## 📖 目录

- 核心功能 [<sup>1</sup>](#-核心功能)
- 快速开始 [<sup>2</sup>](#-快速开始)
- 详细功能说明 [<sup>3</sup>](#-详细功能说明)
- 配置选项 [<sup>4</sup>](#-配置选项)
- 使用示例 [<sup>5</sup>](#-使用示例)
- 常见问题 [<sup>6</sup>](#-常见问题)
- 开发与贡献 [<sup>7</sup>](#-开发与贡献)

---

## ✨ 核心功能

### 🎨 **完整的语法高亮**
- 支持 Dialogue Manager 全部语法（段落、对话、选项、条件、循环等）
- BBCode 和内置标签高亮
- 代码块和表达式语法着色

### 🧠 **智能代码补全**
| 类型 | 说明 | 触发方式 |
|------|------|----------|
| **Godot 类/方法** | 自动识别项目中的全局类、AutoLoad 单例、方法、属性、信号 | 输入类名后按 `.` |
| **段落跳转** | 本地和跨文件段落补全，支持 `END`/`END!` 关键字 | 输入 `=>` 或 `-` 后 |
| **Import 路径** | 智能扫描工作区 `.dialogue` 文件，自动生成别名 | 输入 `import ` 后 |
| **Dialogue 标签** | 20+ 内置标签（时间、音效、文本效果等） | 输入 `[` 后 |
| **自定义元数据标签** | 支持自定义标签（表情、音效、特效等），可配置别名 | 输入 `[#` 后 |

### 🔍 **悬停提示**
- **Godot 成员**: 显示方法签名、参数、返回值、文档注释
- **段落引用**: 显示段落说明、来源文件、预览内容
- **Import 路径**: 显示文件大小、段落数量
- **标签**: 显示用途、参数说明、示例

### 🚀 **跳转到定义**
- `Ctrl + 点击` 跳转到 GDScript 源文件（类/方法/属性/信号）
- 跳转到段落定义（支持跨文件）
- 跳转到导入的 `.dialogue` 文件

### 🔧 **实时诊断与快速修复**
- 检测类名、方法名拼写错误
- 验证参数数量和类型
- 检测未定义的段落引用
- 一键快速修复（拼写纠正、类型转换、参数填充）

### 📦 **文案导出**
- 导出为 JSON、CSV、Markdown
- 自动提取角色对话、旁白、选项
- 移除 BBCode 和标签（可选保留原始文本）
- 支持台词 ID 管理（添加/清除）

### 🗂️ **代码折叠**
- 自动折叠段落（`~ title` 到最后的 `=>`）
- 支持 `#region` / `#endregion` 自定义区域

---

## 🚀 快速开始

### 1. 安装扩展

#### 方法 A：从 VSCode 市场安装
1. 打开 VSCode
2. 按 `Ctrl+Shift+X` 打开扩展面板
3. 搜索 `Godot Dialogue Manager`
4. 点击 **Install**

#### 方法 B：手动安装 `.vsix`
1. 从 GitHub Releases [<sup>8</sup>](https://github.com/hakubox/dialogue-godot-support/releases) 下载最新 `.vsix` 文件
2. 在 VSCode 中按 `Ctrl+Shift+P`
3. 输入 `Extensions: Install from VSIX...`
4. 选择下载的 `.vsix` 文件

### 2. 打开 Godot 项目
确保你的项目包含 Dialogue Manager 插件，并且有 `.dialogue` 文件。

### 3. 开始编写对话
创建或打开一个 `.dialogue` 文件，输入以下内容测试：

```dialogue
~ start
# 这是一个测试段落

NPC: 你好！[#happy]
Player: 你好，请问...

- 我想购买物品 => shop
- 我要离开 => END

~ shop
do! ShopManager.open_shop()
=> END
```

---

## 📚 详细功能说明

### 1️⃣ **Godot 类和方法补全**

#### 🔹 自动识别项目中的类
扩展会扫描 `.godot/global_script_class_cache.cfg` 和 `project.godot`，自动识别：
- 所有 `class_name` 定义的全局类
- AutoLoad 单例（如 `PlayerState`、`AudioManager`）
- 继承关系和文档注释

#### 🔹 智能触发
只在以下上下文触发补全，避免干扰对话文本：
- `do` / `do!` 语句
- `set` 语句
- `if` / `elif` 条件
- `{{ }}` 插值
- `while` / `match` / `when` 控制流

#### 🔹 示例

```dialogue
# ✅ 补全 PlayerState 的方法
do PlayerState.add_gold(100)

# ✅ 补全属性
set player.health = 100

# ✅ 补全 AutoLoad 单例
if AudioManager.is_playing("bgm_battle")
	do AudioManager.stop("bgm_battle")
endif

# ✅ 插值中补全
NPC: 你有 {{PlayerState.gold}} 金币。
```

#### 🔹 全局成员访问（无需类名前缀）

在 `settings.json` 中配置全局类后，可以省略类名：

```json
{
  "dialogue.diagnostics.globalClasses": [
    "PlayerState",
    "AudioManager"
  ]
}
```

然后可以直接写：

```dialogue
# ❌ 原来需要写
do PlayerState.add_gold(100)
if PlayerState.gold >= 50

# ✅ 配置后可以写
do add_gold(100)
if gold >= 50
```

---

### 2️⃣ **段落跳转补全**

#### 🔹 本地段落
自动扫描当前文件的所有段落定义（`~ xxx`）：

```dialogue
~ start
NPC: 欢迎！

- 开始冒险 => dungeon    # ← 补全本地段落
- 查看商店 => shop
- 离开 => END            # ← 内置关键字

~ dungeon
# 地牢场景...

~ shop
# 商店场景...
```

#### 🔹 跨文件段落
支持 `import` 导入的文件中的段落：

```dialogue
import "res://dialogues/common.dialogue" as Common
import "res://dialogues/chapter1.dialogue" as Ch1

~ start
NPC: 选择一个章节：

- 第一章 => Ch1/intro        # ← 补全 Ch1 的段落
- 帮助 => Common/help         # ← 补全 Common 的段落
- 返回 => start
```

#### 🔹 立即跳转（`!` 后缀）
支持 Dialogue Manager 的立即跳转语法：

```dialogue
- 快速跳转 => next_scene!    # 不等待当前对话显示完成
=> END!                        # 强制立即结束
```

#### 🔹 悬停提示

悬停在段落引用上时，显示：
- 段落名称和完整路径
- 段落上方的注释（`#` 或 `##`）
- **第一句对话预览**（新增）
- 来源文件（本地或导入）

```dialogue
~ battle_start
# 战斗开始
# 玩家进入战斗区域

NPC: 准备战斗！

# 悬停 => battle_start 时显示：
# 📍 battle_start
# **预览:** `NPC: 准备战斗！`
# **说明:**
# 战斗开始
# 玩家进入战斗区域
# **位置:** 第 10 行
```

---

### 3️⃣ **Import 路径补全**

#### 🔹 自动扫描工作区
扩展会递归扫描工作区中所有 `.dialogue` 文件，并自动生成 PascalCase 别名。

```dialogue
# 输入 import 后按空格，显示所有 .dialogue 文件
import "res://dialogues/chapter1/intro.dialogue" as Chapter1Intro
```

#### 🔹 目录导航
支持逐级输入路径：

```dialogue
import "res://dialogues/    # ← 显示 dialogues 目录下的所有文件和子目录
import "res://dialogues/chapter1/    # ← 显示 chapter1 目录下的文件
```

#### 🔹 悬停提示
悬停在 `import` 路径上时，显示：
- 文件完整路径
- 文件大小
- 段落数量
- 一键跳转

---

### 4️⃣ **Dialogue 标签补全**

#### 🔹 内置标签（20+ 个）

输入 `[` 后自动提示，按类别分组：

| 类别 | 标签 | 说明 |
|------|------|------|
| **时间控制** | `[wait]`, `[speed]`, `[pause]` | 控制对话显示速度和等待时间 |
| **音效** | `[sound]`, `[voice]` | 播放音效和语音 |
| **文本效果** | `[wave]`, `[shake]`, `[rainbow]`, `[ghost]`, `[pulse]` | 文字动画效果 |
| **UI 控制** | `[br]`, `[signal]`, `[next]`, `[auto]`, `[jump]` | 换行、信号、自动播放等 |
| **BBCode** | `[b]`, `[i]`, `[u]`, `[s]`, `[color]`, `[font]`, `[size]` | 富文本格式 |

#### 🔹 示例

```dialogue
NPC: 你好[wait=1.5]，欢迎来到这里！
这是[wave]波浪文字[/wave]效果。
[sound path="res://audio/coin.wav"]你获得了金币！
```

#### 🔹 智能占位符
插入标签时自动生成占位符：

```dialogue
[wait=|]             # 光标停在 | 位置
[sound path="|"]     # 光标停在路径位置
[wave]|[/wave]       # 自动闭合，光标在中间
```

---

### 5️⃣ **自定义元数据标签**

#### 🔹 配置自定义标签

在 `settings.json` 中配置：

```json
{
  "dialogue.diagnostics.customTags": {
    "happy": {
      "description": "快乐表情",
      "example": "NPC: 你好！[#happy]",
      "category": "face",
      "alias": ["开心", "高兴"]
    },
    "knock_sound": {
      "description": "敲门音效",
      "example": "[#knock_sound]",
      "category": "se",
      "alias": ["敲门"]
    }
  },
  "dialogue.diagnostics.metadataCategories": {
    "face": {
      "icon": "😊",
      "description": "表情"
    },
    "se": {
      "icon": "🔊",
      "description": "音效"
    }
  }
}
```

#### 🔹 使用

```dialogue
NPC: 你好！[#happy]           # 或 [#开心]
*敲门* [#knock_sound]         # 或 [#敲门]
```

#### 🔹 管理标签

右键菜单 → `Dialogue: 打开标签配置` 或 `Dialogue: 添加新元数据标签`

---

### 6️⃣ **全局变量支持**

#### 🔹 配置全局变量

在 `settings.json` 中定义：

```json
{
  "dialogue.diagnostics.globalVariables": {
    // 简单类型
    "playerName": {
      "type": "String",
      "comment": "玩家角色名"
    },
    "gold": {
      "type": "int",
      "comment": "当前金币数"
    },
    
    // 复杂嵌套类型
    "playerStats": {
      "type": "Dictionary",
      "comment": "玩家属性",
      "schema": {
        "hp": {
          "type": "int",
          "comment": "血量"
        },
        "skills": {
          "type": "Array",
          "itemType": "String",
          "comment": "技能列表"
        },
        "equipment": {
          "type": "Dictionary",
          "comment": "装备信息",
          "schema": {
            "weapon": { "type": "String" },
            "armor": { "type": "String?", "comment": "可选" }
          }
        }
      }
    }
  }
}
```

#### 🔹 使用

```dialogue
# ✅ 访问全局变量
if gold >= 100
	NPC: 你的金币：{{gold}}
endif

# ✅ 访问嵌套属性
set playerStats.hp += 10
if playerStats.equipment.weapon == "sword"
	NPC: 你装备了剑！
endif

# ✅ 数组操作
if "fireball" in playerStats.skills
	NPC: 你会火球术！
endif
```

#### 🔹 类型检查

扩展会验证：
- 属性路径是否存在（如 `playerStats.equipment.weapon`）
- 可选属性（`String?`）的访问
- 数组元素类型

---

### 7️⃣ **实时诊断与快速修复**

#### 🔹 检测的错误类型

| 错误类型 | 示例 | 快速修复 |
|----------|------|----------|
| **类名拼写错误** | `PlayerStat.add_gold(100)` | 建议：`PlayerState` |
| **方法名拼写错误** | `PlayerState.add_gld(100)` | 建议：`add_gold` |
| **参数数量错误** | `PlayerState.add_gold()` | 自动填充必需参数 |
| **参数类型错误** | `add_gold("100")` | 转换为 `int("100")` |
| **段落未定义** | `=> undefined_title` | 建议创建段落或纠正拼写 |

#### 🔹 拼写纠正算法
使用 **Levenshtein 编辑距离算法**，智能建议相似的类名/方法名：

```dialogue
# ❌ 错误
do PlayrState.add_gold(100)
   ^^^^^^^^^
   未找到类 'PlayrState'

# 💡 快速修复建议:
# 1. 将 'PlayrState' 改为 'PlayerState'
# 2. 将 'PlayrState' 改为 'PlayerStat'
```

#### 🔹 类型转换
自动建议类型转换：

```dialogue
# ⚠️ 警告
do PlayerState.add_gold("100")
                       ^^^^^
   参数类型不匹配：期望 'int'，实际 'String'

# 💡 快速修复:
# 转换为 int 类型: int("100")
```

---

### 8️⃣ **文案导出**

#### 🔹 导出格式

右键菜单 → `Dialogue: 导出文案`，支持：
- **JSON（格式化）**: 适合阅读和编辑
- **JSON（紧凑）**: 适合程序读取
- **CSV**: 可用 Excel 打开
- **Markdown**: 表格格式

#### 🔹 导出内容

```json
[
  {
    "id": "DLG_0001",
    "type": "character",
    "speaker": "NPC",
    "text": "你好，欢迎！",
    "rawText": "你好，[wave]欢迎[/wave]！[#happy]",
    "line": 5,
    "tags": ["happy"],
    "hasInlineCode": false
  },
  {
    "id": "DLG_0002",
    "type": "narration",
    "text": "这是一段旁白。",
    "rawText": "这是一段旁白。",
    "line": 6,
    "tags": [],
    "hasInlineCode": false
  }
]
```

#### 🔹 台词 ID 管理

右键菜单 → `Dialogue: 为所有台词添加 ID`

```dialogue
# 自动添加 ID
NPC: 你好！ [ID:A1B2C3D4E5F6]
Player: 你好。 [ID:123456789ABC]

# 清除 ID
右键菜单 → `Dialogue: 清除所有台词 ID`
```

---

### 9️⃣ **代码折叠**

#### 🔹 自动折叠段落
从 `~ title` 折叠到最后的 `=>`：

```dialogue
~ start         # ← 点击折叠图标
NPC: 你好！
- 选项1 => a
- 选项2 => b
=> END          # ← 折叠到这里
```

#### 🔹 自定义区域
使用 `#region` / `#endregion`：

```dialogue
#region 第一章对话
~ intro
...
~ ending
...
#endregion

#region 战斗对话
~ battle_start
...
#endregion
```

---

## ⚙️ 配置选项

### 完整配置示例

```json
{
  // ========== 全局类配置 ==========
  "dialogue.diagnostics.globalClasses": [
    "PlayerState",
    "AudioManager",
    "SaveManager"
  ],

  // ========== 全局变量配置 ==========
  "dialogue.diagnostics.globalVariables": {
    "playerName": {
      "type": "String",
      "comment": "玩家名"
    },
    "playerStats": {
      "type": "Dictionary",
      "schema": {
        "hp": { "type": "int" },
        "mp": { "type": "int" }
      }
    }
  },

  // ========== 自定义标签配置 ==========
  "dialogue.diagnostics.customTags": {
    "happy": {
      "description": "快乐表情",
      "category": "face",
      "alias": ["开心"]
    }
  },

  // ========== 标签分类配置 ==========
  "dialogue.diagnostics.metadataCategories": {
    "face": {
      "icon": "😊",
      "description": "表情"
    }
  },

  // ========== 其他选项 ==========
  "dialogue.diagnostics.enableCustomTags": true,
  "dialogue.diagnostics.strictMode": false
}
```

## ❓ 常见问题

### Q1: 补全列表中没有我的类？
**A**: 确保你的类使用了 `class_name` 声明：

```gdscript
# ✅ 正确
class_name PlayerState
extends Node

# ❌ 错误
extends Node
```

或者将类在全局挂载，然后重启 VSCode 或等待类缓存刷新。

---

### Q2: 跨文件段落补全不生效？
**A**: 确保：
1. `import` 语句正确（路径使用 `res://`）
2. 打开过导入的 `.dialogue` 文件（触发扫描）
3. 导入的文件中存在 `~ xxx` 段落定义

---

### Q3: 如何禁用某些检查？
**A**: 在 `settings.json` 中设置：

```json
{
  "dialogue.diagnostics.strictMode": false  // 禁用严格模式
}
```

---

### Q4: 私有成员（`_` 开头）不显示？
**A**: 这是预期行为，符合 GDScript 的可见性规则。如果需要访问私有成员，直接输入完整名称即可（不会自动补全）。

---

### Q5: 首次打开项目时补全很慢？
**A**: 扩展需要扫描所有 GDScript 文件构建类缓存，通常需要 2-5 秒。等待控制台输出 `✅ 类缓存初始化完成` 后即可正常使用。

---

## 🛠️ 开发与贡献

### 环境设置

```bash
git clone https://github.com/hakubox/dialogue-godot-support.git
cd dialogue-godot-support
npm install
```

### 调试

1. 在 VSCode 中打开项目
2. 按 `F5` 启动扩展开发主机
3. 在新窗口中打开 Godot 项目测试

### 打包

```bash
npm run package
# 生成 dist/dialogue-godot-support-x.x.x.vsix
```

### 贡献指南

欢迎提交 Issue 和 Pull Request！请确保：
- 代码符合 TypeScript 规范
- 添加必要的注释
- 测试新功能

---

## 📄 许可证

MIT License - 详见 LICENSE [<sup>9</sup>](LICENSE) 文件

---

## 🙏 致谢

- Godot Engine [<sup>10</sup>](https://godotengine.org/)
- Dialogue Manager Plugin [<sup>11</sup>](https://github.com/nathanhoad/godot_dialogue_manager) by Nathan Hoad
- VSCode Extension API [<sup>12</sup>](https://code.visualstudio.com/api)

---

## 📧 联系方式

- **GitHub Issues**: 提交问题 [<sup>13</sup>](https://github.com/hakubox/dialogue-godot-support/issues)
- **作者**: hakubox
- **邮箱**: hakubox@outlook.com

---

<p align="center">
  <strong>如果这个扩展对你有帮助，请给个 ⭐️ Star！</strong>
</p>