"""FastAPI entrypoint for the Growth Intelligence Python backend."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.routes import (
    chat,
    embed,
    feedback,
    memory,
    recall,
    refine,
    steal_strategy,
    usage_info,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    get_settings()  # warm settings / .env load
    yield


app = FastAPI(
    title="Growth Intelligence Assistant API",
    version="0.1.0",
    lifespan=lifespan,
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException):
    """Match Next.js route shape: { error: string } instead of { detail }."""
    detail = exc.detail
    if isinstance(detail, dict) and "error" in detail:
        body = detail
    elif isinstance(detail, str):
        body = {"error": detail}
    else:
        body = {"error": str(detail)}
    return JSONResponse(status_code=exc.status_code, content=body)


app.include_router(chat.router)
app.include_router(refine.router)
app.include_router(memory.router)
app.include_router(feedback.router)
app.include_router(recall.router)
app.include_router(embed.router)
app.include_router(steal_strategy.router)
app.include_router(usage_info.router)


@app.get("/health")
async def health():
    return {"ok": True, "service": "growth-intelligence-python"}
