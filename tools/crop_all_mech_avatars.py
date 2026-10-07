"""Batch crop mech avatars from standing illustrations.
Crops head/cockpit/visor focus regions (256x256 transparent PNG) for all 32 mechs.
"""
import os
from PIL import Image

MECHS = {
  's01': 'dnipro_score', 's02': 'blacksmith', 's03': 'leviathan', 's04': 'shovel_zero',
  's05': 'overclock', 's06': 'dirge', 's07': 'qed', 's08': 'candlestick',
  's09': 'gamekeeper', 's10': 'feather_array', 's11': 'clockwork', 's12': 'star_chart',
  't01': 'winter_general', 't02': 'galatea_7', 't03': 'firebox', 't04': 'greyhound',
  't05': 'bionic_crane', 't06': 'qinggong', 't07': 'breath_hold', 't08': 'aria',
  't09': 'elegy', 't10': 'trajectory', 't11': 'veteran', 't12': 'colossus',
  'm01': 'raven', 'm02': 'ballast', 'm03': 'lifeline', 'm04': 'nameless',
  'm05': 'stranglehold', 'm06': 'downpour', 'm07': 'portcullis', 'm08': 'dead_number'
}

CROP_CONFIG = {
  # STEEL Legion (s01 - s12)
  's01': {'cx': 448, 'cy': 380, 'size': 380}, # 四涵道旋翼機首主機身/感測器
  's02': {'cx': 448, 'cy': 350, 'size': 400}, # 六涵道旋翼重裝甲機首
  's03': {'cx': 470, 'cy': 340, 'size': 400}, # 飛鯨浮空艦獨角雷光機首
  's04': {'cx': 440, 'cy': 380, 'size': 380}, # 零戰風工兵鏟破甲衝角機鼻
  's05': {'cx': 460, 'cy': 360, 'size': 400}, # X構型裸架雙聯磁軌機首
  's06': {'cx': 450, 'cy': 270, 'size': 360}, # 半人馬四足機甲頭部面甲
  's07': {'cx': 448, 'cy': 300, 'size': 380}, # 8觸手古文明核心頭部
  's08': {'cx': 448, 'cy': 340, 'size': 360}, # 瓷白共軸雙旋翼球體核心
  's09': {'cx': 450, 'cy': 280, 'size': 360}, # 袋鼠仿生機甲頭部面甲
  's10': {'cx': 450, 'cy': 280, 'size': 380}, # 迅猛龍頭部面甲
  's11': {'cx': 600, 'cy': 520, 'size': 340}, # 滑翔翼鈦白長航機首/光束噴口
  's12': {'cx': 460, 'cy': 340, 'size': 380}, # 鴨式三角翼星圖菱形感測球機頭

  # SWARM Legion (t01 - t12)
  't01': {'cx': 450, 'cy': 240, 'size': 360}, # 骨白骷髏面甲/牛角頭部
  't02': {'cx': 460, 'cy': 250, 'size': 360}, # 修長紫藍機甲面部
  't03': {'cx': 460, 'cy': 260, 'size': 400}, # 大猩猩體態破障巨兵頭部
  't04': {'cx': 450, 'cy': 280, 'size': 360}, # 四足獵犬機械獸頭部
  't05': {'cx': 180, 'cy': 280, 'size': 280}, # 丹頂鶴長頸涉禽鳥首/朱紅冠頂/喙
  't06': {'cx': 480, 'cy': 460, 'size': 280}, # 齊天靈猴臉譜面甲/雙螺旋金箍
  't07': {'cx': 360, 'cy': 640, 'size': 360}, # 翼龍長喙狙擊頭部/紅光感測眼
  't08': {'cx': 450, 'cy': 270, 'size': 380}, # 東方機械神龍龍首/粉色龍角
  't09': {'cx': 320, 'cy': 660, 'size': 320}, # 波斯幾何大三角飛翼座艙/機首
  't10': {'cx': 440, 'cy': 250, 'size': 360}, # 雙耳雷達機甲頭部/雙肩發射箱
  't11': {'cx': 450, 'cy': 560, 'size': 360}, # 阿特拉斯重步兵三角面盔頭部
  't12': {'cx': 440, 'cy': 210, 'size': 360}, # 重裝巨兵眉心電磁砲頭部

  # MERC Legion (m01 - m08)
  'm01': {'cx': 460, 'cy': 240, 'size': 360}, # 吸血鬼突襲態寡婦尖面部
  'm02': {'cx': 560, 'cy': 270, 'size': 360}, # 暴龍水平脊椎猙獰巨顎龍首
  'm03': {'cx': 460, 'cy': 360, 'size': 380}, # 雙尾桁機腹探測艙/機首
  'm04': {'cx': 370, 'cy': 680, 'size': 320}, # 仿生獵鷹金色羽刃鷹首/喙
  'm05': {'cx': 390, 'cy': 600, 'size': 340}, # 狼人頭部面甲/狼吻獠牙
  'm06': {'cx': 240, 'cy': 700, 'size': 360}, # 四足劍龍首部/黃眼機械頭
  'm07': {'cx': 450, 'cy': 350, 'size': 380}, # 犀角金龜甲蟲犀角/頭部
  'm08': {'cx': 720, 'cy': 700, 'size': 340}  # 消音黑豹地面型豹首/冰晶藍眼
}

def crop_all_mechs():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    mechs_dir = os.path.join(base_dir, 'public', 'assets', 'mechs')
    avatars_dir = os.path.join(base_dir, 'public', 'assets', 'mech_avatars')
    os.makedirs(avatars_dir, exist_ok=True)

    print(f"Cropping {len(MECHS)} mech avatars to {avatars_dir}...")
    for mid, slug in sorted(MECHS.items()):
        mech_file = os.path.join(mechs_dir, f"{mid}_{slug}.png")
        if not os.path.exists(mech_file):
            print(f"Warning: {mech_file} does not exist!")
            continue

        cfg = CROP_CONFIG[mid]
        cx, cy, sz = cfg['cx'], cfg['cy'], cfg['size']
        sx = cx - sz // 2
        sy = cy - sz // 2

        img = Image.open(mech_file).convert('RGBA')
        cropped = img.crop((sx, sy, sx + sz, sy + sz))
        avatar = cropped.resize((256, 256), Image.Resampling.LANCZOS)

        out_path = os.path.join(avatars_dir, f"{mid}.png")
        avatar.save(out_path, format='PNG', optimize=True)
        print(f"Generated {mid}.png (box: x={sx}, y={sy}, size={sz})")

if __name__ == '__main__':
    crop_all_mechs()
