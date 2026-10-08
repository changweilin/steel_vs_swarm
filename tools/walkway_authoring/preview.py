"""Use the shared destination-mesh review assembler for editable pedestrian scenes."""
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
result = runpy.run_path(str(ROOT / 'tools/road_structure_authoring/preview.py'), init_globals={
    'REVIEW_OUT': ROOT / 'out/walkway_review',
    'REVIEW_LABEL': 'Walkway Review',
    'BLEND_NAME': 'walkways.blend',
    'RENDER_REVIEWS': False,
})
