from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
import cairosvg

SLATE="#1E293B"; COPPER="#D97706"; ALAB="#F8FAFC"; NIGHT="#0F172A"

def word(text, weight="700", size=100, track=-0.02):
    f=TTFont(f"/tmp/brand/package/files/inter-latin-{weight}-normal.woff")
    gs=f.getGlyphSet(); cmap=f.getBestCmap(); upm=f["head"].unitsPerEm; hm=f["hmtx"]
    s=size/upm; x=0; parts=[]
    for ch in text:
        g=cmap[ord(ch)]; pen=SVGPathPen(gs); gs[g].draw(pen)
        parts.append(f'<path transform="translate({x:.2f},0) scale({s:.5f},{-s:.5f})" d="{pen.getCommands()}"/>')
        x+=hm[g][0]*s+track*size
    cap=f["OS/2"].sCapHeight*s
    return "".join(parts), x-track*size, cap

# The mark on a 64 grid: a bold rule (the line) crossed by a rising stroke (the learner).
def mark(rule, rise, bg=None, pad=0, variant="trend"):
    # The pass line: a bold full-width rule. The learner: a trend line that climbs
    # slowly below it, then crosses it and keeps rising. Crossing = ready.
    s=f'<rect x="{pad+4}" y="{pad+34}" width="56" height="9" fill="{rule}"/>'
    pts=[(6,54),(26,46),(58,10)] if variant=="trend" else [(6,52),(30,52),(56,10)]
    d=" ".join(f"{x+pad},{y+pad}" for x,y in pts)
    s+=f'<polyline points="{d}" fill="none" stroke="{rise}" stroke-width="8" stroke-linejoin="miter" stroke-linecap="square"/>'
    if bg: s=f'<rect width="{64+2*pad}" height="{64+2*pad}" rx="{14+pad*0.2}" fill="{bg}"/>'+s
    return s

def svg(w,h,body): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{body}</svg>'

paths,ww,cap=word("Readyline")
files={}
files["readyline-mark.svg"]=svg(64,64,mark(SLATE,COPPER))
files["readyline-mark-dark.svg"]=svg(64,64,mark(ALAB,COPPER))
files["readyline-app-icon.svg"]=svg(80,80,mark(ALAB,COPPER,bg=SLATE,pad=8))
H=72; gap=18; scale=0.5  # wordmark at 50px cap ~ matches mark height
def lockup(ink):
    wpaths,_,_=word("Readyline",size=50)
    return f'{mark(ink,COPPER)}<g transform="translate({64+gap},{32+cap*0.5*0.5+2})" fill="{ink}">{wpaths}</g>'
lw=64+gap+ww*0.5+2
files["readyline-logo.svg"]=svg(round(lw),64,lockup(SLATE))
files["readyline-logo-dark.svg"]=svg(round(lw),64,lockup(ALAB))
files["readyline-wordmark.svg"]=svg(round(ww)+2,round(cap)+4,f'<g transform="translate(0,{cap+2:.1f})" fill="{SLATE}">{paths}</g>')
for n,c in files.items(): open(f"/tmp/brand/out/{n}","w").write(c)
# contact sheet
sheet=f'''<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560">
<rect width="900" height="280" fill="{ALAB}"/><rect y="280" width="900" height="280" fill="{NIGHT}"/>
<g transform="translate(40,40) scale(2)">{mark(SLATE,COPPER)}</g>
<g transform="translate(240,60)">{lockup(SLATE)}</g>
<g transform="translate(40,320) scale(2)">{mark(ALAB,COPPER)}</g>
<g transform="translate(240,340)">{lockup(ALAB)}</g>
<g transform="translate(700,330)">{mark(ALAB,COPPER,bg=SLATE,pad=8)}</g>
<g transform="translate(800,345) scale(0.4)">{mark(ALAB,COPPER,bg=SLATE,pad=8)}</g>
<g transform="translate(700,60) scale(1)">{mark(ALAB,COPPER,bg=SLATE,pad=8)}</g>
<g transform="translate(240,200) scale(0.5)">{lockup(SLATE)}</g>

</svg>'''
cairosvg.svg2png(bytestring=sheet.encode(),write_to="/tmp/brand/sheet.png")
print(round(ww),round(cap))
