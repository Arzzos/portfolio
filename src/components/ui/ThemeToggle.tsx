import { useEffect, useState } from 'react';

export default function ThemeToggle({ lang }: { lang: 'es' | 'en' }) {
  const [light, setLight] = useState(false);

  useEffect(() => {
    setLight(document.documentElement.classList.contains('light'));
  }, []);

  const toggle = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle('light', next);
    document.documentElement.classList.toggle('dark', !next);
    try {
      localStorage.setItem('arzzos-theme', next ? 'light' : 'dark');
    } catch {
      /* storage unavailable */
    }
    window.dispatchEvent(new CustomEvent('arzzos-theme', { detail: { theme: next ? 'light' : 'dark' } }));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={light}
      aria-label={
        lang === 'es'
          ? `Tema ${light ? 'light' : 'dark'}, cambiar a ${light ? 'oscuro' : 'claro'}`
          : `Theme ${light ? 'light' : 'dark'}, switch to ${light ? 'dark' : 'light'}`
      }
      className="mono rounded border border-current px-3 py-2 text-xs opacity-80 hover:opacity-100"
    >
      {light ? '☀ light' : '☾ dark'}
    </button>
  );
}
