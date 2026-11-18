<div align="center">

# 问学 · Wenxue

**一个把「出题 — 做题 — 批改 — 讲透」串成闭环的 AI 学习桌面应用。**

不订阅、不上传、不锁数据：自带 API Key，题库放在你自己的文件夹里，AI 也是你自己的。

[![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-000000?logo=apple&logoColor=white)](#下载)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-45-47848F?logo=electron&logoColor=white)](package.json)
[![Agent](https://img.shields.io/badge/Agent-pi-7C5CFF)](https://github.com/earendil-works/pi)

</div>

---

## 这是什么

**问学是一个本地运行的 AI 出题与 AI 教学软件。**

它把「刷题」这件事从「做题 → 对答案」升级成「AI 按你的要求出卷 → 你作答 → AI 逐题批改并讲清失分点 → 追问到懂为止」。

所有数据都在你的电脑上。AI 用的是你自己填的接口（DeepSeek、OpenAI、Claude、通义、本地 Ollama……只要是 OpenAI 兼容协议都可以），没有中间商，没有按次收费，也没有人能看到你的错题本。

---

## 它解决什么问题

| 传统刷题 | 问学 |
| --- | --- |
| 题库固定，想练的知识点没有题 | 说出「高二化学、离子反应、20 题、中等难度」，AI 现场出卷 |
| 做完只知道自己错了 | 按采分点批改，指出具体哪一步丢分、为什么丢 |
| 看不懂解析，也不知道该问谁 | 每题右侧固定 AI 侧边栏，追问到真正理解；整套还能做全局复盘 |
| 错题散落在各处，从不复习 | 每套载体有唯一编号，作答、批改、讨论全部按载体归档 |
| 学习计划靠感觉 | 直接和内置 Agent 讨论学情、定计划，甚至让它动手整理文件 |

---

## 核心亮点

**1. 出题不是「随机生成」，而是可命题的**
告诉 AI 学科、年级、知识点、题型配比、难度、总分、考试时长，它会按一份严格的载体 Schema 产出结构完整的卷子：分大题、带共用阅读材料、每题有分值 / 参考答案 / 采分点 / 知识点标签。写进 `Documents/问学试卷` 就会被自动收录。

**2. 批改到「采分点」级别**
不是给个分数了事。主观题按 rubric 逐点判分，返回得分、等级、评语、失分点与改进建议；选择题可本地秒判，也可以全部交给 AI。填空题可标「答案不唯一」，由 AI 判分。

**3. 每题一个独立 AI 侧边栏**
点「批改 / 讲解 / AI 对话」都唤起右侧侧边栏；会话与这道小题一一绑定、互不干扰。默认只读本题作答与所属大题，需要时可打开「允许读取整套载体」，让 AI 做整套分析。

**4. 内置 Agent，不只是聊天框**
主界面就是一个完整的 Agent 工作台：能看到它一步步调用工具（读文件、写文件、执行命令），边想边做。你可以让它出卷并直接放进题库、批量整理错题、按你的薄弱点生成复习计划。

**5. 多接口随时切换**
可保存多套 API 配置（地址 + Key + 模型），考试用便宜的、讲题用强的，一键切换。配置只存在本机。

**6. 一张卡片一个编号**
每个试卷 / 练习 / 提升计划自动生成 8 位编号，所有入口都会展示，点击即复制；AI 也能用编号直接找到整套内容。

---

## 功能一览

- **AI 出卷**：按学科 / 知识点 / 难度 / 题型 / 分值定制，自动落盘到放题目录
- **载体卡片**：试卷 / 练习 / 提升计划统一展示，带 8 位编号（点击复制）、进度与得分
- **答题界面**：分大题展示，阅读材料默认完整展开，作答自动保存；填空支持句内空位（题文与答案穿插）
- **AI 批改**：采分点级评分 + 评语 + 失分原因 + 下一步建议
- **右侧 AI 侧边栏**：批改 / 讲解 / 对话三按钮统一唤起，单题会话隔离；可开关整套上下文
- **整套 AI 对话**：每个载体底部独立入口，做整套总结与错题分析
- **每日任务**：按 `date` 自动归集到期题目，待完成 / 已完成分组，点击直达目标题
- **提升计划**：说一句「两周补全对话计划」，AI 自动按天排期；到期自动进每日任务
- **题目按钮可控**：出题 AI 可为单题关闭批改 / 讲解 / 对话按钮
- **联网搜索**：内置 Aggr Search（Rust 多引擎聚合），所有对话的 AI 都能搜索与抓取网页
- **全局 Agent**：流式输出、工具调用过程可见、可随时中止
- **对话管理**：多会话列表，新建 / 切换 / 重命名 / 删除，重启后继续
- **学习记录**：每个载体的作答、批改、对话完整留存
- **多接口管理**：增删改、切换、连通性测试、拉取模型列表
- **全本地存储**：数据目录可自定义，不依赖任何服务器

---

## 下载

前往 [Releases](../../releases) 下载最新的版本：

**macOS（Apple Silicon）**
- **DMG**（推荐）：打开后把「问学.app」拖进 Applications 即可
- **ZIP**：解压后手动拖入 Applications

**Windows（x64）**
- **EXE**：运行安装包，可选安装目录

> macOS 版使用 ad-hoc 签名，首次打开若被系统拦截，请在「系统设置 → 隐私与安全性」中点「仍要打开」，或执行：
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/问学.app
> ```

**系统要求**：macOS 12+ / Apple Silicon，或 Windows 10 及以上（x64）

> Windows 版由 GitHub Actions 自动构建，见 [`.github/workflows/build-windows.yml`](.github/workflows/build-windows.yml)。

---

## 快速开始

1. 打开应用 → 右上角「设置」→「API 接口」→「添加接口」
2. 填入 **API 地址**（OpenAI 兼容，如 `https://api.deepseek.com`）、**API Key**、**模型名**（如 `deepseek-chat`）
3. 点「测试」确认连通，保存后自动设为当前接口
4. 回到「对话」，直接说：
   ```
   帮我出一套高二化学卷，20 题，离子反应和化学平衡各一半，满分 100，90 分钟，
   选择题 12 道每题 3 分，剩下填空和简答。写完存进放题目录。
   ```
5. 打开「学习 → 试卷练习」开始做，做完点「批改」，再在右侧侧边栏追问。

---

## 载体

载体 = 一个文件夹里的 JSON（默认放题目录 `~/Documents/问学试卷`）。启动与手动「同步」时会自动扫描未收录的 `*.json`。所有试卷、练习、提升计划都是同一种结构，靠 `kind` 区分。

一份载体的最小结构：

```jsonc
{
  "kind": "paper",                       // paper | practice | plan
  "title": "高二化学 · 离子反应专项",
  "subject": "化学",
  "grade": "高二",
  "goal": "",                            // 提升计划写目标
  "totalScore": 100,
  "durationMinutes": 90,
  "sections": [
    {
      "name": "一、选择题",
      "passage": "共用阅读材料（没有就留空）",
      "date": "2026-11-20",              // 可选：本大题所有小题继承该日期
      "questions": [
        {
          "id": "1",
          "type": "choice",              // choice | multi_choice | fill_blank | short_answer | essay | translation | calculation | other
          "stem": "题干",
          "options": [{ "key": "A", "text": "选项内容" }],
          "maxScore": 3,
          "referenceAnswer": "A",
          "rubric": [{ "point": "选出正确选项", "score": 3 }],
          "knowledgePoints": ["离子方程式"],
          "difficulty": 3,
          "date": "",                    // 可选：覆盖大题日期
          "answerMode": "fixed",         // fixed | open（答案不唯一，AI 判分）
          "actions": { "grade": true, "explain": true, "chat": true }
        }
      ]
    }
  ]
}
```

规则只有三条：`totalScore` 等于各小题 `maxScore` 之和；共用材料只放 `section.passage`，小题的 `passage` 留空；题号在载体内唯一。编号 `code` 由应用生成，不需要手写。

完整的命题规范见 [`prompts/paper_master.md`](prompts/paper_master.md)，可以直接整份投喂给任何 AI。

---

## 数据与隐私

- 试卷、作答、批改、对话 **全部保存在本机**，默认在 `~/Library/Application Support/Wenxue`
- API Key 只写入本机配置文件（仅当前用户可读），不会上传到任何服务器
- 外发请求只有两类：你自己配置的模型接口；你让 AI 联网搜索时，由内置 Aggr Search 向搜索引擎发起查询
- 应用不包含统计、埋点、崩溃上报

---

## 自行构建

```bash
git clone <this-repo>
cd wenxue
npm install
npm start                 # 开发模式
./scripts/build-app.sh    # 打包为 /Applications/问学.app
```

构建脚本会复制 Electron 运行时、剥离开发依赖、写入 `Info.plist` 并做 ad-hoc 签名。产物为当前机器架构。

---

## 目录结构

```
electron/          主进程
  main.js          窗口、IPC、载体编排
  lib/pi.js        pi Agent：文本补全 / 工具调用 / 会话
  lib/store.js     载体、作答、对话、设置、文件夹同步、旧数据迁移
  lib/papers.js    载体规范化、编号、题型
  lib/prompts.js   提示词模板加载
renderer/          渲染层（原生 HTML/CSS/ESM，无框架）
  views/           学习（试卷/每日任务/提升计划）、载体、对话、记录、设置
  qa-sidebar.js    右侧 AI 侧边栏（单题 / 整套）
  toolcard.js      工具调用卡片
  cloze.js         内联填空
prompts/           命题 / 批改 / 讲解 提示词
scripts/build-app.sh
```

---

## 路线图

- [ ] 社区题库：从 Git 仓库一键订阅、按知识点检索下载
- [ ] 错题本与薄弱点统计
- [ ] 复习计划与间隔重复
- [ ] Windows / Linux 构建

---

## 免责声明

本项目仅提供学习工具，不附带任何题库内容。请勿导入或分发无授权的版权试题；导入第三方内容所产生的责任由使用者自行承担。

---

## License

[Apache License 2.0](LICENSE)

第三方依赖：[@earendil-works/pi](https://github.com/earendil-works/pi)（MIT）、Electron（MIT）。
