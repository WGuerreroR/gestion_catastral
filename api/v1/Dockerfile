FROM python:3.14

# ===============================
# Dependencias del sistema (GIS)
# ===============================
RUN apt-get update && apt-get install -y \
    gdal-bin \
    libgdal-dev \
    libproj-dev \
    proj-data \
    proj-bin \
    libgeos-dev \
    build-essential \
    python3-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ===============================
# Variables necesarias
# ===============================
ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal
ENV GDAL_CONFIG=/usr/bin/gdal-config

# ===============================
# App
# ===============================
WORKDIR /app
COPY app/requirements.txt requirements.txt

# Actualizar pip (importante para wheels)
RUN pip install --upgrade pip

# Instalar dependencias Python
RUN pip install --no-cache-dir -r requirements.txt

COPY app .

EXPOSE 8500

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8500"]

