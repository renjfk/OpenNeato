"""Cleaning-session map renderer — converts JSONL pose data to a PNG image.

Algorithm ported from:
  - frontend/src/history-data.ts  (JSONL parsing, coverage grid, bounds)
  - frontend/src/views/history/helpers.ts  (canvas rendering)

Rendering order (bottom to top):
  1. Dark background
  2. Grid lines (0.5 m spacing)
  3. Coverage cells (semi-transparent green)
  4. Path line (amber/gold)
  5. Start marker (green dot)
  6. End marker (red dot)
  7. Recharge bolt icons (gold with dark outline)
"""

from __future__ import annotations

import io
import json
import math
import re
from typing import Any

from PIL import Image, ImageDraw

from .const import (
    HISTORY_BG_COLOR,
    HISTORY_CELL_SIZE_M,
    HISTORY_COVERAGE_COLOR,
    HISTORY_END_COLOR,
    HISTORY_GRID_COLOR,
    HISTORY_GRID_STEP_M,
    HISTORY_IMAGE_SIZE,
    HISTORY_PAD_PX,
    HISTORY_PATH_COLOR,
    HISTORY_RECHARGE_COLOR,
    HISTORY_ROBOT_DIAMETER_M,
    HISTORY_START_COLOR,
    MOTION_FRAMES,
    MOTION_MAX_PATH_POINTS,
    MOTION_TAIL_FRAMES,
    MOTION_TOTAL_MS,
)


# ── JSONL parsing (ported from history-data.ts) ─────────────────────

# Heatshrink decompression can corrupt bytes in numeric tokens.
# Match the structural skeleton permissively so we can repair numbers.
_POSE_RE = re.compile(
    r'^\{.x.:\s*(-?[\d.eE:"\w-]+)\s*,.y.:\s*(-?[\d.eE:"\w-]+)'
    r'\s*,.t.:\s*([\d.eE:"\w-]+)\s*,.ts.:\s*([\d.eE:"\w-]+)\s*\}$'
)


def _repair_number(raw: str) -> float | None:
    """Replace non-numeric garbage with dots, collapse, parse."""
    cleaned = re.sub(r"[^0-9.eE-]", ".", raw)
    parts = cleaned.split(".")
    if len(parts) > 2:
        cleaned = parts[0] + "." + "".join(parts[1:])
    try:
        n = float(cleaned)
        return n if math.isfinite(n) else None
    except ValueError:
        return None


def _try_repair_pose(line: str) -> dict[str, float] | None:
    """Attempt regex-based recovery of a corrupted pose line."""
    m = _POSE_RE.match(line)
    if not m:
        return None
    vals = [_repair_number(m.group(i)) for i in range(1, 5)]
    if any(v is None for v in vals):
        return None
    return {"x": vals[0], "y": vals[1], "t": vals[2], "ts": vals[3]}


