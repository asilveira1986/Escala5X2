"""API do otimizador. Stateless: recebe o problema pronto e devolve até 3 propostas. Não acessa o banco."""
from __future__ import annotations

import hmac
import os
import threading

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.concurrency import run_in_threadpool

from .modelo import resolver
from .schemas import Problema, Resposta

app = FastAPI(title="JornadaCerta Otimizador", version="1.0.0", docs_url=None, redoc_url=None, openapi_url=None)
_limite = threading.BoundedSemaphore(int(os.environ.get("MAX_CONCURRENT", "2")))


def autenticar(authorization: str | None = Header(default=None)) -> None:
    """Token interno compartilhado com o worker (OPTIMIZER_TOKEN). Sem token configurado, o serviço recusa tudo."""
    esperado = os.environ.get("OPTIMIZER_TOKEN", "")
    if not esperado:
        raise HTTPException(status_code=503, detail="otimizador sem token configurado")
    enviado = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(enviado.encode(), esperado.encode()):
        raise HTTPException(status_code=401, detail="não autorizado")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/otimizar", response_model=Resposta, dependencies=[Depends(autenticar)])
async def otimizar(problema: Problema) -> Resposta:
    if not _limite.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="otimizador ocupado; tente novamente em instantes")
    try:
        return await run_in_threadpool(resolver, problema)
    finally:
        _limite.release()
