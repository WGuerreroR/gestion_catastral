FROM --platform=linux/amd64 qgis/qgis:3.44.8-noble

ENV DEBIAN_FRONTEND=noninteractive
ENV QT_QPA_PLATFORM=offscreen
ENV PYTHONPATH=/usr/share/qgis/python:/usr/share/qgis/python/plugins:$PYTHONPATH
ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal
ENV QGIS_PLUGINPATH=/root/.local/share/QGIS/QGIS3/profiles/default/python/plugins

RUN apt-get update && apt-get install -y \
    python3-pip \
    python3-dev \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# GitHub descomprime el tag v4.18.3 como "qfieldsync-4.18.3/" (sin la v)
RUN mkdir -p $QGIS_PLUGINPATH && \
    curl -L "https://github.com/opengisch/qfieldsync/archive/refs/tags/v4.18.3.zip" \
         -o /tmp/qfieldsync.zip && \
    unzip /tmp/qfieldsync.zip -d /tmp/qfieldsync_src && \
    mv /tmp/qfieldsync_src/qfieldsync-4.18.3/qfieldsync $QGIS_PLUGINPATH/qfieldsync && \
    rm -rf /tmp/qfieldsync.zip /tmp/qfieldsync_src

WORKDIR /app
COPY app/requirements.txt requirements.txt

RUN pip3 install --break-system-packages --no-cache-dir -r requirements.txt

COPY app .

EXPOSE 8400

#CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8400", "--no-access-log"]
CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8400"]