def parse_session_jsonl(raw: str) -> dict[str, Any]:
    """Parse raw JSONL text into structured session data.

    Returns dict with keys: session, summary, path, coverage, recharges, bounds.
    """
    lines = [l for l in raw.strip().split("\n") if l.strip()]

    session: dict | None = None
    summary: dict | None = None
    poses: list[dict[str, float]] = []
    recharges: list[tuple[float, float]] = []

    for line in lines:
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            repaired = _try_repair_pose(line)
            if repaired:
                poses.append(repaired)
            continue

        obj_type = obj.get("type")
        if obj_type == "session":
            session = obj
        elif obj_type == "summary":
            summary = obj
        elif obj_type == "recharge":
            recharges.append((obj.get("x", 0), obj.get("y", 0)))
        elif "x" in obj and "y" in obj and "type" not in obj:
            # Pose point — skip origin (all zeros)
            if obj.get("x") != 0 or obj.get("y") != 0 or obj.get("t") != 0:
                poses.append(obj)

    if not poses:
        return {
            "session": session, "summary": summary,
            "path": [], "coverage": [], "recharges": recharges, "bounds": None,
        }

    # Build coverage grid — stamp robot footprint at each pose and record
    # the earliest ts at which each cell was touched so the animated
    # replay reveals coverage progressively instead of popping in on
    # frame 1. Ported from frontend/src/history-data.ts.
    cell_size = HISTORY_CELL_SIZE_M
    radius_cells = math.ceil(HISTORY_ROBOT_DIAMETER_M / 2 / cell_size)
    first_cover_ts: dict[tuple[int, int], float] = {}

    for p in poses:
        cx = round(p["x"] / cell_size)
        cy = round(p["y"] / cell_size)
        ts = float(p.get("ts", 0))
        for dx in range(-radius_cells, radius_cells + 1):
            for dy in range(-radius_cells, radius_cells + 1):
                if dx * dx + dy * dy <= radius_cells * radius_cells:
                    key = (cx + dx, cy + dy)
                    if key not in first_cover_ts:
                        first_cover_ts[key] = ts

    # Bounding box padded by robot radius
    pad = HISTORY_ROBOT_DIAMETER_M / 2 + 0.1
    xs = [p["x"] for p in poses]
    ys = [p["y"] for p in poses]
    bounds = {
        "minX": min(xs) - pad,
        "maxX": max(xs) + pad,
        "minY": min(ys) - pad,
        "maxY": max(ys) + pad,
    }

    return {
        "session": session,
        "summary": summary,
        "path": poses,
        "coverage": [(c[0], c[1], ts) for c, ts in first_cover_ts.items()],
        "recharges": recharges,
        "bounds": bounds,
    }


# ── Map rendering (ported from helpers.ts::renderMap) ────────────────


def _session_bounds(bounds: dict[str, float], image_size: int):
    """Compute viewport transform from world coords to pixels.

    Returned tuple: (to_x, to_y, min_x, max_x, min_y, max_y, scale).
    Bounds are always taken from the *full* session so the viewport
    stays steady across animated frames rather than zooming in as the
    path grows.
    """
    min_x, max_x = bounds["minX"], bounds["maxX"]
    min_y, max_y = bounds["minY"], bounds["maxY"]
    world_w = max_x - min_x
    world_h = max_y - min_y
    if world_w <= 0 or world_h <= 0:
        return None
    pad = HISTORY_PAD_PX
    avail_w = image_size - pad * 2
    avail_h = image_size - pad * 2
    scale = min(avail_w / world_w, avail_h / world_h)
    rendered_w = world_w * scale
    rendered_h = world_h * scale
    off_x = pad + (avail_w - rendered_w) / 2
    off_y = pad + (avail_h - rendered_h) / 2

    def to_x(x: float) -> float:
        return off_x + (x - min_x) * scale

    def to_y(y: float) -> float:
        return off_y + (max_y - y) * scale  # Y is inverted

    return to_x, to_y, min_x, max_x, min_y, max_y, scale


