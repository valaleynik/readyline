exec(open('wordmarks4.py').read().split('\nv={"G1')[0])
asc=max(l["b"][3] for l in L if l["b"])
top=min(-asc, -CAP-sq*0.18)
pad=4
def wordmark(ink):
    body=build(ink,"d")
    w=W+2*pad; h=(depth-top)+2*pad
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" width="{w:.0f}" height="{h:.0f}"><g transform="translate({pad},{-top+pad:.1f})">{body}</g></svg>', w, h
for name,ink in [("readyline-logo.svg",SLATE),("readyline-logo-dark.svg",ALAB)]:
    s,w,h=wordmark(ink); open(name,"w").write(s)
print("logo", round(W), round(depth-top))
# preview
import cairosvg
for n in ["readyline-logo.svg","readyline-logo-dark.svg"]:
    cairosvg.svg2png(url=n, write_to=n.replace(".svg",".png"), output_width=600, background_color=("#0F172A" if "dark" in n else "#F8FAFC"))
