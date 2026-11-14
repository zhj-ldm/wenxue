'use strict';

const { TYPE_LABEL } = require('./papers');

function stripFence(text) {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/```(?:json|JSON)?\s*/g, '')
    .replace(/```/g, '')
    .trim();
}

function extractBalanced(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return '';
}

function parseJsonLoose(text) {
  const attempts = [];
  const cleaned = stripFence(text);
  attempts.push(cleaned);
  const balanced = extractBalanced(cleaned);
  if (balanced && balanced !== cleaned) attempts.push(balanced);
  // 去掉可能存在的尾随逗号
  attempts.push(cleaned.replace(/,\s*([}\]])/g, '$1'));

  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      return { ok: true, value: JSON.parse(candidate), text: candidate };
    } catch (err) {
      /* try next */
    }
  }
  return { ok: false, value: null, error: 'JSON 解析失败', text: cleaned };
}

function levelOf(ratio) {
  if (ratio >= 0.9) return '优秀';
  if (ratio >= 0.75) return '良好';
  if (ratio >= 0.6) return '合格';
  return '待提高';
}

function toArray(value) {
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? v.trim() : v)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/\n|；|;/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeGrade(raw, maxScore, extra = {}) {
  const src = raw && raw.grade && typeof raw.grade === 'object' ? raw.grade : raw || {};
  const max = Number(maxScore) || 0;
  let score = parseFloat(String(src.score != null ? src.score : src.得分 != null ? src.得分 : ''));
  const invalid = !Number.isFinite(score);
  if (!invalid) score = Math.min(max, Math.max(0, Math.round(score * 10) / 10));

  const ratio = max > 0 && !invalid ? score / max : 0;
  const highlights = toArray(src.highlights || src.得分点 || src.strengths).map(String);

  const issuesRaw = toArray(src.issues || src.失分点 || src.problems);
  const issues = issuesRaw
    .map((item) => {
      if (typeof item === 'string') return { point: item, advice: '', deduct: null };
      if (!item || typeof item !== 'object') return null;
      return {
        point: String(item.point || item.item || item.问题 || '').trim(),
        advice: String(item.advice || item.suggestion || item.建议 || '').trim(),
        deduct: item.deduct != null && Number.isFinite(parseFloat(item.deduct)) ? Math.round(parseFloat(item.deduct) * 10) / 10 : null
      };
    })
    .filter((i) => i && i.point);

  return Object.assign(
    {
      score: invalid ? null : score,
      maxScore: max,
      level: String(src.level || src.等级 || '').trim() || (invalid ? '待评' : levelOf(ratio)),
      comment: String(src.comment || src.评语 || src.summary || '').trim(),
      highlights,
      issues,
      knowledgePoints: toArray(src.knowledgePoints || src.知识点).map(String),
      nextSteps: toArray(src.nextSteps || src.建议 || src.下一步).map(String),
      gradedAt: new Date().toISOString()
    },
    extra
  );
}

function normalizeLetters(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-H]/g, '')
    .split('')
    .sort()
    .join('');
}

function localGrade(question, answer, model) {
  const expected = normalizeLetters(question.referenceAnswer);
  const actual = normalizeLetters(answer);
  const max = Number(question.maxScore) || 0;
  const correct = expected && actual && expected === actual;
  const score = correct ? max : 0;
  let comment;
  if (!actual) comment = '未作答。';
  else if (correct) comment = '选项正确，本题满分。';
  else if (question.type === 'multi_choice') comment = `正确答案为 ${expected || '未提供'}，你的选择为 ${actual}，多选或少选均不得分。`;
  else comment = `正确答案为 ${expected || '未提供'}，你的选择 ${actual} 有误。`;

  return {
    score,
    maxScore: max,
    level: levelOf(max > 0 ? score / max : 0),
    comment,
    highlights: correct ? ['选出正确选项'] : [],
    issues: correct
      ? []
      : [{ point: '选项判断有误', advice: expected ? `正确选项为 ${expected}，可回看对应段落定位依据。` : '请核对参考答案。', deduct: max }],
    knowledgePoints: question.knowledgePoints || [],
    nextSteps: correct ? [] : ['回到原文/题干，圈出判断依据后再选。'],
    gradedAt: new Date().toISOString(),
    model: model || 'local',
    source: 'local'
  };
}

function gradeTypeLabel(type) {
  return TYPE_LABEL[type] || type;
}

module.exports = {
  parseJsonLoose,
  normalizeGrade,
  localGrade,
  gradeTypeLabel
};
