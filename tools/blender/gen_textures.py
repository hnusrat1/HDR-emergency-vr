"""Generate tiling PBR textures + signage decals for the HDR suite.
Outputs into site/assets/tex. All imagery here is original or derived from CC0 (ambientCG)."""
import os, math, json, glob
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import cv2

OUT = '/home/claude/hdr/site/assets/tex'
ACG = '/home/claude/hdr/tools/acg'
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)
FONT = '/usr/share/fonts/opentype/inter/'


def F(w, size):
    name = {'r': 'Inter-Regular.otf', 'm': 'Inter-Medium.otf', 's': 'Inter-SemiBold.otf', 'b': 'Inter-Bold.otf',
            'x': 'Inter-ExtraBold.otf', 'k': 'Inter-Black.otf', 'l': 'Inter-Light.otf', 'i': 'Inter-Italic.otf'}[w]
    return ImageFont.truetype(FONT + name, size)


def save(im, name, q=88):
    p = os.path.join(OUT, name)
    if name.endswith('.jpg'):
        im.convert('RGB').save(p, quality=q, optimize=True)
    else:
        im.save(p, optimize=True)
    return p


def tile_noise(n, scale, octaves=4, seed=0):
    """Tileable value noise via FFT-filtered white noise."""
    r = np.random.default_rng(seed)
    acc = np.zeros((n, n))
    amp = 1.0
    for o in range(octaves):
        w = r.standard_normal((n, n))
        fx = np.fft.fftfreq(n)[:, None]
        fy = np.fft.fftfreq(n)[None, :]
        f = np.sqrt(fx ** 2 + fy ** 2)
        s = scale / (2 ** o)
        filt = np.exp(-(f * n / max(s, 1e-3)) ** 2 * 0.5 * (s ** 2) / n ** 2 * n ** 2 / max(s, 1) ** 2)
        # simple gaussian low-pass with cutoff ~ 1/s
        filt = np.exp(-0.5 * (f * s) ** 2 * 40)
        acc += amp * np.real(np.fft.ifft2(np.fft.fft2(w) * filt))
        amp *= 0.5
    acc -= acc.min()
    acc /= acc.max() + 1e-9
    return acc


def normal_from_height(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nz = np.ones_like(h)
    n = np.stack([-gx, gy, nz], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8))


# ---------------------------------------------------------------- vinyl floor
def gen_vinyl():
    n = 2048  # 2 m -> ~1 mm/px
    base = np.array([201, 196, 185], float)
    mot = tile_noise(n, 140, 3, 1)
    streak = tile_noise(n, 60, 2, 2)
    # directional streaks (stretch along x)
    streak = cv2.resize(cv2.resize(streak, (n // 8, n)), (n, n))
    img = np.ones((n, n, 3)) * base
    img += ((mot - 0.5) * 14)[..., None]
    img += ((streak - 0.5) * 8)[..., None] * np.array([1.0, 0.95, 0.85])
    # chips
    chips = [((112, 110, 106), 0.010), ((236, 233, 226), 0.016), ((150, 140, 124), 0.006), ((88, 96, 104), 0.003)]
    for col, dens in chips:
        m = rng.random((n, n)) < dens * 0.25
        m = cv2.dilate(m.astype(np.uint8), np.ones((2, 2), np.uint8)).astype(bool)
        img[m] = img[m] * 0.4 + np.array(col) * 0.6
    img = cv2.GaussianBlur(img, (0, 0), 0.6)
    # roll seam (heat-welded) at x=0
    img[:, :2] = img[:, :2] * 0.82 + np.array([140, 132, 120]) * 0.18
    save(Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)), 'vinyl_c.jpg', 86)
    # roughness: subtle scuffs
    r = 0.30 + (tile_noise(n, 90, 3, 5) - 0.5) * 0.12
    scuff = np.zeros((n, n), np.float32)
    for _ in range(140):
        x, y = rng.integers(0, n, 2)
        L = rng.integers(20, 180)
        a = rng.random() * math.pi
        cv2.line(scuff, (int(x), int(y)), (int(x + L * math.cos(a)), int(y + L * math.sin(a))), float(rng.random() * 0.5 + 0.3), 1)
    scuff = cv2.GaussianBlur(scuff, (0, 0), 1.2)
    r = np.clip(r + scuff * 0.18, 0, 1)
    save(Image.fromarray((r * 255).astype(np.uint8)), 'vinyl_r.jpg', 90)
    h = tile_noise(n, 30, 2, 9) * 0.6 + scuff * 0.4
    save(normal_from_height(h, 1.2), 'vinyl_n.jpg', 92)


# ---------------------------------------------------------------- painted wall
def gen_paint():
    n = 1024  # 1.5 m
    h = tile_noise(n, 6, 3, 11)
    save(normal_from_height(h, 2.5), 'paint_n.jpg', 92)
    v = 0.965 + (tile_noise(n, 200, 3, 12) - 0.5) * 0.05
    save(Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8)), 'paint_c.jpg', 90)


