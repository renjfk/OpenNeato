"""LIDAR scan renderer — converts 360-point scan data to a PNG image.

Algorithm ported from frontend/src/components/lidar-map.tsx:
  1. Filter invalid points (error != 0, dist == 0, dist > max)
  2. Detect contiguous wall segments with gap bridging
  3. Smooth distances within segments via moving average
  4. Draw grid rings, wall polylines, and robot indicator

This module is a pure function (no HA dependencies) so it can run in the
executor without blocking the event loop, and can be unit-tested standalone.
"""

from __future__ import annotations

import io
import math
from typing import Any

from PIL import Image, ImageDraw

from .const import (
    LIDAR_BG_COLOR,
    LIDAR_GRID_COLOR,
    LIDAR_IMAGE_SIZE,
    LIDAR_MAX_BRIDGE_GAP,
    LIDAR_MAX_DIST_JUMP_PCT,
    LIDAR_MAX_DIST_MM,
    LIDAR_MAX_RANGE_MM,
    LIDAR_MAX_SCAN_AGE,
    LIDAR_MIN_SEGMENT_LEN,
    LIDAR_ROBOT_COLOR,
    LIDAR_SMOOTH_WINDOW,
    LIDAR_WALL_COLOR,
)


class ScanAccumulator:
    """Accumulates LIDAR readings across multiple scans for denser walls.

    Each of the 360 angle slots holds the most recent valid distance and an
    age counter.  Old readings fade out after MAX_SCAN_AGE scans.
    """

    def __init__(self) -> None:
        self._dists: list[float | None] = [None] * 360
        self._ages: list[int] = [0] * 360

    def merge(self, points: list[dict[str, Any]], moving: bool) -> None:
        """Merge a new scan into the accumulator."""
        if moving:
            # Clear when the robot is moving to avoid ghost walls
            self._dists = [None] * 360
            self._ages = [0] * 360
        else:
            # Age existing points
            for i in range(360):
                if self._dists[i] is not None:
                    self._ages[i] += 1
                    if self._ages[i] > LIDAR_MAX_SCAN_AGE:
                        self._dists[i] = None

        # Overwrite with fresh readings
        for p in points:
            if p.get("error", 0) != 0:
                continue
            dist = p.get("dist", 0)
            if dist == 0 or dist > LIDAR_MAX_DIST_MM:
                continue
            angle = int(p.get("angle", 0)) % 360
            self._dists[angle] = float(dist)
            self._ages[angle] = 0

    def snapshot(self) -> list[tuple[float, int] | None]:
        """Return a copy of (dist, age) per angle, or None if empty."""
        return [
            (self._dists[i], self._ages[i]) if self._dists[i] is not None else None
            for i in range(360)
        ]


