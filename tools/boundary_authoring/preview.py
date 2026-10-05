"""Review deployed boundary meshes through the shared Blender studio."""
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
joins = globals().get('REVIEW_JOINS', '--joins' in sys.argv)
runpy.run_path(str(ROOT/'tools/transport_authoring/preview.py'), init_globals={
    'REVIEW_DIRECTORY': str(ROOT/'out/boundary_review'/('joins' if joins else '')),
    'PREVIEW_PREFIX': 'Boundary Joins' if joins else 'Boundary', 'PREVIEW_COLUMNS': 3,
    'PREVIEW_MARGIN': 6, 'PREVIEW_LIGHT_GAIN': 1.5,
    'PREVIEW_SURFACE_ATTRIBUTES': True,
    'WRITE_OUTPUT': globals().get('WRITE_OUTPUT', True),
}, run_name='__main__')
