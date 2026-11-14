import { call } from '../api.js';
import { toast } from '../ui.js';

// 直接选文件导入：读 JSON → 归一化入库（不经过 AI）
export async function importPaperFile(ctx = {}, { subject = '' } = {}) {
  const file = await call('dialog:pickFile');
  if (!file) return null;
  try {
    const read = await call('file:read', { filePath: file });
    const res = await call('paper:import', { raw: read.content, subject });
    toast(`已导入《${res.paper.title}》· ${res.paper.questions.length} 题 · ${res.paper.totalScore} 分`, 'ok');
    if (ctx.go) ctx.go('library', { subject: res.paper.subject });
    return res;
  } catch (err) {
    toast(err.message || '导入失败', 'error');
    return null;
  }
}
