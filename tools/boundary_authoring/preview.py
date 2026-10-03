"""Review deployed boundary meshes through the shared Blender studio."""
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
runpy.run_path(str(ROOT/'tools/transport_authoring/preview.py'), init_globals={
    'REVIEW_DIRECTORY': str(ROOT/'out/boundary_review'),
    'PREVIEW_PREFIX': 'Boundary', 'PREVIEW_COLUMNS': 3,
    'PREVIEW_MARGIN': 6, 'PREVIEW_LIGHT_GAIN': 1.5,
    'WRITE_OUTPUT': globals().get('WRITE_OUTPUT', True),
}, run_name='__main__')
