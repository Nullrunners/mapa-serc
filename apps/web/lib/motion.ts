/** True when the person asked their system for less motion (WCAG 2.3.3): then nothing glides, it just appears. */
export const lessMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** How to scroll something into view: smoothly, unless the person asked for less motion. */
export const scrollMotion = (): ScrollBehavior => (lessMotion() ? "auto" : "smooth");
