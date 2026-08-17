'use client';

/**
 * HazardHorizonRadar — 300 m forward perspective radar
 *
 * A 60 FPS HTML5 canvas road with:
 * - Vanishing point perspective road grid with distance guidance arcs (50m, 100m, 200m, 300m)
 * - Atmospheric depth fog and periodic radar sweep line (passing bottom to horizon every ~3s)
 * - Dynamic Ego Vehicle Avatar with neon wake lines that scale with vehicle speed
 * - Perspective billboard hazard discs with crisp vector iconography, pulse rings, and distance HUD tags
 * - Eco-Glide Glow: smooth emerald horizon gradient when coasting is active
 */

import { useEffect, useRef } from 'react';
import type { HorizonHazard, HazardSeverity } from '@/lib/sim/demoSimulator';
import { clamp, MAX_RANGE_M } from '@/lib/sim/demoSimulator';
import { HAZARD_COLOR } from './hazardMeta';

const SEVERITY_PULSE: Record<HazardSeverity, boolean> = {
  info: false,
  low: false,
  medium: false,
  high: true,
  critical: true,
};

const LANE_OFFSET: Record<HorizonHazard['lane'], number> = {
  left: -0.42,
  center: 0,
  right: 0.42,
};

export interface HazardHorizonRadarProps {
  hazards: HorizonHazard[];
  speedKmh: number;
  maxRangeM?: number;
  /** Emerald tint boost while Eco-Glide coasting */
  coasting?: boolean;
  className?: string;
}

