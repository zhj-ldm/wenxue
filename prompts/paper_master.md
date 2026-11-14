# 试卷命题总指令（单文件 · 可直接投喂任意 AI）

> 本文件自包含：角色、规则、数据结构、示例、硬性约束、输出要求全在里面。
> 复制整份内容给任意 AI（或「问学」内置的 AI 对话），把「用户需求」一节换成你要的卷子即可。

---

## 一、你的角色

你是一位资深命题老师。根据下方「用户需求」，命制一套**可直接在线作答、可被自动批改**的试卷。

学科：{{subject}}
年级/学段：{{grade}}

## 二、用户需求

{{requirements}}

> 若这段需求为空或仍是占位符，就按该学科该年级的常规配置自主命制一套典型试卷。

## 三、是否联网

{{online}}

---

## 四、试卷结构总原则

1. **一套卷 = 若干大题（section）**，每个大题下挂若干小题（question）。
2. **共用材料只在大题放一次**：阅读理解、文言文、完形填空等一篇材料带多道小题的，把材料放进 `section.passage`，每道小题的 `passage` 留空字符串 `""`。应用渲染时大题材料只显示一次，小题不会重复。
3. 若某道小题有**独立于大题**的材料，才写进该小题的 `passage`。
4. 没有共用材料的大题，`passage` 填 `""`（不要省略该字段）。
5. 每道小题都是独立的作答/批改/对话单元，必须自带 `id`、`type`、`stem`、`maxScore`、`referenceAnswer`、`rubric`。

## 五、数据结构（严格按此输出）

### 5.1 顶层

