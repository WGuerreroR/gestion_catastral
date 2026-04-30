# Sincronización offline manual (paquete QField → PostGIS)

Este documento describe el flujo de **vuelta** del ciclo offline:
toma un ZIP con un `data.gpkg` editado en campo (vía QField mobile o
QGIS Desktop) y aplica los cambios contra la BD PostGIS de producción.

Es **independiente del flujo de QField Cloud** (`/qfield/*`). Da igual
si el paquete vino de nuestra API, de QField Cloud o de un operador
desde QGIS Desktop con QFieldSync — el endpoint solo lee el GPKG y
aplica los upserts. Esto desacopla la operación del estado de QField
Cloud.

---

## Resumen del flujo

```
[QField mobile / QGIS Desktop]
        │
        │  edita data.gpkg + DCIM/IMG_xxx.jpg
        ▼
   ZIP con data.gpkg + DCIM/  ──────► POST /api/v1/proyectos/{id}/offline/aplicar-cambios
                                              │ 202 Accepted (sync_id)
                                              ▼
                                      BackgroundTask:
                                        1. Inspecciona GPKG
                                        2. Diff por PK contra PostGIS
                                        3. UPSERT capa por capa
                                        4. Copia DCIM/ → proyecto_base/DCIM/
                                        5. Transición de estado
                                        6. Persiste sync_history
                                              │
                                              ▼
                                      GET /offline/sync/{sync_id}/detalle
                                      (polling del frontend)
```

---

## Endpoints

Todos bajo el prefijo del router (`/api/v1/proyectos`). Auth con
`require_roles("administrador", "supervisor")` salvo el caso especial
de `forzar_reproceso=true` sobre estado `finalizado` (solo admin).

| Método | Path | Descripción |
|--|--|--|
| `POST` | `/{id}/offline/aplicar-cambios` | Encola un sync. Devuelve `202` con `sync_id`. |
| `POST` | `/{id}/offline/inspeccionar-paquete` | Síncrono. Preview sin tocar PostGIS. |
| `GET`  | `/{id}/offline/historial-sync` | Lista paginada de syncs previos. |
| `GET`  | `/offline/sync/{sync_id}/detalle` | Detalle completo (estado, resumen, fotos, advertencias). |

### `POST /offline/aplicar-cambios`

Body multipart:

| Campo | Tipo | Obligatorio | Descripción |
|--|--|--|--|
| `paquete_zip` | file | ✅ | ZIP con `data.gpkg` y `DCIM/` |
| `forzar_reproceso` | bool | — | Default `false`. Bypassa idempotencia y permite re-aplicar contra estado `finalizado` (admin). |
| `usuario_campo` | str | — | Override del usuario para auditoría. Si no, usa el del JWT. |

**Estados de `admin_asignacion.estado` y permisos**:

| Estado actual | Quién puede sync | Notas |
|--|--|--|
| `campo` | admin / supervisor | Tras un sync `ok`, transiciona a `validacion`. |
| `validacion` | admin / supervisor | No transiciona automáticamente. |
| `finalizado` | solo admin con `forzar_reproceso=true` | Cualquier otro caso → `403`. |
| (otro) | — | `409` |

**Idempotencia**: cada sync se identifica por SHA-256 del ZIP. Si ya
hubo un sync `ok` con el mismo hash y `forzar_reproceso=false`, el
nuevo sync queda en estado `idempotente` con el resumen del previo
copiado, sin tocar PostGIS.

### `POST /offline/inspeccionar-paquete`

Mismo body que `aplicar-cambios`. Síncrono, no escribe nada. Devuelve:

```json
{
  "valido": true,
  "estrategia": "diff_por_pk",
  "fotos_en_paquete": 6,
  "capas": {
    "42": {
      "layer_id": 42,
      "qgis_table": "lc_predio_p_2dc9463c_...",
      "postgis_table": "lc_predio_p",
      "is_editable": true,
      "geom_col": "geom",
      "feature_count": 125,
      "schema_cols": 84
    }
  },
  "preview": {
    "lc_predio_p":                          {"added": 0, "updated_attrs_features": 1, "updated_geom_features": 0, "removed": 0},
    "cr_caracteristicasunidadconstruccion": {"added": 0, "updated_attrs_features": 2, "updated_geom_features": 0, "removed": 0}
  },
  "advertencias": [],
  "errores": []
}
```

El **preview** se calcula contra la BD viva: para cada capa editable,
compara los rows del GPKG contra PostGIS por la PK de negocio.

### `GET /offline/historial-sync?limit=20&offset=0`

Lista paginada de syncs previos de la asignación, ordenada por fecha
descendente.

### `GET /offline/sync/{sync_id}/detalle`

Detalle completo: incluye `resumen` agregado por capa, `fotos_resumen`,
`advertencias`, `error_detalle`, transición de estado.

