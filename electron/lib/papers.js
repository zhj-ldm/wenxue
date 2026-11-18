'use strict';

const crypto = require('crypto');

const SUBJECTS = [
  { key: 'chinese', name: '语文', en: 'Chinese', note: '现代文 · 文言文 · 写作' },
  { key: 'english', name: '英语', en: 'English', note: '阅读 · 完形 · 翻译 · 写作' },
  { key: 'history', name: '历史', en: 'History', note: '材料分析 · 论述' },
  { key: 'politics', name: '政治', en: 'Politics', note: '材料题 · 辨析' },
  { key: 'geography', name: '地理', en: 'Geography', note: '区域分析 · 综合题' },
  { key: 'physics', name: '物理', en: 'Physics', note: '计算 · 实验' },
  { key: 'chemistry', name: '化学', en: 'Chemistry', note: '推断 · 计算 · 实验' },
  { key: 'biology', name: '生物', en: 'Biology', note: '概念 · 探究' },
  { key: 'math', name: '数学', en: 'Math', note: '不推荐：过程书写建议手写' },
  { key: 'other', name: '综合', en: 'General', note: '跨学科 · 其他' }
];

const TYPES = ['choice', 'multi_choice', 'fill_blank', 'short_answer', 'essay', 'translation', 'calculation', 'other'];

const TYPE_LABEL = {
  choice: '单选',
  multi_choice: '多选',
  fill_blank: '填空',
  short_answer: '简答',
  essay: '写作',
  translation: '翻译',
  calculation: '计算',
  other: '其他'
};

function pick(obj, keys) {
  for (const key of keys) {
    const v = obj[key];
    if (v != null && v !== '') return v;
  }
  return '';
}

function toNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = parseFloat(String(value == null ? '' : value).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

function normalizeOptions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, i) => {
      const letter = String.fromCharCode(65 + i);
      if (typeof item === 'string') {
        const m = item.match(/^\s*([A-Ha-h])[\.、:：)\s]\s*(.+)$/);
        return m ? { key: m[1].toUpperCase(), text: m[2].trim() } : { key: letter, text: item.trim() };
      }
      if (item && typeof item === 'object') {
        return {
          key: String(pick(item, ['key', 'label', 'letter', 'value']) || letter).toUpperCase().slice(0, 2),
          text: String(pick(item, ['text', 'content', 'value', 'label', 'option']) || '').trim()
        };
      }
      return null;
    })
    .filter((o) => o && o.text);
}

function normalizeRubric(raw, maxScore) {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' && raw.trim()
      ? raw.split(/\n|；|;/).filter(Boolean).map((line) => ({ point: line.trim(), score: null }))
      : [];
  const out = list
    .map((item) => {
      if (typeof item === 'string') return { point: item.trim(), score: null };
      if (!item || typeof item !== 'object') return null;
      return {
        point: String(pick(item, ['point', 'desc', 'description', 'text', 'item', '得分点']) || '').trim(),
        score: item.score != null ? toNumber(item.score, 0) : null
      };
    })
    .filter((r) => r && r.point);

  const known = out.reduce((sum, r) => sum + (r.score || 0), 0);
  if (out.length && maxScore > 0 && Math.abs(known - maxScore) > 0.01) {
    if (known === 0) {
      const even = Math.round((maxScore / out.length) * 10) / 10;
      out.forEach((r) => (r.score = even));
    }
  }
  return out;
}

function inferType(raw, options) {
  const declared = String(raw.type || raw.题型 || '').trim().toLowerCase().replace(/\s+/g, '_');
  const map = {
    choice: 'choice',
    单选: 'choice',
    single_choice: 'choice',
    single: 'choice',
    multi_choice: 'multi_choice',
    multiple_choice: 'multi_choice',
    多选: 'multi_choice',
    fill_blank: 'fill_blank',
    blank: 'fill_blank',
    fill: 'fill_blank',
    填空: 'fill_blank',
    默写: 'fill_blank',
    单词拼写: 'fill_blank',
    short_answer: 'short_answer',
    shorts: 'short_answer',
    简答: 'short_answer',
    分析: 'short_answer',
    鉴赏: 'short_answer',
    essay: 'essay',
    writing: 'essay',
    作文: 'essay',
    写作: 'essay',
    translation: 'translation',
    翻译: 'translation',
    calculation: 'calculation',
    计算: 'calculation',
    解答: 'calculation',
    other: 'other'
  };
  if (map[declared]) return map[declared];
  if (Array.isArray(raw.blanks) && raw.blanks.length) return 'fill_blank';
  if (options.length >= 2) return 'choice';
  return 'short_answer';
}

