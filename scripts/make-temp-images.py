#!/usr/bin/env python3
"""Builds the interim TEMP-* source images from the old site's assets (photo-direction.md rows 6, 16, 17).
Run once: python3 scripts/make-temp-images.py <old-site-assets-dir>. Outputs land in src/assets/temp/.
astro:assets then produces the AVIF/WebP widths that actually ship."""
import sys, os
from PIL import Image, ImageFilter
src = sys.argv[1].rstrip('/') + '/'
out = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'temp')
def load(name): return Image.open(src + name).convert('RGB')
def save(im, name, q=90):
    im.save(os.path.join(out, name), 'JPEG', quality=q, optimize=True, progressive=True)
    print(name, im.size)

hero = load('2-1920w-9f4f5dc7f9.png')                      # row 6, shoulder massage (900x1200)
# QA m-19: retouch the three lit candle / bokeh lights out of the background (OpenCV inpaint, feathered).
try:
    import cv2, numpy as np
    im = cv2.cvtColor(np.array(hero), cv2.COLOR_RGB2BGR)
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    bright = ((hsv[:, :, 2] > 200) & (hsv[:, :, 1] < 140)).astype(np.uint8) * 255
    mask = np.zeros(bright.shape, np.uint8)
    for (x, y, w, h) in [(69, 361, 55, 59), (311, 462, 62, 57), (129, 24, 42, 48), (0, 487, 4, 47)]:   # the lights (+ one at the left edge)
        y0, y1, x0, x1 = max(0, y - 30), y + h + 30, max(0, x - 30), x + w + 30
        mask[y0:y1, x0:x1] = np.maximum(mask[y0:y1, x0:x1], bright[y0:y1, x0:x1])
    mask = cv2.dilate(mask, np.ones((21, 21), np.uint8))
    fixed = cv2.inpaint(im, mask, 25, cv2.INPAINT_TELEA)
    m = cv2.GaussianBlur(mask.astype(np.float32) / 255, (0, 0), 8)[..., None]
    fixed = (fixed * (1 - m) + cv2.GaussianBlur(fixed, (0, 0), 9) * m).astype(np.uint8)
    hero = Image.fromarray(cv2.cvtColor(fixed, cv2.COLOR_BGR2RGB))
except ImportError:
    print('opencv not installed: hero not retouched')
# QA M4: native size only, never upscaled. Desktop uses the whole 900x1200 frame (the stage caps the photo at 900px);
# mobile/portrait uses a 4:5 crop of hands and face (the therapist's face is out of frame).
save(hero, 'TEMP-hero-desktop.jpg', q=92)
save(hero.crop((60, 300, 780, 1200)), 'TEMP-hero-4x5.jpg', q=92)

back = load('Untitled-design---2026-01-10T014904-235-1920w-4269f80efb.png')   # row 17, deep tissue (1200x900)
save(back.crop((330, 0, 1050, 900)), 'TEMP-lymphatic-4x5.jpg')
save(back.crop((0, 110, 560, 810)), 'TEMP-hands-4x5.jpg')    # hands only, no face (Katy placeholder)

sport = load('Untitled-design---2026-01-10T015021-308-1920w-3882fb282b.png')  # row 17, sports (1200x900)
save(sport.crop((150, 0, 1050, 900)), 'TEMP-massage-1x1.jpg')

# Review #3: the row-16 clay-mask crop showed a client's face. Facials now use a faceless treatment-room still:
room = load('Untitled-design---2026-01-09T224452-703-1920w-c8333bd7e8.png')   # towels on a made bed (1200x900)
save(room.crop((480, 170, 1200, 890)), 'TEMP-facial-room-1x1.jpg')   # towels and flowers only; lit candles cropped out

wrap = load('Untitled-design---2026-01-10T045645-189-1920w-0041f92c3b.png')  # row 22, detox wrap (1200x900) — Wrap Me Up (dev B)
save(wrap.crop((160, 330, 880, 870)), 'TEMP-wrap-4x3.jpg')   # upper back in the wrap only: no face, no hips
