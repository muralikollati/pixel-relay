// Spark: tiny sparkline using SVG
export function Spark({ data = [], color = '#00E5FF', width = 60, height = 24 }) {
  if (!data.length) return null;
  const min  = Math.min(...data);
  const max  = Math.max(...data);
  const span = max - min || 1;
  const pts  = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / span) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// QuotaBar: small horizontal bar
export function QuotaBar({ value = 0 }) {
  const pct   = Math.min(value, 100);
  const color = pct > 80 ? '#EF4444' : pct > 60 ? '#F59E0B' : '#10B981';
  return (
    <div style={{ width: '100%', maxWidth: 80 }}>
      <div style={{ fontSize: 9, color, fontFamily: 'DM Mono, monospace', marginBottom: 3 }}>{pct}%</div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.4s' }} />
      </div>
    </div>
  );
}
