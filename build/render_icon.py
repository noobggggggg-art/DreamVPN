import math, numpy as np
from PIL import Image, ImageDraw
import make_icon as g          # та же геометрия, что и в icon.svg

K = 4; N = 512 * K
def hexc(h, a=255): h = h.lstrip('#'); return (int(h[0:2],16), int(h[2:4],16), int(h[4:6],16), a)
def sc(pts): return [(x*K, y*K) for x, y in pts]
def layer(): return Image.new('RGBA', (N, N), (0,0,0,0))

def gradient(w, h, stops, diag=True, vec=(0,0,1,1)):
    ys, xs = np.mgrid[0:h, 0:w]
    x1,y1,x2,y2 = vec
    px, py = xs/(w-1), ys/(h-1)
    dx, dy = x2-x1, y2-y1
    t = ((px-x1)*dx + (py-y1)*dy) / (dx*dx + dy*dy); t = np.clip(t, 0, 1)
    out = np.zeros((h, w, 4))
    offs = [s[0] for s in stops]
    for c in range(4):
        out[..., c] = np.interp(t, offs, [hexc(s[1])[c] for s in stops])
    return Image.fromarray(out.astype('uint8'), 'RGBA')

def poly_mask(pts):
    m = Image.new('L', (N, N), 0); ImageDraw.Draw(m).polygon(sc(pts), fill=255); return m

def fill_grad(img, mask, stops, vec):
    xs = [p for p in np.argwhere(np.array(mask) > 0)]
    ys0, xs0 = np.min([a[0] for a in xs]), np.min([a[1] for a in xs]); ys1, xs1 = np.max([a[0] for a in xs]), np.max([a[1] for a in xs])
    gr = gradient(xs1-xs0+1, ys1-ys0+1, stops, vec=vec)
    full = layer(); full.paste(gr, (xs0, ys0)); full.putalpha(Image.composite(full.getchannel('A'), Image.new('L',(N,N),0), mask))
    img.alpha_composite(full)

def stroke(img, pts, w, color, closed=True, alpha=255):
    L = layer(); d = ImageDraw.Draw(L); p = sc(pts); c = hexc(color, alpha)
    d.line(p + ([p[0]] if closed else []), fill=c, width=int(w*K), joint='curve')
    r = w*K/2
    for x, y in (p if not closed else p): d.ellipse([x-r, y-r, x+r, y+r], fill=c)
    img.alpha_composite(L)

img = layer()
# фон: скруглённый квадрат с чёрно-фиолетовым градиентом
bgm = Image.new('L', (N, N), 0); ImageDraw.Draw(bgm).rounded_rectangle([16*K,16*K,496*K,496*K], radius=116*K, fill=255)
bg = gradient(N, N, [(0,'#34185f'),(0.55,'#150a2a'),(1,'#05030b')]); bg.putalpha(bgm); img.alpha_composite(bg)
# мягкое свечение за луной
ys, xs = np.mgrid[0:N, 0:N]; cx, cy, r = (g.C1[0]+40)*K, (g.C1[1]-10)*K, 230*K
a = np.clip(1 - np.hypot(xs-cx, ys-cy)/r, 0, 1) * 0.55 * 255 * (np.array(bgm)/255)
gl = np.zeros((N, N, 4), 'uint8'); gl[...,0], gl[...,1], gl[...,2], gl[...,3] = 139, 61, 255, a.astype('uint8')
img.alpha_composite(Image.fromarray(gl, 'RGBA'))
# внутренняя рамка
rim = layer(); ImageDraw.Draw(rim).rounded_rectangle([22*K,22*K,490*K,490*K], radius=110*K, outline=hexc('#7c3aed', 115), width=4*K); img.alpha_composite(rim)

OUT = '#0a0514'
# луна
mm = poly_mask(g.moon)
fill_grad(img, mm, [(0,'#ecd9ff'),(0.5,'#a566ff'),(1,'#6a2bd6')], (0.1,0,0.9,1))
stroke(img, g.moon, 15, OUT)
# блик на краю
sh = g.arc(g.C1, g.R1-20, math.radians(196), math.radians(246), False, 30)
stroke(img, sh, 9, '#fbf3ff', closed=False, alpha=230)
# закрытый глаз, ресницы, румянец
def qbez(p0, p1, p2, n=30): return [((1-t)**2*p0[0]+2*(1-t)*t*p1[0]+t*t*p2[0], (1-t)**2*p0[1]+2*(1-t)*t*p1[1]+t*t*p2[1]) for t in [i/n for i in range(n+1)]]
stroke(img, qbez((112,262),(134,290),(160,262)), 9, OUT, closed=False)
stroke(img, [(110,258),(101,252)], 6, OUT, closed=False); stroke(img, [(163,258),(172,252)], 6, OUT, closed=False)
bl = layer(); ImageDraw.Draw(bl).ellipse([(124-20)*K,(304-12)*K,(124+20)*K,(304+12)*K], fill=hexc('#ff7fd6', 153)); img.alpha_composite(bl)
# звёзды
def star_pts(cx, cy, R):
    r = R*0.30; return [(cx+(R if k%2==0 else r)*math.cos(math.radians(k*45-90)), cy+(R if k%2==0 else r)*math.sin(math.radians(k*45-90))) for k in range(8)]
for cx, cy, R, w in [(372,196,50,9),(428,300,28,7),(318,122,20,6)]:
    pts = star_pts(cx, cy, R); fill_grad(img, poly_mask(pts), [(0,'#ffffff'),(1,'#d9b8ff')], (0,0,1,1)); stroke(img, pts, w, OUT)
dots = layer(); dd = ImageDraw.Draw(dots)
for x, y, r_, c in [(410,116,7,'#e9d5ff'),(404,368,6,'#c4a1ff'),(446,204,5,'#e9d5ff')]: dd.ellipse([(x-r_)*K,(y-r_)*K,(x+r_)*K,(y+r_)*K], fill=hexc(c))
img.alpha_composite(dots)

big = img.resize((1024, 1024), Image.LANCZOS)
big.save('icon_1024.png')
big.resize((512, 512), Image.LANCZOS).save('icon.png')
big.save('icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print('done')
