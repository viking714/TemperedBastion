/**
 * 内核公共出口。
 *
 * ⚠️ 边界约束（AC-5）：本目录下的一切都必须是纯逻辑——
 * 不得 import react/react-dom/engine/render/ui/api/theme，
 * 不得触碰 document / window / navigator / canvas / requestAnimationFrame /
 * performance / fetch / localStorage。由 `core.boundary.test.ts` 静态守护。
 */
export * from './types';
export * from './units';
export * from './config';
export * from './economy';
export * from './path';
export * from './placement';
export * from './targeting';
export * from './combat';
export * from './spawn';
export * from './waveStateMachine';
export * from './simulation';
export * from './game';
export * from './serialize';
