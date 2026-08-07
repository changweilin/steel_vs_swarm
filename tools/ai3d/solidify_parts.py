# ============ T2 薄殼 → 實心低模:實體化 + 減面(§5o C 路徑的入庫版;runbook §5t)============
#
# 為什麼有這一支:TRELLIS.2(O-Voxel)的產出是**撕裂遍佈的雙層薄殼**(§5o 實測:50k 面
# 3.3 萬開放邊 / 2.5 千元件;473k 面原生輸出照樣 20 萬開放邊 ⇒ 兇手不是減面是輸出本身),
# 對它硬減面要嘛打不到預算、要嘛塌成三角形湯。唯一兩者成立的路 = **先實體化再減面**
# (§5o 路徑 C):uniform volumetric resample(帶 offset 的等值面重建)把雙層殼併成單層
# 封閉面,之後的 quadric 就與 2GP 實心 mc 網格同一個處境(§5m 敢 213k→560 的理由)。
#
# 管線位置(T2 產物入庫的唯一路徑;§5p 待續③ / §5s ⑥ 的「等首個入庫節點才搬」= 本輪):
#   T2 raw GLB → **本支**(實體化 + quadric 到工作面數)→ normalize_parts.py(Blender:
#   置中/縮進包絡/末段溫和減面/剝材質)→ {family}.glb → intake_parts.mjs 閘門
# study clone 的 decim_gate.py / symfill_wedge.py 是量測史料;出貨縫只有這一份(原則 2)。
#
# 參數(--sweep 的量測基礎,2026-08-07 魔鬼塔 seed 42 閉合注 + seed 1234 浮雕注 V5a 楔形):
#   cells  = 對角線 ÷ cellsize(解析度)。太低 = 識別特徵被重採樣抹掉;太高 = quadric
#            從超高面數一路塌、回到「大比例減面」的險路。
#   offset = 等值面外推(比例 × 對角線)。太低 = 薄壁處斷開;太高 = 圓潤化吃掉稜線。
#   兩者都是**比例**(絕對值隨網格對角線走)—— §5r ⑥ 同一條:MUST NOT 把絕對值當可移植常數。
#
# 判準(§5o 方法論:表面偏差量不出撕裂):watertight / open_edges / components / v:f
# 先行,kf_p95(來源取樣→到結果)與 dev_p95(結果取樣→到來源)殿後,黏土人眼收尾。
#
# 環境:pymeshlab + trimesh + numpy 的 venv(MUST NOT 進 package.json,A2;3060 機上
# 現成的家 = Documents\study\TRELLIS.2-stableprojectorz\.venv)。
#
# 用法:
#   python tools/ai3d/solidify_parts.py <t2_raw.glb> --out <solid.glb> --target 500
#   python tools/ai3d/solidify_parts.py <t2_raw.glb> --sweep          # 3×3 參數掃描,只印表
import argparse
import os
import sys
import tempfile

import numpy as np
import trimesh

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')


def load_concat(path):
    m = trimesh.load(path, force='mesh', process=False)
    if isinstance(m, trimesh.Scene):
        m = trimesh.util.concatenate([g for g in m.geometry.values()])
    return m


def solidify(src_path, target, out_path, cells=256, offset_frac=0.006):
    import pymeshlab
    ms = pymeshlab.MeshSet()
    ms.load_new_mesh(src_path)
    ms.meshing_merge_close_vertices()
    ms.meshing_remove_duplicate_faces()
    ms.meshing_remove_unreferenced_vertices()
    diag = ms.current_mesh().bounding_box().diagonal()
    ms.generate_resampled_uniform_mesh(
        cellsize=pymeshlab.PureValue(diag / cells),
        offset=pymeshlab.PureValue(diag * offset_frac),
        mergeclosevert=True, discretize=False, multisample=True, absdist=False)
    ms.meshing_decimation_quadric_edge_collapse(
        targetfacenum=int(target), preserveboundary=True, preservenormal=True,
        preservetopology=False, planarquadric=True, qualitythr=0.3, autoclean=True)
    # pymeshlab 只出 ply/obj 系;下游 normalize_parts.py(Blender gltf importer)要 GLB
    # ⇒ 經 trimesh 轉檔(純幾何,無材質可失真)
    if out_path.lower().endswith(('.glb', '.gltf')):
        with tempfile.TemporaryDirectory() as td:
            p = os.path.join(td, 's.ply')
            ms.save_current_mesh(p, save_textures=False)
            trimesh.load(p, force='mesh', process=False).export(out_path)
    else:
        ms.save_current_mesh(out_path, save_textures=False)
    return out_path


def stats(m, ref=None):
    w = m.copy()
    w.merge_vertices()
    e = w.edges_sorted
    uniq, cnt = np.unique(e, axis=0, return_counts=True)
    out = {
        'faces': len(w.faces), 'verts': len(w.vertices),
        'open_edges': int((cnt == 1).sum()),
        'components': len(w.split(only_watertight=False)),
        'watertight': bool(w.is_watertight),
        'vf': round(len(w.vertices) / max(1, len(w.faces)), 2),
    }
    if ref is not None:
        rd = float(np.linalg.norm(ref.bounds[1] - ref.bounds[0]))
        p, _ = trimesh.sample.sample_surface(ref, 20000)
        _, d, _ = trimesh.proximity.ProximityQuery(w).on_surface(p)
        out['kf_p95'] = round(float(np.percentile(d, 95)) / rd, 4)
        p2, _ = trimesh.sample.sample_surface(w, 20000)
        _, d2, _ = trimesh.proximity.ProximityQuery(ref).on_surface(p2)
        out['dev_p95'] = round(float(np.percentile(d2, 95)) / rd, 4)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--out', default=None)
    ap.add_argument('--target', type=int, default=500)
    ap.add_argument('--cells', type=float, default=256)
    ap.add_argument('--offset', type=float, default=0.006)
    ap.add_argument('--sweep', action='store_true')
    a = ap.parse_args()

    ref = load_concat(a.src)
    ref.merge_vertices()
    print(f'src: {len(ref.faces)} faces  {stats(ref)}', flush=True)

    if a.sweep:
        print(f'{"cells":>6} {"offset":>7} | faces open comp wt   v:f  kf_p95 dev_p95')
        for cells in (192, 256, 320):
            for off in (0.004, 0.006, 0.008):
                with tempfile.TemporaryDirectory() as td:
                    p = os.path.join(td, 's.ply')
                    try:
                        solidify(a.src, a.target, p, cells, off)
                        s = stats(load_concat(p), ref)
                        print(f'{cells:>6.0f} {off:>7.3f} | {s["faces"]:>5} {s["open_edges"]:>4} '
                              f'{s["components"]:>4} {str(s["watertight"])[0]:>2} {s["vf"]:>5} '
                              f'{s["kf_p95"]:>7} {s["dev_p95"]:>7}', flush=True)
                    except Exception as ex:
                        print(f'{cells:>6.0f} {off:>7.3f} | 失敗:{ex!r}', flush=True)
        return

    out = a.out or os.path.splitext(a.src)[0] + f'_solid{a.target}.glb'
    solidify(a.src, a.target, out, a.cells, a.offset)
    s = stats(load_concat(out), ref)
    print(f'out: {out}\n     {s}', flush=True)
    if not s['watertight'] or s['components'] != 1:
        print('⚠ 未收斂成水密單元件 —— 調 --cells/--offset 或回黏土人眼', flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
