exec(open("wordmarks2.py").read().split("v={}")[0])
y=idx[4]
from fontTools.pens.transformPen import TransformPen
ypen=SVGPathPen(None); GS[y["g"]].draw(TransformPen(ypen,(S,0,0,-S,y["x"],0)))
yshape=lambda fill: f'<path fill="{fill}" d="{ypen.getCommands()}"/>'
def lineshape(fill, th=None):
    th=th or tthick*0.62
    return f'<rect fill="{fill}" x="{x0:.1f}" y="{depth-th:.1f}" width="{x1-x0:.1f}" height="{th:.1f}"/>'
ytop=-CAP*0.75
def grad(id,a,b,x_a,y_a,x_b,y_b,mid=None):
    stops=f'<stop offset="0" stop-color="{a}"/>'+(f'<stop offset="{mid}" stop-color="{a}"/>' if mid else '')+f'<stop offset="1" stop-color="{b}"/>'
    return f'<defs><linearGradient id="{id}" gradientUnits="userSpaceOnUse" x1="{x_a:.1f}" y1="{y_a:.1f}" x2="{x_b:.1f}" y2="{y_b:.1f}">{stops}</linearGradient></defs>'
others=lambda ink: glyph(L,ink,skip=(4,6)).replace(SLATE,ink)+dotless.replace(SLATE,ink)
yl=y["x"]+y["b"][0]
def build(ink, kind, dotc=COPPER):
    gid=f"g{kind}{ink[1:]}"
    if kind=="h":   g=grad(gid,ink,COPPER,yl,0,x1,0)
    elif kind=="d": g=grad(gid,ink,COPPER,yl,ytop,x1,depth)
    else:           g=grad(gid,ink,COPPER,yl,0,x1,0,mid=0.12)
    return g+others(ink)+yshape(f"url(#{gid})")+lineshape(f"url(#{gid})")+dot(dotc)
v={"G1  one fade, left to right":"h","G2  one fade along the stroke, top of the y to the end of the line":"d"}
rows=[]; yoff=56
for name,k in v.items():
    rows.append(f'<text x="40" y="{yoff}" font-family="Inter" font-size="15" font-weight="600" fill="#475569">{name}</text>')
    rows.append(f'<g transform="translate(40,{yoff+36+CAP})">{build(SLATE,k)}</g>')
    yoff+=CAP+116
rows.append(f'<rect x="0" y="{yoff-30}" width="{int(W+80)}" height="{CAP+150}" fill="#0F172A"/>')
rows.append(f'<g transform="translate(40,{yoff+20+CAP})">{build(ALAB,"d")}</g>')
rows.append(f'<g transform="translate(40,{yoff+70+CAP}) scale(0.25)">{build(ALAB,"d")}</g>')
rows.append(f'<g transform="translate(240,{yoff+70+CAP}) scale(0.16)">{build(ALAB,"d")}</g>')
yoff+=CAP+150
sheet=f'<svg xmlns="http://www.w3.org/2000/svg" width="{int(W+80)}" height="{int(yoff)}"><rect width="100%" height="100%" fill="{ALAB}"/>{"".join(rows)}</svg>'
cairosvg.svg2png(bytestring=sheet.encode(),write_to="wordmarks4.png")
open("build_parts.py","w").write("")  # marker
