// Battery icon with 4 fill ticks that reflect charge level and color

export function BatteryIcon({ pct, color }: { pct: number; color: string }) {
    const c = `var(--${color})`;
    const ticks = pct > 87 ? 4 : pct > 62 ? 3 : pct > 37 ? 2 : pct > 12 ? 1 : 0;

    return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="7" width="18" height="10" rx="2" stroke={c} stroke-width="1.5" />
            <path d="M22 11v2" stroke={c} stroke-width="1.5" stroke-linecap="round" />
            {ticks >= 1 && <rect x="4.5" y="9.5" width="2.5" height="5" rx="0.5" fill={c} />}
            {ticks >= 2 && <rect x="8.5" y="9.5" width="2.5" height="5" rx="0.5" fill={c} />}
            {ticks >= 3 && <rect x="12.5" y="9.5" width="2.5" height="5" rx="0.5" fill={c} />}
            {ticks >= 4 && <rect x="16.5" y="9.5" width="1.5" height="5" rx="0.5" fill={c} />}
        </svg>
    );
}
