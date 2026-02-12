// Type declarations for Vite ?raw SVG imports
declare module "*.svg?raw" {
    const content: string;
    export default content;
}
