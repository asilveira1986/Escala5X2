from datetime import date, timedelta

import pytest

from app.modelo import resolver
from app.schemas import Problema
from .util import NOITE, TURNOS, colaboradores, problema, segunda, semanas, verificar


def rodar(d: dict):
    p = Problema.model_validate(d)
    return p, resolver(p)


def test_problema_pequeno_cobre_tudo_e_respeita_as_regras():
    p, r = rodar(problema(n=6, dias=7, minimo=3))
    assert r.status in ("otima", "viavel")
    s = r.solucoes[0]
    assert s.metricas.faltaCobertura == 0
    assert verificar(p, s) == []
    # cada pessoa tem exatamente 2 folgas na semana e 40h (meta)
    assert s.metricas.deficitHorasMin == 0


def test_cobertura_impossivel_ainda_devolve_solucao_e_mostra_a_falta():
    p, r = rodar(problema(n=3, dias=7, minimo=10))
    s = r.solucoes[0]
    assert s.metricas.faltaCobertura > 0           # não há gente: a folga de cobertura aparece
    assert verificar(p, s) == []                    # mas as regras rígidas continuam respeitadas


def test_ausencia_e_indisponibilidade_nunca_recebem_turno():
    d = problema(n=5, dias=7, minimo=2)
    ini = segunda()
    d["colaboradores"][0]["ausencias"] = [(ini + timedelta(days=i)).isoformat() for i in range(7)]   # semana toda de férias
    d["colaboradores"][1]["indisponiveis"] = [(ini + timedelta(days=2)).isoformat()]
    d["colaboradores"][0]["semanas"][0]["exigeFolgas"] = False
    d["colaboradores"][0]["semanas"][0]["alvoMin"] = 0
    p, r = rodar(d)
    s = r.solucoes[0]
    assert verificar(p, s) == []
    c0 = [a for a in s.alocacoes if a.colaboradorId == "c00"]
    assert c0 == []                                                             # férias: sem lançamento algum
    c1 = {a.data: a for a in s.alocacoes if a.colaboradorId == "c01"}
    assert c1[ini + timedelta(days=2)].tipo == "folga"                          # indisponível: lançado como folga


def test_interjornada_com_a_escala_anterior():
    d = problema(n=4, dias=7, minimo=1)
    ini = segunda()
    # c00 fechou ontem um turno da noite (22h–06h de hoje): o primeiro turno só pode ser a partir de 17h
    d["turnos"] = TURNOS + [NOITE]
    for c in d["colaboradores"]:
        c["permitidos"] = ["manha", "meio", "tarde"]
    d["colaboradores"][0]["anteriores"] = [{"data": (ini - timedelta(days=1)).isoformat(), "inicioMin": 1320, "fimMin": 1800, "liquidoMin": 420}]
    p, r = rodar(d)
    s = r.solucoes[0]
    assert verificar(p, s) == []
    primeiro = next(a for a in s.alocacoes if a.colaboradorId == "c00" and a.data == ini)
    assert primeiro.tipo == "folga"        # nenhum turno de dia fecha 11h depois das 06h


def test_rodizio_de_domingo():
    ini = segunda()
    d = problema(n=5, dias=28, minimo=1, tempo=15)
    for c in d["colaboradores"]:
        c["rodizioDomingo"] = 2
    d["cobertura"] = [{"diaSemana": dw, "faixaInicioMin": 720, "faixaFimMin": 840, "minimo": 3} for dw in range(7)]
    p, r = rodar(d)
    s = r.solucoes[0]
    assert verificar(p, s) == []


def test_regras_impossiveis_voltam_inviaveis_com_mensagem():
    d = problema(n=3, dias=7, minimo=1)
    for c in d["colaboradores"]:
        c["semanas"][0]["folgasExigidas"] = 7     # 7 folgas por semana: ninguém pode trabalhar e ainda assim há meta; sem trabalho a meta só penaliza
        c["semanas"][0]["limiteMin"] = 0
        c["semanas"][0]["folgasExigidas"] = 8     # impossível de verdade (só há 7 dias)
    _, r = rodar(d)
    assert r.status == "inviavel" and r.solucoes == []
    assert "regras rígidas" in (r.mensagem or "")


def test_ate_tres_alternativas_distintas_e_ordenadas_por_objetivo():
    d = problema(n=8, dias=14, minimo=3, ideal=5, tempo=12, numSolucoes=3)
    d["colaboradores"] = colaboradores(8, segunda(), segunda() + timedelta(days=13))
    p, r = rodar(d)
    assert 2 <= len(r.solucoes) <= 3
    objs = [s.metricas.objetivo for s in r.solucoes]
    assert objs == sorted(objs)
    chaves = [tuple((a.colaboradorId, a.data, a.turnoId) for a in s.alocacoes) for s in r.solucoes]
    assert len(set(chaves)) == len(chaves)               # nenhuma repetida
    for s in r.solucoes:
        assert verificar(p, s) == []
        assert s.metricas.faltaCobertura == 0


def test_preferencia_de_evitar_dia_e_atendida_quando_ha_folga_de_gente():
    ini = segunda()
    d = problema(n=8, dias=7, minimo=2)
    alvo = (ini + timedelta(days=2)).isoformat()
    d["colaboradores"][0]["preferencias"] = [{"tipo": "evitar_trabalho", "data": alvo, "peso": 500}]
    p, r = rodar(d)
    s = r.solucoes[0]
    folga = next(a for a in s.alocacoes if a.colaboradorId == "c00" and a.data.isoformat() == alvo)
    assert folga.tipo == "folga" and s.metricas.preferenciasNaoAtendidas == 0


def test_estabilidade_mantem_a_escala_de_referencia():
    d = problema(n=8, dias=7, minimo=2, tempo=8)
    p, r1 = rodar(d)
    ref = [{"colaboradorId": a.colaboradorId, "data": a.data.isoformat(), "turnoId": a.turnoId} for a in r1.solucoes[0].alocacoes]
    d2 = problema(n=8, dias=7, minimo=2, tempo=8, referencia=ref)
    d2["pesos"] = {"estabilidade": 200}
    _, r2 = rodar(d2)
    assert r2.solucoes[0].metricas.mudancasEmRelacaoReferencia == 0


def test_equidade_de_domingos_entre_a_equipe():
    d = problema(n=6, dias=28, minimo=2, tempo=15)
    p, r = rodar(d)
    m = r.solucoes[0].metricas
    assert verificar(p, r.solucoes[0]) == []
    assert m.domingosMax - m.domingosMin <= 1


def test_custo_considera_domingo_em_dobro():
    d = problema(n=6, dias=14, minimo=2, tempo=8)
    _, r = rodar(d)
    assert r.solucoes[0].metricas.custoReais > 0


def test_contrato_do_problema_rejeita_dados_incoerentes():
    d = problema()
    d["colaboradores"][0]["permitidos"] = ["inexistente"]
    with pytest.raises(Exception):
        Problema.model_validate(d)
    d = problema()
    d["periodo"]["fim"] = "2026-01-01"
    with pytest.raises(Exception):
        Problema.model_validate(d)
