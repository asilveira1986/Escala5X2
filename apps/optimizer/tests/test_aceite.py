"""Critério de aceite da Fase 3: solução viável em até 30 s para um setor de 50 pessoas (um mês)."""
import time
from datetime import timedelta

from app.modelo import resolver
from app.schemas import Problema
from .util import NOITE, TURNOS, colaboradores, segunda, verificar


def setor_de_50(tempo=30, **kw):
    ini = segunda()                      # 01/02/2027
    fim = ini + timedelta(days=27)       # 4 semanas
    cobertura = []
    for d in range(7):
        fim_de_semana = d in (0, 6)
        cobertura += [
            {"diaSemana": d, "faixaInicioMin": 600, "faixaFimMin": 720, "minimo": 14 if fim_de_semana else 22, "ideal": 18 if fim_de_semana else 26},
            {"diaSemana": d, "faixaInicioMin": 780, "faixaFimMin": 1020, "minimo": 12 if fim_de_semana else 20, "ideal": 16 if fim_de_semana else 24},
        ]
    d = {
        "periodo": {"inicio": ini.isoformat(), "fim": fim.isoformat()},
        "turnos": TURNOS + [NOITE],
        "colaboradores": colaboradores(50, ini, fim),
        "cobertura": cobertura, "feriados": [(ini + timedelta(days=7)).isoformat()],   # uma segunda-feira feriado
        "tempoLimiteS": tempo, "numSolucoes": 3, "workers": 4,
    }
    # um quinto da equipe com rodízio de domingo e algumas férias
    for i, c in enumerate(d["colaboradores"]):
        if i % 5 == 0:
            c["rodizioDomingo"] = 2
        if i % 11 == 0:
            c["ausencias"] = [(ini + timedelta(days=k)).isoformat() for k in range(14, 21)]
            c["semanas"][2]["exigeFolgas"] = False
            c["semanas"][2]["alvoMin"] = 0
    d.update(kw)
    return d


def test_setor_de_50_pessoas_em_ate_30_segundos():
    p = Problema.model_validate(setor_de_50())
    t = time.monotonic()
    r = resolver(p)
    dt = time.monotonic() - t
    assert dt <= 30 + 5, f"demorou {dt:.1f}s"                 # 30 s de limite + folga de montagem do modelo
    assert r.status in ("otima", "viavel")
    assert r.solucoes, r.mensagem
    for s in r.solucoes:
        assert verificar(p, s) == []                           # regras rígidas respeitadas em TODAS as propostas
    melhor = r.solucoes[0]
    assert melhor.metricas.faltaCobertura == 0                 # a equipe cobre a demanda
    assert melhor.metricas.deficitHorasMin == 0                # e todos fecham as horas contratadas
    assert melhor.metricas.domingosMax - melhor.metricas.domingosMin <= 2
    print(f"\n50 pessoas × 28 dias: {dt:.1f}s, status {r.status}, {len(r.solucoes)} propostas, objetivo {melhor.metricas.objetivo}")


def test_o_verificador_independente_pega_violacoes():
    """Garante que o teste acima não é vácuo: uma solução adulterada precisa ser reprovada."""
    p = Problema.model_validate(setor_de_50(tempo=5, numSolucoes=1))
    r = resolver(p)
    s = r.solucoes[0]
    trab = [a for a in s.alocacoes if a.tipo == "trabalho" and a.colaboradorId == "c01"]
    folgas = [a for a in s.alocacoes if a.tipo == "folga" and a.colaboradorId == "c01"]
    for a in folgas[:4]:                                       # transforma quatro folgas em trabalho: estoura folgas/teto semanal
        a.tipo, a.turnoId, a.inicioMin, a.fimMin, a.intervaloMin = "trabalho", "manha", 480, 1020, 60
    assert verificar(p, s) != []


def test_setor_de_50_com_demanda_apertada_ainda_responde_no_prazo():
    """Demanda perto da capacidade (só ~20% de folga): o solver pode não provar a otimalidade, mas precisa responder no prazo."""
    d = setor_de_50()
    d["cobertura"] = [{"diaSemana": dw, "faixaInicioMin": 780, "faixaFimMin": 1020, "minimo": 26 if dw in (0, 6) else 32, "ideal": 36} for dw in range(7)]
    p = Problema.model_validate(d)
    t = time.monotonic()
    r = resolver(p)
    dt = time.monotonic() - t
    assert dt <= 35, f"demorou {dt:.1f}s"
    assert r.solucoes and r.status in ("otima", "viavel")
    for s in r.solucoes:
        assert verificar(p, s) == []
    print(f"\ndemanda apertada: {dt:.1f}s, status {r.status}, falta {r.solucoes[0].metricas.faltaCobertura}, ideal {r.solucoes[0].metricas.faltaIdeal}")