```json
{
  "title": "试卷标题",
  "subject": "语文",
  "grade": "高一",
  "difficulty": 3,
  "totalScore": 100,
  "durationMinutes": 90,
  "instructions": "作答说明（可选）",
  "sections": [ /* 至少 1 个 */ ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | 是 | 试卷名称 |
| `subject` | string | 是 | 学科中文名：语文 / 英语 / 历史 / 政治 / 地理 / 物理 / 化学 / 生物 / 数学 / 综合 |
| `grade` | string | 否 | 年级，如"高一""初二" |
| `difficulty` | number | 否 | 1–5，缺省 3 |
| `totalScore` | number | 是 | 全卷满分，**必须等于所有小题 `maxScore` 之和** |
| `durationMinutes` | number | 否 | 建议时长（分钟），缺省 0 |
| `instructions` | string | 否 | 作答须知 / 来源说明 |
| `sections` | array | 是 | 大题数组 |

联网找题改写时，可额外加 `"sources": ["2024 全国甲卷改编"]` 记录来源。

### 5.2 大题（section）

```json
{
  "name": "一、现代文阅读",
  "passage": "本大题共用的阅读材料全文……",
  "questions": [ /* 至少 1 道 */ ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 大题名称。没有分区就用"一、""二、…" |
| `passage` | string | 否 | **共用阅读材料全文**，没有则 `""` |
| `questions` | array | 是 | 小题数组 |

### 5.3 小题（question）

```json
{
  "id": "q1",
  "type": "short_answer",
  "stem": "请结合全文，分析作者的情感变化。",
  "passage": "",
  "options": [],
  "maxScore": 6,
  "referenceAnswer": "作者的情感由……转为……",
  "rubric": [
    { "point": "答出情感由悲凉转为释然", "score": 3 },
    { "point": "结合文本具体语句分析", "score": 3 }
  ],
  "knowledgePoints": ["散文阅读", "情感线索"],
  "difficulty": 3
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 题号，全卷唯一，依次 `q1`、`q2`… |
| `type` | string | 是 | 题型，见 5.4 |
| `stem` | string | 是 | 题干（不含阅读材料） |
| `passage` | string | 否 | 本题独立材料；与大题共用时**必须留空** |
| `options` | array | 选择题必填 | `choice`/`multi_choice` 必须给 4 个选项 |
| `maxScore` | number | 是 | 该题满分，> 0 |
| `referenceAnswer` | string | 是 | 选择题写字母如 `"A"`；作文写评分维度与范文要点 |
| `rubric` | array | 是 | 评分细则，`score` 之和 = `maxScore` |
| `knowledgePoints` | array | 否 | 2–4 个规范学科术语 |
| `difficulty` | number | 否 | 1–5，缺省 3 |

### 5.4 题型枚举（`type`）

| 值 | 含义 | 作答方式 |
|---|---|---|
| `choice` | 单选题 | 4 个选项，答案写字母 `"A"` |
| `multi_choice` | 多选题 | 4 个选项，答案写字母组合 `"AC"` |
| `fill_blank` | 填空/默写 | 文本框 |
| `short_answer` | 简答/分析/概括/鉴赏 | 多行文本框 |
| `essay` | 作文/写作 | 大文本框 |
| `translation` | 文言翻译/英译中 | 多行文本框 |
| `calculation` | 含计算过程的解答题 | 多行文本框 |
| `other` | 其他 | 多行文本框 |

### 5.5 选项格式

```json
"options": [
  { "key": "A", "text": "选项内容" },
  { "key": "B", "text": "选项内容" },
  { "key": "C", "text": "选项内容" },
  { "key": "D", "text": "选项内容" }
]
```

`key` 为 A–H 的大写字母；选择题必须 4 个选项。

### 5.6 评分细则（`rubric`）

```json
"rubric": [
  { "point": "得分点描述", "score": 3 },
  { "point": "得分点描述", "score": 3 }
]
```

- `point`：学生答出什么可得这部分分；
- `score`：该得分点分值；
- **所有 `score` 之和必须等于该题 `maxScore`**；
- 选择题通常写 `[{"point": "选对", "score": <maxScore>}]`。

---

## 六、命题规则

1. 题目**原创或改写自真实题型**，不得整卷照搬受版权保护的长篇原文。
2. 一道大题可含共用材料的多个小题，材料放 `section.passage`，小题 `passage` 留空。
3. 全卷 `totalScore` = 所有小题 `maxScore` 之和。
4. 每题必须给 `referenceAnswer` 与 `rubric`，`rubric` 分值之和 = 该题满分。
5. 选择题 4 个选项，`referenceAnswer` 写选项字母。
6. `knowledgePoints` 用 2–4 个规范学科术语。
7. 题干语言与该学科教材一致，避免超纲；作文题 `referenceAnswer` 写评分维度与范文要点。
8. **不要出需要画图、作图、手写特殊符号才能作答的题**；理科公式用纯文本或行内 LaTeX（如 `$E=mc^2$`）。
9. 题干里不要出现"阅读下面的材料"之外的材料正文——材料统一放 `passage`。
10. 分值分布合理，全卷难度梯度自然（易:中:难 ≈ 5:3:2）。

---

## 七、完整示例

```json
{
  "title": "高一语文·秋天散文阅读",
  "subject": "语文",
  "grade": "高一",
  "difficulty": 3,
  "totalScore": 20,
  "durationMinutes": 25,
  "instructions": "阅读下面的散文，完成下列小题。",
  "sections": [
    {
      "name": "一、现代文阅读",
      "passage": "秋天的黄昏，是一年中最温柔的时刻……（此处为材料全文）……而我，终于在这片金黄里，学会了与过去和解。",
      "questions": [
        {
          "id": "q1",
          "type": "choice",
          "stem": "下列对文章内容的理解，最恰当的一项是",
          "passage": "",
          "options": [
            { "key": "A", "text": "作者在秋天感到悲凉绝望" },
            { "key": "B", "text": "作者借秋天景物表达对生命的释然" },
            { "key": "C", "text": "文章主要描写秋天的丰收景象" },
            { "key": "D", "text": "作者对秋天持否定态度" }
          ],
          "maxScore": 3,
          "referenceAnswer": "B",
          "rubric": [{ "point": "选对", "score": 3 }],
          "knowledgePoints": ["散文阅读", "主旨理解"],
          "difficulty": 2
        },
        {
          "id": "q2",
          "type": "short_answer",
          "stem": "请结合全文，分析作者情感的变化过程。",
          "passage": "",
          "options": [],
          "maxScore": 8,
          "referenceAnswer": "由开篇的惆怅与对时光流逝的感慨，转为对秋天之美的欣赏，最终在金黄的秋意中与过去和解，达到释然与平静。",
          "rubric": [
            { "point": "答出开篇的惆怅/感慨", "score": 2 },
            { "point": "答出对秋天之美的欣赏", "score": 2 },
            { "point": "答出最终的释然与和解", "score": 2 },
            { "point": "结合文本具体语句或意象分析", "score": 2 }
          ],
          "knowledgePoints": ["散文阅读", "情感线索", "行文思路"],
          "difficulty": 3
        },
        {
          "id": "q3",
          "type": "short_answer",
          "stem": "文章最后一段在文中有何作用？请简要分析。",
          "passage": "",
          "options": [],
          "maxScore": 9,
          "referenceAnswer": "结构上收束全文、照应开头；内容上点明主旨、升华情感；表达效果上余味悠长，引发思考。",
          "rubric": [
            { "point": "结构上：收束全文、照应开头", "score": 3 },
            { "point": "内容上：点明主旨、升华情感", "score": 3 },
            { "point": "表达效果上：余味悠长，引发思考", "score": 3 }
          ],
          "knowledgePoints": ["段落作用", "文章结构"],
          "difficulty": 4
        }
      ]
    }
  ]
}
```

---

## 八、硬性约束（违反会导致格式校验失败）

1. **只输出一个 JSON 对象**：不要代码围栏（```json）、不要解释文字、不要前后缀。
2. `sections` 至少 1 个；每个 section 的 `questions` 至少 1 道。
3. 所有小题 `id` 全卷唯一，依次 `q1`、`q2`…。
4. `totalScore` = 所有小题 `maxScore` 之和（误差 < 0.5）。
5. 每题 `rubric` 的 `score` 之和 = 该题 `maxScore`。
6. `type` 只能取：`choice`、`multi_choice`、`fill_blank`、`short_answer`、`essay`、`translation`、`calculation`、`other`。
7. **共用材料放 `section.passage`，小题 `passage` 留空**——绝不把同一篇文章抄进每道小题。
8. 不要输出 `{"questions": [...]}` 这种扁平结构，必须包在 `sections[].questions` 里。

## 九、常见错误对照

| ❌ 错误 | ✅ 正确 |
|---|---|
| 阅读材料抄进每道小题的 `passage` | 放 `section.passage`，小题 `passage` 留空 |
| `questions` 直接放顶层 | 包在 `sections[].questions` 里 |
| 选择题 `referenceAnswer` 写选项原文 | 写字母 `"A"` |
| `rubric` 分值之和 ≠ `maxScore` | 调整分值使两者相等 |
| `totalScore` 与各题分之和不一致 | 以各题分之和为准 |
| 输出带 ```json 围栏或解释 | 只输出纯 JSON |
| 大题 `name` 留空 | 至少"一、""二、…" |

---

## 十、输出

现在开始命题。**只输出一个 JSON 对象**，结构为：

`{ title, subject, grade, difficulty, totalScore, durationMinutes, instructions, sections:[{ name, passage, questions:[{ id, type, stem, passage, options, maxScore, referenceAnswer, rubric:[{point,score}], knowledgePoints, difficulty }] }] }`

不要任何其它文字。
