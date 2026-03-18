from fastapi import FastAPI, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from routers import auth, personas, roles, asignaciones, predios,asignacion_proyecto,spatial

app = FastAPI(title="Gestión Predial Chiquinquirá",
 version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(personas.router, prefix="/api/v1")
app.include_router(roles.router, prefix="/api/v1")
app.include_router(asignaciones.router, prefix="/api/v1")
app.include_router(predios.router, prefix="/api/v1")
app.include_router(asignacion_proyecto.router, prefix="/api/v1")
app.include_router(spatial.router, prefix="/api/v1")
router = APIRouter()
@router.get("/")
def root():
    return {"mensaje": "API Gestión Predial"}
app.include_router(router)