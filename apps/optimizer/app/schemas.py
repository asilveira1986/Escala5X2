"""Contrato do otimizador. Todas as regras legais já chegam resolvidas (o serviço é só combinatória)."""
from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Base(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Periodo(Base):
    inicio: date
    fim: date

    @model_validator(mode="after")
    def _ordem(self) -> "Periodo":
        if self.fim < self.inicio:
            raise ValueError("fim antes do início")
        if (self.fim - self.inicio).days > 62:
            raise ValueError("período máximo de 63 dias")
        return self


class Turno(Base):
    id: str
    inicioMin: int = Field(ge=0, le=1439)
    fimMin: int = Field(ge=1, le=2879)            # pode passar de 1440 (vira a noite)
    intervaloMin: int = Field(ge=0, default=0)
    liquidoMin: int = Field(ge=1)
    noturnoMin: int = Field(ge=0, default=0)      # minutos de relógio entre 22h e 5h (adicional noturno)

    @model_validator(mode="after")
    def _coerente(self) -> "Turno":
        if self.fimMin <= self.inicioMin or self.fimMin - self.inicioMin > 1440:
            raise ValueError("turno inválido")
        return self


class TurnoAnterior(Base):
    """Turno já existente antes do período (continuidade de interjornada e semanas)."""
    data: date
    inicioMin: int
    fimMin: int
    liquidoMin: int = Field(ge=0)


class Semana(Base):
    inicio: date                                   # início da semana (segunda ou domingo, conforme `inicioSemana`)
    limiteMin: int = Field(ge=0)                   # teto semanal de horas líquidas (já com a regra mais rígida da semana)
    alvoMin: int = Field(ge=0, default=0)          # horas contratadas (meta; desvio é penalizado)
    exigeFolgas: bool = False
    folgasExigidas: int = Field(ge=0, default=0)
    diasElegiveisFora: int = Field(ge=0, default=0)    # dias da semana fora do período que podem contar como folga
    trabalhadosFora: int = Field(ge=0, default=0)      # dias fora do período já trabalhados (escala anterior)
    completaNoPeriodo: bool = True                 # a meta só é cobrada em semanas inteiras dentro do período


class Preferencia(Base):
    tipo: Literal["evitar_trabalho", "preferir_trabalho", "evitar_turno", "preferir_turno"]
    data: Optional[date] = None
    diaSemana: Optional[int] = Field(default=None, ge=0, le=6)
    turnoId: Optional[str] = None
    peso: int = Field(default=50, ge=1, le=10000)


class Colaborador(Base):
    id: str
    nome: str = ""
    permitidos: list[str]                          # ids dos turnos que a pessoa pode fazer (limites diários/intervalo já aplicados)
    admissao: Optional[date] = None
    desligamento: Optional[date] = None
    ausencias: list[date] = []                     # férias/afastamento: sem trabalho e sem lançamento
    indisponiveis: list[date] = []                 # sem trabalho, lançados como folga
    semanas: list[Semana] = []
    interjornadaMin: int = Field(ge=0, default=660)
    rodizioDomingo: Optional[int] = Field(default=None, ge=2)
    custoHoraCentavos: int = Field(ge=0, default=0)
    anteriores: list[TurnoAnterior] = []
    preferencias: list[Preferencia] = []


class Cobertura(Base):
    diaSemana: int = Field(ge=0, le=6)             # 0 = domingo
    faixaInicioMin: int = Field(ge=0, le=1439)
    faixaFimMin: int = Field(ge=1, le=1440)        # <= início: atravessa a meia-noite
    minimo: int = Field(ge=0)
    ideal: Optional[int] = Field(default=None, ge=0)


class Referencia(Base):
    colaboradorId: str
    data: date
    turnoId: Optional[str] = None                  # None = folga


class Pesos(Base):
    faltaCobertura: int = 10_000
    deficitHorasPorMin: int = 5
    faltaIdeal: int = 100
    equidadeDomingos: int = 500
    preferencia: int = 1                           # multiplicador do peso de cada preferência
    estabilidade: int = 20
    custoPorReal: int = 1


class Problema(Base):
    periodo: Periodo
    inicioSemana: Literal[0, 1] = 1
    turnos: list[Turno]
    colaboradores: list[Colaborador]
    cobertura: list[Cobertura] = []
    feriados: list[date] = []
    referencia: list[Referencia] = []
    pesos: Pesos = Pesos()
    tempoLimiteS: float = Field(default=30, gt=0, le=120)
    numSolucoes: int = Field(default=3, ge=1, le=3)
    semente: int = 1
    workers: int = Field(default=4, ge=1, le=16)

    @model_validator(mode="after")
    def _refs(self) -> "Problema":
        ids = {t.id for t in self.turnos}
        if len(ids) != len(self.turnos):
            raise ValueError("ids de turno repetidos")
        cids = {c.id for c in self.colaboradores}
        if len(cids) != len(self.colaboradores):
            raise ValueError("ids de colaborador repetidos")
        for c in self.colaboradores:
            falta = set(c.permitidos) - ids
            if falta:
                raise ValueError(f"turno inexistente em permitidos: {sorted(falta)}")
        return self


class AlocacaoSaida(Base):
    colaboradorId: str
    data: date
    tipo: Literal["trabalho", "folga"]
    turnoId: Optional[str] = None
    inicioMin: Optional[int] = None
    fimMin: Optional[int] = None
    intervaloMin: Optional[int] = None


class Metricas(Base):
    faltaCobertura: int
    faltaIdeal: int
    deficitHorasMin: int
    domingosMin: int
    domingosMax: int
    preferenciasNaoAtendidas: int
    custoReais: int
    mudancasEmRelacaoReferencia: int
    objetivo: int


class Solucao(Base):
    status: Literal["otima", "viavel"]
    alocacoes: list[AlocacaoSaida]
    metricas: Metricas


class Resposta(Base):
    status: Literal["otima", "viavel", "inviavel"]
    solucoes: list[Solucao]
    mensagem: Optional[str] = None
    tempoMs: int
