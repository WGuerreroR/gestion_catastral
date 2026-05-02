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

## Visor de predios (parametrizable por JSON)

Componente React reutilizable que renderiza la información completa de
un predio (predio + terreno + N unidades + características + fotos +
interesados) dirigido 100% por un JSON. La página `/predios/visor`
busca por `id_operacion` o `numero_predial` y monta `<PredioVisor>`.

### Backend
- `routers/predios.py` expone:
  - `GET /predios/{busqueda}/completo` — payload jerárquico del predio
  - `GET /dominios/{nombre_tabla}` — catálogos LADM (`*tipo`) con whitelist
    + caché TTL 1h (`routers/dominios.py`)
  - `GET /spatial/manzana/{codigo_manzana}` — geometría de la manzana
  - `GET /predios/{id}/fotos/{ruta}` — sirve fotos del proyecto activo
    del predio (resuelto vía `predio_fotos_service`)
  - `GET /predios/{id}/auditoria/{tabla}/{pk}` — stub `cambios: []`
  - `POST /predios/{id}/guardar` — UPSERT por tabla; valida permisos +
    whitelist + reglas server-side contra el form JSON
  - `GET /predios/{id}/export-pdf` — PDF con `fpdf2` (texto + fotos)
- `services/predio_form_loader.py` carga form JSONs desde
  `api/v1/app/forms/`. Los JSONs **deben mantenerse sincronizados** con
  los del frontend (`webapp/src/config/predio-forms/`) — esto se hace
  manualmente con `cp` o un test que compare ambos archivos.
- `services/predio_validators.py` espejo Python de los validadores del
  frontend (mismas reglas, mismo orden).

### Frontend (`webapp/src/components/predio-visor/`)
- `PredioVisor.jsx` — orquestador. Se invoca como
  `<PredioVisor formConfig={...} busqueda="ch-16318" />`.
- `widgets/` — registry: `text`, `textarea`, `number`, `boolean`,
  `date`, `datetime`, `select`, `photo`, `geometry`. Para agregar un
  widget nuevo, crearlo en `widgets/` y registrarlo en `widgets/index.js`.
- `mapa/SeccionMapa.jsx` — sección tipo `mapa` multi-capa con
  OpenLayers + proj4 (EPSG:9377). Sync bidireccional con secciones
  `lista` vía `useMapaPredioSync`.
- `validators.js` y `visibility.js` — reglas declaradas en JSON.
  `registrarValidador(nombre, fn)` para validators custom.

### Cómo agregar un nuevo form JSON
1. Crear `webapp/src/config/predio-forms/<nombre>.json` (referencia:
   `predio-completo-lectura.json`).
2. Copiar el archivo a `api/v1/app/forms/<nombre>.json` (los dos lados
   deben coincidir bit a bit).
3. Importarlo desde la página y pasarlo como `formConfig` al
   `<PredioVisor>`.
4. Cada `seccion` requiere `tipo` (`registro_unico` | `lista` | `mapa`),
   `tabla_origen`, `id_pk_field` (para auditoría y guardado), y
   opcionalmente `roles_edicion` (sin esto, la sección queda solo en
   view aunque el modo global sea edit).
5. Para cada `campo` declarar `widget`, `field`, `label` y
   opcionalmente `validations`, `visible_if`, `auditoria.habilitada`.

### Tablas LADM editables desde el visor
`predio_guardar_repo.py` define los UPDATERS:
- **registro_unico**: `lc_predio_p`, `cr_terreno`
- **lista**: `cr_unidadconstruccion`, `cr_caracteristicasunidadconstruccion`,
  `cr_interesado`

Los campos editables vienen del whitelist del JSON. PKs (`id_operacion`,
`globalid`, `id_operacion_uc_geo`, etc.) son inmutables y solo
identifican el registro.

## Key Conventions

- **Repository pattern:** All DB queries live in `repositories/`; routers call services or repositories directly, never raw SQL.
- **Schemas:** Every endpoint has a corresponding Pydantic schema in `schemas/`; do not bypass validation.
- **RBAC:** Protected routes use the `require_roles` decorator from `core/security.py`. Check role requirements before adding new endpoints.
- **`SKIP_AUTH`:** The flag in `core/deps.py` bypasses token verification with a mock user — only safe for local development. Do not deploy with this enabled.
- **Docker platform:** `api/v1/Dockerfile` uses `linux/amd64` for Apple Silicon compatibility.
