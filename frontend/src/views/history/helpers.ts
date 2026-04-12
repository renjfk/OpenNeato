// Shared helpers for history views

import clockSvg from "../../assets/icons/clock.svg?raw";
import houseSvg from "../../assets/icons/house.svg?raw";
import manualSvg from "../../assets/icons/manual.svg?raw";
import spotSvg from "../../assets/icons/spot.svg?raw";
import type { MapData, MapTransform } from "../../types";

const DEFAULT_TRANSFORM: MapTransform = { panX: 0, panY: 0, zoom: 1 };

export function formatDuration(secs: number): string {
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function formatDate(epoch: number): string {
    const d = new Date(epoch * 1000);
    const mon = (d.getMonth() + 1).toString().padStart(2, "0");
    const day = d.getDate().toString().padStart(2, "0");
    const h = d.getHours().toString().padStart(2, "0");
    const min = d.getMinutes().toString().padStart(2, "0");
    return `${mon}/${day} ${h}:${min}`;
}

export function modeInfo(mode: string): { label: string; icon: string } {
    if (mode === "house") return { label: "House Clean", icon: houseSvg };
    if (mode === "spot") return { label: "Spot Clean", icon: spotSvg };
    if (mode === "manual") return { label: "Manual Clean", icon: manualSvg };
    return { label: mode, icon: clockSvg };
}

// Canvas renderer for map visualization
export function renderMap(canvas: HTMLCanvasElement, map: MapData, recording = false, tf?: MapTransform) {
    const ctx = canvas.getContext("2d");
    if (!ctx || !map.bounds) return;

    const { panX, panY, zoom } = tf ?? DEFAULT_TRANSFORM;

    const dpr = window.devicePixelRatio || 1;
    const displayW = canvas.clientWidth;
    const displayH = canvas.clientHeight;
    canvas.width = displayW * dpr;
    canvas.height = displayH * dpr;
    ctx.scale(dpr, dpr);

    // Apply zoom + pan: zoom from top-left origin, panX/panY computed by
    // useMapGestures already account for the cursor-relative zoom anchor.
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    const { minX, maxX, minY, maxY } = map.bounds;
    const worldW = maxX - minX;
    const worldH = maxY - minY;

    const pad = 20;
    const availW = displayW - pad * 2;
    const availH = displayH - pad * 2;
    const scale = Math.min(availW / worldW, availH / worldH);

    // Center the map within the canvas
    const renderedW = worldW * scale;
    const renderedH = worldH * scale;
    const offX = pad + (availW - renderedW) / 2;
    const offY = pad + (availH - renderedH) / 2;

    const toX = (x: number) => offX + (x - minX) * scale;
    const toY = (y: number) => offY + (maxY - y) * scale;

    const isDark = getComputedStyle(canvas).getPropertyValue("--surface").trim().startsWith("#1");

    // Background
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--surface").trim() || "#1a1a1c";
    ctx.fillRect(0, 0, displayW, displayH);

    // Grid lines - draw first so coverage/path render on top
    ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.06)";
    ctx.lineWidth = 1;
    const gridStep = 0.5;
    const gridMinX = Math.floor(minX / gridStep) * gridStep;
    const gridMinY = Math.floor(minY / gridStep) * gridStep;
    for (let gx = gridMinX; gx <= maxX; gx += gridStep) {
        ctx.beginPath();
        ctx.moveTo(toX(gx), toY(minY));
        ctx.lineTo(toX(gx), toY(maxY));
        ctx.stroke();
    }
    for (let gy = gridMinY; gy <= maxY; gy += gridStep) {
        ctx.beginPath();
        ctx.moveTo(toX(minX), toY(gy));
        ctx.lineTo(toX(maxX), toY(gy));
        ctx.stroke();
    }

    // Coverage cells
    const cellPx = map.cellSize * scale;
    ctx.fillStyle = isDark ? "rgba(52, 199, 89, 0.15)" : "rgba(22, 130, 50, 0.22)";
    for (const [cx, cy] of map.coverage) {
        const wx = cx * map.cellSize;
        const wy = cy * map.cellSize;
        ctx.fillRect(toX(wx) - cellPx / 2, toY(wy) - cellPx / 2, cellPx, cellPx);
    }

    // Path line
    if (map.path.length > 1) {
        ctx.beginPath();
        ctx.moveTo(toX(map.path[0].x), toY(map.path[0].y));
        for (let i = 1; i < map.path.length; i++) {
            ctx.lineTo(toX(map.path[i].x), toY(map.path[i].y));
        }
        ctx.strokeStyle = isDark ? "rgba(249, 235, 178, 0.6)" : "rgba(180, 140, 40, 0.5)";
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
    }

    // Start point
    if (map.path.length > 0) {
        const start = map.path[0];
        ctx.beginPath();
        ctx.arc(toX(start.x), toY(start.y), 5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(52, 199, 89, 0.9)";
        ctx.fill();
    }

    // End point - open ring with glow when recording, solid dot when finished
    if (map.path.length > 1) {
        const end = map.path[map.path.length - 1];
        const ex = toX(end.x);
        const ey = toY(end.y);
        if (recording) {
            ctx.save();
            ctx.shadowColor = "rgba(52, 199, 89, 0.6)";
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(ex, ey, 6, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(52, 199, 89, 0.9)";
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.restore();
        } else {
            ctx.beginPath();
            ctx.arc(ex, ey, 5, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255, 69, 58, 0.9)";
            ctx.fill();
        }
    }

    // Recharge points (bolt icon with glow)
    for (const rp of map.recharges) {
        const rx = toX(rp.x);
        const ry = toY(rp.y);
        const s = 10;
        const drawBolt = () => {
            ctx.beginPath();
            ctx.moveTo(rx + s * 0.15, ry - s);
            ctx.lineTo(rx - s * 0.55, ry + s * 0.05);
            ctx.lineTo(rx - s * 0.05, ry + s * 0.05);
            ctx.lineTo(rx - s * 0.15, ry + s);
            ctx.lineTo(rx + s * 0.55, ry - s * 0.05);
            ctx.lineTo(rx + s * 0.05, ry - s * 0.05);
            ctx.closePath();
        };
        ctx.save();
        ctx.shadowColor = "rgba(255, 204, 0, 0.7)";
        ctx.shadowBlur = 8;
        drawBolt();
        ctx.fillStyle = "rgba(255, 204, 0, 1)";
        ctx.fill();
        ctx.restore();
        drawBolt();
        ctx.strokeStyle = isDark ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 0.3)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
}
