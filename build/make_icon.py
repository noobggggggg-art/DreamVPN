import math, subprocess
S = 512
C1, R1 = (232, 272), 156          # внешняя окружность месяца
C2, R2 = (312, 232), 130          # «вырез»

def inter(c1, r1, c2, r2):
    (x1, y1), (x2, y2) = c1, c2
    d = math.hypot(x2 - x1, y2 - y1)
    a = (r1**2 - r2**2 + d**2) / (2 * d)
    h = math.sqrt(r1**2 - a**2)
    mx, my = x1 + a * (x2 - x1) / d, y1 + a * (y2 - y1) / d
    return [(mx + h * (y2 - y1) / d, my - h * (x2 - x1) / d), (mx - h * (y2 - y1) / d, my + h * (x2 - x1) / d)]

def ang(c, p): return math.atan2(p[1] - c[1], p[0] - c[0])
def arc(c, r, a0, a1, ccw, n=90):
    if ccw and a1 > a0: a1 -= 2 * math.pi
    if not ccw and a1 < a0: a1 += 2 * math.pi
    return [(c[0] + r * math.cos(a0 + (a1 - a0) * i / n), c[1] + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]

P1, P2 = sorted(inter(C1, R1, C2, R2), key=lambda p: p[1])      # верхняя, нижняя
# внешняя дуга: из верхней точки в нижнюю через левую сторону
outer = max((arc(C1, R1, ang(C1, P1), ang(C1, P2), ccw) for ccw in (True, False)), key=lambda pts: -pts[len(pts)//2][0])
# внутренняя дуга: из нижней в верхнюю, середина которой лежит внутри внешнего круга
inner_c = [arc(C2, R2, ang(C2, P2), ang(C2, P1), ccw) for ccw in (True, False)]
inner = min(inner_c, key=lambda pts: math.hypot(pts[len(pts)//2][0]-C1[0], pts[len(pts)//2][1]-C1[1]))
moon = outer + inner
def path(pts, close=True): return 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in pts) + (' Z' if close else '')

def star(cx, cy, R, r=None, rot=0):
    r = r or R * 0.30
    pts = []
    for k in range(8):
        a = math.radians(rot + k * 45 - 90); rr = R if k % 2 == 0 else r
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return path(pts)

shine = path(arc((C1[0], C1[1]), R1 - 20, math.radians(196), math.radians(246), False, 30), close=False)
OUT = '#0a0514'
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34185f"/><stop offset="0.55" stop-color="#150a2a"/><stop offset="1" stop-color="#05030b"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#8b3dff" stop-opacity="0.55"/><stop offset="1" stop-color="#8b3dff" stop-opacity="0"/></radialGradient>
    <linearGradient id="moon" x1="0.1" y1="0" x2="0.9" y2="1"><stop offset="0" stop-color="#ecd9ff"/><stop offset="0.5" stop-color="#a566ff"/><stop offset="1" stop-color="#6a2bd6"/></linearGradient>
    <linearGradient id="star" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9b8ff"/></linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="116" fill="url(#bg)"/>
  <rect x="22" y="22" width="468" height="468" rx="110" fill="none" stroke="#7c3aed" stroke-opacity="0.45" stroke-width="4"/>
  <circle cx="{C1[0]+40}" cy="{C1[1]-10}" r="230" fill="url(#glow)"/>
  <path d="{path(moon)}" fill="url(#moon)" stroke="{OUT}" stroke-width="15" stroke-linejoin="round"/>
  <path d="{shine}" fill="none" stroke="#fbf3ff" stroke-opacity="0.9" stroke-width="9" stroke-linecap="round"/>
  <path d="M112 262 Q134 290 160 262" fill="none" stroke="{OUT}" stroke-width="9" stroke-linecap="round"/>
  <path d="M110 258 l-9 -6 M163 258 l9 -6" fill="none" stroke="{OUT}" stroke-width="6" stroke-linecap="round"/>
  <ellipse cx="124" cy="304" rx="20" ry="12" fill="#ff7fd6" fill-opacity="0.6"/>
  <path d="M378 134 L378 134" stroke="none"/>
  <path d="{star(372, 196, 50)}" fill="url(#star)" stroke="{OUT}" stroke-width="9" stroke-linejoin="round"/>
  <path d="{star(428, 300, 28)}" fill="url(#star)" stroke="{OUT}" stroke-width="7" stroke-linejoin="round"/>
  <path d="{star(318, 122, 20)}" fill="url(#star)" stroke="{OUT}" stroke-width="6" stroke-linejoin="round"/>
  <circle cx="410" cy="116" r="7" fill="#e9d5ff"/><circle cx="404" cy="368" r="6" fill="#c4a1ff"/><circle cx="446" cy="204" r="5" fill="#e9d5ff"/>
</svg>'''
open('icon.svg', 'w').write(svg)
print('P1', P1, 'P2', P2, 'moon pts', len(moon))
