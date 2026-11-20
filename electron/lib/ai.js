'use strict';

const prompts = require('./prompts');
const { normalizePaper, TYPE_LABEL } = require('./papers');
const { parseJsonLoose, normalizeGrade } = require('./grader');

function passageBlock(question) {
  if (!question.passage) return '';
  return `\n阅读材料 / 材料：\n${question.passage}\n`;
}

function optionsBlock(question) {
  if (!Array.isArray(question.options) || !question.options.length) return '';
  return `\n选项：\n${question.options.map((o) => `${o.key}. ${o.text}`).join('\n')}\n`;
}

function rubricText(question) {
  if (!Array.isArray(question.rubric) || !question.rubric.length) return '（未提供，按学科常规评分标准执行）';
  return question.rubric
    .map((r) => `- ${r.point}${r.score != null ? `（${r.score} 分）` : ''}`)
    .join('\n');
}

function gradeText(grade) {
  if (!grade) return '尚未批改';
  const lines = [];
  if (grade.score != null) lines.push(`得分：${grade.score} / ${grade.maxScore}`);
  if (grade.level) lines.push(`等级：${grade.level}`);
  if (grade.comment) lines.push(`评语：${grade.comment}`);
  if (grade.issues && grade.issues.length) {
    lines.push('失分点：');
    grade.issues.forEach((i) => lines.push(`- ${i.point}${i.advice ? `：${i.advice}` : ''}`));
  }
  return lines.join('\n');
}

function typeLabel(type) {
  return `${TYPE_LABEL[type] || type}（${type}）`;
}

function sampleBlock(question) {
  const sample = String(question.sampleAnswer || '').trim();
  if (!sample) return '';
  return `- 示范答案（仅供讲解参考，不参与自动批改）：${sample}\n`;
}

function buildGradePrompt(paper, question, answer) {
  const open = question.answerMode === 'open';
  return prompts.render('grade', {
    subject: paper.subject || '综合',
    grade: paper.grade || '通用',
    type: typeLabel(question.type),
    maxScore: question.maxScore,
    stem: question.stem,
    passageBlock: passageBlock(question),
    optionsBlock: optionsBlock(question),
    referenceAnswer: open
      ? '（本题答案不唯一，不设标准答案，请按作答质量与评分细则判分）'
      : question.referenceAnswer || '（未提供，请按学科常规标准判断）',
    rubric: rubricText(question),
    answer: String(answer || '').trim() || '（学生未作答）'
  });
}

function buildExplainPrompt(paper, question, answer, grade) {
  return prompts.render('explain', {
    subject: paper.subject || '综合',
    grade: paper.grade || '通用',
    stem: question.stem,
    passageBlock: passageBlock(question),
    optionsBlock: optionsBlock(question),
    referenceAnswer: question.referenceAnswer || '（未提供）',
    sampleAnswer: sampleBlock(question),
    rubric: rubricText(question),
    answer: String(answer || '').trim() || '（学生未作答）',
    grade: gradeText(grade)
  });
}

function buildQuestionContext(paper, question, index, count, answer, grade, section) {
  const sectionInfo = section
    ? `所属大题：${section.name || '未命名'}${section.passage ? `\n大题材料：\n${section.passage}` : ''}\n`
    : '';
  return prompts.render('question_context', {
    subject: paper.subject || '综合',
    grade: paper.grade || '通用',
    paperTitle: paper.title || '未命名试卷',
    index: index + 1,
    count,
    type: typeLabel(question.type),
    maxScore: question.maxScore,
    stem: question.stem,
    passageBlock: `${sectionInfo}${passageBlock(question)}`,
    optionsBlock: optionsBlock(question),
    referenceAnswer: question.answerMode === 'open' ? '（答案不唯一，无标准答案）' : question.referenceAnswer || '（未提供）',
    sampleAnswer: sampleBlock(question),
    rubric: rubricText(question),
    answer: String(answer || '').trim() || '（学生尚未作答）',
    grade: gradeText(grade)
  });
}

function parseGrade(text, maxScore) {
  const parsed = parseJsonLoose(text);
  if (!parsed.ok) {
    return normalizeGrade(
      {
        score: null,
        level: '待评',
        comment: String(text || '').trim().slice(0, 1200) || 'AI 未返回可解析的批改结果。',
        issues: [],
        highlights: [],
        knowledgePoints: [],
        nextSteps: []
      },
      maxScore,
      { parseWarning: '结构化解析失败，已保留 AI 原文' }
    );
  }
  return normalizeGrade(parsed.value, maxScore);
}

module.exports = {
  buildGradePrompt,
  buildExplainPrompt,
  buildQuestionContext,
  parseGrade,
  gradeText
};