Estados posibles del campo `estado` en la respuesta:
- `encolado` — recién creado, BackgroundTask aún no arrancó
- `corriendo` — la tarea está procesando
- `ok` — completado sin errores
- `parcial` — completado con errores en alguna capa o foto
- `error` — falló todo
- `idempotente` — copia de un sync `ok` previo (mismo hash)

---

## Estrategia de diff

El plan original contemplaba dos estrategias:

- **A — `log_qgis_offline_editing`**: usar las tablas `log_*` que crea
  el plugin oficial de QGIS Offline Editing
  (`log_added_features`, `log_feature_updates`, `log_geometry_updates`,
  `log_removed_features`).
- **B — `diff_por_pk`**: comparar fila a fila el GPKG contra PostGIS
  por la PK de negocio.

**En la práctica, los paquetes que vienen de QField Cloud / QField mobile
SIEMPRE traen las tablas log_* vacías**. QField no usa el plugin Offline
Editing — sus cambios viajan como delta files entre mobile y Cloud, y
esos deltas se consumen al sincronizar. Cuando descargamos el ZIP, llega
el GPKG con los datos actualizados pero **sin metadata de qué cambió**.

Por eso el endpoint usa la **estrategia B** prácticamente en todos los
casos. Sólo cae a la estrategia A si el GPKG fue producido por QGIS
Desktop con el plugin Offline Editing y todavía tiene los logs intactos.

**Consecuencia importante**: la estrategia B **no detecta deletes**. Si
un row existe en PostGIS y no aparece en el GPKG, asumimos que está
"fuera del scope del paquete" (recortado por bbox al exportar), no
"borrado en campo". Solo la estrategia A puede detectar borrados.

---

## Tablas editables y sus PKs

Definidas en `qfield_upsert_service.CAPAS_EDITABLES`:

| Tabla PostGIS | PK de negocio | Geom | Campos foto |
|--|--|--|--|
| `lc_predio_p` | `id_operacion` | `geometry` (9377) | `foto`, `foto_2` |
| `cr_terreno` | `globalid` | `geometry` (9377) | — |
| `cr_unidadconstruccion` | `id_operacion_uc_geo` | `geometry` (9377) | — |
| `cr_caracteristicasunidadconstruccion` | `id_operacion_unidad_cons` | — | `foto_fachada`, `foto_banio`, `foto_cocina`, `foto_acabados`, `foto_anexo`, `foto_industrial` |
| `cr_interesado` | `globalid` | — | — |

Las **columnas inmutables** (PK estable, FKs) nunca se modifican aunque
vengan distintas en el GPKG — se ignoran y se levanta advertencia.

Las **columnas de auditoría** se excluyen del compare/upsert por completo
porque su tz handling no es uniforme entre PostGIS y GPKG (a veces el
naive está en UTC, a veces en local Bogotá), y no son ediciones del
usuario:

- `created_date`, `last_edited_date`
- `comienzo_vida_util_version`, `fin_vida_util_version`

---

## Manejo de fotos

`qfield_photo_service.procesar_dcim()` corre **después** del upsert de
capas (para que las rutas en BD ya estén actualizadas).

### Destino

Las fotos se copian a `PROYECTO_BASE_PATH/DCIM/` (env var, default
`/app/data/proyecto_base`). **No** se reescriben las rutas en BD: las
rutas relativas (`DCIM/IMG_xxx.jpg`) siguen siendo válidas desde el
proyecto QGIS maestro porque su carpeta de fotos es exactamente esa.

### Casos manejados

| Caso | Acción |
|--|--|
| Foto referenciada en BD y archivo presente en paquete, no en destino | Copia limpia a destino |
| Archivo ya existe en destino con **mismo contenido** (SHA-256 igual) | `skip_idem` — no se duplica |
| Archivo ya existe en destino con **contenido distinto** | Copia con sufijo `_collision_{sync_id}` y reescribe la referencia en BD para apuntar al archivo nuevo. La foto vieja queda intacta. |
| Foto en paquete no referenciada en BD (huérfana) | Copia tal cual al destino. Puede ser una foto tomada y aún no asociada en formularios. |
| Foto referenciada en BD pero no en paquete | Advertencia, NO aborta. Se deja la ruta vieja intacta. |

### Resumen

```json
{
  "encontradas_en_paquete": 6,
  "referenciadas_en_bd": 6,
  "copiadas_nuevas": 6,
  "skip_idem": 0,
  "colisiones_nombre": 0,
  "huerfanas_copiadas": 0,
  "faltantes_referenciadas": 0,
  "fallidas": 0,
  "advertencias": [],
  "errores": []
}
```

---

## Migraciones SQL requeridas

Antes de habilitar los endpoints, aplicar (en orden) las migraciones de
`migrations/`:

```bash
# Opción A — con psql instalado:
psql "$DATABASE_URL" -f migrations/002_add_ultima_sincronizacion_offline.sql
psql "$DATABASE_URL" -f migrations/003_create_sync_history.sql

# Opción B — con el script Python que viene en el repo:
python3 scripts/apply_migrations.py            # aplica todas las pendientes
python3 scripts/apply_migrations.py --dry-run  # solo lista
```

