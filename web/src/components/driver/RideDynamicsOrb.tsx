'use client';

/**
 * RideDynamicsOrb — aerospace/automotive precision G-meter gauge (DRIVER_VIEW_PLAN §3.3)
 *
 * Maps longitudinal acceleration (a_long → Y axis) and lateral cornering force
 * (a_lat → X axis) onto a spring-damped floating orb with dynamic neon aura:
 *   Emerald  |G| ≤ 0.15 g   — smooth cruising / optimal dynamics
 *   Amber    |G| ≤ 0.35 g   — moderate maneuver
 *   Crimson  |G| > 0.35 g   — harsh dynamics event (expanding shockwave)
 */

import { useEffect, useRef } from 'react';
import { clamp, GRAVITY } from '@/lib/sim/demoSimulator';

const MAX_G = 0.5;
const EMERALD = '#10B981';
const AMBER = '#F59E0B';
const CRIMSON = '#F43F5E';

interface Ripple {
  born: number;
}

export interface RideDynamicsOrbProps {
  /** Longitudinal acceleration in m/s² (negative = braking, positive = acceleration). */
  aLong: number;
  /** Lateral acceleration in m/s² (positive = right turn load, negative = left turn load). */
  aLat: number;
  className?: string;
}

export function RideDynamicsOrb({ aLong, aLat, className = '' }: RideDynamicsOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const targetRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    // -aLong moves up towards BRAKE when negative; aLat moves right when positive
    targetRef.current = {
      x: clamp(aLat / GRAVITY / MAX_G, -1, 1),
      y: clamp(aLong / GRAVITY / MAX_G, -1, 1),
    };
  }, [aLong, aLat]);

  const wasHarshRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let lastTs = performance.now();
    let size = 0;
    let dpr = 1;

    // Spring-damper physics state
    let px = 0;
    let py = 0;
    let vx = 0;
    let vy = 0;
    const trail: Array<{ x: number; y: number }> = [];
    const ripples: Ripple[] = [];

    const resize = () => {
      const rect = container.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = Math.max(1, Math.min(rect.width, rect.height));
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const draw = (ts: number) => {
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      // Critically damped spring physics tracking G target
      const stiffness = 95;
      const damping = 14;
      vx += (targetRef.current.x - px) * stiffness * dt - vx * damping * dt;
      vy += (targetRef.current.y - py) * stiffness * dt - vy * damping * dt;
      px += vx * dt;
      py += vy * dt;

      trail.push({ x: px, y: py });
      if (trail.length > 28) trail.shift();

      const totalG = Math.hypot(px, py) * MAX_G;
      const aura = totalG <= 0.15 ? EMERALD : totalG <= 0.35 ? AMBER : CRIMSON;

      // Spawn shockwave ripple on entering harsh band
      const harsh = totalG > 0.35;
      if (harsh && !wasHarshRef.current) ripples.push({ born: ts });
      wasHarshRef.current = harsh;
      while (ripples.length && ts - ripples[0].born > 1100) ripples.shift();

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      const c = size / 2;
      // Precision radius calibrated so concentric rings and labels have ample margin
      const R = size * 0.28;

      // ---- Aerospace Gauge Dial Face ----------------------------------------
      const dialGrad = ctx.createRadialGradient(c, c, 2, c, c, size * 0.48);
      dialGrad.addColorStop(0, '#0c0f14');
      dialGrad.addColorStop(0.75, '#07090d');
      dialGrad.addColorStop(1, '#020305');

      ctx.beginPath();
      ctx.arc(c, c, size * 0.47, 0, Math.PI * 2);
      ctx.fillStyle = dialGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Outer bezel ring
      ctx.beginPath();
      ctx.arc(c, c, R + size * 0.08, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // ---- Concentric Reference Rings (0.15g / 0.35g / 0.50g) --------------
      const rings: Array<{ g: number; color: string; dash: number[]; width: number }> = [
        { g: 0.15, color: 'rgba(16, 185, 129, 0.35)', dash: [2, 3], width: 1 },
        { g: 0.35, color: 'rgba(245, 158, 11, 0.32)', dash: [3, 3], width: 1 },
        { g: 0.50, color: 'rgba(244, 63, 94, 0.38)', dash: [4, 3], width: 1.2 },
      ];

      for (const ring of rings) {
        ctx.beginPath();
        const ringR = (ring.g / MAX_G) * R;
        ctx.arc(c, c, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = ring.color;
        ctx.lineWidth = ring.width;
        ctx.setLineDash(ring.dash);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // ---- Crosshair Axes with Precision Ticks -----------------------------
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      // Horizontal axis
      ctx.moveTo(c - R * 1.08, c);
      ctx.lineTo(c + R * 1.08, c);
      // Vertical axis
      ctx.moveTo(c, c - R * 1.08);
      ctx.lineTo(c, c + R * 1.08);
      ctx.stroke();

      // Small tick marks along axes for aerospace precision
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
      const tickG = [0.15, 0.35, 0.5];
      for (const g of tickG) {
        const offset = (g / MAX_G) * R;
        const tickLen = 2.5;
        // Horizontal axis ticks
        ctx.beginPath();
        ctx.moveTo(c + offset, c - tickLen);
        ctx.lineTo(c + offset, c + tickLen);
        ctx.moveTo(c - offset, c - tickLen);
        ctx.lineTo(c - offset, c + tickLen);
        // Vertical axis ticks
        ctx.moveTo(c - tickLen, c - offset);
        ctx.lineTo(c + tickLen, c - offset);
        ctx.moveTo(c - tickLen, c + offset);
        ctx.lineTo(c + tickLen, c + offset);
        ctx.stroke();
      }

      // Center crosshair zero point
      ctx.beginPath();
      ctx.arc(c, c, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fill();

      // ---- Precision Axis Labels (Fully contained inside bezel) ------------
      const labelFontSize = Math.max(6.5, Math.round(size * 0.055));
      ctx.font = `700 ${labelFontSize}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // BRAKE (Top)
      ctx.fillText('BRAKE', c, Math.max(labelFontSize + 2, (c - R) * 0.45));

      // ACCEL (Bottom)
      ctx.fillText('ACCEL', c, Math.min(size - labelFontSize - 2, c + R + (size - (c + R)) * 0.55));

      // LEFT (Left)
      ctx.fillText('LEFT', Math.max(labelFontSize * 1.8, (c - R) * 0.45), c);

      // RIGHT (Right)
      ctx.fillText('RIGHT', Math.min(size - labelFontSize * 2, c + R + (size - (c + R)) * 0.55), c);

      // ---- Shockwave Ripples ------------------------------------------------
      for (const r of ripples) {
        const t = (ts - r.born) / 1100;
        ctx.beginPath();
        ctx.arc(c, c, R * (0.25 + t * 0.95), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(244, 63, 94, ${0.6 * (1 - t)})`;
        ctx.lineWidth = 2.5 * (1 - t) + 0.5;
        ctx.stroke();
      }

      // ---- Fading Motion Trail ----------------------------------------------
      for (let i = 0; i < trail.length; i++) {
        const t = i / trail.length;
        const tp = trail[i];
        ctx.beginPath();
        ctx.arc(c + tp.x * R, c + tp.y * R, 1.8 + t * 3.2, 0, Math.PI * 2);
        ctx.fillStyle = hexA(aura, t * 0.28);
        ctx.fill();
      }

      // ---- Floating Core Orb with Dynamic Aura -------------------------------
      const ox = c + px * R;
      const oy = c + py * R;
      const orbR = size * 0.055;

      // Dynamic aura glow
      ctx.save();
      ctx.shadowColor = aura;
      ctx.shadowBlur = Math.round(size * 0.22);
      const grad = ctx.createRadialGradient(ox, oy, 1, ox, oy, orbR * 2.6);
      grad.addColorStop(0, hexA(aura, 0.92));
      grad.addColorStop(0.45, hexA(aura, 0.35));
      grad.addColorStop(1, hexA(aura, 0));
      ctx.beginPath();
      ctx.arc(ox, oy, orbR * 2.6, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();

      // Solid inner orb core
      ctx.beginPath();
      ctx.arc(ox, oy, orbR, 0, Math.PI * 2);
      ctx.fillStyle = aura;
      ctx.fill();

      // Specular 3D highlight
      ctx.beginPath();
      ctx.arc(ox - orbR * 0.28, oy - orbR * 0.28, orbR * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fill();

      // ---- Live |G| High-Contrast Readout ------------------------------------
      const gReadoutSize = Math.max(9, Math.round(size * 0.08));
      ctx.font = `800 ${gReadoutSize}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.fillStyle = aura;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${totalG.toFixed(2)}g`, c, c + R * 0.42);

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="flex flex-col items-center">
      <div ref={containerRef} className={`relative flex items-center justify-center ${className}`}>
        <canvas ref={canvasRef} aria-label="Ride dynamics precision G-meter" />
      </div>
    </div>
  );
}

function hexA(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
