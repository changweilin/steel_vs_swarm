"""photo_manifest.json 的跨分類安全合併寫入。"""
from __future__ import annotations

import json
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def _locked(path: Path):
    lock_path = path.with_suffix(path.suffix + '.lock')
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, 'a+b') as lock:
        lock.seek(0)
        if os.path.getsize(lock_path) == 0:
            lock.write(b'0')
            lock.flush()
        lock.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            lock.seek(0)
            if os.name == 'nt':
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def merge_manifest(path, edited, families=None):
    """合回磁碟最新版本；families 之外的列逐位元採用最新版。"""
    path = Path(path)
    fams = set(families or [])
    with _locked(path):
        if fams and path.exists():
            latest = json.loads(path.read_text(encoding='utf-8'))
            merged = [row for row in latest if row.get('family') not in fams]
            merged.extend(row for row in edited if row.get('family') in fams)
        else:
            merged = edited
        fd, tmp = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=path.parent)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8', newline='') as out:
                out.write(json.dumps(merged, ensure_ascii=False, indent=2) + '\n')
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
