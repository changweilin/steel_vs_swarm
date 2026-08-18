import sys
import os
import argparse
import subprocess
from pathlib import Path

def to_wsl_path(win_path):
    p = Path(win_path).resolve()
    # If drive letter, e.g. C:\... -> /mnt/c/...
    drive = p.drive.rstrip(':').lower()
    rest = p.as_posix().split(':', 1)[-1]
    return f"/mnt/{drive}{rest}"

def main():
    parser = argparse.ArgumentParser(description="Hunyuan3D-2GP Windows-WSL adapter")
    parser.add_argument("images", nargs="+", help="Input image paths (Windows format)")
    parser.add_argument("--output-dir", "--out", dest="output_dir", required=True, help="Output directory")
    parser.add_argument("--profile", type=int, default=3, help="Offload profile (default 3)")
    args = parser.parse_args()

    out_win = Path(args.output_dir).resolve()
    out_win.mkdir(parents=True, exist_ok=True)
    out_wsl = to_wsl_path(out_win)

    wsl_images = [to_wsl_path(img) for img in args.images]
    img_args = " ".join(f'"{p}"' for p in wsl_images)

    cmd = (
        f"source ~/ai3d/.venv311hy/bin/activate && "
        f"cd ~/ai3d/Hunyuan3D-2GP && "
        f"PYTHONIOENCODING=utf-8 python run_hy.py {img_args} --out \"{out_wsl}\" --profile {args.profile}"
    )

    print(f"[hunyuan_adapter] Executing in WSL2: {len(args.images)} images -> {out_win}", flush=True)
    res = subprocess.run(["wsl", "bash", "-c", cmd])
    if res.returncode != 0:
        print(f"[hunyuan_adapter] WSL command failed with return code {res.returncode}", file=sys.stderr)
        sys.exit(res.returncode)

    # Verify output GLBs
    missing = 0
    for img in args.images:
        stem = Path(img).stem
        glb = out_win / f"{stem}.glb"
        if not glb.exists():
            print(f"[hunyuan_adapter] Error: Expected output {glb} was not created!", file=sys.stderr)
            missing += 1
        else:
            print(f"[hunyuan_adapter] Output verified: {glb} ({glb.stat().st_size} bytes)", flush=True)

    if missing > 0:
        sys.exit(1)
    print(f"[hunyuan_adapter] All {len(args.images)} meshes generated successfully.", flush=True)
    sys.exit(0)

if __name__ == "__main__":
    main()