function normalizeQuestion(raw, index, sectionName) {
  const options = normalizeOptions(raw.options || raw.选项 || raw.choices);
  const maxScore = toNumber(pick(raw, ['maxScore', 'score', 'points', '分值', '满分', 'value']), 5) || 5;
  const stem = String(pick(raw, ['stem', 'question', 'content', 'text', '题干', 'title']) || '').trim();
  const passage = String(pick(raw, ['passage', 'material', 'reading', '材料', '阅读材料']) || '').trim();
  const referenceRaw = pick(raw, ['referenceAnswer', 'answer', 'correctAnswer', '参考答案', '答案']);
  const referenceAnswer =
    referenceRaw && typeof referenceRaw === 'object'
      ? String(referenceRaw.text || referenceRaw.value || JSON.stringify(referenceRaw))
      : String(referenceRaw || '').trim();
  const kpRaw = pick(raw, ['knowledgePoints', 'knowledge', 'tags', '知识点']);
  const knowledgePoints = Array.isArray(kpRaw)
    ? kpRaw.map(String).map((s) => s.trim()).filter(Boolean)
    : String(kpRaw || '')
        .split(/[,，、;；]/)
        .map((s) => s.trim())
        .filter(Boolean);

  const type = inferType(raw, options);
  const scoreForRubric = maxScore;
  const blanksRaw = raw.blanks || raw.空格 || raw.每空;
  const blanks = Array.isArray(blanksRaw)
    ? blanksRaw
        .map((b, i) => {
          if (b == null) return null;
          if (typeof b === 'string') return { key: String(i + 1), answer: b, maxScore: 0, width: 0 };
          return {
            key: String(b.key || b.id || i + 1),
            answer: String(b.answer || b.referenceAnswer || b.参考答案 || ''),
            maxScore: Number(b.maxScore || b.score) || 0,
            width: Number(b.width) || 0
          };
        })
        .filter(Boolean)
    : [];
  const layout = String(raw.layout || raw.版式 || (blanks.length ? 'inline' : 'block')).toLowerCase() === 'inline' ? 'inline' : 'block';

  return {
    id: String(raw.id || `q${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '') || `q${index + 1}`,
    section: String(pick(raw, ['section', 'part', 'group', '部分', '分区']) || sectionName || '').trim(),
    type,
    layout,
    stem,
    passage,
    blanks,
    options: type === 'choice' || type === 'multi_choice' ? options : options.length ? options : [],
    maxScore,
    referenceAnswer: referenceAnswer || (type === 'choice' ? 'A' : ''),
    rubric: normalizeRubric(raw.rubric || raw.评分细则 || raw.scoring || raw.criteria, scoreForRubric),
    knowledgePoints,
    difficulty: Math.min(5, Math.max(1, Math.round(toNumber(raw.difficulty, 3)))),
    date: String(raw.date || raw.日期 || '').trim(),
    actions: normalizeActions(raw.actions),
    answerMode: (raw.answerMode || raw.answerType) === 'open' ? 'open' : 'fixed',
    explanation: String(pick(raw, ['explanation', 'analysis', '解析', '命题解析']) || '').trim(),
    sourceNote: String(pick(raw, ['sourceNote', 'source', '来源']) || '').trim()
  };
}

function flattenQuestions(src) {
  const direct = src.questions || src.题目 || src.items;
  if (Array.isArray(direct)) {
    // 扁平题单：合成一个匿名大题，passage 取公共材料
    const sharedPassage = String(src.passage || src.material || src.reading || '').trim();
    return direct.map((q) => ({ q, section: q.section || q.部分 || '', sectionPassage: q.passage || sharedPassage }));
  }

  const sections = src.sections || src.parts || src.部分;
  if (Array.isArray(sections)) {
    const out = [];
    for (const section of sections) {
      const name = section.name || section.title || section.名称 || '';
      const sectionPassage = String(section.passage || section.material || section.reading || section.材料 || '').trim();
      const list = section.questions || section.items || section.题目 || [];
      if (Array.isArray(list)) {
        list.forEach((q) => out.push({ q, section: name, sectionPassage }));
      }
    }
    return out;
  }
  return [];
}

function normalizePaper(raw, opts = {}) {
  const src = raw && raw.paper && typeof raw.paper === 'object' ? raw.paper : raw;
  if (!src || typeof src !== 'object') throw new Error('试卷数据格式无法识别');

  const flat = flattenQuestions(src);
  if (!flat.length) throw new Error('没有解析到任何题目，请检查试卷内容');

  const questions = flat.map((item, i) => normalizeQuestion(item.q, i, item.section)).filter((q) => q.stem);
  if (!questions.length) throw new Error('题目缺少题干，无法导入');

  // 按「大题名 + 阅读材料」分组，供答题页按大题渲染
  const sections = [];
  let curKey = null;
  flat.forEach((item, i) => {
    const q = questions[i];
    if (!q) return;
    const key = `${item.section}::${item.sectionPassage || ''}`;
    if (key !== curKey) {
      curKey = key;
      sections.push({ name: item.section, passage: item.sectionPassage || '', questionIds: [q.id] });
    } else {
      sections[sections.length - 1].questionIds.push(q.id);
    }
  });

  const sum = questions.reduce((acc, q) => acc + q.maxScore, 0);
  const declaredTotal = toNumber(src.totalScore || src.满分 || src.score, 0);
  const totalScore = declaredTotal > 0 && Math.abs(declaredTotal - sum) < 0.5 ? declaredTotal : Math.round(sum * 10) / 10;

  const subject = String(opts.subject || src.subject || src.学科 || '综合').trim();
  const grade = String(opts.grade || src.grade || src.年级 || '').trim();
  const title =
    String(src.title || src.name || src.标题 || '').trim() || `${grade}${subject} · AI 试卷`.replace(/^ · /, '');

  return {
    schemaVersion: 1,
    id: src.id || `paper_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`,
    title,
    subject,
    grade,
    source: opts.source || src.source || 'imported',
    difficulty: Math.min(5, Math.max(1, Math.round(toNumber(src.difficulty, 3)))),
    totalScore,
    durationMinutes: Math.max(0, Math.round(toNumber(src.durationMinutes || src.时长, 0))),
    instructions: String(src.instructions || src.说明 || '').trim(),
    sources: Array.isArray(src.sources) ? src.sources.map(String) : [],
    createdAt: new Date().toISOString(),
    questions,
    sections
  };
}

/* ---------------- 统一载体（试卷 / 练习 / 提升计划） ---------------- */

function normalizeActions(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    grade: src.grade !== false,
    explain: src.explain !== false,
    chat: src.chat !== false
  };
}

function normalizeCarrier(raw, opts = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const kind = ['paper', 'practice', 'plan'].includes(opts.kind || src.kind) ? opts.kind || src.kind : 'paper';
  const rawSections = Array.isArray(src.sections) ? src.sections : [];
  const sections = rawSections
    .map((section, si) => {
      const sec = section && typeof section === 'object' ? section : {};
      const rawQuestions = Array.isArray(sec.questions) ? sec.questions : [];
      const questions = rawQuestions
        .map((q, qi) =>
          normalizeQuestion(
            Object.assign({}, q, {
              id: q && q.id ? q.id : `q${si + 1}_${qi + 1}`,
              date: String((q && q.date) || ''),
              actions: normalizeActions(q && q.actions),
              answerMode: (q && q.answerMode) === 'open' ? 'open' : 'fixed'
            }),
            qi,
            sec.name || ''
          )
        )
        .filter(Boolean);
      return {
        id: String(sec.id || `s${si + 1}`),
        name: String(sec.name || `第 ${si + 1} 部分`).trim(),
        passage: String(sec.passage || '').trim(),
        date: String(sec.date || '').trim(),
        questions
      };
    })
    .filter((s) => s.questions.length);

  if (!sections.length) throw new Error('载体里没有题目，无法保存');

  const questions = sections.flatMap((s) => s.questions);
  const sum = questions.reduce((acc, q) => acc + q.maxScore, 0);
  const declared = toNumber(src.totalScore, 0);
  const totalScore = declared > 0 && Math.abs(declared - sum) < 0.5 ? declared : Math.round(sum * 10) / 10;

  return {
    schemaVersion: 2,
    code: String(src.code || '').toUpperCase(),
    kind,
    title: String(src.title || '未命名').trim(),
    subject: String(src.subject || '综合').trim(),
    grade: String(src.grade || '').trim(),
    goal: String(src.goal || '').trim(),
    difficulty: Math.min(5, Math.max(1, Math.round(toNumber(src.difficulty, 3)))),
    totalScore,
    durationMinutes: Math.max(0, Math.round(toNumber(src.durationMinutes, 0))),
    instructions: String(src.instructions || '').trim(),
    sourceFile: String(src.sourceFile || '').trim(),
    createdAt: src.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sections
  };
}

function carrierQuestions(carrier) {
  const sections = Array.isArray(carrier.sections) ? carrier.sections : [];
  return sections.flatMap((section) =>
    (section.questions || []).map((q) => ({ question: q, section }))
  );
}

function carrierSummary(carrier, extra = {}) {
  const questions = carrierQuestions(carrier);
  return Object.assign(
    {
      code: carrier.code,
      kind: carrier.kind,
      title: carrier.title,
      subject: carrier.subject,
      grade: carrier.grade,
      goal: carrier.goal,
      totalScore: carrier.totalScore,
      durationMinutes: carrier.durationMinutes,
      questionCount: questions.length,
      sectionCount: (carrier.sections || []).length,
      createdAt: carrier.createdAt,
      updatedAt: carrier.updatedAt
    },
    extra
  );
}

function summary(paper, extra = {}) {
  return Object.assign(
    {
      id: paper.id,
      title: paper.title,
      subject: paper.subject,
      grade: paper.grade,
      source: paper.source,
      questionCount: paper.questions.length,
      totalScore: paper.totalScore,
      durationMinutes: paper.durationMinutes,
      createdAt: paper.createdAt,
      lastOpenedAt: paper.createdAt
    },
    extra
  );
}

function exportFilename(paper) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const safe = String(paper.title || '试卷').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  return `${stamp}-${safe}.json`;
}

module.exports = {
  SUBJECTS,
  TYPES,
  TYPE_LABEL,
  normalizePaper,
  normalizeQuestion,
  normalizeCarrier,
  carrierQuestions,
  carrierSummary,
  summary,
  exportFilename
};
