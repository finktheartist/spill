const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const Camera = () => (
  <svg viewBox="0 0 24 24" {...s}><path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3v10H4z" /><circle cx="12" cy="13.2" r="3.4" /></svg>
);
export const Arrow = ({ back = false }: { back?: boolean }) => (
  <svg viewBox="0 0 24 24" {...s} style={back ? { transform: 'scaleX(-1)' } : undefined}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const Replay = () => (
  <svg viewBox="0 0 24 24" {...s}><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4" /></svg>
);
export const Reset = () => (
  <svg viewBox="0 0 24 24" {...s}><path d="M12 3.5 19.5 7.8v8.4L12 20.5 4.5 16.2V7.8zM12 12v8.5M12 12l7.5-4.2M12 12 4.5 7.8" /></svg>
);
export const Plus = () => (
  <svg viewBox="0 0 24 24" {...s}><path d="M12 5v14M5 12h14" /></svg>
);
