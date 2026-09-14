/** GET /api/config —— 唯一数值真源（AC-3）。 */
import { configResponseSchema, formatConfigError } from '../config/schema';
import type { ConfigResponse } from '../config/schema';
import { ApiError, requestJson } from './client';

export async function fetchConfig(): Promise<ConfigResponse> {
  const raw = await requestJson('/api/config');
  const parsed = configResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError({
      status: 200,
      code: 'CONFIG_SCHEMA_MISMATCH',
      message: `后端配置不符合前端契约：${formatConfigError(parsed.error)}`,
    });
  }
  return parsed.data;
}

export async function checkHealth(): Promise<boolean> {
  try {
    await requestJson('/api/health');
    return true;
  } catch {
    return false;
  }
}