def _render_frame(
    data: dict[str, Any],
    image_size: int,
    recording: bool,
    upto_time: float | None,
) -> Image.Image | None:
    """Render a single frame as a PIL RGB image.

    When upto_time is set, only path points, coverage cells and
    recharges with ts <= upto_time are drawn, and the end marker is
    pinned to the most recent visible pose (styled as the recording
    cursor so the viewer sees the robot mid-run). Bounds are always the
    full-session bounds so the viewport doesn't jitter.
    """
    bounds = data.get("bounds")
    full_path = data.get("path", [])
    if not bounds or not full_path:
        return None

    transform = _session_bounds(bounds, image_size)
    if transform is None:
        return None
    to_x, to_y, min_x, max_x, min_y, max_y, scale = transform

    img = Image.new("RGBA", (image_size, image_size), HISTORY_BG_COLOR + (255,))
    draw = ImageDraw.Draw(img)

    # ── Grid lines ───────────────────────────────────────────────────
    grid_step = HISTORY_GRID_STEP_M
    grid_min_x = math.floor(min_x / grid_step) * grid_step
    grid_min_y = math.floor(min_y / grid_step) * grid_step

    gx = grid_min_x
    while gx <= max_x:
        x_px = to_x(gx)
        draw.line([(x_px, to_y(min_y)), (x_px, to_y(max_y))], fill=HISTORY_GRID_COLOR, width=1)
        gx += grid_step

    gy = grid_min_y
    while gy <= max_y:
        y_px = to_y(gy)
        draw.line([(to_x(min_x), y_px), (to_x(max_x), y_px)], fill=HISTORY_GRID_COLOR, width=1)
        gy += grid_step

    # ── Time-filter the session data ─────────────────────────────────
    if upto_time is None:
        path = full_path
        coverage = data.get("coverage", [])
        recharges = data.get("recharges", [])
    else:
        path = [p for p in full_path if p.get("ts", 0) <= upto_time]
        coverage = [c for c in data.get("coverage", []) if len(c) < 3 or c[2] <= upto_time]
        recharges = [r for r in data.get("recharges", []) if _recharge_ts(r) <= upto_time]

    # ── Coverage cells ───────────────────────────────────────────────
    cell_size = HISTORY_CELL_SIZE_M
    cell_px = cell_size * scale
    for cell in coverage:
        cx, cy = cell[0], cell[1]
        wx = cx * cell_size
        wy = cy * cell_size
        x0 = to_x(wx) - cell_px / 2
        y0 = to_y(wy) - cell_px / 2
        draw.rectangle([x0, y0, x0 + cell_px, y0 + cell_px], fill=HISTORY_COVERAGE_COLOR)

    # ── Path line ────────────────────────────────────────────────────
    if len(path) > 1:
        coords = [(to_x(p["x"]), to_y(p["y"])) for p in path]
        draw.line(coords, fill=HISTORY_PATH_COLOR, width=2, joint="curve")

    # ── Start marker (green dot) ─────────────────────────────────────
    if path:
        sx, sy = to_x(path[0]["x"]), to_y(path[0]["y"])
        r = 5
        draw.ellipse([sx - r, sy - r, sx + r, sy + r], fill=HISTORY_START_COLOR)

    # ── End / cursor marker ──────────────────────────────────────────
    # During animation (upto_time set and not yet complete) we show the
    # robot's current position as a green ring to cue "playing"; once
    # the whole session is drawn we switch to the final end style.
    complete = upto_time is None or (full_path and upto_time >= full_path[-1].get("ts", 0))
    if len(path) > 1:
        ex, ey = to_x(path[-1]["x"]), to_y(path[-1]["y"])
        if recording or not complete:
            r = 6
            draw.ellipse(
                [ex - r, ey - r, ex + r, ey + r],
                outline=HISTORY_START_COLOR, width=3,
            )
        else:
            r = 5
            draw.ellipse([ex - r, ey - r, ex + r, ey + r], fill=HISTORY_END_COLOR)

    # ── Recharge bolt icons ──────────────────────────────────────────
    for recharge in recharges:
        rx_world, ry_world = _recharge_xy(recharge)
        rx, ry = to_x(rx_world), to_y(ry_world)
        s = 10
        bolt = [
            (rx + s * 0.15, ry - s),
            (rx - s * 0.55, ry + s * 0.05),
            (rx - s * 0.05, ry + s * 0.05),
            (rx - s * 0.15, ry + s),
            (rx + s * 0.55, ry - s * 0.05),
            (rx + s * 0.05, ry - s * 0.05),
        ]
        draw.polygon(bolt, fill=HISTORY_RECHARGE_COLOR + (255,), outline=(0, 0, 0, 128))

    # Flatten alpha onto the dark background for stable encoding.
    rgb_img = Image.new("RGB", img.size, HISTORY_BG_COLOR)
    rgb_img.paste(img, mask=img.split()[3])
    return rgb_img


