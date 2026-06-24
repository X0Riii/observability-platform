import { useRef, useEffect, useCallback, useState } from 'react';

interface TimelineEvent {
  id: string;
  ts: number;
  type: string;
  subtype?: string;
  seq: number;
  url?: string;
  method?: string;
  status?: number;
}

interface Props {
  events: TimelineEvent[];
  width?: number;
  height?: number;
}

const LANE_CONFIG: Record<string, { label: string; color: string }> = {
  navigation: { label: 'Navigation', color: '#06b6d4' },
  network: { label: 'Network', color: '#22c55e' },
  dom: { label: 'DOM', color: '#a855f7' },
  js: { label: 'JavaScript', color: '#f59e0b' },
  storage: { label: 'Storage', color: '#ef4444' },
  screenshot: { label: 'Screenshot', color: '#ec4899' },
  performance: { label: 'Performance', color: '#14b8a6' },
};

const LANE_HEIGHT = 28;
const HEADER_HEIGHT = 20;
const PADDING = 40;

export function TimelineCanvas({ events, width: containerWidth = 800 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState(0);

  const lanes = Object.keys(LANE_CONFIG);
  const canvasHeight = HEADER_HEIGHT + lanes.length * LANE_HEIGHT + 10;

  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const minTs = sorted.length > 0 ? sorted[0].ts : 0;
  const maxTs = sorted.length > 0 ? sorted[sorted.length - 1].ts : 1;
  const range = (maxTs - minTs) / zoom;

  const timeToX = useCallback((ts: number) => {
    return PADDING + ((ts - (minTs + offset)) / range) * (containerWidth - PADDING * 2);
  }, [minTs, offset, range, containerWidth]);

  const laneIndex = (type: string) => {
    const idx = lanes.indexOf(type);
    return idx >= 0 ? idx : lanes.length - 1;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = containerWidth * dpr;
    canvas.height = canvasHeight * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, containerWidth, canvasHeight);

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, containerWidth, canvasHeight);

    // Lane headers
    lanes.forEach((lane, i) => {
      const y = HEADER_HEIGHT + i * LANE_HEIGHT;
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, y, containerWidth, LANE_HEIGHT - 1);
      ctx.fillStyle = '#64748b';
      ctx.font = '11px monospace';
      ctx.fillText(LANE_CONFIG[lane]?.label || lane, 4, y + 16);
    });

    // Events
    for (const ev of sorted) {
      const x = timeToX(ev.ts);
      if (x < PADDING || x > containerWidth - 10) continue;
      const lane = laneIndex(ev.type);
      const y = HEADER_HEIGHT + lane * LANE_HEIGHT + 4;
      const color = LANE_CONFIG[ev.type]?.color || '#94a3b8';

      ctx.fillStyle = color;
      const barWidth = Math.max(4, 20 / zoom);
      ctx.fillRect(x, y, barWidth, LANE_HEIGHT - 8);
    }

    // Timescale
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, 0, containerWidth, HEADER_HEIGHT);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    const step = range / 5;
    for (let i = 0; i <= 5; i++) {
      const t = minTs + offset + i * step;
      const x = timeToX(t);
      ctx.fillText(new Date(t).toISOString().substr(11, 8), x, 14);
    }
  }, [sorted, zoom, offset, containerWidth, canvasHeight, timeToX, lanes]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) setZoom(z => Math.min(z * 1.3, 100));
    else setZoom(z => Math.max(z / 1.3, 0.1));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startOffset = offset;
    const handleMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      setOffset(startOffset - dx * (range / (containerWidth - PADDING * 2)));
    };
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  return (
    <div className="relative">
      <div className="flex gap-2 mb-2 text-xs text-gray-500">
        <button onClick={() => setZoom(1)} className="px-2 py-1 bg-gray-800 rounded hover:bg-gray-700">Reset</button>
        <span>Zoom: {zoom.toFixed(1)}x</span>
        <span>Events: {events.length}</span>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: containerWidth, height: canvasHeight, cursor: 'grab' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}
