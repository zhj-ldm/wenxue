export const TYPE_LABEL = {
  choice: '单选',
  multi_choice: '多选',
  fill_blank: '填空',
  short_answer: '简答',
  essay: '写作',
  translation: '翻译',
  calculation: '计算',
  other: '其他'
};

export const SOURCE_LABEL = {
  generated: 'AI 命题',
  imported: '导入',
  searched: '检索整理'
};

export const DIFFICULTY_LABEL = ['', '很易', '较易', '适中', '较难', '很难'];

export const GRADE_OPTIONS = ['小学', '初中', '高一', '高二', '高三', '大学', '通用'];

export const ANSWER_TYPES = ['choice', 'fill_blank', 'short_answer', 'essay', 'translation', 'calculation'];

export const PROVIDERS = [
  { id: 'ollama-cloud', name: 'Ollama Cloud', env: 'OLLAMA_API_KEY' },
  { id: 'openai', name: 'OpenAI', env: 'OPENAI_API_KEY' },
  { id: 'anthropic', name: 'Anthropic', env: 'ANTHROPIC_API_KEY' },
  { id: 'openrouter', name: 'OpenRouter', env: 'OPENROUTER_API_KEY' },
  { id: 'deepseek', name: 'DeepSeek', env: 'DEEPSEEK_API_KEY' },
  { id: 'google', name: 'Google', env: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  { id: 'groq', name: 'Groq', env: 'GROQ_API_KEY' },
  { id: 'mistral', name: 'Mistral', env: 'MISTRAL_API_KEY' },
  { id: 'xai', name: 'xAI', env: 'XAI_API_KEY' }
];