def _recharge_xy(recharge: Any) -> tuple[float, float]:
    """Return (x, y) for a recharge point, supporting dict or tuple inputs."""
    if isinstance(recharge, dict):
        return recharge.get("x", 0), recharge.get("y", 0)
    return recharge[0], recharge[1]


def _recharge_ts(recharge: Any) -> float:
    """Return the ts for a recharge point; tuples from the Python parser
    don't carry ts, so fall back to 0 (drawn from the first frame)."""
    if isinstance(recharge, dict):
        return float(recharge.get("ts", 0))
    return 0.0


def render_history_map(
    data: dict[str, Any],
    image_size: int = HISTORY_IMAGE_SIZE,
    recording: bool = False,
) -> bytes:
    """Render a cleaning session map as a PNG image. Returns PNG bytes."""
    img = _render_frame(data, image_size, recording, upto_time=None)
    if img is None:
        from .lidar_renderer import render_idle_image
        return render_idle_image(image_size)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _downsample_path(path: list[dict], max_points: int) -> list[dict]:
    """Stride-sample a pose list, keeping first and last so start/end markers
    still sit on real data. Returns the original when under the cap."""
    n = len(path)
    if n <= max_points or max_points < 2:
        return path
    step = n / max_points
    indices = {int(i * step) for i in range(max_points)}
    indices.add(0)
    indices.add(n - 1)
    return [path[i] for i in sorted(indices)]


def render_history_animation(
    data: dict[str, Any],
    image_size: int = HISTORY_IMAGE_SIZE,
    frames: int = MOTION_FRAMES,
    total_ms: int = MOTION_TOTAL_MS,
    tail_frames: int = MOTION_TAIL_FRAMES,
    max_path_points: int = MOTION_MAX_PATH_POINTS,
) -> bytes | None:
    """Render a time-lapse replay of a cleaning session as an animated GIF.

    Plays once (loop=1) then holds on the fully-drawn map: `tail_frames`
    of the total `frames` stay on the completed state so the dashboard
    settles instead of spinning forever. Long sessions are path-
    downsampled to `max_path_points` before rendering to cap encoder
    cost at a few hundred ms regardless of cleaning duration.

    Returns None when there isn't enough data to animate (caller should
    fall back to the static map).
    """
    path = data.get("path", [])
    if not path or frames <= 0:
        return None
    duration = path[-1].get("ts", 0) - path[0].get("ts", 0)
    if duration <= 0:
        return None

    # Subsample globally so per-frame filtering + drawing both shrink.
    # Bounds / coverage stay on the full data so the viewport and fill
    # still reflect the real session.
    sampled_path = _downsample_path(path, max_path_points)
    frame_data = dict(data)
    frame_data["path"] = sampled_path

    anim_frames = max(1, frames - tail_frames)
    per_frame_ms = max(20, total_ms // frames)
    images: list[Image.Image] = []
    t0 = path[0].get("ts", 0)
    for i in range(anim_frames):
        frac = (i + 1) / anim_frames
        t = t0 + duration * frac
        img = _render_frame(frame_data, image_size, recording=False, upto_time=t)
        if img is None:
            return None
        images.append(img)

    # Tail: fully-rendered final map so the dashboard lingers on completion.
    final = _render_frame(frame_data, image_size, recording=False, upto_time=None)
    if final is None:
        return None
    for _ in range(tail_frames):
        images.append(final)

    # Quantize once against the fully-drawn final frame so every frame
    # shares one palette (no per-frame palette overhead), then let the
    # GIF encoder inter-frame delta-encode by leaving disposal at its
    # default "do not dispose" — cumulative reveal means only newly
    # drawn pixels change between frames, which the encoder can tile.
    reference = images[-1].convert("P", palette=Image.Palette.ADAPTIVE, colors=64)
    palette_frames = [im.quantize(palette=reference) for im in images]

    buf = io.BytesIO()
    palette_frames[0].save(
        buf,
        format="GIF",
        save_all=True,
        append_images=palette_frames[1:],
        duration=per_frame_ms,
        loop=1,
        optimize=True,
    )
    return buf.getvalue()
