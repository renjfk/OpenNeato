// Renders a raw SVG string inline in the DOM.
// This preserves currentColor, CSS custom properties, and animations
// that would be lost with <img src="...">.

export function Icon({ svg, class: cls }: { svg: string; class?: string }) {
    return <span class={cls} dangerouslySetInnerHTML={{ __html: svg }} />;
}
