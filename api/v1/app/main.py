from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from routers import auth, personas, roles, asignaciones, predios, asignacion_proyecto, spatial, calidad, calidad_externa, calidad_muestreo, dominios, tipos_marca, marcas_predio, validacion_calidad, migracion_ladm, revision_masiva


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Inicializar QGIS una sola vez para que QgsOfflineEditing esté disponible
    try:
        from qgis.core import QgsApplication
        qgs = QgsApplication([], False)
        qgs.initQgis()
        app.state.qgs = qgs
    except ImportError:
        # Fuera del contenedor Docker (desarrollo local sin QGIS)
        app.state.qgs = None

    # Marcar como error los jobs LADM huérfanos (interrumpidos por un reinicio
    # previo). Background tasks NO sobreviven a un restart del proceso.
    try:
        from db.database import SessionLocal
        from sqlalchemy import text
        with SessionLocal() as _db:
            _db.execute(text("""
                UPDATE migracion_ladm_job
                SET estado = 'error',
                    error_message = COALESCE(error_message,
                        'Interrumpido por reinicio del servidor'),
                    finalizado_en = NOW()
                WHERE estado IN ('pending', 'running')
            """))
            _db.commit()
    except Exception:
        # Si la tabla no existe (migración 019 no aplicada) o la BD está caída,
        # no rompemos el arranque del servidor.
        pass

    yield

    if getattr(app.state, "qgs", None):
        app.state.qgs.exitQgis()


app = FastAPI(
    title="Gestión Catastral",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allow_headers=["*"],
)

app.include_router(auth.router,                prefix="/api/v1")
app.include_router(personas.router,            prefix="/api/v1")
app.include_router(roles.router,               prefix="/api/v1")
app.include_router(asignaciones.router,        prefix="/api/v1")
app.include_router(predios.router,             prefix="/api/v1")
app.include_router(asignacion_proyecto.router, prefix="/api/v1")
app.include_router(spatial.router,             prefix="/api/v1")
app.include_router(calidad.router,             prefix="/api/v1")
app.include_router(calidad_externa.router,     prefix="/api/v1")
app.include_router(calidad_muestreo.router,    prefix="/api/v1")
app.include_router(dominios.router,            prefix="/api/v1")
app.include_router(tipos_marca.router,         prefix="/api/v1")
app.include_router(marcas_predio.router,        prefix="/api/v1")
app.include_router(marcas_predio.router_global, prefix="/api/v1")
app.include_router(validacion_calidad.router,   prefix="/api/v1")
app.include_router(migracion_ladm.router,       prefix="/api/v1")
app.include_router(revision_masiva.router,      prefix="/api/v1")

router = APIRouter()

@router.get("/")
def root():
    return {"mensaje": "API Gestión Catastral"}

app.include_router(router)
