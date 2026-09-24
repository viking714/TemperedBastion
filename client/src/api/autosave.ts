/** GET/PUT /api/autosave —— 自动存档的适配（每用户一行，随玩随存）。 */
import { autoSaveOutSchema, autoSaveWriteResponseSchema, formatConfigError, savePayloadSchema } from '../config/schema';
import type { AutoSaveOut, AutoSaveWriteResponse, SavePayload } from '../config/schema';
import { ApiError, requestJson } from './client';

/** GET /api/autosave —— 有存档返回 {payload, totalLevels}；没有则 null（404）。 */
export async function fetchAutoSave(): Promise<AutoSaveOut | null> {
  try {
    const raw = await requestJson('/api/autosave');
    const parsed = autoSaveOutSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiError({
        status: 200,
        code: 'AUTOSAVE_SCHEMA_MISMATCH',
        message: `自动存档不符合前端契约：${formatConfigError(parsed.error)}`,
      });
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function writeAutoSave(payload: SavePayload): Promise<AutoSaveWriteResponse> {
  const body = savePayloadSchema.parse(payload);
  const raw = await requestJson('/api/autosave', { method: 'PUT', body: JSON.stringify(body) });
  const parsed = autoSaveWriteResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError({
      status: 200,
      code: 'AUTOSAVE_WRITE_SCHEMA_MISMATCH',
      message: `自动存档写响应不符合契约：${formatConfigError(parsed.error)}`,
    });
  }
  return parsed.data;
}

/** 页面卸载时的尽力而为保存：keepalive 让请求在文档销毁后仍尽量送达。 */
export function writeAutoSaveKeepalive(payload: SavePayload): void {
  void fetch('/api/autosave', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
}