def render_lidar_scan(
    accumulated: list[tuple[float, int] | None],
    image_size: int = LIDAR_IMAGE_SIZE,
    max_range_mm: int = LIDAR_MAX_RANGE_MM,
) -> bytes:
    """Render accumulated LIDAR data as a PNG image. Returns PNG bytes.

    Parameters
    ----------
    accumulated : list of (dist_mm, age) or None, length 360
        The merged scan snapshot from ScanAccumulator.snapshot().
    image_size : int
        Output image width and height in pixels.
    max_range_mm : int
        Maximum display radius in millimetres.
    """
    img = Image.new("RGB", (image_size, image_size), LIDAR_BG_COLOR)
    draw = ImageDraw.Draw(img)

    cx = image_size / 2
    cy = image_size / 2
    padding = 8
    scale = (image_size / 2 - padding) / max_range_mm

    # ── Grid rings at 1 m intervals ──────────────────────────────────
    for r_mm in range(1000, max_range_mm + 1, 1000):
        r_px = r_mm * scale
        bbox = [cx - r_px, cy - r_px, cx + r_px, cy + r_px]
        draw.ellipse(bbox, outline=LIDAR_GRID_COLOR, width=1)

    # ── Crosshair ────────────────────────────────────────────────────
    draw.line([(cx, padding), (cx, image_size - padding)], fill=LIDAR_GRID_COLOR, width=1)
    draw.line([(padding, cy), (image_size - padding, cy)], fill=LIDAR_GRID_COLOR, width=1)

    # ── Helpers ──────────────────────────────────────────────────────
    def to_canvas(angle_deg: float, dist: float) -> tuple[float, float]:
        rad = math.radians(90 - angle_deg)
        return (cx + dist * scale * math.cos(rad), cy - dist * scale * math.sin(rad))

    def opacity(age: int) -> float:
        return 1.0 - (age / LIDAR_MAX_SCAN_AGE) * 0.7

    def same_surface(dist_a: float, dist_b: float) -> bool:
        avg = (dist_a + dist_b) / 2
        return abs(dist_a - dist_b) < avg * LIDAR_MAX_DIST_JUMP_PCT

    # ── Segment detection (walk 360 angles, bridge small gaps) ───────
    segments: list[list[tuple[int, float, int]]] = []  # (angle, dist, age)
    current: list[tuple[int, float, int]] = []

    for i in range(360):
        pt = accumulated[i]
        if pt is None:
            # Try to bridge the gap
            bridged = False
            if current:
                last_dist = current[-1][1]
                for gap in range(1, LIDAR_MAX_BRIDGE_GAP + 1):
                    nxt = accumulated[(i + gap) % 360]
                    if nxt is not None and same_surface(last_dist, nxt[0]):
                        bridged = True
                        break
            if not bridged and current:
                segments.append(current)
                current = []
            continue

        dist, age = pt
        if current and not same_surface(current[-1][1], dist):
            segments.append(current)
            current = []
        current.append((i, dist, age))

    if current:
        segments.append(current)

    # Wrap-around: merge first and last segment if they connect
    if len(segments) >= 2:
        last_seg = segments[-1]
        first_seg = segments[0]
        if (
            last_seg[-1][0] >= 355
            and first_seg[0][0] <= 4
            and same_surface(last_seg[-1][1], first_seg[0][1])
        ):
            segments[0] = last_seg + first_seg
            segments.pop()

    # ── Smooth distances within each segment ─────────────────────────
    def smooth(seg: list[tuple[int, float, int]]) -> list[tuple[int, float, int]]:
        result = []
        for i, (angle, _dist, age) in enumerate(seg):
            lo = max(0, i - LIDAR_SMOOTH_WINDOW)
            hi = min(len(seg) - 1, i + LIDAR_SMOOTH_WINDOW)
            avg_dist = sum(seg[j][1] for j in range(lo, hi + 1)) / (hi - lo + 1)
            result.append((angle, avg_dist, age))
        return result

    # ── Draw wall segments as polylines ──────────────────────────────
    for seg in segments:
        if len(seg) < LIDAR_MIN_SEGMENT_LEN:
            continue
        smoothed = smooth(seg)
        avg_age = sum(s[2] for s in seg) / len(seg)
        alpha = opacity(avg_age) * 0.7
        # PIL doesn't support per-line alpha on RGB, so blend the color
        wall_r, wall_g, wall_b = LIDAR_WALL_COLOR
        bg_r, bg_g, bg_b = LIDAR_BG_COLOR
        blended = (
            int(wall_r * alpha + bg_r * (1 - alpha)),
            int(wall_g * alpha + bg_g * (1 - alpha)),
            int(wall_b * alpha + bg_b * (1 - alpha)),
        )
        coords = [to_canvas(s[0], s[1]) for s in smoothed]
        if len(coords) >= 2:
            draw.line(coords, fill=blended, width=3, joint="curve")

    # ── Robot indicator (triangle pointing up = forward) ─────────────
    tri = [
        (cx, cy - 8),
        (cx - 5, cy + 4),
        (cx + 5, cy + 4),
    ]
    draw.polygon(tri, fill=LIDAR_ROBOT_COLOR)

    # ── Encode PNG ───────────────────────────────────────────────────
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _build_idle_image(image_size: int) -> Image.Image:
    img = Image.new("RGB", (image_size, image_size), LIDAR_BG_COLOR)
    draw = ImageDraw.Draw(img)

    cx = image_size / 2
    cy = image_size / 2
    padding = 8
    scale = (image_size / 2 - padding) / LIDAR_MAX_RANGE_MM

    # Faint grid rings
    for r_mm in range(1000, LIDAR_MAX_RANGE_MM + 1, 1000):
        r_px = r_mm * scale
        bbox = [cx - r_px, cy - r_px, cx + r_px, cy + r_px]
        draw.ellipse(bbox, outline=LIDAR_GRID_COLOR, width=1)

    # Crosshair
    draw.line([(cx, padding), (cx, image_size - padding)], fill=LIDAR_GRID_COLOR, width=1)
    draw.line([(padding, cy), (image_size - padding, cy)], fill=LIDAR_GRID_COLOR, width=1)

    # Robot indicator
    tri = [
        (cx, cy - 8),
        (cx - 5, cy + 4),
        (cx + 5, cy + 4),
    ]
    draw.polygon(tri, fill=LIDAR_ROBOT_COLOR)
    return img


def render_idle_image(image_size: int = LIDAR_IMAGE_SIZE) -> bytes:
    """Render a placeholder PNG for when the robot is docked / no data."""
    buf = io.BytesIO()
    _build_idle_image(image_size).save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def render_idle_gif(image_size: int = LIDAR_IMAGE_SIZE) -> bytes:
    """GIF-format variant so motion-map camera's content_type stays consistent."""
    buf = io.BytesIO()
    _build_idle_image(image_size).save(buf, format="GIF", optimize=True)
    return buf.getvalue()
