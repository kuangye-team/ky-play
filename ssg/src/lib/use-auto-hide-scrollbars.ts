import { useEffect } from "react";

export function useAutoHideScrollbars() {
  useEffect(() => {
    const timers = new Map<HTMLElement, number>();
    const onScroll = (event: Event) => {
      const element = event.target === document
        ? document.documentElement
        : event.target;
      if (!(element instanceof HTMLElement)) return;

      window.clearTimeout(timers.get(element));
      element.classList.add("is-scrolling");
      timers.set(element, window.setTimeout(() => {
        element.classList.remove("is-scrolling");
        timers.delete(element);
      }, 800));
    };

    // Capture also covers independently scrolling panels and portal dialogs.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      for (const [element, timer] of timers) {
        window.clearTimeout(timer);
        element.classList.remove("is-scrolling");
      }
    };
  }, []);
}
