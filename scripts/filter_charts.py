#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Screen the gallery for plain plots (line / bar / scatter / heatmap figures).

The gallery should only carry hand-drawn Figure 1 artwork: teasers, framework and
architecture diagrams. A paper whose Figure 1 is just a matplotlib chart adds no layout
value, so those entries get flagged here and removed from every index.

How it decides
--------------
1. Semantic signal (primary): every published figure already has a CLIP ViT-B/32 image
   embedding (``forge/data/image_emb.bin``). ``scripts/chart_prompts.json`` freezes the
   text vectors for five "plain plot" prompts and four "hand-drawn paper figure" prompts,
   so the margin ``max(sim_chart) - max(sim_figure)`` can be computed without a browser.
2. Visual signal (secondary, needs Pillow): plots are mostly white, are drawn with thin
   strokes, and contain at least one straight axis/gridline spanning a large part of the
   canvas. Named paper figures are built from filled boxes, arrows, photos and icons.

Decision bands
--------------
    margin >= 0.045  -> flag   (removed after eyeballing a contact sheet)
    0.030 .. 0.045   -> review (needs a look; mixed schematics with a small inset plot)
    below 0.030      -> keep

Usage
-----
    python scripts/filter_charts.py                       # summary + top candidates
    python scripts/filter_charts.py --json report.json    # full per-figure report
    python scripts/filter_charts.py --sheet 20 sheet.png  # contact sheet for review
    python scripts/filter_charts.py --band 0.030 0.045    # list the review band
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROMPTS = ROOT / "scripts" / "chart_prompts.json"
IDS = ROOT / "forge" / "data" / "ids.json"
EMB = ROOT / "forge" / "data" / "image_emb.bin"
FIGURES = ROOT / "data" / "figures.json"
DIM = 512
FLAG = 0.045
REVIEW = 0.030


def load_vectors():
    data = json.loads(PROMPTS.read_text(encoding="utf-8"))
    return data["charts"], data["figures"]


def cosine_rows(matrix, rows, vec):
    """matrix: flat row-major list/array; returns best cosine of each row against vec."""
    size = len(vec)
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [(sum(matrix[r * size + j] * vec[j] for j in range(size)) / norm) for r in rows]


