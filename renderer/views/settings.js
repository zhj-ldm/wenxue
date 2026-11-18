import { call } from '../api.js';
import { h, toast, modal, confirmDialog } from '../ui.js';

function maskKey(hasKey) {
  return hasKey ? '已保存 Key' : '未填 Key';
}

export async function renderSettings(container, ctx) {
  const { go, state } = ctx;
  const data = await call('settings:get');
  let settings = data.settings;
  let settingsDraft = Object.assign({}, settings);
  let profiles = data.profiles || [];
  let activeProfileId = data.activeProfileId || '';

  state.settings = settings;

  const page = h('div', { class: 'page' });

  page.appendChild(
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', { class: 'page-title' }, '设置'), h('div', { class: 'page-sub' }, 'API 接口、模型与文件位置')),
      h('button', { class: 'btn', type: 'button', onclick: () => go('home') }, '← 返回')
    )
  );

  const grid = h('div', { class: 'settings-grid' });

  /* ---------- API 接口 ---------- */

  const profileList = h('div', { class: 'profile-list' });

  function paintProfiles() {
    profileList.innerHTML = '';
    if (!profiles.length) {
      profileList.appendChild(
        h('div', { class: 'hint', style: 'padding:10px 0' }, '还没有接口。点下面的「添加接口」，填一个 OpenAI 兼容的地址和 Key。')
      );
      return;
    }
    profiles.forEach((p) => {
      const active = p.id === activeProfileId;
      profileList.appendChild(
        h(
          'div',
          { class: `profile-row ${active ? 'active' : ''}` },
          h(
            'div',
            { class: 'profile-main' },
            h(
              'div',
              { class: 'profile-title' },
              h('span', {}, p.name || p.model),
              active ? h('span', { class: 'badge accent' }, '使用中') : null
            ),
            h('div', { class: 'profile-meta' }, `${p.model} · ${p.baseUrl}`),
            h('div', { class: 'profile-meta' }, maskKey(p.hasKey))
          ),
          h(
            'div',
            { class: 'profile-actions' },
            active
              ? null
              : h(
                  'button',
                  {
                    class: 'btn subtle sm',
                    type: 'button',
                    onclick: async () => {
                      const res = await call('provider:activate', { id: p.id });
                      profiles = res.profiles;
                      activeProfileId = res.activeProfileId;
                      paintProfiles();
                      toast(`已切换到「${p.name || p.model}」`, 'ok');
                    }
                  },
                  '使用'
                ),
            h(
              'button',
              { class: 'btn subtle sm', type: 'button', onclick: () => openEditor(p) },
              '编辑'
            ),
            h(
              'button',
              {
                class: 'btn subtle sm',
                type: 'button',
                onclick: async (event) => {
                  const btn = event.currentTarget;
                  btn.disabled = true;
                  btn.textContent = '测试中…';
                  try {
                    const res = await call('provider:test', { id: p.id });
                    toast(`连通成功 · ${res.ms}ms${res.reply ? ` · ${res.reply}` : ''}`, 'ok');
                  } catch (err) {
                    toast(err.message || '连通失败', 'error');
                  } finally {
                    btn.disabled = false;
                    btn.textContent = '测试';
                  }
                }
              },
              '测试'
            ),
            h(
              'button',
              {
                class: 'btn subtle sm',
                type: 'button',
                onclick: async () => {
                  const ok = await confirmDialog({
                    title: '删除接口',
                    message: `确定删除「${p.name || p.model}」吗？保存的 Key 会一起删除。`,
                    confirmText: '删除',
                    danger: true
                  });
                  if (!ok) return;
                  const res = await call('provider:delete', { id: p.id });
                  profiles = res.profiles;
                  activeProfileId = res.activeProfileId;
                  paintProfiles();
                  toast('接口已删除');
                }
              },
              '删除'
            )
          )
        )
      );
    });
  }

  function openEditor(profile) {
    const draft = profile || { name: '', baseUrl: '', model: '', contextWindow: 128000, maxTokens: 8192, hasKey: false };
    const nameInput = h('input', { class: 'input', type: 'text', placeholder: '例如：DeepSeek 官方', value: draft.name || '' });
    const baseInput = h('input', {
      class: 'input',
      type: 'text',
      placeholder: 'https://api.deepseek.com/v1',
      value: draft.baseUrl || ''
    });
    const keyInput = h('input', {
      class: 'input',
      type: 'password',
      placeholder: draft.hasKey ? '已保存，留空则保持不变' : 'sk-...'
    });
    const modelInput = h('input', { class: 'input', type: 'text', placeholder: 'deepseek-chat', value: draft.model || '' });
    const ctxInput = h('input', { class: 'input', type: 'number', value: String(draft.contextWindow || 128000) });

    const ref = modal({
      title: profile ? '编辑接口' : '添加接口',
      size: 'narrow',
      body: h(
        'div',
        {},
        h('div', { class: 'field' }, h('span', { class: 'label' }, '名称'), nameInput),
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'label' }, 'API 地址'),
          baseInput,
          h('div', { class: 'hint' }, 'OpenAI 兼容地址，通常以 /v1 结尾，例如 https://api.openai.com/v1')
        ),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'API Key'), keyInput),
        h('div', { class: 'field' }, h('span', { class: 'label' }, '模型名'), modelInput),
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'label' }, '上下文长度'),
          ctxInput,
          h('div', { class: 'hint' }, '输出不设额外上限，由模型自身的能力决定。')
        )
      ),
      footer: [
        h('button', { class: 'btn subtle', type: 'button', onclick: () => ref.close() }, '取消'),
        h(
          'button',
          {
            class: 'btn primary',
            type: 'button',
            onclick: async (event) => {
              const btn = event.currentTarget;
              btn.disabled = true;
              btn.textContent = '保存中…';
              try {
                const res = await call('provider:save', {
                  id: profile ? profile.id : '',
                  name: nameInput.value.trim(),
                  baseUrl: baseInput.value.trim(),
                  apiKey: keyInput.value.trim(),
                  model: modelInput.value.trim(),
                  contextWindow: Number(ctxInput.value) || 128000,
                  maxTokens: 0
                });
                profiles = res.profiles;
                activeProfileId = res.activeProfileId;
                paintProfiles();
                ref.close();
                toast('接口已保存', 'ok');
              } catch (err) {
                toast(err.message || '保存失败', 'error');
                btn.disabled = false;
                btn.textContent = '保存';
              }
            }
          },
          '保存'
        )
      ]
    });
    setTimeout(() => nameInput.focus(), 60);
  }

  const apiCard = h(
    'div',
    { class: 'settings-card' },
    h('h3', {}, 'API 接口'),
    h(
      'div',
      { class: 'desc' },
      '直接填写 OpenAI 兼容的服务地址与 Key，可保存多套配置随时切换。Key 只保存在本机配置文件中，不会上传。'
    ),
    profileList,
    h(
      'div',
      { class: 'row', style: 'margin-top:12px' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => openEditor(null) }, '添加接口')
    )
  );

  /* ---------- 学习偏好 ---------- */

  const exportInput = h('input', { class: 'input', type: 'text', value: settingsDraft.exportDir || '' });
  const timeoutInput = h('input', {
    class: 'input',
    type: 'number',
    min: '30',
    step: '10',
    value: String(Math.round((settingsDraft.timeoutMs || 180000) / 1000))
  });
  const welcomeInput = h('input', { class: 'input', type: 'text', value: settingsDraft.searchCmd || '', placeholder: 'agent-search "{{query}}" --json' });
  const autoChoice = h('input', { type: 'checkbox', checked: settingsDraft.autoGradeChoice !== false });

  async function saveSettings(patch, message = '设置已保存') {
    const res = await call('settings:save', patch);
    settings = res.settings;
    settingsDraft = Object.assign({}, settings);
    state.settings = settings;
    toast(message, 'ok');
  }

  const prefCard = h(
    'div',
    { class: 'settings-card' },
    h('h3', {}, '学习偏好'),
    h('div', { class: 'desc' }, '模型统一由上方「API 接口」决定，所有批改、讲解、对话都使用当前启用的接口。这里配置超时、载体存放位置与可选的搜索命令。'),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'label' }, '放题目录'),
      h(
        'div',
        { class: 'row' },
        exportInput,
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: async () => {
              const dir = await call('dialog:pickFolder', { defaultPath: exportInput.value });
              if (dir) exportInput.value = dir;
            }
          },
          '选择'
        )
      ),
      h('div', { class: 'hint' }, 'AI 出卷与导入的载体都会写到这里（按学科分子文件夹），启动时自动收录。')
    ),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'label' }, '联网搜索命令（可选）'),
      welcomeInput,
      h('div', { class: 'hint' }, '默认使用内置 Aggr Search（多引擎聚合），无需填写。只有想换成别的命令行工具时才填，{{query}} 会替换成关键词。')
    ),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'label' }, 'AI 超时（秒）'),
      timeoutInput,
      h('div', { class: 'hint' }, '单次请求的最长等待时间，超过后会自动中止。')
    ),
    h(
      'div',
      { class: 'settings-actions' },
      h('label', { class: 'switch' }, autoChoice, '客观选择题由本地直接判定'),
      h(
        'button',
        {
          class: 'btn primary',
          type: 'button',
          onclick: () =>
            saveSettings({
              exportDir: exportInput.value.trim(),
              timeoutMs: Math.round(Number(timeoutInput.value || 180) * 1000),
              autoGradeChoice: autoChoice.checked,
              searchCmd: welcomeInput.value.trim()
            })
        },
        '保存'
      )
    )
  );

  /* ---------- 提示词 ---------- */

  const promptChips = h('div', { class: 'prompt-list' }, h('span', { class: 'hint' }, '读取中…'));
  (async () => {
    try {
      const list = await call('prompts:list');
      promptChips.innerHTML = '';
      list.forEach((item) => {
        promptChips.appendChild(
          h(
            'button',
            {
              class: 'prompt-chip',
              type: 'button',
              onclick: () =>
                modal({
                  title: `${item.name}.md`,
                  body: h('pre', { class: 'prompt-view' }, item.content)
                })
            },
            item.name
          )
        );
      });
    } catch (err) {
      promptChips.innerHTML = '';
      promptChips.appendChild(h('span', { class: 'hint' }, err.message || '读取失败'));
    }
  })();

  const promptCard = h(
    'div',
    { class: 'settings-card' },
    h('h3', {}, '提示词'),
    h('div', { class: 'desc' }, '批改、讲解与题目对话使用的规范化提示词，点击可查看当前版本。'),
    promptChips
  );

  /* ---------- 数据 ---------- */

  const dataCard = h(
    'div',
    { class: 'settings-card' },
    h('h3', {}, '数据与放题目录'),
    h('div', { class: 'desc' }, '所有数据都保存在本机。把载体 JSON 放进「放题目录」，应用每次打开会自动收录。'),
    h('div', { class: 'kv' }, h('span', {}, '数据目录'), h('b', {}, state.boot.dataRoot || '')),
    h('div', { class: 'kv' }, h('span', {}, '放题目录'), h('b', {}, settingsDraft.exportDir || '')),
    h('div', { class: 'kv' }, h('span', {}, '版本'), h('b', {}, `v${state.boot.version || '1.0.0'}`)),
    h(
      'div',
      { class: 'row', style: 'margin-top:14px' },
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: async () => {
            try {
              const res = await call('carrier:syncFolder', { dir: settingsDraft.exportDir || '' });
              toast(res.added ? `已收录 ${res.added} 个新载体` : `已扫描 ${res.scanned} 个文件，没有新内容`, res.added ? 'ok' : '');
            } catch (err) {
              toast(err.message || '同步失败', 'error');
            }
          }
        },
        '立即同步'
      )
    )
  );

  paintProfiles();

  grid.append(apiCard, prefCard, promptCard, dataCard);
  page.appendChild(grid);
  container.appendChild(page);
}
