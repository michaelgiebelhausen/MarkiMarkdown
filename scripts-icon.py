"""Generates the MarkiMarkdown icon: the two panes of the editor, side by side."""
import zlib, struct, io, math

S = 512

def blend(dst, src, a):
    return tuple(int(round(d + (s - d) * a)) for d, s in zip(dst, src))

BG_OUT = (252, 252, 251)      # page white, matches the app
CARD   = (31, 31, 30)         # ink
LEFT   = (139, 139, 134)      # muted: the code side
RIGHT  = (47, 111, 237)       # accent: the clean side
PAPER  = (252, 252, 251)

def rounded(x, y, w, h, r, px, py):
    """Signed coverage of a rounded rect at a point, 0..1, antialiased."""
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    d = math.hypot(px - cx, py - cy)
    if px < x - 1 or px > x + w + 1 or py < y - 1 or py > y + h + 1:
        return 0.0
    return max(0.0, min(1.0, r - d + 0.5)) if (px < x + r or px > x + w - r or py < y + r or py > y + h - r) else 1.0

rows = []
M = 34                       # outer margin
CARD_R = 96
GAP = 10
inner = S - 2 * M
half = (inner - GAP) / 2

for y in range(S):
    row = bytearray()
    row.append(0)  # PNG filter: none
    for x in range(S):
        px, py = x + 0.5, y + 0.5
        col = BG_OUT
        a_card = rounded(M, M, inner, inner, CARD_R, px, py)
        if a_card <= 0:
            row += bytes((0, 0, 0, 0))
            continue
        col = CARD

        # two pages inside the card
        pad = 46
        top = M + pad
        ph = inner - 2 * pad
        lx = M + pad
        rx = M + pad + half - 12 + GAP
        pw = half - 34

        for i, (ox, tint) in enumerate(((lx, PAPER), (rx, PAPER))):
            a_page = rounded(ox, top, pw, ph, 18, px, py)
            if a_page > 0:
                col = blend(col, tint, a_page)

        # text lines: short ticks on the left (code), full bars on the right (clean text)
        line_h = 15
        step = 42
        for n in range(4):
            ly = top + 34 + n * step
            # left: a marker plus a shorter line
            mk_w = 20
            a = rounded(lx + 22, ly, mk_w, line_h, 6, px, py)
            if a > 0:
                col = blend(col, LEFT, a)
            a = rounded(lx + 22 + mk_w + 10, ly, pw - 84 - (14 if n % 2 else 0), line_h, 6, px, py)
            if a > 0:
                col = blend(col, LEFT, a * 0.55)
            # right: one solid bar, the first one accented like a heading
            tone = RIGHT if n == 0 else LEFT
            strength = 1.0 if n == 0 else 0.5
            w = pw - 44 - (26 if n == 3 else 0)
            a = rounded(rx + 22, ly, w, line_h + (5 if n == 0 else 0), 6, px, py)
            if a > 0:
                col = blend(col, tone, a * strength)

        alpha = int(round(255 * a_card))
        row += bytes((col[0], col[1], col[2], alpha))
    rows.append(bytes(row))

raw = b''.join(rows)

def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', S, S, 8, 6, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(raw, 9))
       + chunk(b'IEND', b''))

open('build/icon.png', 'wb').write(png)

# ICO wrapping a PNG (supported since Vista); 0 in the size field means 256
ico = struct.pack('<HHH', 0, 1, 1)
ico += struct.pack('<BBBBHHII', 0, 0, 0, 0, 1, 32, len(png), 22)
ico += png
open('build/icon.ico', 'wb').write(ico)
print('icon.png', len(png), 'bytes; icon.ico', len(ico), 'bytes')
