import { useEffect } from 'react';

/**
 * Fades elements marked with data-reveal up into place as they scroll into view.
 * data-delay="80" staggers one by 80ms. Content stays visible without JS and
 * for visitors who prefer reduced motion.
 */
export function useReveal() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          el.classList.add('is-revealed');
          io.unobserve(el);
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    );

    document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
      el.style.setProperty('--reveal-delay', `${Number(el.dataset.delay ?? 0)}ms`);
      el.classList.add('reveal');
      io.observe(el);
    });

    return () => io.disconnect();
  }, []);
}
