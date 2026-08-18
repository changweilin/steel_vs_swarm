# 圈選 + 分離 + 三道篩選的稽核(2026-08-10 §5au)。不需 GPU、不需網路、不需語料。
#
# 為什麼是合成 matte 而不是拿語料跑:使用者在 §5aq-h 把語料手動清倉過一輪(300 → 163 張,
# 刪掉的正是「無法乾淨分離主目標」那一類)⇒ **現存語料裡幾乎沒有多目標的照片**(181 張裡
# 只有 5 張切得開)。拿它當唯一的證據面,等於用「今天剛好沒事發生」證明規則是對的;而這一批
# 改動的用途本來就是**下一輪自動採集**(沒有人會在迴圈裡手動清倉)。故行為直測一律餵合成
# matte —— 並排兩顆、桁架碎片、碎屑、失焦、被邊框切掉,每一種各造一張。
# Ⅴ 段另外對**真語料**跑零誤殺硬約束(語料不在就跳過並說出來,MUST NOT 洗成通過)。
#
# 用法:
#   .venv/Scripts/python audit_split_targets.py
#   .venv/Scripts/python audit_split_targets.py --home <資料家>     # 連 Ⅴ 段一起跑
#   .venv/Scripts/python audit_split_targets.py --break-contain     # 反向驗證:碎片變成獨立目標
#   .venv/Scripts/python audit_split_targets.py --break-erode       # 反向驗證:模糊尺量到輪廓硬邊
#   .venv/Scripts/python audit_split_targets.py --break-touch       # 反向驗證:截斷不看邊框接觸
import argparse
import json
import os
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import matte_frame                                        # noqa: E402
import screen_mattes as SC                                # noqa: E402
import split_targets as ST                                # noqa: E402

OK, BAD = [], []


def ck(cond, msg):
    (OK if cond else BAD).append(msg)
    print(('  ✓ ' if cond else '  ✗ ') + msg)


def rgba(w, h):
    return np.zeros((h, w, 4), np.uint8)


def blob(a, x0, y0, x1, y1, tone=170, tex=0.0):
    """畫一塊不透明矩形;tex > 0 加細正弦紋理(決定性,零亂數)。

    紋理的**空間頻率要夠高**才讀得出「銳利」:離散 Laplacian 對波數 k 的響應是
    `4(cos k − 1)`,k = 1/3(週期 19px)只有 0.22 —— 比門檻還低,那是「這張圖本來就很平滑」
    不是失焦(實測第一版 fixture 就踩到,量出 0.224)。k = 2/3 ⇒ 響應 0.86,穩穩在門檻之上。
    """
    ys, xs = np.mgrid[y0:y1, x0:x1]
    v = np.full(ys.shape, float(tone))
    if tex:
        v = v + tex * (np.sin(xs / 1.5) * np.cos(ys / 1.5))
    a[y0:y1, x0:x1, :3] = np.clip(v, 0, 255)[:, :, None].astype(np.uint8)
    a[y0:y1, x0:x1, 3] = 255
    return a


def hole(a, x0, y0, x1, y1):
    """挖掉一塊(讓 bbox 填滿率低於 ②「主體是一張紙」的門檻)。"""
    a[y0:y1, x0:x1, 3] = 0
    return a


def disc(a, cx, cy, r, tone=170, tex=0.0):
    """圓形主體:bbox 填滿率 ≈ 0.785,不會先被 ② 判成印刷品。"""
    ys, xs = np.mgrid[0:a.shape[0], 0:a.shape[1]]
    m = (xs - cx) ** 2 + (ys - cy) ** 2 <= r * r
    v = np.full(a.shape[:2], float(tone))
    if tex:
        v = v + tex * (np.sin(xs / 1.5) * np.cos(ys / 1.5))
    a[:, :, :3] = np.where(m[:, :, None], np.clip(v, 0, 255)[:, :, None], a[:, :, :3]).astype(np.uint8)
    a[:, :, 3] = np.where(m, 255, a[:, :, 3])
    return a


def im_of(a):
    return Image.fromarray(a, 'RGBA')


def plan_of(a):
    return ST.plan(a[:, :, 3] > matte_frame.ALPHA_SOLID)


