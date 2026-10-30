from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="가계부")
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
