// Battery icon matching SVGRepo style with dynamic charge fill

interface BatteryIconProps {
    pct: number;
}

export function BatteryIcon({ pct }: BatteryIconProps) {
    // Fill width inside the battery body (8 to 48 = 40 units range)
    const fillWidth = Math.round((pct / 100) * 40);
    const fillRight = 8 + fillWidth;

    // Color the fill based on charge level
    const fillColor = pct <= 25 ? "var(--red)" : pct <= 50 ? "var(--amber)" : pct <= 75 ? "#8fdf3f" : "var(--green)";

    return (
        <svg
            viewBox="0 0 64 64"
            width="28"
            height="28"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="Battery"
        >
            <defs>
                {/* Clip to battery interior: main body + nub */}
                <clipPath id="batt-clip">
                    <rect x="8" y="20" width="40" height="24" />
                    <rect x="48" y="28" width="8" height="8" />
                </clipPath>
            </defs>
            {/* Dark outer shell */}
            <path
                fill="#394240"
                d="M60,20h-4v-4c0-2.211-1.789-4-4-4H4c-2.211,0-4,1.789-4,4v32c0,2.211,1.789,4,4,4h48c2.211,0,4-1.789,4-4v-4h4c2.211,0,4-1.789,4-4V24C64,21.789,62.211,20,60,20z M56,36h-8v8H8V20h40v8h8V36z"
            />
            {/* Charge fill clipped to interior */}
            {pct > 0 && (
                <rect x="8" y="20" width={fillRight - 8} height="24" fill={fillColor} clip-path="url(#batt-clip)" />
            )}
        </svg>
    );
}
