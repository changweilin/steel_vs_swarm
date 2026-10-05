"""Review the shipped lane furniture without replacing the user's other Blender scenes."""
import runpy
from pathlib import Path

runpy.run_path(str(Path(__file__).with_name('preview.py')), init_globals={
    'REVIEW_KEYS': {'lane-guidance', 'lane-turn', 'lane-night', 'bridge', 'tunnel'},
    'BLEND_NAME': 'lane-guidance.blend',
}, run_name='__main__')
