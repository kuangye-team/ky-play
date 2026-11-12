/** Build-time target; desktop builds must never fall back to browser storage. */
export const isDesktop = import.meta.env.VITE_DESKTOP === true;
