# Otimizador de escalas (FastAPI + OR-Tools CP-SAT). Contexto de build = apps/optimizer.
# Railway: serviço "optimizer", Root Directory = apps/optimizer (ou RAILWAY_DOCKERFILE_PATH=apps/optimizer/Dockerfile).
# Variáveis: OPTIMIZER_TOKEN (segredo compartilhado com o worker), opcional MAX_CONCURRENT (padrão 2).
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app app
RUN useradd --system --create-home --uid 1001 app && chown -R app /srv
USER app
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
