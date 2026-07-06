from fastapi import FastAPI

from app.routes import captures, generate, health, quotes

app = FastAPI(title="QuoteLens API")
app.include_router(health.router)
app.include_router(captures.router)
app.include_router(generate.router)
app.include_router(quotes.router)
