// Renders a raw SVG string inline in the DOM.
// This preserves currentColor, CSS custom properties, and animations
// that would be lost with <img src="...">.

interface IconProps {
    svg: string;
    class?: string;
}

export function Icon({ svg, class: cls }: IconProps) {
    return <span class={cls} dangerouslySetInnerHTML={{ __html: svg }} />;
}
