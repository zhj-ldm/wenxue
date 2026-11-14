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
| 看不懂解析，也不知道该问谁 | 每道题都有独立对话，追问到真正理解 |
| 错题散落在各处，从不复习 | 作答记录、批改结果、讨论过程全部按试卷归档 |
| 学习计划靠感觉 | 直接和内置 Agent 讨论学情、定计划，甚至让它动手整理文件 |

---

## 核心亮点

**1. 出题不是「随机生成」，而是可命题的**
告诉 AI 学科、年级、知识点、题型配比、难度、总分、考试时长，它会按一份严格的试卷 Schema 产出结构完整的卷子：分大题、带共用阅读材料、每题有分值 / 参考答案 / 采分点 / 知识点标签。写进 `Documents/问学试卷` 就会被自动收录。

**2. 批改到「采分点」级别**
不是给个分数了事。主观题按 rubric 逐点判分，返回得分、等级、评语、失分点与改进建议；选择题可本地秒判，也可以全部交给 AI。

**3. 每道题一个独立对话**
讲思路、问错因、要求换种讲法、让它出同类变式题——上下文只围绕这一道题，不串味、不丢焦点。

**4. 内置 Agent，不只是聊天框**
主界面就是一个完整的 Agent 工作台：能看到它一步步调用工具（读文件、写文件、执行命令），边想边做。你可以让它出卷并直接放进题库、批量整理错题、按你的薄弱点生成复习计划。

**5. 多接口随时切换**
可保存多套 API 配置（地址 + Key + 模型），考试用便宜的、讲题用强的，一键切换。配置只存在本机。

**6. 题库就是一个文件夹**
没有数据库、没有云同步、没有导入导出流程。你往里扔 JSON，它自动扫描收录；它导出的卷子也是普通 JSON，随时可以备份、分享、用 Git 管理。

---

## 功能一览

- **AI 出卷**：按学科 / 知识点 / 难度 / 题型 / 分值定制，自动落盘到题库
- **试卷库**：按学科筛选、进度与得分统计、搜索、删除、导出
- **答题界面**：分大题展示，阅读材料默认完整展开，作答自动保存
- **AI 批改**：采分点级评分 + 评语 + 失分原因 + 下一步建议
- **AI 讲解**：一键讲透一道题，支持多轮追问
- **全局 Agent**：流式输出、工具调用过程可见、可随时中止
- **学习记录**：每套卷的作答、批改、对话完整留存
- **多接口管理**：增删改、切换、连通性测试、拉取模型列表
- **全本地存储**：数据目录可自定义，不依赖任何服务器

---

## 下载

前往 [Releases](../../releases) 下载最新的 macOS 版本（Apple Silicon）。

> 应用使用 ad-hoc 签名，首次打开若被系统拦截，请在「系统设置 → 隐私与安全性」中点「仍要打开」，或执行：
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/问学.app
> ```

**系统要求**：macOS 12+ / Apple Silicon

---

## 快速开始

1. 打开应用 → 左侧「设置」→「API 接口」→「添加接口」
2. 填入 **API 地址**（OpenAI 兼容，如 `https://api.deepseek.com`）、**API Key**、**模型名**（如 `deepseek-chat`）
3. 点「测试」确认连通，保存后自动设为当前接口
4. 回到「对话」，直接说：
   ```
   帮我出一套高二化学卷，20 题，离子反应和化学平衡各一半，满分 100，90 分钟，
   选择题 12 道每题 3 分，剩下填空和简答。写完存进题库。
   ```
5. 打开「试卷库」开始做，做完点「Grade with AI」，再对每道题追问。

---

## 题库

题库 = 一个文件夹（默认 `~/Documents/问学试卷`），里面的 `*.json` 会在启动时自动扫描收录，也支持手动「同步文件夹」。

一份试卷的最小结构：

```jsonc
{
  "title": "高二化学 · 离子反应专项",
  "subject": "化学",
  "grade": "高二",
  "totalScore": 100,
  "durationMinutes": 90,
  "sections": [
    {
      "name": "一、选择题",
      "passage": "共用阅读材料（没有就留空）",
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
          "difficulty": "medium"
        }
      ]
    }
  ]
}
```

规则只有三条：`totalScore` 等于各小题 `maxScore` 之和；共用材料只放 `section.passage`，小题的 `passage` 留空；题号在卷内唯一。

完整的命题规范见 [`prompts/paper_master.md`](prompts/paper_master.md)，可以直接整份投喂给任何 AI。

---

## 数据与隐私

- 试卷、作答、批改、对话 **全部保存在本机**，默认在 `~/Library/Application Support/Wenxue`
- API Key 只写入本机配置文件（仅当前用户可读），不会上传到任何服务器
- 唯一的外发请求，是你自己配置的模型接口
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
  main.js          窗口、IPC、任务编排
  lib/pi.js        pi Agent：文本补全 / 工具调用 / 会话
  lib/store.js     题库、作答、设置、文件夹同步
  lib/papers.js    试卷规范化与导出
  lib/prompts.js   提示词模板加载
renderer/          渲染层（原生 HTML/CSS/ESM，无框架）
  views/           首页、试卷库、答题、对话、记录、设置
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
