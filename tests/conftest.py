"""
tests/conftest.py — fixtures compartidas para los tests.

Agrega `api/v1/app/` al sys.path para que `import services.qfield_gpkg_inspector`
funcione desde la raíz del repo sin instalación.
"""

import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_ROOT = os.path.join(REPO_ROOT, "api", "v1", "app")

if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)