Ambas migraciones son **idempotentes** (`IF NOT EXISTS` / `ADD COLUMN
IF NOT EXISTS`), así que correrlas dos veces no rompe nada.

### Estructuras agregadas

`admin_asignacion.ultima_sincronizacion_offline timestamp` — distinta de
`ultima_sincronizacion_cloud` que la actualiza el flujo `/qfield/*`.

`sync_history` — auditoría de sincronizaciones offline. Una fila por
sync intentado, con resumen agregado en `jsonb`.

---

## Variables de entorno

| Variable | Default | Uso |
|--|--|--|
| `DATABASE_URL` | — | Conexión a PostgreSQL/PostGIS |
| `PROYECTO_BASE_PATH` | `/app/data/proyecto_base` | Carpeta del proyecto QGIS maestro. Tanto el flujo de generación offline como el sync inverso lo usan. |

---

## ⚠️ `SKIP_AUTH=True` y este endpoint

`api/v1/app/core/deps.py` tiene `SKIP_AUTH = True` por default — bypass
total de la verificación de tokens. **Esto es solo para desarrollo
local**. Antes de exponer este endpoint en cualquier ambiente productivo
o staging:

1. Poner `SKIP_AUTH = False` en `core/deps.py`.
2. Asegurar que el frontend manda el token JWT en `Authorization: Bearer`.

Con `SKIP_AUTH=True`, cualquier llamada al endpoint pasa como
administrador. Es importante porque este endpoint **modifica datos
productivos** en PostGIS y mueve archivos al directorio del proyecto
maestro.

---

## Tests

Suite con `pytest`:

```bash
python3 -m pytest tests/ -v
```

Coverage:

- `tests/test_qfield_gpkg_inspector.py` — 14 tests del inspector con
  GPKGs sintéticos creados al vuelo (sin BD real).
- `tests/test_qfield_photo_service.py` — 11 tests del servicio de fotos
  con SQLite in-memory + carpetas temporales.

Los tests **no requieren PostgreSQL ni Docker** — usan SQLite y
`tempfile`. Para validación end-to-end contra BD real, usar el
`scripts/inspect_gpkg.py` como CLI o disparar el endpoint con `curl`.

---

## CLI de inspección standalone

`scripts/inspect_gpkg.py` permite ver qué encontraría el endpoint sin
levantar la API:

```bash
python3 scripts/inspect_gpkg.py /path/a/MZ_19.zip | jq
```

Imprime el JSON con tablas detectadas, mapping `layer_id ↔ postgis_table`,
estrategia de diff y conteos preview. Útil para diagnosticar paquetes
sospechosos antes de subirlos al endpoint.

---

## Lo que NO hace este endpoint

- ❌ NO modifica el flujo existente de QField Cloud (`/qfield/*`).
- ❌ NO toca tablas de dominio (`*_tipo`, `campobooleano`, etc.) ni las
  tablas `admin_*`.
- ❌ NO sincroniza `cr_construccion`.
- ❌ NO ejecuta DELETEs en estrategia B (que es la habitual).
- ❌ NO maneja conflictos multiusuario (modelo: una asignación = un
  reconocedor).
- ❌ NO sube fotos a S3/MinIO ni las guarda fuera de
  `PROYECTO_BASE_PATH/DCIM/`.

---

## Troubleshooting

### El sync queda en `corriendo` indefinidamente

Revisar logs del contenedor:

```bash
docker compose logs --tail=100 api_v1
```

Posibles causas:
- BD remota inalcanzable (timeout TCP).
- GPKG corrupto que sqlite3 no abre.
- Excepción no capturada en una capa específica.

El estado se actualiza al final del `tarea_aplicar_paquete()`. Si la
tarea muere por OOM o el contenedor se reinicia mid-process, el sync
queda atascado en `corriendo`. Idea para v2: timeout watchdog que marque
los syncs > N minutos como `error`.

### Falsos positivos en `preview`

La normalización de timestamps cubre los casos que vimos en producción
(GPKG en UTC con `Z`, PostGIS naive en local Bogotá). Si aparecen otros
falsos positivos:

1. Identificar la columna que difiere con `scripts/inspect_gpkg.py` + el
   helper `_normalizar` de `qfield_upsert_service`.
2. Si es metadata (no edición real), agregarla a `CAMPOS_AUDIT_GLOBAL`.
3. Si es un caso de tz/encoding nuevo, extender `_normalizar`.

### Las fotos no aparecen en QGIS Desktop tras el sync

Verificar:
- `PROYECTO_BASE_PATH` apunta a la carpeta correcta.
- El proyecto maestro de QGIS está apuntando a `proyecto_base/DCIM/`
  como base de fotos (rutas relativas).
- El sync no tuvo errores en `fotos_resumen` (revisar el detalle del sync).
