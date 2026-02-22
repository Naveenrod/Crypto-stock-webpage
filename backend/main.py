from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import crypto, stocks, news

app = FastAPI(
    title="Financial Analyzer API",
    description="Real-time crypto & stock market analysis with ML predictions",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(crypto.router, prefix="/api/crypto", tags=["Crypto"])
app.include_router(stocks.router, prefix="/api/stocks", tags=["Stocks"])
app.include_router(news.router, prefix="/api/news", tags=["News"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "message": "Financial Analyzer API running"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=9000, reload=True)
