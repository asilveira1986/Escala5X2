import threading

import pytest
from fastapi.testclient import TestClient

from app import main
from .util import problema

cliente = TestClient(main.app)
H = {"Authorization": "Bearer segredo-de-teste"}


@pytest.fixture(autouse=True)
def token(monkeypatch):
    monkeypatch.setenv("OPTIMIZER_TOKEN", "segredo-de-teste")


def test_health_e_publico():
    assert cliente.get("/health").json() == {"status": "ok"}


def test_sem_token_configurado_o_servico_recusa_tudo(monkeypatch):
    monkeypatch.delenv("OPTIMIZER_TOKEN")
    assert cliente.post("/v1/otimizar", json=problema(), headers=H).status_code == 503


def test_exige_o_token_certo():
    assert cliente.post("/v1/otimizar", json=problema()).status_code == 401
    assert cliente.post("/v1/otimizar", json=problema(), headers={"Authorization": "Bearer errado"}).status_code == 401
    assert cliente.post("/v1/otimizar", json=problema(), headers={"Authorization": "segredo-de-teste"}).status_code == 200  # sem o prefixo Bearer também vale


def test_otimiza_e_devolve_o_contrato():
    r = cliente.post("/v1/otimizar", json=problema(n=5, dias=7, minimo=2), headers=H)
    assert r.status_code == 200
    j = r.json()
    assert j["status"] in ("otima", "viavel")
    s = j["solucoes"][0]
    assert set(s["metricas"]) >= {"faltaCobertura", "deficitHorasMin", "custoReais", "objetivo"}
    assert s["alocacoes"][0].keys() >= {"colaboradorId", "data", "tipo"}


def test_problema_invalido_e_422():
    d = problema()
    d["colaboradores"][0]["permitidos"] = ["x"]
    assert cliente.post("/v1/otimizar", json=d, headers=H).status_code == 422
    assert cliente.post("/v1/otimizar", json={"periodo": 1}, headers=H).status_code == 422
    d = problema(); d["campoDesconhecido"] = 1
    assert cliente.post("/v1/otimizar", json=d, headers=H).status_code == 422


def test_ocupado_devolve_429(monkeypatch):
    monkeypatch.setattr(main, "_limite", threading.BoundedSemaphore(1))
    assert main._limite.acquire(blocking=False)          # simula uma otimização em andamento
    assert cliente.post("/v1/otimizar", json=problema(), headers=H).status_code == 429
    main._limite.release()
    assert cliente.post("/v1/otimizar", json=problema(), headers=H).status_code == 200


def test_documentacao_interativa_nao_e_exposta():
    assert cliente.get("/docs").status_code == 404
    assert cliente.get("/openapi.json").status_code == 404
