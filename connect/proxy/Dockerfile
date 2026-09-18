FROM python:3.12-slim
ARG PROXY_REF=6229afd57ef71ce662a90caef25ebccc101f0915
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN git init -q && git remote add origin https://github.com/Kineviz/graphxr-database-proxy.git && git fetch --depth 1 origin "$PROXY_REF" && git checkout --detach FETCH_HEAD && rm -rf .git
COPY connect/proxy/requirements.lock /tmp/age-requirements.lock
RUN pip install --no-cache-dir -r /tmp/age-requirements.lock
COPY connect/proxy/ /opt/age/
RUN python /opt/age/install.py /app && useradd -m ageproxy && mkdir -p /app/config && chown -R ageproxy:ageproxy /app
USER ageproxy
CMD ["python", "-m", "uvicorn", "src.graphxr_database_proxy.main:app", "--host", "0.0.0.0", "--port", "9080"]
