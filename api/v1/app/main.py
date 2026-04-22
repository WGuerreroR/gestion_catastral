from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from routers import auth, personas, roles, asignaciones, predios, asignacion_proyecto, spatial, calidad, calidad_externa


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
    allow_credentials=True,
    allow_methods=["*"],
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

router = APIRouter()

@router.get("/")
def root():
    return {"mensaje": "API Gestión Catastral"}

app.include_router(router)