def gen_speckle():
    n = 1024
    img = np.ones((n, n, 3)) * np.array([228, 225, 216], float)
    img += ((tile_noise(n, 120, 3, 21) - 0.5) * 8)[..., None]
    for col, d in [((170, 165, 155), 0.02), ((250, 248, 244), 0.03), ((130, 126, 120), 0.006)]:
        m = rng.random((n, n)) < d
        img[m] = img[m] * 0.5 + np.array(col) * 0.5
    img = cv2.GaussianBlur(img, (0, 0), 0.7)
    save(Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)), 'speckle_c.jpg', 86)


def copy_acg(asset, key, rot=False, color_adj=None, size=1024):
    d = glob.glob(f'{ACG}/{asset}/*')
    for suffix, out in [('_Color.jpg', 'c'), ('_NormalGL.jpg', 'n'), ('_Roughness.jpg', 'r')]:
        f = [x for x in d if x.endswith(suffix)]
        if not f:
            continue
        im = Image.open(f[0])
        if rot:
            im = im.rotate(90, expand=True)
            if out == 'n':  # rotate normal vectors too
                a = np.asarray(im).astype(float) / 127.5 - 1
                a = np.stack([a[..., 1], -a[..., 0], a[..., 2]], -1)
                im = Image.fromarray(((a + 1) * 127.5).clip(0, 255).astype(np.uint8))
        if out == 'c' and color_adj:
            a = np.asarray(im.convert('RGB')).astype(float)
            a = color_adj(a)
            im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
        im = im.resize((size, size), Image.LANCZOS)
        save(im, f'{key}_{out}.jpg', 88 if out != 'n' else 92)


def gen_acg():
    copy_acg('OfficeCeiling001', 'ceiling')
    copy_acg('Fabric036', 'fabric', size=512,
             color_adj=lambda a: 255 - (255 - (a.mean(-1, keepdims=True) * np.ones(3))) * 0.35 + 0)
    copy_acg('Leather037', 'leather', size=512, color_adj=lambda a: (a.mean(-1, keepdims=True) * np.ones(3)) * 0 + 235)
    # light maple: lighten and warm Wood066, grain vertical
    def maple(a):
        g = a.mean(-1, keepdims=True)
        g = (g - g.mean()) * 0.8 + 150
        return g * np.array([1.18, 1.0, 0.78])
    copy_acg('Wood066', 'wood', rot=True, color_adj=maple)


# ---------------------------------------------------------------- signs
YEL = (250, 214, 0)
MAG = (128, 0, 112)
BLK = (20, 20, 20)


def trefoil(dr, cx, cy, R, col):
    dr.ellipse([cx - R, cy - R, cx + R, cy + R], fill=col)
    r1, r2 = 1.5 * R, 5 * R
    for c in (90, 210, 330):  # blade centers (deg, PIL y-down): bottom, upper-left, upper-right
        a0, a1 = c - 30, c + 30
        pts = []
        for t in np.linspace(a0, a1, 24):
            pts.append((cx + r2 * math.cos(math.radians(t)), cy + r2 * math.sin(math.radians(t))))
        for t in np.linspace(a1, a0, 24):
            pts.append((cx + r1 * math.cos(math.radians(t)), cy + r1 * math.sin(math.radians(t))))
        dr.polygon(pts, fill=col)


def centered(dr, y, text, font, fill, W, x0=0):
    w = dr.textlength(text, font=font)
    dr.text((x0 + (W - w) / 2, y), text, font=font, fill=fill)