export function HazardHorizonRadar({
  hazards,
  speedKmh,
  maxRangeM = MAX_RANGE_M,
  coasting = false,
  className = '',
}: HazardHorizonRadarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Props → refs so the rAF loop never restarts on updates.
  const hazardsRef = useRef<HorizonHazard[]>(hazards);
  const speedRef = useRef(speedKmh);
  const coastingRef = useRef(coasting);
  useEffect(() => {
    hazardsRef.current = hazards;
    speedRef.current = speedKmh;
    coastingRef.current = coasting;
  }, [hazards, speedKmh, coasting]);

  // Smoothed per-hazard distances for 60 FPS motion between 20 Hz snapshots.
  const smoothDistRef = useRef<Map<string, number>>(new Map());
  const dashOffsetRef = useRef(0);
  const pulseRef = useRef(0);
  const coastingAlphaRef = useRef(coasting ? 1 : 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let lastTs = performance.now();
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // Perspective: d (meters ahead) → 0..1 road progress toward the viewer.
    const persp = (d: number) => 1 / (1 + Math.max(0, d) / 24);

    const draw = (ts: number) => {
      const dt = Math.min(0.1, (ts - lastTs) / 1000);
      lastTs = ts;
      pulseRef.current += dt;

      // Smoothly interpolate Eco-Glide coasting glow alpha (0 -> 1)
      const targetCoasting = coastingRef.current ? 1 : 0;
      coastingAlphaRef.current += (targetCoasting - coastingAlphaRef.current) * Math.min(1, dt * 6);
      const coastAlpha = coastingAlphaRef.current;

      const speedCurrent = speedRef.current;
      const speedMps = speedCurrent / 3.6;
      const laneDashPitch = 10;
      // Lane dashes scroll toward the viewer in sync with ground speed.
      dashOffsetRef.current = (dashOffsetRef.current + speedMps * dt) % laneDashPitch;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const horizonY = height * 0.16;
      const bottomY = height * 0.98;
      const roadHalfBottom = width * 0.44;
      const roadHalfHorizon = Math.max(4, width * 0.024);

      const yAt = (d: number) => horizonY + (bottomY - horizonY) * persp(d);
      const halfAt = (d: number) => {
        const p = persp(d);
        return roadHalfHorizon + (roadHalfBottom - roadHalfHorizon) * p;
      };

      // =========================================================================
      // 1. ATMOSPHERIC DEPTH FOG & ECO-GLIDE HORIZON GLOW
      // =========================================================================

      // Deep sky vignette
      const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY * 1.8);
      skyGrad.addColorStop(0, 'rgba(8, 12, 16, 0.95)');
      skyGrad.addColorStop(0.7, 'rgba(10, 20, 18, 0.4)');
      skyGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, width, horizonY * 1.8);

      // Atmospheric vanishing point radial glow
      const atmoRadius = Math.max(width * 0.4, 160);
      const atmoGrad = ctx.createRadialGradient(cx, horizonY, 0, cx, horizonY, atmoRadius);
      atmoGrad.addColorStop(0, `rgba(16, 185, 129, ${0.08 + coastAlpha * 0.22})`);
      atmoGrad.addColorStop(0.4, `rgba(5, 150, 105, ${0.03 + coastAlpha * 0.12})`);
      atmoGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = atmoGrad;
      ctx.fillRect(0, 0, width, horizonY + atmoRadius);

      // Eco-Glide Smooth Horizon Glow
      if (coastAlpha > 0.01) {
        const ecoGrad = ctx.createLinearGradient(0, horizonY - 24, 0, horizonY + 36);
        ecoGrad.addColorStop(0, 'rgba(16, 185, 129, 0)');
        ecoGrad.addColorStop(0.45, `rgba(52, 211, 153, ${0.28 * coastAlpha})`);
        ecoGrad.addColorStop(0.7, `rgba(16, 185, 129, ${0.15 * coastAlpha})`);
        ecoGrad.addColorStop(1, 'rgba(16, 185, 129, 0)');
        ctx.fillStyle = ecoGrad;
        ctx.fillRect(0, horizonY - 24, width, 60);
      }

      // =========================================================================
      // 2. ROAD SURFACE & BOUNDARIES
      // =========================================================================

      // Road Surface polygon
      ctx.beginPath();
      ctx.moveTo(cx - roadHalfHorizon, horizonY);
      ctx.lineTo(cx + roadHalfHorizon, horizonY);
      ctx.lineTo(cx + roadHalfBottom, bottomY);
      ctx.lineTo(cx - roadHalfBottom, bottomY);
      ctx.closePath();

      const roadGrad = ctx.createLinearGradient(0, horizonY, 0, bottomY);
      roadGrad.addColorStop(0, '#060709');
      roadGrad.addColorStop(0.4, '#0c0e12');
      roadGrad.addColorStop(1, '#13161c');
      ctx.fillStyle = roadGrad;
      ctx.fill();

      // Eco-Glide road surface wash
      if (coastAlpha > 0.01) {
        const roadEcoGrad = ctx.createLinearGradient(0, horizonY, 0, bottomY);
        roadEcoGrad.addColorStop(0, `rgba(16, 185, 129, ${0.14 * coastAlpha})`);
        roadEcoGrad.addColorStop(0.5, `rgba(16, 185, 129, ${0.05 * coastAlpha})`);
        roadEcoGrad.addColorStop(1, 'rgba(16, 185, 129, 0)');
        ctx.fillStyle = roadEcoGrad;
        ctx.fill();
      }

      // Outer Road Shoulder Edges (with glowing bloom)
      const edgeAlpha = 0.35 + coastAlpha * 0.45;
      ctx.save();
      ctx.shadowColor = '#10b981';
      ctx.shadowBlur = coastAlpha > 0.3 ? 8 : 4;
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = `rgba(16, 185, 129, ${edgeAlpha})`;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + side * roadHalfHorizon, horizonY);
        ctx.lineTo(cx + side * roadHalfBottom, bottomY);
        ctx.stroke();
      }
      ctx.restore();

      // =========================================================================
      // 3. PERSPECTIVE ROAD GRID: DISTANCE GUIDANCE RINGS / ARC CROSSBARS
      // =========================================================================

      const distanceMarks = [50, 100, 200, 300];
      ctx.font = '700 9px Inter, system-ui, -apple-system, sans-serif';
      ctx.textBaseline = 'middle';

      for (const mark of distanceMarks) {
        if (mark > maxRangeM) continue;
        const y = yAt(mark);
        const half = halfAt(mark);
        const p = persp(mark);

        // Perspective arced crossbar across the road
        ctx.beginPath();
        ctx.moveTo(cx - half, y);
        // Slight forward curvature for spherical perspective arc
        const curveOffset = Math.max(1, half * 0.06);
        ctx.quadraticCurveTo(cx, y + curveOffset, cx + half, y);

        ctx.strokeStyle = `rgba(255, 255, 255, ${0.08 + p * 0.08})`;
        ctx.lineWidth = Math.max(0.8, 1.4 * p);
        ctx.stroke();

        // Edge tick brackets
        ctx.strokeStyle = `rgba(16, 185, 129, ${0.3 + p * 0.3})`;
        ctx.lineWidth = 1.5;
        for (const side of [-1, 1]) {
          const edgeX = cx + side * half;
          ctx.beginPath();
          ctx.moveTo(edgeX - side * 3, y - 2);
          ctx.lineTo(edgeX, y);
          ctx.lineTo(edgeX - side * 3, y + 2);
          ctx.stroke();
        }

        // Distance HUD labels on the right side of the road
        const labelText = `${mark}m`;
        const labelX = cx + half + 7;
        const labelAlpha = 0.28 + p * 0.35;

        ctx.textAlign = 'left';
        ctx.fillStyle = `rgba(255, 255, 255, ${labelAlpha})`;
        ctx.fillText(labelText, labelX, y);
      }

      // =========================================================================
      // 4. SPEED-SYNCHRONIZED CENTER LANE DASHES (True 3D Perspective Tapering)
      // =========================================================================

      const pitch = laneDashPitch;
      const dashLen = 3.8;
      const offset = dashOffsetRef.current;

      for (let d = -offset + pitch; d < maxRangeM; d += pitch) {
        if (d < 0.2) continue;
        const yBottom = yAt(d);
        const yTop = yAt(d + dashLen);
        if (yBottom <= horizonY) continue;

        const pBottom = persp(d);
        const pTop = persp(d + dashLen);

        // Perspective widths: starts bold and wide at bottom (~10px), tapering to ~1px at horizon
        const wBottom = Math.max(1.0, 9.6 * Math.pow(pBottom, 1.25));
        const wTop = Math.max(0.6, 9.6 * Math.pow(pTop, 1.25));
        const alpha = Math.min(0.95, 0.16 + pBottom * 0.78);

        // Render each dash as a true perspective tapered trapezoid
        ctx.beginPath();
        ctx.moveTo(cx - wBottom / 2, yBottom);
        ctx.lineTo(cx + wBottom / 2, yBottom);
        ctx.lineTo(cx + wTop / 2, yTop);
        ctx.lineTo(cx - wTop / 2, yTop);
        ctx.closePath();

        const dashGrad = ctx.createLinearGradient(0, yTop, 0, yBottom);
        dashGrad.addColorStop(0, `rgba(215, 230, 255, ${alpha * 0.75})`);
        dashGrad.addColorStop(1, `rgba(255, 255, 255, ${alpha})`);

        ctx.fillStyle = dashGrad;
        ctx.fill();

        // Subtle soft neon bloom on foreground dashes close to the vehicle
        if (pBottom > 0.45) {
          ctx.save();
          ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
          ctx.shadowBlur = 8 * (pBottom - 0.45) * 1.8;
          ctx.fillStyle = `rgba(255, 255, 255, ${0.25 * (pBottom - 0.45)})`;
          ctx.fill();
          ctx.restore();
        }
      }

      // =========================================================================
      // 5. RADAR SWEEP (Passing bottom to horizon every ~3s)
      // =========================================================================

      const sweepDuration = 3.0; // 3 seconds periodic cycle
      const sweepPhase = (pulseRef.current / sweepDuration) % 1.0;
      // Moving from bottom (0) to horizon (1)
      const sweepY = bottomY - sweepPhase * (bottomY - horizonY);
      const sweepDistM = (1 - (sweepY - horizonY) / (bottomY - horizonY)) * maxRangeM;
      const sweepHalf = halfAt(sweepDistM);
      const sweepAlpha = Math.sin(sweepPhase * Math.PI); // Smooth peak in mid-corridor

      if (sweepAlpha > 0.01) {
        // Radar scan band gradient
        const bandH = Math.max(16, (1 - sweepPhase * 0.5) * 40);
        const scanGrad = ctx.createLinearGradient(0, sweepY - bandH, 0, sweepY + bandH);
        scanGrad.addColorStop(0, 'rgba(16, 185, 129, 0)');
        scanGrad.addColorStop(0.5, `rgba(56, 189, 248, ${0.12 * sweepAlpha})`);
        scanGrad.addColorStop(1, 'rgba(16, 185, 129, 0)');

        ctx.fillStyle = scanGrad;
        ctx.beginPath();
        ctx.moveTo(cx - sweepHalf * 1.05, sweepY - bandH);
        ctx.lineTo(cx + sweepHalf * 1.05, sweepY - bandH);
        ctx.lineTo(cx + sweepHalf * 1.05, sweepY + bandH);
        ctx.lineTo(cx - sweepHalf * 1.05, sweepY + bandH);
        ctx.closePath();
        ctx.fill();

        // Focused radar laser pulse line
        ctx.beginPath();
        ctx.moveTo(cx - sweepHalf, sweepY);
        ctx.quadraticCurveTo(cx, sweepY + sweepHalf * 0.05, cx + sweepHalf, sweepY);
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.45 * sweepAlpha})`;
        ctx.lineWidth = Math.max(1, 2 * (1 - sweepPhase * 0.6));
        ctx.stroke();
      }

      // =========================================================================
      // 6. APPROACHING HAZARD MARKERS (Far → Near perspective billboards)
      // =========================================================================

      const seen = new Set<string>();
      const sorted = [...hazardsRef.current].sort((a, b) => b.distanceM - a.distanceM);

      for (const h of sorted) {
        seen.add(h.id);
        const smoothMap = smoothDistRef.current;
        const prev = smoothMap.get(h.id) ?? h.distanceM;
        const smoothed = prev + (h.distanceM - prev) * Math.min(1, dt * 10);
        smoothMap.set(h.id, smoothed);

        const d = clamp(smoothed, 0, maxRangeM);
        const p = persp(d);
        const y = yAt(d);
        const x = cx + LANE_OFFSET[h.lane] * halfAt(d);
        const scale = 0.55 + p * 1.3;

        // Entrance pop animation
        const ageS = (Date.now() - h.spawnedAt) / 1000;
        const pop = ageS < 0.3 ? 0.55 + (ageS / 0.3) * 0.45 : 1;
        const radius = 16 * scale * pop;
        const color = HAZARD_COLOR[h.kind];

        // One-time expanding entrance shockwave ring
        if (ageS < 0.7) {
          ctx.beginPath();
          ctx.arc(x, y, radius * (1.2 + ageS * 2.5), 0, Math.PI * 2);
          ctx.strokeStyle = hexA(color, 0.7 * (1 - ageS / 0.7));
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }

        // Pulse ripple for high / critical severity
        if (SEVERITY_PULSE[h.severity]) {
          const phase = (pulseRef.current * 0.9) % 1;
          ctx.beginPath();
          ctx.arc(x, y, radius * (1 + phase * 1.6), 0, Math.PI * 2);
          ctx.strokeStyle = hexA(color, 0.55 * (1 - phase));
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Perspective ground shadow anchor
        ctx.beginPath();
        ctx.ellipse(x, y + radius * 0.6, radius * 1.1, radius * 0.35, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fill();

        // Marker Glow Disc
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 20 * scale;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = hexA(color, 0.30);
        ctx.fill();
        ctx.restore();

        // Marker Base Disc (Obsidian glass with colored rim)
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#06070a';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, 2.2 * scale);
        ctx.stroke();

        // Vector hazard icon drawn crisply on the disc
        drawVectorHazardIcon(ctx, h.kind, x, y, radius);

        // Billboard HUD Tag Pill (Title + live distance countdown)
        const label = h.title;
        const dist = `${Math.max(0, Math.round(smoothed))}m`;

        ctx.font = '700 9.5px Inter, system-ui, -apple-system, sans-serif';
        const titleW = ctx.measureText(label).width;
        ctx.font = '800 11px Inter, system-ui, -apple-system, sans-serif';
        const distW = ctx.measureText(dist).width;

        const padX = 7;
        const gap = 6;
        const pillW = padX * 2 + titleW + gap + distW;
        const pillH = 20;
        const pillX = clamp(x - pillW / 2, 6, width - pillW - 6);
        const pillY = Math.max(6, y - radius - pillH - 6);

        // Connector tick from pill to disc
        ctx.beginPath();
        ctx.moveTo(x, pillY + pillH);
        ctx.lineTo(x, y - radius + 1);
        ctx.strokeStyle = hexA(color, 0.6);
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Pill background & border
        ctx.beginPath();
        pillPath(ctx, pillX, pillY, pillW, pillH, 10);
        ctx.fillStyle = 'rgba(6, 8, 12, 0.92)';
        ctx.fill();
        ctx.strokeStyle = hexA(color, 0.65);
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Pill typography
        ctx.textAlign = 'left';
        ctx.font = '600 9.5px Inter, system-ui, -apple-system, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillText(label, pillX + padX, pillY + pillH / 2 + 0.5);

        ctx.font = '800 11px Inter, system-ui, -apple-system, sans-serif';
        ctx.fillStyle = color;
        ctx.fillText(dist, pillX + padX + titleW + gap, pillY + pillH / 2 + 0.5);
      }

      // Cleanup departed hazards
      for (const key of smoothDistRef.current.keys()) {
        if (!seen.has(key)) smoothDistRef.current.delete(key);
      }

      // =========================================================================
      // 7. DYNAMIC EGO VEHICLE AVATAR & NEON WAKE LINES
      // =========================================================================

      const vy = height * 0.89;
      const vw = Math.min(36, width * 0.095);
      const egoColor = coastAlpha > 0.3 ? '#34d399' : '#10b981';

      // Dynamic Speed Wake Lines (scale dynamically with vehicle speed)
      const speedRatio = clamp(speedCurrent / 100, 0, 1.6);
      const wakeLength = 16 + speedRatio * 46;
      const wakeAlpha = 0.25 + speedRatio * 0.6;

      ctx.save();
      ctx.shadowColor = egoColor;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = hexA(egoColor, wakeAlpha);
      ctx.lineWidth = 1.8;

      // Outer wingtip wake trails
      for (const side of [-1, 1]) {
        const wingX = cx + side * vw * 0.62;
        const wingY = vy + vw * 0.5;
        const trailEndX = cx + side * (vw * 0.72 + speedRatio * 4);
        const trailEndY = wingY + wakeLength;

        const wakeGrad = ctx.createLinearGradient(wingX, wingY, trailEndX, trailEndY);
        wakeGrad.addColorStop(0, hexA(egoColor, wakeAlpha));
        wakeGrad.addColorStop(0.7, hexA(egoColor, wakeAlpha * 0.4));
        wakeGrad.addColorStop(1, 'rgba(16, 185, 129, 0)');

        ctx.strokeStyle = wakeGrad;
        ctx.beginPath();
        ctx.moveTo(wingX, wingY);
        ctx.lineTo(trailEndX, trailEndY);
        ctx.stroke();
      }

      // Center thruster twin flow streams
      if (speedCurrent > 5) {
        ctx.setLineDash([5, 4]);
        ctx.lineDashOffset = -pulseRef.current * (speedCurrent * 0.25 + 6);
        for (const side of [-1, 1]) {
          const jetX = cx + side * vw * 0.22;
          const jetY = vy + vw * 0.32;
          ctx.strokeStyle = hexA(egoColor, wakeAlpha * 0.7);
          ctx.beginPath();
          ctx.moveTo(jetX, jetY);
          ctx.lineTo(jetX + side * 2, jetY + wakeLength * 0.75);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      ctx.restore();

      // Futuristic Glowing Vehicle Delta/Chevron Avatar
      ctx.save();
      ctx.shadowColor = egoColor;
      ctx.shadowBlur = 18 + speedRatio * 12;

      // Outer Delta Polygon
      ctx.beginPath();
      ctx.moveTo(cx, vy - vw * 0.82); // Apex
      ctx.lineTo(cx + vw * 0.65, vy + vw * 0.52); // Right wingtip
      ctx.lineTo(cx, vy + vw * 0.20); // Rear center notch
      ctx.lineTo(cx - vw * 0.65, vy + vw * 0.52); // Left wingtip
      ctx.closePath();

      // Metallic Chassis Gradient Fill
      const chassisGrad = ctx.createLinearGradient(cx, vy - vw * 0.82, cx, vy + vw * 0.52);
      chassisGrad.addColorStop(0, '#10b981');
      chassisGrad.addColorStop(0.35, '#064e3b');
      chassisGrad.addColorStop(1, '#022c22');
      ctx.fillStyle = chassisGrad;
      ctx.fill();

      // Neon glowing chassis border
      ctx.strokeStyle = egoColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner Cockpit Core Accent
      ctx.beginPath();
      ctx.moveTo(cx, vy - vw * 0.48);
      ctx.lineTo(cx + vw * 0.22, vy + vw * 0.12);
      ctx.lineTo(cx, vy + vw * 0.02);
      ctx.lineTo(cx - vw * 0.22, vy + vw * 0.12);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      ctx.restore();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [maxRangeM]);

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="absolute inset-0" aria-label="Hazard horizon radar" />
    </div>
  );
}

/**
 * Vector hazard iconography drawn cleanly inside the marker disc.
 * Modeled after Lucide React vector strokes: CircleDot, Waves, CornerUpRight, Droplets, CarFront.
 */
function drawVectorHazardIcon(
  ctx: CanvasRenderingContext2D,
  kind: HorizonHazard['kind'],
  x: number,
  y: number,
  r: number,
): void {
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.3, r * 0.17);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const u = r * 0.52; // glyph scaling unit

  switch (kind) {
    case 'pothole': {
      // CircleDot motif: Outer crater rim with crimson center core dot
      ctx.beginPath();
      ctx.ellipse(x, y, u * 1.15, u * 0.65, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      // Center core point
      ctx.beginPath();
      ctx.arc(x, y, u * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = '#f43f5e';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, r * 0.1);
      ctx.stroke();
      break;
    }

    case 'speed_bump': {
      // Waves motif: Dual sleek aerodynamic wave humps
      for (const dy of [-u * 0.25, u * 0.45]) {
        ctx.beginPath();
        ctx.moveTo(x - u * 1.15, y + dy);
        ctx.quadraticCurveTo(x - u * 0.55, y + dy - u * 0.55, x, y + dy);
        ctx.quadraticCurveTo(x + u * 0.55, y + dy + u * 0.55, x + u * 1.15, y + dy);
        ctx.stroke();
      }
      break;
    }

    case 'sharp_curve': {
      // CornerUpRight motif: Crisp 90-degree corner arrow turning up and right
      ctx.beginPath();
      ctx.moveTo(x - u * 0.75, y + u * 0.85);
      ctx.lineTo(x - u * 0.75, y - u * 0.2);
      ctx.quadraticCurveTo(x - u * 0.75, y - u * 0.75, x - u * 0.2, y - u * 0.75);
      ctx.lineTo(x + u * 0.55, y - u * 0.75);
      ctx.stroke();

      // Arrowhead
      ctx.beginPath();
      ctx.moveTo(x + u * 0.2, y - u * 1.15);
      ctx.lineTo(x + u * 0.9, y - u * 0.75);
      ctx.lineTo(x + u * 0.2, y - u * 0.35);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'water_pooling': {
      // Droplets motif: Water teardrop with subtle ripple
      // Teardrop top apex
      ctx.beginPath();
      ctx.moveTo(x, y - u * 0.95);
      ctx.quadraticCurveTo(x + u * 0.75, y - u * 0.15, x + u * 0.75, y + u * 0.35);
      ctx.arc(x, y + u * 0.35, u * 0.75, 0, Math.PI, false);
      ctx.quadraticCurveTo(x - u * 0.75, y - u * 0.15, x, y - u * 0.95);
      ctx.closePath();
      ctx.fillStyle = '#38bdf8';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, r * 0.12);
      ctx.stroke();
      break;
    }

    case 'traffic_queue': {
      // CarFront motif: Sleek automotive silhouette (windshield, roof, headlights)
      const cw = u * 1.3;
      const ch = u * 0.95;
      const cy = y - u * 0.1;

      // Chassis outline
      ctx.beginPath();
      ctx.roundRect(x - cw / 2, cy - ch / 2, cw, ch, u * 0.25);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      // Windshield bar
      ctx.beginPath();
      ctx.moveTo(x - cw * 0.35, cy - ch * 0.05);
      ctx.lineTo(x + cw * 0.35, cy - ch * 0.05);
      ctx.stroke();

      // Headlight dots
      ctx.fillStyle = '#10b981';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(x + side * cw * 0.32, cy + ch * 0.26, u * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }

  ctx.restore();
}

/** Rounded-rect path helper with fallback for environments lacking native roundRect. */
function pillPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Hex color + alpha channel helper. */
function hexA(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}


