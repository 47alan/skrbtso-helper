FROM ghcr.io/d4vinci/scrapling:latest

WORKDIR /app

COPY tools/skrbtso_scrapling_helper.py /app/skrbtso_scrapling_helper.py

ENV PYTHONUNBUFFERED=1 \
    SKRBTSO_HELPER_HOST=0.0.0.0 \
    SKRBTSO_HELPER_PORT=8787

EXPOSE 8787

CMD ["python", "/app/skrbtso_scrapling_helper.py"]
