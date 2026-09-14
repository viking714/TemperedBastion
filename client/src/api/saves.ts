/** GET/PUT /api/save/{slot} —— 存档读写的适配（AC-4a）。 */
import { formatConfigError, savePayloadSchema, saveWriteResponseSchema } from '../config/schema';
import type { SavePayload, SaveWriteResponse } from '../config/schema';
import { ApiError, requestJson } from './client';

export const DEFAULT_SLOT = 1;

export async function fetchSave(slot: number = DEFAULT_SLOT): Promise<SavePayload> {
  const raw = await requestJson(`/api/save/${slot}`);
  const parsed = savePayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError({
      status: 200,
      code: 'SAVE_SCHEMA_MISMATCH',
      message: `存档数据不符合前端契约：${formatConfigError(parsed.error)}`,
    });
  }
  return parsed.data;
}

export async function writeSave(payload: SavePayload, slot: number = DEFAULT_SLOT): Promise<SaveWriteResponse> {
  const body = { ...payload, slot };
  const raw = await requestJson(`/api/save/${slot}`, { method: 'PUT', body: JSON.stringify(body) });
  const parsed = saveWriteResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError({
      status: 200,
      code: 'SAVE_WRITE_SCHEMA_MISMATCH',
      message: `写档响应不符合契约：${formatConfigError(parsed.error)}`,
    });
  }
  return parsed.data;
}

export function isSaveNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'SAVE_NOT_FOUND';
}
