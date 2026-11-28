exec(open("wordmarks.py").read().split("variants={}")[0])
from fontTools.pens.recordingPen import RecordingPen
# find the y tail terminal: lowest points of the y outline
rp=RecordingPen(); GS[idx[4]["g"]].draw(rp)
pts=[p for op,args in rp.value for p in args if p]
ymin=min(p[1] for p in pts)
low=[p for p in pts if abs(p[1]-ymin)<1]
tx0=min(p[0] for p in low)*S; 
# terminal thickness: points near the bottom-left within the tail
near=[p for p in pts if p[0]*S<tx0+stem*2 and p[1]<ymin+ (0.2*UPM)]
tthick=(max(p[1] for p in near)-ymin)*S
y=idx[4]; e=idx[8]; i=idx[6]
depth=-ymin*S
x0=y["x"]+tx0; x1=e["x"]+e["b"][2]
def bar(fill, th=None):
    th=th or tthick*0.62
    return f'<rect fill="{fill}" x="{x0:.1f}" y="{depth-th:.1f}" width="{x1-x0:.1f}" height="{th:.1f}"/>'
dl=CM[0x131]; pen=SVGPathPen(GS); GS[dl].draw(pen)
dotless=f'<path fill="{SLATE}" transform="translate({i["x"]:.1f},0) scale({S:.5f},{-S:.5f})" d="{pen.getCommands()}"/>'
ix=i["x"]+(i["b"][0]+i["b"][2])/2; sq=stem*1.1
dot=lambda c,lift=0.18: f'<rect fill="{c}" x="{ix-sq/2:.1f}" y="{-CAP-sq*lift:.1f}" width="{sq:.1f}" height="{sq:.1f}"/>'
v={}
v["A1  y's tail runs on as the pass line (slate, one continuous shape)"]=glyph(L,SLATE)+bar(SLATE)
v["A2  same, the line in copper"]=glyph(L,SLATE)+bar(COPPER)
v["B   the i's dot is a copper ready point"]=glyph(L,SLATE,skip=(6,))+dotless+dot(COPPER)
v["E   both: the y draws the pass line, the copper point sits above it"]=glyph(L,SLATE,skip=(6,))+dotless+dot(COPPER)+bar(SLATE)
rows=[]; yoff=56
for name,body in v.items():
    rows.append(f'<text x="40" y="{yoff}" font-family="Inter" font-size="15" font-weight="600" fill="#475569">{name}</text>')
    rows.append(f'<g transform="translate(40,{yoff+36+CAP})">{body}</g>')
    yoff+=CAP+116
# dark + small sizes of E
Ebody=v["E   both: the y draws the pass line, the copper point sits above it"]
Edark=Ebody.replace(SLATE,ALAB)
rows.append(f'<rect x="0" y="{yoff-30}" width="{int(W+80)}" height="{CAP+150}" fill="#0F172A"/>')
rows.append(f'<g transform="translate(40,{yoff+20+CAP})">{Edark}</g>')
rows.append(f'<g transform="translate(40,{yoff+70+CAP}) scale(0.25)">{Edark}</g>')
rows.append(f'<g transform="translate(240,{yoff+70+CAP}) scale(0.16)">{Edark}</g>')
yoff+=CAP+150
sheet=f'<svg xmlns="http://www.w3.org/2000/svg" width="{int(W+80)}" height="{int(yoff)}"><rect width="100%" height="100%" fill="{ALAB}"/>{"".join(rows)}</svg>'
cairosvg.svg2png(bytestring=sheet.encode(),write_to="wordmarks2.png")
import json; json.dump({k:val for k,val in v.items()},open("wordmark-bodies.json","w"))
print(tx0, tthick, depth)