def visual_features(path):
    """(white fraction, thick-stroke fraction, longest straight line fraction)."""
    try:
        import numpy as np
        from PIL import Image
    except ImportError:                                    # optional signal
        return None
    try:
        im = Image.open(path).convert("RGB")
    except OSError:
        return None
    w, h = im.size
    scale = min(1.0, 600.0 / max(w, h))
    if scale < 1.0:
        im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.BILINEAR)
    a = np.asarray(im).astype(np.int16)
    mx, mn = a.max(axis=2), a.min(axis=2)
    ink = (mx < 238) | ((mx - mn) > 28)
    if not ink.any():
        return (1.0, 0.0, 0.0)
    white = 1.0 - float(ink.mean())
    core = ink[1:-1, 1:-1] & ink[:-2, 1:-1] & ink[2:, 1:-1] & ink[1:-1, :-2] & ink[1:-1, 2:]
    thick = float(core.sum()) / float(ink.sum())
    H, W = ink.shape

    def longest(line):
        if not line.any():
            return 0
        idx = np.flatnonzero(np.diff(np.concatenate(([0], line.view(np.int8), [0]))))
        return int((idx[1::2] - idx[0::2]).max()) if len(idx) else 0

    rows = max((longest(ink[y]) for y in range(0, H, 2)), default=0) / W
    cols = max((longest(ink[:, x]) for x in range(0, W, 2)), default=0) / H
    return (white, thick, max(rows, cols))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", help="write the full report here")
    ap.add_argument("--sheet", nargs=2, metavar=("N", "OUT"), help="contact sheet of the top N candidates")
    ap.add_argument("--band", nargs=2, type=float, metavar=("LO", "HI"), help="list candidates inside a margin band")
    ap.add_argument("--no-visual", action="store_true", help="skip the Pillow-based visual signal")
    args = ap.parse_args()

    charts, figures = load_vectors()
    ids = json.loads(IDS.read_text(encoding="utf-8"))
    raw = EMB.read_bytes()
    matrix = memoryview(raw).cast("f") if hasattr(memoryview(raw), "cast") else None
    if matrix is None:
        raise SystemExit("the running Python cannot view the embedding file as float32")
    rows = range(len(ids))

    chart_sim = [max(vals) for vals in zip(*[cosine_rows(matrix, rows, v) for v in charts])]
    figure_sim = [max(vals) for vals in zip(*[cosine_rows(matrix, rows, v) for v in figures])]
    meta = {f["id"]: f for f in json.loads(FIGURES.read_text(encoding="utf-8"))}

    report = []
    for i, fid in enumerate(ids):
        m = chart_sim[i] - figure_sim[i]
        entry = {"id": fid, "margin": round(m, 4), "chart": round(chart_sim[i], 4), "figure": round(figure_sim[i], 4)}
        fig = meta.get(fid)
        if fig:
            entry["pattern"] = fig["pattern"]
            entry["title"] = fig["title"]
        if not args.no_visual and fig:
            feat = visual_features(ROOT / fig["image"])
            if feat:
                white, thick, line = feat
                entry.update(white=round(white, 3), thick=round(thick, 3), line=round(line, 3))
                entry["visual"] = round(
                    min(1.0, max(0.0, (line - 0.35) / 0.35))
                    + 0.5 * min(1.0, max(0.0, (white - 0.5) / 0.3))
                    + 0.5 * max(0.0, 1.0 - thick / 0.3), 3)
                entry["combined"] = round(m + 0.06 * entry["visual"], 4)
        report.append(entry)

    report.sort(key=lambda r: -r.get("combined", r["margin"]))
    if args.json:
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"report -> {args.json}")

    flagged = [r for r in report if r["margin"] >= FLAG]
    review = [r for r in report if REVIEW <= r["margin"] < FLAG]
    print(f"figures scored: {len(report)}")
    print(f"  margin >= {FLAG}: {len(flagged)} (remove)")
    print(f"  {REVIEW} .. {FLAG}: {len(review)} (review a contact sheet)")
    print(f"  below {REVIEW}: {len(report) - len(flagged) - len(review)} (keep)")

    if args.band:
        lo, hi = args.band
        for r in report:
            if lo <= r["margin"] < hi:
                print(f'  {r["margin"]:.3f} {r["id"]:24s} {r.get("pattern","?"):12s} {r.get("title","")[:60]}')
    elif not args.sheet:
        print("\ntop candidates:")
        for r in report[:30]:
            print(f'  m={r["margin"]:.3f} k={r.get("combined", 0):.3f} L{r.get("line", 0):.2f} '
                  f'{r["id"]:24s} {r.get("pattern","?"):12s} {r.get("title","")[:52]}')

    if args.sheet:
        n, out = int(args.sheet[0]), args.sheet[1]
        try:
            from PIL import Image, ImageDraw, ImageFont
        except ImportError:
            raise SystemExit("Pillow is required for --sheet")
        cols, tw, th, lab = 5, 380, 190, 34
        sel = report[:n]
        sheet = Image.new("RGB", (cols * tw, ((n + cols - 1) // cols) * (th + lab)), (255, 255, 255))
        d = ImageDraw.Draw(sheet)
        font = ImageFont.load_default()
        for i, r in enumerate(sel):
            fig = meta.get(r["id"])
            if not fig:
                continue
            x, y = (i % cols) * tw, (i // cols) * (th + lab)
            im = Image.open(ROOT / fig["image"]).convert("RGB")
            s = min((tw - 8) / im.width, th / im.height)
            im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
            sheet.paste(im, (x + (tw - im.width) // 2, y + (th - im.height) // 2))
            d.rectangle([x, y, x + tw - 1, y + th + lab - 1], outline=(205, 210, 222))
            d.text((x + 6, y + th + 6), f'#{i+1} m={r["margin"]:.3f} k={r.get("combined",0):.3f} L{r.get("line",0):.2f}', fill=(20, 20, 30), font=font)
            d.text((x + 6, y + th + 20), f'{r["id"]} {fig["pattern"]}', fill=(80, 85, 100), font=font)
        sheet.save(out)
        print(f"sheet -> {out} ({len(sel)} candidates)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