def wrap(dr, text, font, maxw):
    words = text.split(' ')
    lines, cur = [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if dr.textlength(t, font=font) <= maxw:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def sign_caution(name, lines, W=600, H=800, header='CAUTION', border=True):
    im = Image.new('RGB', (W, H), YEL)
    dr = ImageDraw.Draw(im)
    hh = int(H * 0.15)
    dr.rectangle([0, 0, W, hh], fill=MAG)
    centered(dr, hh * 0.16, header, F('k', int(hh * 0.62)), YEL, W)
    trefoil(dr, W / 2, hh + H * 0.27, H * 0.045, MAG)
    y = hh + H * 0.27 + H * 0.045 * 5 + H * 0.05
    fs = int(H * 0.085)
    for ln in lines:
        centered(dr, y, ln, F('x', fs), BLK, W)
        y += fs * 1.15
    if border:
        dr.rectangle([6, 6, W - 7, H - 7], outline=BLK, width=4)
    return save(im, name + '.png')


def gen_signs():
    albedo = {}
    sign_caution('sign_hra_door', ['HIGH', 'RADIATION', 'AREA'])
    sign_caution('sign_caution_ram', ['RADIOACTIVE', 'MATERIAL'], 600, 600)
    # container label
    im = Image.new('RGB', (700, 420), YEL)
    dr = ImageDraw.Draw(im)
    trefoil(dr, 110, 210, 17, MAG)
    dr.text((215, 66), 'EMERGENCY', font=F('k', 62), fill=BLK)
    dr.text((215, 140), 'SOURCE CONTAINER', font=F('x', 40), fill=BLK)
    dr.text((215, 215), 'Ir-192  HDR', font=F('b', 40), fill=MAG)
    dr.text((215, 280), 'Place applicator + source inside.', font=F('m', 26), fill=BLK)
    dr.text((215, 315), 'Close lid. Do not open. Call RSO.', font=F('m', 26), fill=BLK)
    dr.rectangle([5, 5, 694, 414], outline=BLK, width=5)
    save(im, 'sign_container.png')

    # room ID sign
    im = Image.new('RGB', (800, 260), (44, 62, 80))
    dr = ImageDraw.Draw(im)
    dr.text((40, 40), 'B-112', font=F('b', 92), fill=(255, 255, 255))
    dr.text((330, 52), 'HDR Brachytherapy', font=F('s', 46), fill=(255, 255, 255))
    dr.text((330, 120), 'Radiation Oncology', font=F('r', 36), fill=(190, 205, 220))
    dr.text((40, 186), 'Restricted area  ·  Authorized staff only', font=F('m', 30), fill=(230, 196, 60))
    save(im, 'sign_room.png')

    # E-stop label
    im = Image.new('RGB', (500, 260), YEL)
    dr = ImageDraw.Draw(im)
    centered(dr, 26, 'EMERGENCY', F('k', 74), BLK, 500)
    centered(dr, 112, 'OFF', F('k', 74), (180, 0, 0), 500)
    centered(dr, 200, 'Press to stop treatment', F('s', 30), BLK, 500)
    dr.rectangle([4, 4, 495, 255], outline=BLK, width=6)
    save(im, 'sign_estop.png')

    # procedure posters
    def poster(name, title, sections, W=1100, H=1560, foot=None):
        im = Image.new('RGB', (W, H), (252, 252, 249))
        dr = ImageDraw.Draw(im)
        dr.rectangle([0, 0, W, 190], fill=(178, 20, 30))
        trefoil(dr, 95, 95, 13, (255, 255, 255))
        dr.text((180, 28), 'HDR EMERGENCY PROCEDURE', font=F('k', 54), fill=(255, 255, 255))
        dr.text((180, 104), title, font=F('s', 38), fill=(255, 228, 228))
        y = 225
        n = 1
        for sec, steps in sections:
            dr.rectangle([50, y, W - 50, y + 54], fill=(36, 48, 60))
            dr.text((70, y + 8), sec, font=F('b', 32), fill=(255, 255, 255))
            y += 74
            for st in steps:
                bold, rest = st
                dr.ellipse([58, y + 2, 112, y + 56], fill=(178, 20, 30))
                centered(dr, y + 6, str(n), F('b', 36), (255, 255, 255), 54, 58)
                lines = wrap(dr, bold + ' ' + rest, F('m', 33), W - 210)
                first = True
                for ln in lines:
                    if first and ln.startswith(bold):
                        dr.text((135, y + 8), bold, font=F('x', 33), fill=(20, 20, 20))
                        bw = dr.textlength(bold + ' ', font=F('x', 33))
                        dr.text((135 + bw, y + 8), ln[len(bold):].strip(), font=F('m', 33), fill=(40, 40, 40))
                    else:
                        dr.text((135, y + 8), ln, font=F('m', 33), fill=(40, 40, 40))
                    first = False
                    y += 44
                y += 18
                n += 1
            y += 8
        if foot:
            dr.rectangle([0, H - 150, W, H], fill=(240, 240, 236))
            for i, ln in enumerate(foot):
                dr.text((60, H - 132 + i * 42), ln, font=F('s' if i == 0 else 'r', 30), fill=(30, 30, 30))
        dr.rectangle([3, 3, W - 4, H - 4], outline=(60, 60, 60), width=6)
        return im

    sections = [
        ('AT THE CONSOLE', [
            ('Press INTERRUPT.', 'Check the console source indicator, the area monitor and the CCTV.'),
            ('Press EMERGENCY STOP.', 'If the source is still out. Note the time.'),
            ('Take the survey meter.', 'Switch it ON and confirm it responds before you open the door.'),
        ]),
        ('IN THE ROOM  -  minimize time, maximize distance', [
            ('Press EMERGENCY STOP on the unit.', 'Watch the survey meter as you approach.'),
            ('Turn the HAND CRANK.', 'Clockwise, steadily, until the source is home. Confirm with the meter.'),
            ('Remove the applicator.', 'Release the clamp, withdraw the applicator and place it with the transfer tube in the EMERGENCY CONTAINER. Close the lid. Forceps only for a loose source.'),
            ('Survey the patient,', 'the container and the unit. The patient must read background.'),
        ]),
        ('AFTERWARDS', [
            ('Leave and secure the room.', 'Remove the patient if needed. Post the door.'),
            ('Notify', 'the RSO, the physicist and the authorized user. Record times, readings and positions.'),
        ]),
    ]
    im = poster('sign_procedure_console', 'Source fails to retract', sections, H=1720,
                foot=['Radiation Safety Officer  x4417     Physicist on call  x5520',
                      'Training example. Follow your institution\'s posted procedure.'])
    save(im, 'sign_procedure_console.jpg', 90)
    im = poster('sign_procedure_room', 'In-room response', [sections[1]], W=1100, H=1100,
                foot=['If in doubt, get out and call the physicist  x5520', 'Training example.'])
    save(im, 'sign_procedure_room.jpg', 90)

    # unit labels
    im = Image.new('RGB', (900, 300), (238, 239, 236))
    dr = ImageDraw.Draw(im)
    dr.text((40, 30), 'HDR AFTERLOADER', font=F('k', 70), fill=(40, 52, 66))
    dr.text((40, 120), 'Ir-192  ·  24 channel  ·  Unit A', font=F('m', 44), fill=(80, 92, 104))
    dr.rectangle([40, 200, 860, 206], fill=(31, 95, 158))
    dr.text((40, 225), 'S/N 0417-HDR   Max source activity 444 GBq (12 Ci)', font=F('r', 32), fill=(90, 96, 104))
    save(im, 'sign_unit_label.png')
    sign_caution('sign_unit_warning', ['RADIOACTIVE', 'MATERIAL'], 400, 400, border=True)
    im = Image.new('RGB', (600, 300), YEL)
    dr = ImageDraw.Draw(im)
    dr.text((30, 22), 'MANUAL SOURCE', font=F('k', 50), fill=BLK)
    dr.text((30, 82), 'RETRACTION', font=F('k', 50), fill=BLK)
    dr.text((30, 160), 'Fold out handle. Turn clockwise', font=F('s', 28), fill=BLK)
    dr.text((30, 198), 'until it stops. Verify with meter.', font=F('s', 28), fill=BLK)
    # arrow arc
    dr.arc([485, 160, 575, 250], 200, 520, fill=(180, 0, 0), width=10)
    dr.polygon([(560, 228), (586, 202), (590, 240)], fill=(180, 0, 0))
    dr.rectangle([4, 4, 595, 295], outline=BLK, width=5)
    save(im, 'sign_crank.png')

    im = Image.new('RGB', (600, 160), (40, 44, 50))
    dr = ImageDraw.Draw(im)
    dr.text((24, 20), 'AREA RADIATION MONITOR', font=F('b', 38), fill=(240, 240, 240))
    dr.text((24, 80), 'Alarm > 2 mR/h  ·  Room B-112', font=F('r', 32), fill=(180, 190, 200))
    save(im, 'sign_area_monitor.png')

    im = Image.new('RGB', (800, 300), (255, 255, 255))
    dr = ImageDraw.Draw(im)
    dr.rectangle([0, 0, 800, 300], fill=(190, 20, 30))
    centered(dr, 40, 'DO NOT ENTER', F('k', 92), (255, 255, 255), 800)
    centered(dr, 170, 'when RADIATION ON is lit', F('s', 50), (255, 235, 235), 800)
    save(im, 'sign_no_entry.png')

    # hand hygiene, exit, gases, sharps, biohazard, fire, trefoil small
    im = Image.new('RGB', (500, 700), (232, 244, 250))
    dr = ImageDraw.Draw(im)
    dr.rectangle([0, 0, 500, 140], fill=(0, 112, 160))
    centered(dr, 30, 'Clean your hands', F('b', 52), (255, 255, 255), 500)
    for i in range(6):
        x, y = 70 + (i % 2) * 210, 190 + (i // 2) * 160
        dr.rounded_rectangle([x, y, x + 150, y + 130], 18, fill=(255, 255, 255), outline=(0, 112, 160), width=4)
        dr.ellipse([x + 45, y + 25, x + 105, y + 105], outline=(0, 112, 160), width=6)
        dr.text((x + 8, y + 4), str(i + 1), font=F('b', 28), fill=(0, 112, 160))
    save(im, 'sign_handhygiene.png')
    im = Image.new('RGB', (600, 240), (250, 250, 250))
    dr = ImageDraw.Draw(im)
    centered(dr, 40, 'EXIT', F('k', 150), (200, 20, 20), 600)
    save(im, 'sign_exit.png')
    im = Image.new('RGB', (600, 200), (240, 240, 240))
    dr = ImageDraw.Draw(im)
    for i, (t, c) in enumerate([('O2', (46, 139, 87)), ('AIR', (230, 184, 31)), ('VAC', (240, 240, 240))]):
        dr.rectangle([20 + i * 195, 20, 190 + i * 195, 180], fill=c, outline=(60, 60, 60), width=3)
        centered(dr, 70, t, F('k', 56), (20, 20, 20) if t != 'O2' else (255, 255, 255), 170, 20 + i * 195)
    save(im, 'sign_gases.png')
    im = Image.new('RGB', (300, 300), YEL)
    dr = ImageDraw.Draw(im)
    trefoil(dr, 150, 150, 20, MAG)
    save(im, 'sign_trefoil_small.png')
    im = Image.new('RGB', (400, 200), (196, 22, 28))
    dr = ImageDraw.Draw(im)
    centered(dr, 40, 'SHARPS', F('k', 70), (255, 255, 255), 400)
    centered(dr, 130, 'Biohazard', F('s', 36), (255, 220, 220), 400)
    save(im, 'sign_sharps.png')
    im = Image.new('RGB', (400, 300), (181, 28, 28))
    dr = ImageDraw.Draw(im)
    centered(dr, 100, 'BIOHAZARD', F('k', 60), (255, 255, 255), 400)
    save(im, 'sign_biohazard.png')
    im = Image.new('RGB', (300, 400), (200, 20, 30))
    dr = ImageDraw.Draw(im)
    centered(dr, 160, 'FIRE', F('k', 70), (255, 255, 255), 300)
    centered(dr, 240, 'EXTINGUISHER', F('b', 30), (255, 255, 255), 300)
    save(im, 'sign_fire.png')
    im = Image.new('RGB', (600, 240), (250, 250, 248))
    dr = ImageDraw.Draw(im)
    dr.rectangle([0, 0, 600, 70], fill=(31, 95, 158))
    dr.text((20, 12), 'SURVEY METER', font=F('b', 40), fill=(255, 255, 255))
    dr.text((20, 92), 'Take it into the room in any', font=F('m', 32), fill=(30, 30, 30))
    dr.text((20, 136), 'emergency. Switch ON first.', font=F('m', 32), fill=(30, 30, 30))
    dr.text((20, 186), 'Daily check: ____  Battery: OK', font=F('r', 28), fill=(90, 90, 90))
    save(im, 'sign_meter_label.png')
    im = Image.new('RGB', (600, 800), (255, 255, 255))
    dr = ImageDraw.Draw(im)
    dr.rectangle([0, 0, 600, 100], fill=(36, 48, 60))
    dr.text((24, 22), 'EMERGENCY CONTACTS', font=F('b', 44), fill=(255, 255, 255))
    rows = [('Radiation Safety Officer', 'x4417'), ('Physicist on call', 'x5520'), ('Authorized user (MD)', 'x5531'),
            ('Rad Onc front desk', 'x5500'), ('Security', 'x2222'), ('Rapid response', 'x7777'),
            ('Vendor service 24/7', '1-800-555-0142')]
    for i, (a, b) in enumerate(rows):
        y = 140 + i * 90
        dr.text((24, y), a, font=F('m', 34), fill=(30, 30, 30))
        dr.text((24, y + 40), b, font=F('b', 34), fill=(178, 20, 30))
        dr.line([24, y + 84, 576, y + 84], fill=(220, 220, 220), width=2)
    save(im, 'sign_phone_list.png')
    # console control panel face
    im = Image.new('RGB', (1000, 500), (58, 63, 69))
    dr = ImageDraw.Draw(im)
    dr.rounded_rectangle([10, 10, 990, 490], 24, outline=(100, 106, 112), width=4)
    labels = [(110, 'KEY'), (300, 'START'), (500, 'INTERRUPT'), (780, 'EMERGENCY STOP')]
    for x, t in labels:
        centered(dr, 400, t, F('b', 34), (235, 235, 235), 300, x - 150)
    dr.text((40, 30), 'TREATMENT CONTROL', font=F('s', 30), fill=(170, 176, 182))
    dr.text((650, 30), 'DOOR', font=F('s', 26), fill=(170, 176, 182))
    dr.text((800, 30), 'SOURCE', font=F('s', 26), fill=(170, 176, 182))
    save(im, 'sign_panel_console.png')
    im = Image.new('RGB', (300, 120), (60, 60, 60))
    save(im, 'sign_keyswitch.png')
    # whiteboard
    im = Image.new('RGB', (1200, 800), (247, 248, 248))
    dr = ImageDraw.Draw(im)
    blue, red, black = (20, 60, 160), (180, 20, 30), (30, 30, 30)
    dr.text((50, 40), 'HDR  -  Mon', font=F('b', 64), fill=blue)
    sched = [('08:00', 'Daily QA  ✓  (source pos, timer, interlocks, ARM)', black),
             ('08:40', 'Pt 1  GYN cyl  Fx 3/3   7 Gy @ 5 mm', black),
             ('09:30', 'Pt 2  GYN cyl  Fx 1/3', black),
             ('11:00', 'T&R insertion - OR 4', black),
             ('', 'Source exchange Thurs  - vendor 07:00', red),
             ('', 'Emergency kit checked  ✓  forceps, cutters, container', blue)]
    for i, (t, s, c) in enumerate(sched):
        dr.text((60, 160 + i * 95), t, font=F('s', 44), fill=c)
        dr.text((230, 160 + i * 95), s, font=F('m', 44), fill=c)
    dr.rectangle([0, 0, 1199, 799], outline=(170, 175, 180), width=14)
    save(im, 'sign_whiteboard.jpg')
    # lit sign (RADIATION ON) - emissive map is the same image
    im = Image.new('RGB', (900, 240), (25, 4, 4))
    dr = ImageDraw.Draw(im)
    centered(dr, 50, 'RADIATION ON', F('k', 130), (255, 60, 50), 900)
    save(im, 'sign_radiation_on.png')
    im = Image.new('RGB', (900, 240), (40, 40, 40))
    save(im, 'sign_rad_on_label.png')
    # clock face
    S = 512
    im = Image.new('RGB', (S, S), (255, 255, 255))
    dr = ImageDraw.Draw(im)
    for i in range(60):
        a = math.radians(i * 6)
        r0 = S * 0.43 if i % 5 else S * 0.39
        w = 3 if i % 5 else 9
        dr.line([S / 2 + r0 * math.sin(a), S / 2 - r0 * math.cos(a), S / 2 + S * 0.47 * math.sin(a), S / 2 - S * 0.47 * math.cos(a)], fill=(20, 20, 20), width=w)
    for h in range(1, 13):
        a = math.radians(h * 30)
        t = str(h)
        f = F('m', 44)
        w = dr.textlength(t, font=f)
        dr.text((S / 2 + S * 0.32 * math.sin(a) - w / 2, S / 2 - S * 0.32 * math.cos(a) - 28), t, font=f, fill=(20, 20, 20))
    save(im, 'clock_face.png')

    # average albedo (linear) for the bake
    for f in glob.glob(OUT + '/sign_*') + glob.glob(OUT + '/clock_face.png'):
        k = os.path.basename(f).split('.')[0]
        a = np.asarray(Image.open(f).convert('RGB')).astype(float) / 255
        lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4).mean((0, 1))
        albedo[k] = [float(x) for x in lin] + [1.0]
    json.dump(albedo, open(OUT + '/../decal_albedo.json', 'w'))


if __name__ == '__main__':
    gen_signs()
    gen_vinyl()
    gen_paint()
    gen_speckle()
    gen_acg()
    print(sorted(os.listdir(OUT)))