def stats_of(a, tmp):
    im_of(a).save(tmp)
    return SC.matte_stats(tmp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--home', default=None)
    ap.add_argument('--break-contain', action='store_true')
    ap.add_argument('--break-erode', action='store_true')
    ap.add_argument('--break-touch', action='store_true')
    args = ap.parse_args()

    if args.break_contain:
        ST.CONTAIN_F = 1.01         # 沒有任何碎片併得回主體 ⇒ 桁架的腿會變成獨立目標
        # (**不是**設成 0:那讓「有一點重疊就併」恆成立 = 併得更兇,反向驗證會驗不到東西)
    if args.break_erode:
        SC.SHARP_ER = 0             # 不侵蝕 ⇒ 量到的是 matte 的輪廓硬邊
    if args.break_touch:
        SC.CUT_TOL = 10 ** 9        # 「有沒有碰到照片邊框」恆成立

    tmp = os.path.join(HERE, '.audit_split_tmp.png')

    # ── Ⅰ 畫布框取:抽出來的那一支 MUST 逐位元同 2026-08-10 之前的內嵌算式 ──
    print('\nⅠ 畫布框取單一縫')
    def old_frame(im):                     # 舊 matte_photos.py 的原樣算式
        bbox = im.getbbox()
        if bbox:
            im = im.crop(bbox)
        side = int(max(im.size) * 1.18)
        c = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        c.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
        return c
    same = True
    for (w, h, x0, y0, x1, y1) in ((200, 140, 10, 20, 150, 90), (99, 99, 0, 0, 99, 99),
                                   (301, 77, 40, 3, 41, 70), (64, 640, 1, 100, 63, 601)):
        a = blob(rgba(w, h), x0, y0, x1, y1)
        new, org = matte_frame.frame(im_of(a))
        old = old_frame(im_of(a))
        same &= new.size == old.size and np.array_equal(np.asarray(new), np.asarray(old))
        # origin 契約:畫布座標 + origin = 原座標 ⇒ 主體在畫布上的位置回推得到原本的 bbox
        bb = matte_frame.subject_bbox(new)
        same &= (bb[0] + org[0], bb[1] + org[1]) == (x0, y0)
    ck(same, '4 組尺寸的畫布與舊算式逐位元相同,且 origin 換算得回原座標')
    ck(matte_frame.frame(im_of(rgba(50, 50)))[0].size == old_frame(im_of(rgba(50, 50))).size,
       '全透明輸入的行為也與舊算式相同(不裁切但照樣補邊)')
    src = open(os.path.join(HERE, 'matte_photos.py'), encoding='utf-8').read()
    ck('* 1.18' not in src and 'PAD_F' not in src.split('# ')[0],
       'matte_photos.py 不再自己寫一份 1.18 / crop+paste(算式只有 matte_frame 一份)')
    ck('from matte_frame import' in src and 'from matte_frame import' in
       open(os.path.join(HERE, 'split_targets.py'), encoding='utf-8').read(),
       '兩個產出 matte 的地方都 import 同一支框取')

    # ── Ⅱ 分離:面積佔比 + bbox 包含,不是數塊數 ──
    print('\nⅡ 分離規則(合成 matte 行為直測)')
    a = blob(blob(rgba(400, 200), 20, 40, 170, 170), 230, 40, 380, 170)      # 並排兩顆
    seeds, deb, n, _ = plan_of(a)
    ck(len(seeds) == 2 and n == 2, '並排的兩個物件 → 2 個目標')
    ck(seeds[0]['bbox'][0] < seeds[1]['bbox'][0] or seeds[0]['area'] >= seeds[1]['area'],
       '目標依面積排序(~1 恆是主目標),同面積比座標 ⇒ 決定性')

    # 桁架水塔(已出貨的 `landmark/tank` 就是這個形狀):水塔 + 一根連著的腿 = 主體,
    # 另一根腿被 alpha 切斷成獨立元件,而它的 bbox **整個落在主體框裡面** ⇒ MUST 併回去。
    # 碎片面積 MUST ≥ SEED_F,否則它會被「碎屑」那條路吃掉 ⇒ 這一項就驗不到 bbox 包含
    # (第一版 fixture 正是如此,反向驗證才把它抓出來)。
    a = blob(rgba(300, 400), 60, 20, 240, 120)     # 水塔本體
    a = blob(a, 90, 120, 120, 380)                 # 腿 A:與本體相連 ⇒ 主體的 bbox 涵蓋整個高度
    a = blob(a, 180, 200, 215, 380)                # 腿 B:斷開的碎片,bbox 完全在主體框內
    seeds, deb, n, _ = plan_of(a)
    ck(n == 2, '(前提)這張確實是 2 個連通元件')
    frag = 35 * 180 / (180 * 100 + 30 * 260 + 35 * 180)
    ck(frag >= ST.SEED_F, f'(前提)碎片佔 {frag:.1%} ≥ SEED_F ⇒ 併不回去的話它一定會變成獨立目標')
    # 斷言 MUST NOT 隨 --break-* 改變期望值 —— 那樣反向驗證永遠是綠的(原則 9 的整個重點)
    ck(len(seeds) == 1, '被主體框罩住的碎片併回主體,不算新目標(--break-contain ⇒ 這條 MUST 紅)')

    a = blob(rgba(300, 300), 40, 40, 260, 260)
    a = blob(a, 5, 285, 12, 292)              # 遠處的一小點 = 碎屑
    seeds, deb, n, _ = plan_of(a)
    ck(len(seeds) == 1 and n == 2 and deb > 0, '遠處的小碎屑不是目標(進碎屑帳)')
    ck(deb < ST.DEBRIS_MIN, '碎屑小於門檻 ⇒ 這張不會被重出(單一主體逐位元不變)')

    a = blob(rgba(300, 400), 40, 40, 260, 260)
    a = blob(a, 4, 300, 60, 390)              # 大一點的干擾物(> DEBRIS_MIN、< SEED_F、與主體不相接)
    seeds, deb, n, _ = plan_of(a)
    ck(len(seeds) == 1 and n == 2 and ST.DEBRIS_MIN <= deb < ST.SEED_F,
       f'夠大的干擾物({deb:.1%})會讓這張重出一份乾淨的主體')

    a = blob(rgba(300, 300), 40, 40, 260, 260)
    ck(plan_of(a)[0].__len__() == 1 and plan_of(a)[1] == 0.0, '單一主體:1 個目標、零碎屑')
    ck(plan_of(a)[0][0]['share'] == 1.0, '單一主體的面積佔比 = 1')
    r1, r2 = plan_of(a), plan_of(a)
    ck([s['bbox'] for s in r1[0]] == [s['bbox'] for s in r2[0]], '同一張跑兩次結果逐位元相同')

    # 切出來的目標:只留自己那一塊,而且畫布框取與母 matte 同一支
    a = blob(blob(rgba(400, 200), 20, 40, 170, 170), 230, 40, 380, 170)
    seeds, _, _, lab = plan_of(a)
    cuts = [ST.cut(im_of(a), lab, s)[0] for s in seeds]
    ck(all(matte_frame.subject_bbox(c) is not None for c in cuts), '每個目標都切得出非空畫布')
    ck(all(ndimage.label(np.asarray(c)[:, :, 3] > 128)[1] == 1 for c in cuts),
       '切出來的每一張只剩一個連通元件(另一個目標沒有被帶進來)')
    ck(all(abs(c.size[0] - c.size[1]) == 0 for c in cuts), '目標畫布是方形(與母 matte 同一條規則)')

    # ── Ⅲ 三道篩選 ──
    print('\nⅢ 篩選:太模糊 / 太小 / 完整度太低')
    # 圓形主體:bbox 填滿率 0.785 ⇒ 不會先被 ②(主體是一張紙,門檻 0.93)攔下來,
    # 這樣量到的才是 ⑥ 本身(第一版 fixture 用實心矩形,判決理由一路是 print)。
    sharp_a = disc(rgba(700, 700), 350, 350, 250, tex=60)
    st_sharp = stats_of(sharp_a, tmp)
    soft = np.asarray(im_of(sharp_a)).astype(np.float32).copy()
    soft[:, :, :3] = ndimage.gaussian_filter(soft[:, :, :3], (6, 6, 0))
    st_soft = stats_of(soft.astype(np.uint8), tmp)
    ck(st_sharp['sharp'] is not None and st_sharp['sharp'] >= SC.SHARP_MIN,
       f'有紋理的主體判銳利({st_sharp["sharp"]:.3f} ≥ {SC.SHARP_MIN})')
    ck(st_soft['sharp'] < st_sharp['sharp'], '同一張模糊化之後銳利度下降')
    ck(st_soft['sharp'] < SC.SHARP_MIN,
       f'模糊的那張被 ⑥ 擋下({st_soft["sharp"]:.3f} < {SC.SHARP_MIN};--break-erode ⇒ 這條 MUST 紅)')
    ck(SC.verdict_of(st_soft, None, 'rock')[1] == 'blur', '判決理由是 blur')

    # 「太小」= 既有的 ①,切開之後自動變成逐目標的量 —— MUST NOT 另寫第二把尺
    small = blob(rgba(120, 120), 10, 10, 110, 110, tex=60)
    st_small = stats_of(small, tmp)
    ck(SC.verdict_of(st_small, None, 'rock')[1] == 'blank',
       f'畫布 {st_small["canvas"]}px < {SC.MIN_CANVAS} ⇒ 判太小(理由是 blank 不是 blur)')
    ck(sum(1 for ln in open(os.path.join(HERE, 'screen_mattes.py'), encoding='utf-8')
           if 'MIN_CANVAS' in ln and 'st[' in ln) == 1, 'MIN_CANVAS 只有一個判定點')

    # 截斷:碰到照片邊框 ∧ 那一條邊被主體蓋住 ≥ CUT_RUN
    # 平頂 + 底部挖兩個角 ⇒ 頂邊 run = 1.0 而填滿率 0.68(同樣為了不被 ② 先攔下)
    cutshape = hole(hole(blob(rgba(400, 400), 50, 0, 350, 300, tex=60), 50, 180, 140, 300),
                    260, 180, 350, 300)
    st = stats_of(cutshape, tmp)
    wh = [400, 400]
    pbb_touch = list(st['bbox'])
    pbb_free = [st['bbox'][0], 40, st['bbox'][2], st['bbox'][3] + 40]   # 同一個形狀但沒碰到頂
    ck(st['run']['top'] > SC.CUT_RUN, f'(前提)這張的頂邊 run = {st["run"]["top"]:.2f}')
    ck('top' in (SC.cut_sides(st, pbb_touch, wh) or {}), '碰到照片頂邊 + 平頂 ⇒ 判截斷')
    ck(not SC.cut_sides(st, pbb_free, wh),
       '同樣平頂但沒碰到邊框 ⇒ **不**判截斷(平頂的箱子不是被切掉;--break-touch ⇒ 這條 MUST 紅)')
    ck(SC.verdict_of(st, None, 'building', SC.cut_sides(st, pbb_touch, wh))[1] == 'cut', '判決理由是 cut')
    ck(SC.cut_sides(st, pbb_touch, None) is None and SC.cut_sides(st, None, wh) is None,
       '缺邊框帳 ⇒ 不評判(寧缺勿錯)')
    # 底 / 左 / 右三邊只觀察不淘汰,各有一個已出貨來源當反證(檔頭)
    for side, pbb in (('bot', [st['bbox'][0], 40, st['bbox'][2], 400]),
                      ('lf', [0, 40, st['bbox'][2], st['bbox'][3] + 40]),
                      ('rt', [st['bbox'][0], 40, 400, st['bbox'][3] + 40])):
        s2 = dict(st, run=dict(st['run'], **{side: 0.9}))
        c = SC.cut_sides(s2, pbb, wh) or {}
        ck(side in c and SC.verdict_of(s2, None, 'building', c)[1] != 'cut',
           f'{side} 邊碰到邊框 ⇒ 只進觀察名單,不淘汰'
           + ('(--break-touch:平頂被當成碰到頂邊 ⇒ 這條會翻掉)' if args.break_touch else ''))
        ck(SC.watched(s2, 'building', c), f'{side} 邊那一張真的進得了觀察名單')
    ck(SC.CUT_SIDES == ('top',), '淘汰線只有頂邊一條')

    # ── Ⅳ 單一縫 / 接線 ──
    print('\nⅣ 單一縫與接線')
    st_src = open(os.path.join(HERE, 'split_targets.py'), encoding='utf-8').read()
    hv = open(os.path.join(HERE, 'harvest_loop.mjs'), encoding='utf-8').read()
    body = '\n'.join(ln for ln in st_src.split('\n') if not ln.strip().startswith('#'))
    ck(body.count("TARGET_SEP = ") == 1 and body.count('f\'{photo_id}{TARGET_SEP}{n}\'') == 1,
       '目標 id 的格式只定義一次')
    ck("split('~')" not in hv and '"~"' not in hv and "'~'" not in hv,
       'harvest_loop 不拆檔名(母照片一律由帳本 targets[].id 推導)')
    ck('e.targets' in hv and 'shipped.has(id)' in hv,
       'harvest_loop 讀帳本的 targets,而「已出貨」比對的是母照片 id')
    ck(hv.index('split_targets.py') < hv.index('screen_mattes.py'),
       '②b 分離排在 ③ 選片閘之前(反過來的話多目標照片會先被 ④ 整張淘汰)')
    ck(tuple(SC.CAL_METHODS) == ('sf3d', 'trellis2_spz', 'hunyuan_2gp', 'simple_geom_tree')
       and 'CAL_METHODS' in open(os.path.join(HERE, 'screen_mattes.py'), encoding='utf-8').read(),
       '校準名單的 method 名冊在選片閘裡定義')
    ck('rnd' not in body and 'random' not in body,
       '分離這一站零亂數(§2.3:多抽一枚就把整張圖的佈局推移)')
    mp = open(os.path.join(HERE, 'matte_photos.py'), encoding='utf-8').read()
    ck('src.parent.parent.parent == PHOTOS' in mp,
       'matte_photos 只收 photos/<族>/<零件>/*(散在外面的檔案會被記成族名 `photos`)')

    # ── Ⅴ 真語料的零誤殺硬約束(語料不在就跳過,MUST NOT 洗成通過)──
    print('\nⅤ 零誤殺(真語料)')
    home = args.home
    man_p = os.path.join(home, 'photo_manifest.json') if home else None
    if not man_p or not os.path.exists(man_p):
        print('  ⏭ 沒給 --home 或找不到 photo_manifest.json ⇒ 這一段**未驗**')
    else:
        man = json.load(open(man_p, encoding='utf-8'))
        pm = json.load(open(os.path.join(HERE, 'parts_manifest.json'), encoding='utf-8'))
        cal = {i['id'] for r in pm['parts'] if r['method'] in SC.CAL_METHODS
               for i in r.get('imgs', []) if i.get('id')}
        seen = [e for e in man if e.get('id') in cal]
        killed = [e for e in seen if (e.get('screen') or {}).get('v') == 'reject']
        ck(len(seen) > 0, f'語料裡找得到 {len(seen)}/{len(cal)} 個吃 matte 的已出貨來源')
        ck(not killed, '這些來源一個都沒有被淘汰(零誤殺)'
           + ('' if not killed else ':' + ', '.join(f'{e["part"]}/{e["id"][:10]}={e["screen"]["why"]}' for e in killed)))
        tg = [e for e in man if e.get('targets')]
        ck(all(len(t.get('id', '')) > len(e['id']) for e in tg for t in e['targets']),
           f'{len(tg)} 張被切開的照片,目標 id 都是母 id 的延伸')
        ck(all(t.get('screen') for e in tg for t in e['targets']),
           '每個目標都有自己的判決(重跑分離 MUST NOT 把 screen 洗掉 —— 冪等性)')
        ck(all((e.get('screen') or {}).get('why') in ('targets', 'human') for e in tg),
           '被切開的照片,母 screen 由目標 roll up 而來')

    if os.path.exists(tmp):
        os.remove(tmp)
    print(f'\n{"=" * 60}\n✅ 通過 {len(OK)} 項' + (f'、❌ 失敗 {len(BAD)} 項' if BAD else ''))
    for m in BAD:
        print('   ✗ ' + m)
    sys.exit(1 if BAD else 0)


if __name__ == '__main__':
    main()
