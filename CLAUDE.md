# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Chiquinquira** is a cadastral property management system (Gestión Catastral) for managing property records, spatial data, and quality assessment workflows. Full-stack: React frontend + FastAPI backend + PostgreSQL/PostGIS database.

## Running Locally

**Backend (API) — via Docker:**
```bash
docker-compose up --build api_v1       # Starts on http://localhost:8400
```

**Backend — direct Python:**
```bash
cd api/v1/app
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8400
```

**Frontend:**
```bash
cd webapp
npm install
npm run dev        # http://localhost:5173
npm run build      # Production build
npm run preview    # Preview production build
npm run lint       # ESLint
```

## Environment Variables

**Frontend** (`webapp/.env`):
```
VITE_API_URL=http://localhost:8400
```

**Backend** (`api/v1/app/.env`):
```
DATABASE_URL=postgresql://admin:chiquinquira@34.200.5.107:5533/CHIQUINQUIRA
SECRET_KEY=...
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480

# QField Cloud (requerido para empaquetado offline y sincronización)
QFIELD_CLOUD_URL=https://app.qfield.cloud
QFIELD_CLOUD_USERNAME=tu_usuario
QFIELD_CLOUD_PASSWORD=tu_password
```

**Migración de BD requerida** (ejecutar una vez antes de desplegar):
```sql
ALTER TABLE admin_asignacion
  ADD COLUMN IF NOT EXISTS qfield_cloud_project_id VARCHAR(255) NULL;
```

## QField Offline & QField Cloud

`generar_paquete_proyecto` (en `qgis_export_service.py`) orquesta el flujo completo:
1. Lee el área del proyecto (WKT EPSG:9377) desde PostGIS
2. Copia el proyecto base QGIS y actualiza `zonas.shp` con el área de interés
3. Actualiza el extent del canvas en el `.qgz`
4. Convierte las capas PostGIS a `data.gpkg` usando `QgsOfflineEditing` (QFieldSync) — resultado: proyecto usable sin red
5. Sube el zip a QField Cloud y persiste el `cloud_project_id` en `admin_asignacion`

`QgsApplication` se inicializa una sola vez en el startup de FastAPI (`main.py` lifespan). Fuera del contenedor Docker la inicialización falla silenciosamente.

`qgis_project_service.py` expone dos métodos de empaquetado offline:
- `empaquetar_offline_qfieldsync(predios_ids)` — usa `QgsOfflineEditing` (principal, requiere Docker)
- `empaquetar_offline_xml(predios_ids, db_url)` — usa GDAL/OGR + parche XML (fallback, sin QgsApplication)

Endpoints QField Cloud (en `routers/asignacion_proyecto.py`):
- `GET /proyectos/{id}/qfield/status` — estado en QField Cloud
- `POST /proyectos/{id}/qfield/sincronizar` — regenera paquete y re-sube (requiere admin/supervisor)
- `GET /proyectos/{id}/qfield/descargar` — descarga zip (Basic Auth o `?token=<jwt>`)

## Architecture

### Stack
- **Frontend:** React 19, Vite, Redux Toolkit, Material-UI v7, OpenLayers 10, Axios
- **Backend:** FastAPI, SQLAlchemy 2, Uvicorn, QGIS 3.44 (Docker), Python-Jose (JWT), Bcrypt
- **Database:** PostgreSQL + PostGIS (remote at `34.200.5.107:5533`)

### Frontend (`webapp/src/`)
- `api/` — Axios instance with auto-injected Bearer token; auto-logout on 401
- `store/` — Redux slices: `authSlice` (user session), `uiSlice`
- `context/AuthContext.jsx` — Auth context wrapping the app
- `pages/` — Full-page route components (Login, Personas, Roles, Proyectos, Calidad, etc.)
- `components/` — Reusable components including the OpenLayers `Map` component

### Backend (`api/v1/app/`)
- `main.py` — FastAPI app, CORS config (all origins allowed), router registration
- `routers/` — Endpoint modules: `auth`, `personas`, `roles`, `asignaciones`, `proyectos`, `spatial`, `calidad`, `predios`
- `repositories/` — Data access layer (SQLAlchemy queries, one file per domain)
- `schemas/` — Pydantic request/response models (one file per domain)
- `services/` — Business logic; notably `qgis_service.py` for GeoJSON/shapefile processing
- `core/deps.py` — JWT dependency injection; contains `SKIP_AUTH = True` flag that bypasses authentication for development

### API Communication
- REST over HTTP; base URL from `VITE_API_URL`
- JWT stored in `localStorage`; injected as `Authorization: Bearer <token>`
- Token expiry: 8 hours

### Spatial / QGIS
- Backend runs inside a QGIS-enabled Docker image (`qgis/qgis:release-3_44`)
- Geospatial exports land in `data/qgis/exports/`
- Frontend uses OpenLayers for map rendering; `shpjs` for client-side shapefile parsing
- Spatial API routes (`/spatial/*`) support polygon and manzana/block code searches

## Key Conventions

- **Repository pattern:** All DB queries live in `repositories/`; routers call services or repositories directly, never raw SQL.
- **Schemas:** Every endpoint has a corresponding Pydantic schema in `schemas/`; do not bypass validation.
- **RBAC:** Protected routes use the `require_roles` decorator from `core/security.py`. Check role requirements before adding new endpoints.
- **`SKIP_AUTH`:** The flag in `core/deps.py` bypasses token verification with a mock user — only safe for local development. Do not deploy with this enabled.
- **Docker platform:** `api/v1/Dockerfile` uses `linux/amd64` for Apple Silicon compatibility.
