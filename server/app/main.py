"""FastAPI 应用：CORS、统一错误信封、路由挂载、启动钩子（建表 + 配置版本审计）。"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import seed
from .db import get_session_factory, init_db
from .routers import config as config_router
from .routers import health, records, saves
from .schemas import ApiError

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """启动：建表（幂等）+ 把 level.json 版本同步进审计表。"""
    init_db()
    factory = get_session_factory()
    with factory() as db:
        seed.sync_config_version(db)
    yield


def create_app() -> FastAPI:
    application = FastAPI(
        title="淬炼塔防 API",
        version="1.0.0",
        description="关卡配置 + 存档 / 战绩持久化（唯一数值真源：server/config/level.json）",
        lifespan=lifespan,
    )

    # 前端主路径是 Vite dev proxy 同源 /api；CORS 仅作兜底。
    application.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.include_router(health.router, prefix="/api")
    application.include_router(config_router.router, prefix="/api")
    application.include_router(saves.router, prefix="/api")
    application.include_router(records.router, prefix="/api")

    return application


def _envelope(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": {"code": code, "message": message}})


app = create_app()


@app.exception_handler(ApiError)
async def _handle_api_error(_request: Request, exc: ApiError) -> JSONResponse:
    return _envelope(exc.status_code, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def _handle_validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
    details = exc.errors()
    first = details[0] if details else {}
    loc = ".".join(str(part) for part in first.get("loc", ())) or "<body>"
    return _envelope(422, "VALIDATION_ERROR", f"请求参数校验失败：{loc} {first.get('msg', '')}".strip())


@app.exception_handler(StarletteHTTPException)
async def _handle_http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
    return _envelope(exc.status_code, code, str(exc.detail))


@app.exception_handler(Exception)
async def _handle_unexpected(_request: Request, exc: Exception) -> JSONResponse:  # pragma: no cover
    return _envelope(500, "INTERNAL_ERROR", f"服务内部错误：{type(exc).__name__}")
