import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from routers import crypto, stocks, news

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

# ── Rate limiter: 120 req/min per IP (public market-data API) ──
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])

app = FastAPI(
    title="FinSight API",
    description="Real-time crypto & stock market analysis with ML predictions",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# ── Rate limiting ───────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ────────────────────────────────────────────────────────
# FIX: allow_credentials MUST be False when allow_origins=["*"]
# (True + wildcard is a spec violation and a security risk)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,          # ← FIXED (was True)
    allow_methods=["GET", "OPTIONS"], # read-only API
    allow_headers=["Accept", "Content-Type"],
)

# ── Security headers middleware ─────────────────────────────────
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"]  = "nosniff"
    response.headers["X-Frame-Options"]          = "DENY"
    response.headers["X-XSS-Protection"]         = "1; mode=block"
    response.headers["Referrer-Policy"]          = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"]       = "geolocation=(), microphone=(), camera=()"
    # Don't cache financial data in shared proxies
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "private, no-store"
    return response

# ── Global error handler (no stack-trace leakage) ──────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error on {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error. Please try again later."},
    )

# ── Routers ─────────────────────────────────────────────────────
app.include_router(crypto.router, prefix="/api/crypto", tags=["Crypto"])
app.include_router(stocks.router, prefix="/api/stocks", tags=["Stocks"])
app.include_router(news.router,   prefix="/api/news",   tags=["News"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "message": "FinSight API running"}


if __name__ == "__main__":
    import uvicorn
    # reload=False for production; use --reload flag only in dev
    uvicorn.run("main:app", host="0.0.0.0", port=9000, reload=False)
