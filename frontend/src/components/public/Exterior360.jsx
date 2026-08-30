import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, Move } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useLangValue } from "@/hooks/useLang";
import { bi } from "@/lib/i18n";

// Exterior360 — viewer 360° eksterior berbasis frame (jumlah frame BEBAS, ikut data unit).
// Interaksi: drag (pointer), slider scrub, tombol putar kiri/kanan, auto-rotate play/pause.
export default function Exterior360({ frames = [], alt = "" }) {
  const lang = useLangValue();
  const n = frames.length;
  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const stageRef = useRef(null);
  const drag = useRef({ active: false, startX: 0, startIdx: 0 });

  useEffect(() => {
    if (!n) return undefined;
    let alive = true;
    let count = 0;
    frames.forEach((src) => {
      const img = new Image();
      img.onload = () => { if (!alive) return; count += 1; setLoaded(count); if (count >= Math.min(n, 6)) setReady(true); };
      img.onerror = img.onload;
      img.src = src;
    });
    return () => { alive = false; };
  }, [frames, n]);

  useEffect(() => {
    if (!playing || !ready) return undefined;
    const t = setInterval(() => setIdx((i) => (i + 1) % n), 110);
    return () => clearInterval(t);
  }, [playing, ready, n]);

  const step = (d) => { setPlaying(false); setInteracted(true); setIdx((i) => ((i + d) % n + n) % n); };

  const onPointerDown = (e) => {
    setPlaying(false); setInteracted(true); setDragging(true);
    drag.current = { active: true, startX: e.clientX, startIdx: idx };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current.active) return;
    const w = stageRef.current?.clientWidth || 600;
    const per = Math.max(3, w / (n * 1.15));
    const delta = Math.round((e.clientX - drag.current.startX) / per);
    setIdx((((drag.current.startIdx - delta) % n) + n) % n);
  };
  const onPointerUp = () => { drag.current.active = false; setDragging(false); };

  if (n < 2) return null;
  const pct = Math.round((loaded / n) * 100);

  return (
    <div data-testid="ext360-viewer">
      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-testid="ext360-stage"
        className={`relative touch-pan-y select-none overflow-hidden rounded-2xl border border-border bg-card shadow-sm ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        style={{ background: "radial-gradient(ellipse 70% 60% at 50% 42%, hsl(var(--secondary)) 0%, hsl(var(--card)) 70%)" }}
      >
        <img
          src={frames[idx]}
          alt={`${alt} 360° frame ${idx + 1}`}
          draggable={false}
          className="pointer-events-none mx-auto h-[280px] w-full object-contain sm:h-[420px]"
        />
        <span className="absolute right-3 top-3 rounded-full border border-border bg-card/85 px-2.5 py-1 font-mono text-[11px] tabular-nums text-muted-foreground backdrop-blur-sm" data-testid="ext360-counter">
          {idx + 1} / {n}
        </span>
        {!interacted && ready ? (
          <span className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-primary/85 px-4 py-1.5 text-[12px] font-medium text-primary-foreground backdrop-blur-sm">
            <Move size={13} /> {bi("← Geser untuk memutar →", "← Drag to rotate →", lang)}
          </span>
        ) : null}
        {!ready ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card/70 backdrop-blur-sm" data-testid="ext360-loading">
            <p className="text-[12.5px] text-muted-foreground">{bi(`Memuat ${n} frame… ${pct}%`, `Loading ${n} frames… ${pct}%`, lang)}</p>
            <div className="h-1.5 w-44 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${pct}%`, background: "var(--gradient-cta)" }} />
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5 shadow-sm sm:px-4">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => step(-1)} data-testid="ext360-prev" aria-label={bi("Putar kiri", "Rotate left", lang)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:-translate-y-0.5 hover:text-foreground">
            <ChevronLeft size={15} />
          </button>
          <button type="button" onClick={() => { setInteracted(true); setPlaying((p) => !p); }} data-testid="ext360-play"
            aria-label={playing ? bi("Jeda", "Pause", lang) : bi("Putar otomatis", "Auto-rotate", lang)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-primary-foreground transition hover:opacity-90" style={{ background: "var(--gradient-cta)" }}>
            {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>
          <button type="button" onClick={() => step(1)} data-testid="ext360-next" aria-label={bi("Putar kanan", "Rotate right", lang)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:-translate-y-0.5 hover:text-foreground">
            <ChevronRight size={15} />
          </button>
        </div>
        <Slider
          value={[idx]}
          min={0}
          max={n - 1}
          step={1}
          onValueChange={(v) => { setPlaying(false); setInteracted(true); setIdx(v[0] ?? 0); }}
          className="flex-1"
          data-testid="ext360-slider"
        />
        <span className="hidden font-mono text-[11px] tabular-nums text-muted-foreground sm:block">{n} {bi("frame", "frames", lang)}</span>
      </div>
    </div>
  );
}
