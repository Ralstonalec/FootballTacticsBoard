import type { ReactNode } from 'react';

export function Slider(props: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; hint?: string; format?: (v: number) => string;
}) {
  const { label, value, onChange, min = 0, max = 1, step = 0.05, hint, format } = props;
  return (
    <label className="slider" title={hint}>
      <span className="slider-label">
        {label}
        <b>{format ? format(value) : Math.round(value * 100) + '%'}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Section(props: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card">
      <header>
        <h3>{props.title}</h3>
        {props.right}
      </header>
      {props.children}
    </section>
  );
}
