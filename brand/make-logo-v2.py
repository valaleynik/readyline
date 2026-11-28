"""Daylight Volt logo (2026-11-27): "ready" in midnight, "line" in white on a cobalt block, a mint dot.
Text is outlined from Space Grotesk 700 so the SVGs need no font. Run from the repo root."""
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
import cairosvg, shutil

MID="#101935"; COB="#2350F5"; MINT="#0FA77E"; WHITE="#FFFFFF"
FONT="node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff"

def word(text, fill, x0, base, size=100, track=-0.04):
    f=TTFont(FONT); gs=f.getGlyphSet(); cmap=f.getBestCmap(); upm=f["head"].unitsPerEm; hm=f["hmtx"]
    s=size/upm; x=x0; parts=[]
    for ch in text:
        g=cmap[ord(ch)]; pen=SVGPathPen(gs); gs[g].draw(pen)
        parts.append(f'<path fill="{fill}" transform="translate({x:.2f},{base}) scale({s:.5f},{-s:.5f})" d="{pen.getCommands()}"/>')
        x+=hm[g][0]*s+track*size
    xh=f["OS/2"].sxHeight*s; asc=f["OS/2"].sCapHeight*s; desc=-f["hhea"].descent*s
    return "".join(parts), x-track*size, xh, asc, desc

def svg(w,h,body): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" width="{w:.0f}" height="{h:.0f}">{body}</svg>'

def logo(ready_fill):
    base=100; size=100
    a, x1, xh, cap, desc = word("ready", ready_fill, 0, base)
    padx=12
    b, x2, *_ = word("line", WHITE, x1+8+padx, base)
    top=base-cap-14; bot=base+desc*0.55+6
    block=f'<rect x="{x1+8:.2f}" y="{top:.2f}" width="{x2-x1-8+padx:.2f}" height="{bot-top:.2f}" rx="14" fill="{COB}"/>'
    dotx=x2+padx+18; r=9
    dot=f'<circle cx="{dotx:.2f}" cy="{base-r:.2f}" r="{r}" fill="{MINT}"/>'
    w=dotx+r+2; h=bot+4
    return svg(w, h, a+block+b+dot), w, h

def mark(bg=COB, size=64):
    p, x, xh, cap, desc = word("r", WHITE, 0, 0, size=46, track=0)
    body=f'<rect width="64" height="64" rx="14" fill="{bg}"/>'
    body+=f'<g transform="translate({(64-x)/2-5:.2f},{32+xh/2:.2f})">{p}</g>'
    body+=f'<circle cx="{(64-x)/2+x+1:.2f}" cy="{32+xh/2-6:.2f}" r="6" fill="{MINT}"/>'
    return svg(64,64,body)

lt, w, h = logo(MID); dk, *_ = logo(WHITE)
open("brand/readyline-logo.svg","w").write(lt)
open("brand/readyline-logo-dark.svg","w").write(dk)
m=mark()
for n in ["readyline-mark.svg","readyline-mark-dark.svg","readyline-app-icon.svg"]: open(f"brand/{n}","w").write(m)
shutil.copy("brand/readyline-app-icon.svg","web/app/icon.svg")
cairosvg.svg2png(bytestring=m.encode(), write_to="web/app/apple-icon.png", output_width=180, output_height=180)
for n in ["readyline-logo.svg","readyline-logo-dark.svg","readyline-mark.svg","readyline-mark-dark.svg","readyline-app-icon.svg"]:
    shutil.copy(f"brand/{n}", f"web/public/brand/{n}")
print(f"logo {w:.0f}x{h:.0f}")
