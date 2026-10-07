import { useEffect, useRef } from 'react';

const randomColors = (n) =>
  Array.from({ length: n }, () =>
    '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')
  );

export default function TubesBackground({ children }) {
  const canvasRef = useRef(null);
  const appRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // @vite-ignore stops Vite from trying to bundle the CDN URL
        const mod = await import(
          /* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/threejs-components@0.0.19/build/cursors/tubes1.min.js'
        );
        if (!mounted || !canvasRef.current) return;

        appRef.current = mod.default(canvasRef.current, {
          tubes: {
            colors: ['#f967fb', '#53bc28', '#6958d5'],
            lights: {
              intensity: 200,
              colors: ['#83f36e', '#fe8a2e', '#ff008a', '#60aed5'],
            },
          },
        });
      } catch (err) {
        console.error('Failed to load tubes background:', err);
      }
    })();

    return () => {
      mounted = false;
      appRef.current?.dispose?.();
    };
  }, []);

  // Click on the background (not on the card) randomizes colors
  const randomize = () => {
    const app = appRef.current;
    if (!app) return;
    app.tubes.setColors(randomColors(3));
    app.tubes.setLightsColors(randomColors(4));
  };

  return (
    <div className="tubes-bg">
      <canvas ref={canvasRef} className="tubes-canvas" onClick={randomize} />
      <div className="tubes-content">{children}</div>
    </div>
  );
}