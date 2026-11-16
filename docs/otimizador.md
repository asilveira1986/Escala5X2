# Otimizador de escalas (Fase 3)

Serviço Python (`apps/optimizer`: FastAPI + Google OR-Tools CP-SAT) que gera até 3 propostas de escala. **Não acessa o banco**: recebe o problema já montado e devolve JSON. Só o servidor (worker) o chama, nunca o navegador.

## Como funciona
1. `montarProblema` (em `@jc/servicos`) resolve **todas** as regras legais com o motor TypeScript: teto semanal por semana (inclusive na virada de fase da lei), folgas, interjornada, turnos que cada pessoa pode fazer (sem hora extra programada, com intervalo mínimo), rodízio de domingo por acordo, ausências e turnos da escala anterior.
2. O serviço resolve o problema (modelo `x[colaborador, dia, turno]`). Regras rígidas nunca são violadas; **cobertura mínima e horas contratadas são metas com folga penalizada**, então sempre há resposta e ela mostra onde falta gente.
3. Objetivo (pesos configuráveis): cobertura › horas contratadas › cobertura ideal › equidade de domingos/feriados › preferências › estabilidade em relação à escala anterior › custo (hora, dobro em domingo/feriado, adicional noturno).
4. Cada proposta é **revalidada pelo motor TypeScript** (`revalidarSolucoes`); proposta com bloqueio é descartada e registrada como divergência. O servidor TypeScript é a fonte da verdade.

## Critério de aceite (verificado em testes)
Setor de 50 pessoas, 4 semanas, 3 propostas: ~3 s (limite de 30 s), cobertura mínima 100%, horas contratadas 100%, todas aprovadas pelo motor TypeScript.
- `apps/optimizer/tests/test_aceite.py` (Python) e `packages/servicos/test/otimizador-integracao.test.ts` (sobe o serviço de verdade e revalida com o TypeScript).

## Rodar os testes
```bash
cd apps/optimizer
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q        # ou, da raiz: pnpm test:otimizador
pnpm --filter @jc/servicos test      # inclui a integração (pula se não houver .venv)
```

## Publicar no Railway (terceiro serviço)
1. Novo serviço a partir do mesmo repositório, nome `optimizer`, **Root Directory = `apps/optimizer`** (usa o `Dockerfile` dessa pasta).
2. Variável `OPTIMIZER_TOKEN` = um segredo longo e aleatório (gere um novo; não reaproveite outros). Opcional: `MAX_CONCURRENT` (padrão 2).
3. Sem domínio público: use a rede privada do Railway. O endereço interno vai em `OPTIMIZER_URL` (ex.: `http://optimizer.railway.internal:8000`) nos serviços que chamam (worker), junto com o mesmo `OPTIMIZER_TOKEN`.
4. Verifique `GET /health` → `{"status":"ok"}`.

Sem `OPTIMIZER_TOKEN` o serviço recusa tudo (503). A documentação interativa do FastAPI fica desligada.
