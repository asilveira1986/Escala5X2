"""Gerador de problemas e verificador independente das restrições rígidas (não usa o modelo CP-SAT)."""
from __future__ import annotations

from datetime import date, timedelta

from app.modelo import dow
from app.schemas import Problema, Resposta, Solucao

DIA = 1440

TURNOS = [
    {"id": "manha", "inicioMin": 480, "fimMin": 1020, "intervaloMin": 60, "liquidoMin": 480},     # 08–17
    {"id": "meio", "inicioMin": 600, "fimMin": 1140, "intervaloMin": 60, "liquidoMin": 480},      # 10–19
    {"id": "tarde", "inicioMin": 720, "fimMin": 1260, "intervaloMin": 60, "liquidoMin": 480},     # 12–21
]
NOITE = {"id": "noite", "inicioMin": 1320, "fimMin": 1800, "intervaloMin": 60, "liquidoMin": 420, "noturnoMin": 420}  # 22–06


def segunda(ano=2027, mes=2, dia=1) -> date:
    d = date(ano, mes, dia)
    assert d.weekday() == 0
    return d


def semanas(inicio: date, fim: date, limite=2520, alvo=2400, folgas=2):
    """Semanas começando na segunda, todas inteiras dentro do período."""
    out, d = [], inicio
    while d + timedelta(days=6) <= fim:
        out.append({"inicio": d.isoformat(), "limiteMin": limite, "alvoMin": alvo, "exigeFolgas": folgas > 0, "folgasExigidas": folgas, "completaNoPeriodo": True})
        d += timedelta(days=7)
    return out


def colaboradores(n: int, inicio: date, fim: date, turnos=("manha", "meio", "tarde"), **extra):
    return [{"id": f"c{i:02d}", "nome": f"Pessoa {i:02d}", "permitidos": list(turnos), "semanas": semanas(inicio, fim), "interjornadaMin": 660, "custoHoraCentavos": 1500, **extra} for i in range(n)]


def problema(n=6, dias=7, minimo=3, ideal=None, tempo=10, turnos=None, **kw) -> dict:
    ini = segunda()
    fim = ini + timedelta(days=dias - 1)
    p = {
        "periodo": {"inicio": ini.isoformat(), "fim": fim.isoformat()},
        "turnos": turnos or TURNOS,
        "colaboradores": colaboradores(n, ini, fim),
        "cobertura": [{"diaSemana": d, "faixaInicioMin": 720, "faixaFimMin": 840, "minimo": minimo, "ideal": ideal} for d in range(7)],
        "tempoLimiteS": tempo, "numSolucoes": 1, "workers": 4,
    }
    p.update(kw)
    return p


def verificar(prob: Problema, sol: Solucao) -> list[str]:
    """Devolve a lista de violações das restrições rígidas (vazia = válida)."""
    erros: list[str] = []
    turno = {t.id: t for t in prob.turnos}
    dias = [prob.periodo.inicio + timedelta(days=i) for i in range((prob.periodo.fim - prob.periodo.inicio).days + 1)]
    por: dict[tuple[str, date], list] = {}
    for a in sol.alocacoes:
        por.setdefault((a.colaboradorId, a.data), []).append(a)
    for c in prob.colaboradores:
        trab: dict[date, str] = {}
        for d in dias:
            itens = por.get((c.id, d), [])
            ts = [a for a in itens if a.tipo == "trabalho"]
            if len(ts) > 1:
                erros.append(f"{c.id} {d}: mais de um turno")
            if ts:
                trab[d] = ts[0].turnoId or ""
                if ts[0].turnoId not in c.permitidos:
                    erros.append(f"{c.id} {d}: turno não permitido")
                if d in c.ausencias or d in c.indisponiveis or (c.admissao and d < c.admissao) or (c.desligamento and d > c.desligamento):
                    erros.append(f"{c.id} {d}: trabalho em dia bloqueado")
        # semanas
        for s in c.semanas:
            dd = [s.inicio + timedelta(days=i) for i in range(7)]
            total = sum(turno[trab[d]].liquidoMin for d in dd if d in trab) + sum(a.liquidoMin for a in c.anteriores if s.inicio <= a.data < s.inicio + timedelta(days=7))
            if total > s.limiteMin:
                erros.append(f"{c.id} semana {s.inicio}: {total} > {s.limiteMin}")
            if s.exigeFolgas:
                eleg = sum(1 for d in dd if d in dias and not (c.admissao and d < c.admissao)) + s.diasElegiveisFora
                folgas = eleg - (sum(1 for d in dd if d in trab) + s.trabalhadosFora)
                if folgas < s.folgasExigidas:
                    erros.append(f"{c.id} semana {s.inicio}: {folgas} folgas < {s.folgasExigidas}")
        # interjornada
        seq = sorted((d, turno[t]) for d, t in trab.items())
        fins = [((d - prob.periodo.inicio).days * DIA + t.fimMin, (d - prob.periodo.inicio).days * DIA + t.inicioMin) for d, t in seq]
        ant = [((a.data - prob.periodo.inicio).days * DIA + a.fimMin, None) for a in c.anteriores]
        eventos = sorted([(f, i) for f, i in ant] + [(f, i) for f, i in fins], key=lambda e: (e[1] if e[1] is not None else -10**9))
        for i in range(len(fins)):
            for j in range(i + 1, len(fins)):
                if fins[j][1] - fins[i][0] < c.interjornadaMin:
                    erros.append(f"{c.id}: interjornada entre {seq[i][0]} e {seq[j][0]}")
        for fim_ant, _ in ant:
            for (fim, ini) in fins:
                if 0 <= ini - fim_ant < c.interjornadaMin or ini < fim_ant:
                    erros.append(f"{c.id}: interjornada com a escala anterior")
        # rodízio
        if c.rodizioDomingo:
            doms = [d for d in dias if dow(d) == 0]
            for i in range(len(doms) - c.rodizioDomingo + 1):
                if all(d in trab for d in doms[i:i + c.rodizioDomingo]):
                    erros.append(f"{c.id}: {c.rodizioDomingo} domingos seguidos")
    return erros
