/** /api/auth/* —— 注册 / 登录 / 登出 / 会话查询（同源 Cookie 会话）。 */
import { formatConfigError, okResponseSchema, userSchema } from '../config/schema';
import type { AuthUser } from '../config/schema';
import { ApiError, requestJson } from './client';

/** GET /api/auth/me —— 已登录返回用户；未登录（401）返回 null。 */
export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const raw = await requestJson('/api/auth/me');
    const parsed = userSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiError({
        status: 200,
        code: 'AUTH_SCHEMA_MISMATCH',
        message: `用户数据不符合前端契约：${formatConfigError(parsed.error)}`,
      });
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

function parseUser(raw: unknown): AuthUser {
  const parsed = userSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError({
      status: 200,
      code: 'AUTH_SCHEMA_MISMATCH',
      message: `用户数据不符合前端契约：${formatConfigError(parsed.error)}`,
    });
  }
  return parsed.data;
}

export async function register(username: string, password: string): Promise<AuthUser> {
  const raw = await requestJson('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return parseUser(raw);
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const raw = await requestJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return parseUser(raw);
}

export async function logout(): Promise<void> {
  const raw = await requestJson('/api/auth/logout', { method: 'POST' });
  okResponseSchema.parse(raw);
}
