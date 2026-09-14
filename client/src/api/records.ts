/** GET/POST /api/records —— 战绩登记的适配（AC-4b）。 */
import { formatConfigError, recordCreateSchema, recordListSchema, recordSchema } from '../config/schema';
import type { GameRecord, RecordCreate, RecordList } from '../config/schema';
import { ApiError, requestJson } from './client';

export const DEFAULT_RECORD_LIMIT = 50;

export async function fetchRecords(limit: number = DEFAULT_RECORD_LIMIT): Promise<RecordList> {
  const raw = await requestJson(`/api/records?limit=${limit}`);
  const parsed = recordListSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError({
      status: 200,
      code: 'RECORDS_SCHEMA_MISMATCH',
      message: `战绩数据不符合前端契约：${formatConfigError(parsed.error)}`,
    });
  }
  return parsed.data;
}

export async function postRecord(input: RecordCreate): Promise<GameRecord> {
  const body = recordCreateSchema.parse(input);
  const raw = await requestJson('/api/records', { method: 'POST', body: JSON.stringify(body) });
  const parsed = recordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError({
      status: 200,
      code: 'RECORD_SCHEMA_MISMATCH',
      message: `登记战绩响应不符合契约：${formatConfigError(parsed.error)}`,
    });
  }
  return parsed.data;
}
