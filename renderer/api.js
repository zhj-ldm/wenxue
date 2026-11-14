export async function call(channel, payload = {}) {
  const res = await window.api.invoke(channel, payload);
  if (!res || res.ok !== true) {
    const err = new Error((res && res.error) || '操作失败');
    err.raw = (res && res.raw) || '';
    throw err;
  }
  return res.data;
}

export function onAiEvent(cb) {
  return window.api.onAiEvent(cb);
}

export function platform() {
  return window.api.platform;
}
