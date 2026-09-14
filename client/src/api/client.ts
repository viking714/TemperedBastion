/**
 * REST 适配层：统一 fetch 封装 + 错误信封归一化（Adapter 模式）。
 *
 * 前端一律使用**同源相对路径** `/api/...`（开发期由 Vite dev proxy 转发到后端），
 * 因此不依赖 CORS，也不存在硬编码的后端地址。
 */
import { errorEnvelopeSchema } from '../config/schema';

export interface ApiFailure {
  status: number;
  code: string;
  message: string;
}

export class ApiError extends Error implements ApiFailure {
  readonly status: number;
  readonly code: string;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiError';
    this.status = failure.status;
    this.code = failure.code;
  }
}

const NETWORK_FAILURE: ApiFailure = {
  status: 0,
  code: 'NETWORK_ERROR',
  message: '无法连接后端服务，请确认后端已启动（npm run dev 会同时拉起前后端）。',
};

async function parseError(response: Response): Promise<ApiFailure> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const parsed = errorEnvelopeSchema.safeParse(body);
  if (parsed.success) {
    return { status: response.status, code: parsed.data.error.code, message: parsed.data.error.message };
  }
  return {
    status: response.status,
    code: `HTTP_${response.status}`,
    message: `请求失败（HTTP ${response.status}）`,
  };
}

/** 发起一次 JSON 请求并返回原始 JSON（不做 schema 校验，由调用方用 zod 校验）。 */
export async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(NETWORK_FAILURE);
  }

  if (!response.ok) {
    throw new ApiError(await parseError(response));
  }
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    throw new ApiError({ status: response.status, code: 'INVALID_JSON', message: '响应不是合法 JSON' });
  }
}

export function describeApiError(error: unknown): ApiFailure {
  if (error instanceof ApiError) return { status: error.status, code: error.code, message: error.message };
  if (error instanceof Error) return { status: 0, code: 'UNKNOWN', message: error.message };
  return { status: 0, code: 'UNKNOWN', message: '未知错误' };
}
