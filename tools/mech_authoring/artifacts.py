"""Windows readers can briefly deny replacement; retain the complete candidate instead of truncating a live asset."""
import time


def replace_artifact(source, target):
    """Pre: source is complete and owns target. Post: replace atomically, retaining both paths on failure."""
    for attempt in range(8):
        try:
            source.replace(target)
            return
        except PermissionError as error:
            if getattr(error, 'winerror', None) not in {5, 32, 33} or attempt == 7:
                raise
            time.sleep(.1 * (attempt + 1))
