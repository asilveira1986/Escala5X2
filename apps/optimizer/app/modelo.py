"""Modelo CP-SAT da escala. Variável x[c, d, t] = o colaborador c faz o turno t no dia d (no máximo um por dia).

Restrições rígidas: um turno por dia, teto semanal, folgas por semana, interjornada (inclusive com a escala anterior),
rodízio de domingo, ausências/indisponibilidades/vínculo e turnos permitidos por pessoa.
Cobertura mínima e horas contratadas são metas com folga penalizada: o resultado sempre existe e mostra onde falta gente.
Toda solução é revalidada pelo motor TypeScript antes de aparecer ao usuário; este serviço nunca é a palavra final.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional

from ortools.sat.python import cp_model

from .schemas import AlocacaoSaida, Metricas, Problema, Resposta, Solucao

DIA = 1440


def dow(d: date) -> int:
    """0 = domingo (mesma convenção do motor TypeScript)."""
    return (d.weekday() + 1) % 7


@dataclass
class Ctx:
    p: Problema
    model: cp_model.CpModel
    dias: list[date]
    x: list[list[dict[str, cp_model.IntVar]]]            # x[c][d][turno_id]
    w: list[list[object]]                                  # w[c][d] (BoolVar ou 0)
    bloqueado: list[list[bool]]
    faltas: list[cp_model.IntVar] = field(default_factory=list)
    faltas_ideal: list[cp_model.IntVar] = field(default_factory=list)
    deficits: list[cp_model.IntVar] = field(default_factory=list)
    s_dom: list[object] = field(default_factory=list)
    smin: Optional[cp_model.IntVar] = None
    smax: Optional[cp_model.IntVar] = None
    obj: Optional[cp_model.IntVar] = None
    termos_pref: list[tuple[object, int]] = field(default_factory=list)


def _bloqueado(c, d: date) -> bool:
    return bool(
        (c.admissao and d < c.admissao) or (c.desligamento and d > c.desligamento)
        or d in c.ausencias or d in c.indisponiveis
    )


def construir(p: Problema) -> Ctx:
    m = cp_model.CpModel()
    n_dias = (p.periodo.fim - p.periodo.inicio).days + 1
    dias = [p.periodo.inicio + timedelta(days=i) for i in range(n_dias)]
    turno = {t.id: t for t in p.turnos}
    feriados = set(p.feriados)
    pesos = p.pesos

    x: list[list[dict[str, cp_model.IntVar]]] = []
    w: list[list[object]] = []
    bloq: list[list[bool]] = []
    for ci, c in enumerate(p.colaboradores):
        xc, wc, bc = [], [], []
        for di, d in enumerate(dias):
            b = _bloqueado(c, d)
            vars_ = {} if b else {tid: m.NewBoolVar(f"x_{ci}_{di}_{tid}") for tid in c.permitidos}
            xc.append(vars_)
            bc.append(b)
            if vars_:
                wv = m.NewBoolVar(f"w_{ci}_{di}")
                m.Add(sum(vars_.values()) == wv)
                wc.append(wv)
            else:
                wc.append(0)
        x.append(xc); w.append(wc); bloq.append(bc)
    ctx = Ctx(p=p, model=m, dias=dias, x=x, w=w, bloqueado=bloq)
    termos: list[tuple[object, int]] = []   # (expressão, peso)

    # ---- Semanas: teto, folgas, meta de horas
    for ci, c in enumerate(p.colaboradores):
        for sem in c.semanas:
            fim_sem = sem.inicio + timedelta(days=7)
            idx = [di for di, d in enumerate(dias) if sem.inicio <= d < fim_sem]
            horas_ant = sum(a.liquidoMin for a in c.anteriores if sem.inicio <= a.data < fim_sem)
            soma = sum(turno[tid].liquidoMin * v for di in idx for tid, v in x[ci][di].items())
            m.Add(soma + horas_ant <= sem.limiteMin)
            if sem.alvoMin > 0 and sem.completaNoPeriodo:
                alvo = sem.alvoMin
                dfc = m.NewIntVar(0, alvo, f"def_{ci}_{sem.inicio}")
                m.Add(dfc >= alvo - soma - horas_ant)
                ctx.deficits.append(dfc)
                termos.append((dfc, pesos.deficitHorasPorMin))
            if sem.exigeFolgas:
                elegiveis = sum(1 for di in idx if not (c.admissao and dias[di] < c.admissao)) + sem.diasElegiveisFora
                trabalhados = sum(w[ci][di] for di in idx) + sem.trabalhadosFora
                m.Add(trabalhados <= elegiveis - sem.folgasExigidas)

    # ---- Interjornada (pares em dias seguidos e a dois dias, por causa de turnos que viram a noite) e escala anterior
    for ci, c in enumerate(p.colaboradores):
        ij = c.interjornadaMin
        for di in range(len(dias)):
            for tid, v in x[ci][di].items():
                fim_abs = di * DIA + turno[tid].fimMin
                for k in (1, 2):
                    if di + k >= len(dias):
                        continue
                    for tid2, v2 in x[ci][di + k].items():
                        if (di + k) * DIA + turno[tid2].inicioMin - fim_abs < ij:
                            m.AddBoolOr([v.Not(), v2.Not()])
        for a in c.anteriores:
            fim_abs = (a.data - p.periodo.inicio).days * DIA + a.fimMin
            for di in range(min(3, len(dias))):
                for tid, v in x[ci][di].items():
                    if di * DIA + turno[tid].inicioMin - fim_abs < ij:
                        m.Add(v == 0)

    # ---- Rodízio de domingo: em n domingos seguidos, ao menos um de folga
    domingos = [di for di, d in enumerate(dias) if dow(d) == 0]
    for ci, c in enumerate(p.colaboradores):
        n = c.rodizioDomingo
        if n and len(domingos) >= n:
            for i in range(len(domingos) - n + 1):
                m.Add(sum(w[ci][di] for di in domingos[i:i + n]) <= n - 1)

    # ---- Cobertura (meta com folga penalizada)
    cobertas: dict[int, list] = {}
    for dem in p.cobertura:
        cobertas.setdefault(dem.diaSemana, []).append(dem)
    for di, d in enumerate(dias):
        for dem in cobertas.get(dow(d), []):
            fi = di * DIA + dem.faixaInicioMin
            ff = di * DIA + (dem.faixaFimMin if dem.faixaFimMin > dem.faixaInicioMin else dem.faixaFimMin + DIA)
            lits = []
            for dd in (di - 1, di):
                if dd < 0:
                    continue
                for ci in range(len(p.colaboradores)):
                    for tid, v in x[ci][dd].items():
                        t = turno[tid]
                        if dd * DIA + t.inicioMin <= fi and dd * DIA + t.fimMin >= ff:
                            lits.append(v)
            const = 0
            if di == 0:
                for c in p.colaboradores:
                    if any((a.data - p.periodo.inicio).days * DIA + a.inicioMin <= fi and (a.data - p.periodo.inicio).days * DIA + a.fimMin >= ff for a in c.anteriores):
                        const += 1
            total = sum(lits) + const
            if dem.minimo > 0:
                f = m.NewIntVar(0, dem.minimo, f"falta_{di}_{dem.faixaInicioMin}")
                m.Add(total + f >= dem.minimo)
                ctx.faltas.append(f)
                termos.append((f, pesos.faltaCobertura))
            if dem.ideal is not None and dem.ideal > max(dem.minimo, 0):
                fi_ = m.NewIntVar(0, dem.ideal, f"faltai_{di}_{dem.faixaInicioMin}")
                m.Add(total + fi_ >= dem.ideal)
                ctx.faltas_ideal.append(fi_)
                termos.append((fi_, pesos.faltaIdeal))

    # ---- Equidade de domingos e feriados trabalhados
    especiais = [di for di, d in enumerate(dias) if dow(d) == 0 or d in feriados]
    if especiais and len(p.colaboradores) > 1:
        smax = m.NewIntVar(0, len(especiais), "smax")
        smin = m.NewIntVar(0, len(especiais), "smin")
        for ci in range(len(p.colaboradores)):
            s = sum(w[ci][di] for di in especiais)
            ctx.s_dom.append(s)
            m.Add(s <= smax)
            # só entra no mínimo quem pode trabalhar em algum desses dias
            if any(not bloq[ci][di] and x[ci][di] for di in especiais):
                m.Add(s >= smin)
        ctx.smax, ctx.smin = smax, smin
        termos.append((smax - smin, pesos.equidadeDomingos))

    # ---- Preferências
    for ci, c in enumerate(p.colaboradores):
        for pref in c.preferencias:
            for di, d in enumerate(dias):
                if pref.data is not None and pref.data != d:
                    continue
                if pref.diaSemana is not None and pref.diaSemana != dow(d):
                    continue
                if pref.tipo in ("evitar_trabalho", "preferir_trabalho"):
                    base = w[ci][di]
                else:
                    v = x[ci][di].get(pref.turnoId or "")
                    base = v if v is not None else 0
                if isinstance(base, int):
                    continue   # sem variável: constante, não muda a decisão
                peso = pref.peso * pesos.preferencia
                if pref.tipo.startswith("evitar"):
                    termos.append((base, peso))
                else:
                    termos.append((1 - base, peso))

    # ---- Estabilidade em relação à escala anterior
    idx_c = {c.id: i for i, c in enumerate(p.colaboradores)}
    idx_d = {d: i for i, d in enumerate(dias)}
    for r in p.referencia:
        ci, di = idx_c.get(r.colaboradorId), idx_d.get(r.data)
        if ci is None or di is None or bloq[ci][di]:
            continue
        if r.turnoId is None:
            base = w[ci][di]
            if not isinstance(base, int):
                termos.append((base, pesos.estabilidade))
        else:
            v = x[ci][di].get(r.turnoId)
            if v is not None:   # turno que a pessoa nem pode fazer: constante, não influencia a decisão
                termos.append((1 - v, pesos.estabilidade))

    # ---- Custo (hora base + dobro em domingo/feriado + 20% de adicional noturno), em reais inteiros
    for ci, c in enumerate(p.colaboradores):
        if c.custoHoraCentavos <= 0:
            continue
        for di, d in enumerate(dias):
            mult = 2.0 if (dow(d) == 0 or d in feriados) else 1.0
            for tid, v in x[ci][di].items():
                t = turno[tid]
                cents = (t.liquidoMin * c.custoHoraCentavos * mult + t.noturnoMin * c.custoHoraCentavos * 0.2) / 60
                reais = int(round(cents / 100))
                if reais:
                    termos.append((v, reais * pesos.custoPorReal))

    obj = m.NewIntVar(-10**9, 10**12, "objetivo")
    m.Add(obj == sum(expr * peso for expr, peso in termos))
    m.Minimize(obj)
    ctx.obj = obj
    return ctx


def _extrair(ctx: Ctx, solver: cp_model.CpSolver) -> dict[tuple[int, int], Optional[str]]:
    sel: dict[tuple[int, int], Optional[str]] = {}
    for ci in range(len(ctx.p.colaboradores)):
        for di in range(len(ctx.dias)):
            if ctx.bloqueado[ci][di]:
                continue
            esc = None
            for tid, v in ctx.x[ci][di].items():
                if solver.Value(v):
                    esc = tid
            sel[(ci, di)] = esc
    return sel


def _montar_solucao(ctx: Ctx, solver: cp_model.CpSolver, sel: dict, status: int) -> Solucao:
    p = ctx.p
    turno = {t.id: t for t in p.turnos}
    saida: list[AlocacaoSaida] = []
    for ci, c in enumerate(p.colaboradores):
        for di, d in enumerate(ctx.dias):
            if (ci, di) not in sel:
                # ausência/fora do vínculo: sem lançamento; indisponível: folga
                if c.admissao and d < c.admissao or c.desligamento and d > c.desligamento or d in c.ausencias:
                    continue
                saida.append(AlocacaoSaida(colaboradorId=c.id, data=d, tipo="folga"))
                continue
            tid = sel[(ci, di)]
            if tid:
                t = turno[tid]
                saida.append(AlocacaoSaida(colaboradorId=c.id, data=d, tipo="trabalho", turnoId=tid, inicioMin=t.inicioMin, fimMin=t.fimMin, intervaloMin=t.intervaloMin))
            else:
                saida.append(AlocacaoSaida(colaboradorId=c.id, data=d, tipo="folga"))
    # métricas calculadas direto da atribuição (independentes das variáveis auxiliares)
    especiais = [di for di, d in enumerate(ctx.dias) if dow(d) == 0 or d in set(p.feriados)]
    cont = [sum(1 for di in especiais if sel.get((ci, di))) for ci in range(len(p.colaboradores))]
    pref_nao = 0
    for ci, c in enumerate(p.colaboradores):
        for pref in c.preferencias:
            for di, d in enumerate(ctx.dias):
                if (ci, di) not in sel or (pref.data is not None and pref.data != d) or (pref.diaSemana is not None and pref.diaSemana != dow(d)):
                    continue
                esc = sel[(ci, di)]
                if pref.tipo == "evitar_trabalho" and esc:
                    pref_nao += 1
                elif pref.tipo == "preferir_trabalho" and not esc:
                    pref_nao += 1
                elif pref.tipo == "evitar_turno" and esc == pref.turnoId:
                    pref_nao += 1
                elif pref.tipo == "preferir_turno" and esc != pref.turnoId:
                    pref_nao += 1
    idx_c = {c.id: i for i, c in enumerate(p.colaboradores)}
    idx_d = {d: i for i, d in enumerate(ctx.dias)}
    mud = sum(1 for r in p.referencia if (idx_c.get(r.colaboradorId), idx_d.get(r.data)) in {k for k in sel} and sel[(idx_c[r.colaboradorId], idx_d[r.data])] != r.turnoId)
    custo = 0
    for (ci, di), tid in sel.items():
        if tid:
            c, t, d = p.colaboradores[ci], turno[tid], ctx.dias[di]
            mult = 2.0 if (dow(d) == 0 or d in set(p.feriados)) else 1.0
            custo += int(round((t.liquidoMin * c.custoHoraCentavos * mult + t.noturnoMin * c.custoHoraCentavos * 0.2) / 60 / 100))
    met = Metricas(
        faltaCobertura=sum(solver.Value(f) for f in ctx.faltas),
        faltaIdeal=sum(solver.Value(f) for f in ctx.faltas_ideal),
        deficitHorasMin=sum(solver.Value(f) for f in ctx.deficits),
        domingosMin=min(cont) if cont else 0, domingosMax=max(cont) if cont else 0,
        preferenciasNaoAtendidas=pref_nao, custoReais=custo, mudancasEmRelacaoReferencia=mud,
        objetivo=int(round(solver.ObjectiveValue())),
    )
    return Solucao(status="otima" if status == cp_model.OPTIMAL else "viavel", alocacoes=saida, metricas=met)


def _parametros(solver: cp_model.CpSolver, limite: float, p: Problema) -> None:
    solver.parameters.max_time_in_seconds = max(0.5, limite)
    solver.parameters.num_search_workers = max(1, min(p.workers, os.cpu_count() or 1))
    solver.parameters.random_seed = p.semente
    solver.parameters.log_search_progress = False


def resolver(p: Problema) -> Resposta:
    t0 = time.monotonic()
    if not p.colaboradores:
        return Resposta(status="inviavel", solucoes=[], mensagem="Nenhum colaborador informado.", tempoMs=0)
    ctx = construir(p)
    solucoes: list[Solucao] = []
    pares_livres = sum(1 for ci in range(len(p.colaboradores)) for di in range(len(ctx.dias)) if ctx.x[ci][di])
    melhor_obj: Optional[int] = None
    sels: list[dict] = []
    for k in range(p.numSolucoes):
        restante = p.tempoLimiteS - (time.monotonic() - t0)
        if restante < 0.6 and k > 0:
            break
        # a primeira solução fica com metade do tempo (ou tudo, se for a única); as alternativas dividem o resto
        limite = restante if p.numSolucoes == 1 else (restante * 0.5 if k == 0 else restante / (p.numSolucoes - k))
        solver = cp_model.CpSolver()
        _parametros(solver, limite, p)
        st = solver.Solve(ctx.model)
        if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            if k == 0:
                return Resposta(status="inviavel", solucoes=[], mensagem="Não existe escala que respeite as regras rígidas (folgas, teto semanal, interjornada, rodízio e indisponibilidades). Revise ausências e turnos permitidos.", tempoMs=int((time.monotonic() - t0) * 1000))
            break
        sel = _extrair(ctx, solver)
        solucoes.append(_montar_solucao(ctx, solver, sel, st))
        sels.append(sel)
        if k == 0:
            melhor_obj = int(round(solver.ObjectiveValue()))
        # próximas: parecidas em custo (até 15% pior), mas diferentes em pelo menos 3% das decisões
        if k + 1 < p.numSolucoes:
            ctx.model.Add(ctx.obj <= int((melhor_obj or 0) * 1.15) + 500)
            lits = []
            for (ci, di), tid in sel.items():
                if tid:
                    lits.append(ctx.x[ci][di][tid])
                elif not isinstance(ctx.w[ci][di], int):
                    lits.append(ctx.w[ci][di].Not())
            h = max(3, int(round(0.03 * max(1, pares_livres))))
            if len(lits) > h:
                ctx.model.Add(sum(lits) <= len(lits) - h)
    solucoes.sort(key=lambda s: s.metricas.objetivo)
    status = "otima" if solucoes and solucoes[0].status == "otima" else "viavel"
    return Resposta(status=status, solucoes=solucoes, tempoMs=int((time.monotonic() - t0) * 1000))
