"""Use the shared production-mesh studio for the scenery asset library."""
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
runpy.run_path(str(ROOT/'tools/transport_authoring/preview.py'), init_globals={
    'REVIEW_DIRECTORY': str(ROOT/'out/scenery_review'),
    'PREVIEW_PREFIX': 'Scenery', 'PREVIEW_COLUMNS': 4,
    'PREVIEW_MARGIN': 20, 'PREVIEW_LIGHT_GAIN': 2,
    'PREVIEW_SAVE_MAIN': True,
    'WRITE_OUTPUT': globals().get('WRITE_OUTPUT', True),
}, run_name='__main__')
