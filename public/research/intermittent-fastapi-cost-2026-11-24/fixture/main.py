from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/healthz")
def health():
    return {"ok": True}


@app.get("/sample")
def sample():
    return JSONResponse(
        {"fixture": "intermittent-fastapi"},
        headers={"Cache-Control": "no-store"},
    )
