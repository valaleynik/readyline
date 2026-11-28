from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
import cairosvg
SLATE="#1E293B"; COPPER="#D97706"; ALAB="#F8FAFC"
F=TTFont("/tmp/brand/package/files/inter-latin-800-normal.woff")
GS=F.getGlyphSet(); CM=F.getBestCmap(); UPM=F["head"].unitsPerEm; HM=F["hmtx"]
SIZE=120; S=SIZE/UPM; TRACK=-0.025*SIZE
CAP=F["OS/2"].sCapHeight*S; XH=F["OS/2"].sxHeight*S

def layout(text):
    x=0; out=[]
    for ch in text:
        g=CM[ord(ch)]; bp=BoundsPen(GS); GS[g].draw(bp); b=bp.bounds
        out.append(dict(ch=ch,g=g,x=x,adv=HM[g][0]*S,b=[v*S for v in b] if b else None))
        x+=HM[g][0]*S+TRACK
    return out, x-TRACK
def glyph(L, fill, skip=()):
    p=[]
    for i,l in enumerate(L):
        if i in skip: continue
        pen=SVGPathPen(GS); GS[l["g"]].draw(pen)
        p.append(f'<path fill="{fill}" transform="translate({l["x"]:.1f},0) scale({S:.5f},{-S:.5f})" d="{pen.getCommands()}"/>')
    return "".join(p)

L,W=layout("Readyline")
idx={i:l for i,l in enumerate(L)}  # R0 e1 a2 d3 y4 l5 i6 n7 e8
stem=0.115*SIZE  # approx Inter ExtraBold stem width
variants={}

# A. The y's tail becomes the pass line, running under "line".
y=idx[4]; e=idx[8]
tail_y=-y["b"][1]  # descender depth (positive, svg down)
bar=f'<rect fill="{COPPER}" x="{y["x"]+y["b"][0]+stem*0.2:.1f}" y="{tail_y-stem*0.9:.1f}" width="{e["x"]+e["b"][2]-(y["x"]+y["b"][0]+stem*0.2):.1f}" height="{stem*0.9:.1f}"/>'
variants["A  The y's tail becomes the pass line"]=glyph(L,SLATE)+bar

# B. The i's dot is the ready point: a copper square lifted above the x-height, on the rising line.
i=idx[6]
ix=i["x"]+(i["b"][0]+i["b"][2])/2
# draw i without its dot: use dotlessi glyph if present
dl=F.getBestCmap().get(0x131)
parts=glyph(L,SLATE,skip=(6,))
pen=SVGPathPen(GS); GS[dl].draw(pen)
parts+=f'<path fill="{SLATE}" transform="translate({i["x"]:.1f},0) scale({S:.5f},{-S:.5f})" d="{pen.getCommands()}"/>'
sq=stem*1.15
parts+=f'<rect fill="{COPPER}" x="{ix-sq/2:.1f}" y="{-CAP-sq*0.15:.1f}" width="{sq:.1f}" height="{sq:.1f}"/>'
variants["B  The i's dot is the ready point"]=parts

# C. A pass line cut through the word at x-height midline; "line" sits higher (it crossed).
mid=-XH*0.5
ready=glyph(L[:5],SLATE); rest=glyph(L[5:],SLATE)
lift=XH*0.0
cut=f'<rect fill="{COPPER}" x="{-4}" y="{mid-stem*0.35:.1f}" width="{W+8:.1f}" height="{stem*0.7:.1f}"/>'
variants["C  One copper line runs through the word"]=f'{ready}{rest}{cut}'

# D. The l is the rising stroke: a copper diagonal stem crossing a slate bar at the baseline.
l=idx[5]
lx=l["x"]+l["b"][0]
top=-l["b"][3]
dia=f'<polygon fill="{COPPER}" points="{lx-stem*0.6:.1f},0 {lx+stem*0.5:.1f},0 {lx+stem*2.1:.1f},{top:.1f} {lx+stem*1.0:.1f},{top:.1f}"/>'
base=f'<rect fill="{SLATE}" x="{lx-stem*1.6:.1f}" y="{-stem*0.55:.1f}" width="{stem*4.4:.1f}" height="{stem*0.55:.1f}"/>'
variants["D  The l leans forward: the climb inside the name"]=glyph(L,SLATE,skip=(5,))+base+dia

rows=[]; yoff=60
for name,body in variants.items():
    rows.append(f'<text x="40" y="{yoff}" font-family="Inter" font-size="15" font-weight="600" fill="#475569">{name}</text>')
    rows.append(f'<g transform="translate(40,{yoff+40+CAP})">{body}</g>')
    yoff+=CAP+120
sheet=f'<svg xmlns="http://www.w3.org/2000/svg" width="{int(W+80)}" height="{int(yoff)}"><rect width="100%" height="100%" fill="{ALAB}"/>{"".join(rows)}</svg>'
open("wordmarks.svg","w").write(sheet)
cairosvg.svg2png(bytestring=sheet.encode(),write_to="wordmarks.png")
print(W,CAP,XH)
