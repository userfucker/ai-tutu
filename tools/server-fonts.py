"""工作台服务器用的字体：从 Google Fonts 仓库下载可变字体，切出常规 400 / 粗体 700 两个静态字体，存成 woff2。

服务器上画图（@napi-rs/canvas）不能用按字符切成小块的字体文件，所以用完整字体；网页里也用同一份，两边排出来的字一样宽。
用法：python3 tools/server-fonts.py web/fonts      （需要 pip install fonttools brotli）
字体都是 SIL Open Font License 1.1。
"""
import os, sys, urllib.request
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

out = sys.argv[1] if len(sys.argv) > 1 else "web/fonts"
os.makedirs(out, exist_ok=True)
BASE = "https://raw.githubusercontent.com/google/fonts/main/ofl/"
# (文件夹, 文件名, 家族名, 要哪些粗细)
FONTS = [
    ("notosans", "NotoSans[wdth,wght].ttf", "Noto Sans", [400, 700]),
    ("notosanssc", "NotoSansSC[wght].ttf", "Noto Sans SC", [400, 700]),
    ("notosanstc", "NotoSansTC[wght].ttf", "Noto Sans TC", [400, 700]),
    ("notosansjp", "NotoSansJP[wght].ttf", "Noto Sans JP", [400, 700]),
    ("notosanskr", "NotoSansKR[wght].ttf", "Noto Sans KR", [400, 700]),
    ("notosansarabic", "NotoSansArabic[wdth,wght].ttf", "Noto Sans Arabic", [400, 700]),
    ("notosansthai", "NotoSansThai[wdth,wght].ttf", "Noto Sans Thai", [400, 700]),
    ("notoserif", "NotoSerif[wdth,wght].ttf", "Noto Serif", [700]),
    ("notoserifsc", "NotoSerifSC[wght].ttf", "Noto Serif SC", [700]),
]
cache = os.path.join(out, ".download")
os.makedirs(cache, exist_ok=True)
for folder, name, family, weights in FONTS:
    src = os.path.join(cache, name)
    if not os.path.exists(src):
        url = BASE + folder + "/" + urllib.parse.quote(name)
        print("下载", url)
        urllib.request.urlretrieve(url, src)
    for w in weights:
        dst = os.path.join(out, f"{family.replace(' ', '')}-{w}.woff2")
        if os.path.exists(dst):
            continue
        f = TTFont(src)
        axes = {a.axisTag for a in f["fvar"].axes}
        loc = {"wght": w}
        if "wdth" in axes:
            loc["wdth"] = 100
        st = instancer.instantiateVariableFont(f, loc, updateFontNames=False)
        st.flavor = "woff2"
        st.save(dst)
        print("生成", dst, os.path.getsize(dst) // 1024, "KB")
print("完成")
