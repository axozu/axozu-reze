"""Предрасчёт оптического потока между кадрами глаз для плавного моргания.

Запуск (нужно только если поменялись кадры в assets/):
    pip install opencv-python numpy
    python tools/make_eye_flow.py

Считает плотный оптический поток (DIS) в зоне глаз для пар
open→half, half→open, half→closed, closed→half и сохраняет их в
assets/flow_<пара>.png. В рантайме шейдер по этим полям «тянет» веко:
кадр A сэмплируется со сдвигом t·F(A→B), кадр B — со сдвигом (1−t)·F(B→A),
и они смешиваются. Получается движение, а не наплыв одного кадра на другой.

Формат PNG: R = смещение по X, G = по Y, в пикселях кадра 2252×1544,
значение = 128 + смещение (диапазон ±127 px). B не используется.
Поле покрывает прямоугольник CROP (см. ниже и FLOW_RECT в renderer.js).
"""
import os
import cv2
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
CROP = (470, 220, 1760, 760)   # x0, y0, x1, y1 — должен совпадать с FLOW_RECT в renderer.js
SCALE = 0.5                    # поток считается на половинном разрешении
BLUR = 6.0                     # сглаживание поля (px половинного разрешения)


def load(name, gray=False):
    x0, y0, x1, y1 = CROP
    im = cv2.imread(os.path.join(ROOT, name), cv2.IMREAD_GRAYSCALE if gray else cv2.IMREAD_COLOR)
    im = im[y0:y1, x0:x1]
    return cv2.resize(im, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_AREA)


def flow(a, b, mask):
    g1 = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)
    g2 = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    dis.setFinestScale(0)
    dis.setPatchSize(12)
    dis.setPatchStride(4)
    dis.setVariationalRefinementAlpha(40)
    dis.setVariationalRefinementIterations(10)
    f = dis.calc(g1, g2, None)
    f = cv2.GaussianBlur(f, (0, 0), BLUR)
    return f * mask[..., None]


def save(name, f):
    f = f / SCALE  # -> пиксели полного кадра
    enc = np.clip(np.round(f + 128), 0, 255).astype(np.uint8)
    rgb = np.dstack([enc[..., 0], enc[..., 1], np.full(enc.shape[:2], 128, np.uint8)])
    cv2.imwrite(os.path.join(ROOT, name), cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
    print(f'{name}: max |dx|={np.abs(f[..., 0]).max():.1f}px |dy|={np.abs(f[..., 1]).max():.1f}px')


def main():
    o, h, c = load('open.jpg'), load('half.jpg'), load('closed.jpg')
    mask = load('eye_mask.png', gray=True).astype(np.float32) / 255.0
    save('flow_open_half.png', flow(o, h, mask))
    save('flow_half_open.png', flow(h, o, mask))
    save('flow_half_closed.png', flow(h, c, mask))
    save('flow_closed_half.png', flow(c, h, mask))


if __name__ == '__main__':
    main()
