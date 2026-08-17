'use client';

/**
 * /driver — RoadScore Immersive Automotive Driver View & HUD Co-Pilot
 *
 * Driver-centric, uncluttered, full-bleed automotive glass cockpit:
 *  - 100% full-screen immersive forward viewport (Zero wasted static chrome)
 *  - 300m Hazard Horizon Perspective Radar with dynamic road grid & ego vehicle chevron
 *  - Floating High-Contrast Speedometer & Vienna Regulatory Speed Limit Sign
 *  - Floating TrueScore™ Active Shield Badge (Top-Left)
 *  - Floating Single-Hazard Next Action HUD Capsule (Top-Center)
 *  - Floating Compact Aerospace G-Meter Orb (Bottom-Right)
 *  - High-Tech Dark Live Spatial Map (Desktop 58/42 split or Mobile 1-Tap Toggle)
 *  - Single-Alert Smart Assist Notification Capsule (Zero Emojis, Auto-Dismiss TTL Progress)
 *  - 1-Tap Windshield HUD Mode (OLED mirror flip scaleX(-1))
 *  - Hands-Free Auto-Drive Simulation Studio & Fastify SSE Live Stream
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ShieldCheck,
  Moon,
  Mic,
  MicOff,
  FlaskConical,
  Compass,
  Map as MapIcon,
  Radio,
  Car,
} from 'lucide-react';

import { HazardHorizonRadar } from '@/components/driver/HazardHorizonRadar';
import { NextHazardBar } from '@/components/driver/NextHazardBar';
import { SpeedHero } from '@/components/driver/SpeedHero';
import { RideDynamicsOrb } from '@/components/driver/RideDynamicsOrb';
import { TripMap } from '@/components/driver/TripMap';
import { HudMinimalLayout } from '@/components/driver/HudMinimalLayout';
import { TrueScoreCards, type AssistCard } from '@/components/driver/TrueScoreCards';
import { SimulationStudioDrawer } from '@/components/driver/SimulationStudioDrawer';
import { LaunchModal } from '@/components/driver/LaunchModal';
import { DevicePairModal } from '@/components/driver/DevicePairModal';
import { CrashEmergencyModal } from '@/components/driver/CrashEmergencyModal';
import { type EventPulse } from '@/components/map/OSMMap';
import { type VehicleOrbUnit } from '@/components/driver/VehicleOrbSelector';

import { DemoSimulator, type CockpitSnapshot } from '@/lib/sim/demoSimulator';
import { driverVoice } from '@/lib/audio/driverVoice';
import { createClient } from '@/lib/supabase/client';
import {
  useRealtimeStream,
  type TelemetryPacket,
  type DrivingEventPacket,
} from '@/lib/realtime/useRealtimeStream';

const LANE_PAN = { left: -0.7, center: 0, right: 0.7 } as const;

const DRIVER_COLORS = ['#06b6d4', '#f59e0b', '#a855f7', '#10b981', '#ec4899', '#3b82f6'];

const INITIAL_UNITS: VehicleOrbUnit[] = [
  {
    deviceId: 'ROADSCORE_001',
    driverName: 'Gavesh Saparamadu',
    vehiclePlate: 'WP CAB-4821 (Toyota Prius)',
    color: '#06b6d4',
  },
  {
    deviceId: 'DUMMY-001',
    driverName: 'Timesh Dillon',
    vehiclePlate: 'WP GA-9012 (Honda Civic)',
    color: '#f59e0b',
  },
  {
    deviceId: 'DUMMY-002',
    driverName: 'Siluna De Silva',
    vehiclePlate: 'WP KI-3341 (Nissan Leaf)',
    color: '#a855f7',
  },
];

let cardSeq = 0;

function DriverCockpit() {
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  // ---- Core Cockpit State ------------------------------------------------
  const [snapshot, setSnapshot] = useState<CockpitSnapshot | null>(null);
  const [cards, setCards] = useState<AssistCard[]>([]);
  const [mapPulses, setMapPulses] = useState<EventPulse[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Array<[number, number]>>([]);

  const [activeTab, setActiveTab] = useState<'radar' | 'map'>('radar');
  const [launched, setLaunched] = useState(false);
  const [hudMode, setHudMode] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [hapticsOn, setHapticsOn] = useState(true);
  const [simOpen, setSimOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);

  // URL auto-pairing (?device=ROADSCORE_001), default firmly to ROADSCORE_001 to prevent cross-driver bouncing
  const deviceParam = searchParams.get('device');
  const [pairedDevice, setPairedDevice] = useState<string>(() => deviceParam || 'ROADSCORE_001');
  const deviceId = pairedDevice;
  const [liveActive, setLiveActive] = useState(false);

  // Vehicle Fleet Units & Live Telemetry Speeds for Orb Selector
  const [vehicleUnits, setVehicleUnits] = useState<VehicleOrbUnit[]>(INITIAL_UNITS);
  const [liveDeviceSpeeds, setLiveDeviceSpeeds] = useState<Record<string, { speedKmh: number; lastSeen: number }>>({});

  useEffect(() => {
    async function loadDrivers() {
      try {
        const { data: drivers } = await supabase
          .from('drivers')
          .select('driver_id, full_name, assigned_vehicle, assigned_device_id');
        if (drivers && drivers.length > 0) {
          const mapped: VehicleOrbUnit[] = drivers
            .filter((d: any) => d.assigned_device_id)
            .map((d: any, idx: number) => ({
              deviceId: d.assigned_device_id,
              driverName: d.full_name,
              vehiclePlate: d.assigned_vehicle || 'Fleet Vehicle',
              color: DRIVER_COLORS[idx % DRIVER_COLORS.length],
            }));
          if (mapped.length > 0) {
            setVehicleUnits(mapped);
          }
        }
      } catch {
        // Fallback to initial units
      }
    }
    loadDrivers();
  }, [supabase]);

  // Compute live active state and speed for each orb
  const dynamicUnits: VehicleOrbUnit[] = useMemo(() => {
    return vehicleUnits.map((u) => {
      const live = liveDeviceSpeeds[u.deviceId];
      const isLiveRecent = live && Date.now() - live.lastSeen < 4000;
      return {
        ...u,
        speedKmh: isLiveRecent ? live.speedKmh : undefined,
        isLive: !!isLiveRecent,
      };
    });
  }, [vehicleUnits, liveDeviceSpeeds]);

  const activeUnit = useMemo(() => {
    return dynamicUnits.find((u) => u.deviceId === deviceId) || dynamicUnits[0];
  }, [dynamicUnits, deviceId]);

  // Severe Crash & 911 SOS State
  const [crashOpen, setCrashOpen] = useState(false);
  const [crashData, setCrashData] = useState<{ lat: number; lon: number; speedKmh: number; impactG: number }>({
    lat: 6.9271,
    lon: 79.8612,
    speedKmh: 62,
    impactG: 6.8,
  });

  const simRef = useRef<DemoSimulator | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const cardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveFeedUntilRef = useRef(0);

  // ---- Vibration Helper --------------------------------------------------
  const triggerHaptic = useCallback(
    (pattern: number[]) => {
      if (!hapticsOn || typeof window === 'undefined') return;
      try {
        if ('vibrate' in navigator) {
          navigator.vibrate(pattern);
        }
      } catch {
        // Haptics unavailable
      }
    },
    [hapticsOn],
  );

  // ---- Single Active Notification Queue ----------------------------------
  const dismissCard = useCallback((id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
    if (cardTimerRef.current) {
      clearTimeout(cardTimerRef.current);
      cardTimerRef.current = null;
    }
  }, []);

  const pushCard = useCallback(
    (kind: AssistCard['kind'], title: string, message: string, ttlMs: number) => {
      if (cardTimerRef.current) {
        clearTimeout(cardTimerRef.current);
        cardTimerRef.current = null;
      }

      cardSeq += 1;
      const id = `card_${Date.now().toString(36)}_${cardSeq}`;
      // Strictly 1 single alert active at any time
      setCards([{ id, kind, title, message, createdAt: Date.now(), ttlMs }]);

      cardTimerRef.current = setTimeout(() => {
        setCards((prev) => prev.filter((c) => c.id !== id));
        cardTimerRef.current = null;
      }, ttlMs);
    },
    [],
  );

  // ---- Simulator Lifecycle & Event Routing -------------------------------
  useEffect(() => {
    const sim = new DemoSimulator();
    simRef.current = sim;
    sim.start();

    const unsubSnap = sim.subscribe((snap) => {
      setSnapshot(snap);

      // Track breadcrumbs for map trail
      if (snap.position) {
        setBreadcrumbs((prev) => {
          const last = prev[prev.length - 1];
          if (!last) return [[snap.position.lat, snap.position.lon]];
          const dLat = Math.abs(last[0] - snap.position.lat);
          const dLon = Math.abs(last[1] - snap.position.lon);
          // Only append when moved at least ~3 meters
          if (dLat > 0.00003 || dLon > 0.00003) {
            return [...prev.slice(-500), [snap.position.lat, snap.position.lon]];
          }
          return prev;
        });
      }
    });

    const unsubEvt = sim.onEvent((e) => {
      switch (e.type) {
        case 'hazard-spawned': {
          driverVoice.announce(e.hazard.speech, 1, {
            chime: 'hazard',
            pan: LANE_PAN[e.hazard.lane],
          });
          triggerHaptic([80, 40, 80]);
          break;
        }
        case 'hazard-approaching': {
          driverVoice.announce(
            `${e.hazard.title}, ${Math.max(10, Math.round(e.hazard.distanceM / 10) * 10)} meters`,
            1,
            { chime: 'hazard', pan: LANE_PAN[e.hazard.lane] },
          );
          triggerHaptic([60]);
          break;
        }
        case 'hazard-passed': {
          break;
        }
        case 'exoneration': {
          driverVoice.announce(
            'TrueScore Shield. Harsh braking recognized as hazard avoidance. Zero points deducted.',
            2,
            { chime: 'exoneration' },
          );
          triggerHaptic([40]);
          pushCard('exoneration', e.title, e.message, 7000);

          if (simRef.current) {
            const snap = simRef.current.getSnapshot();
            const pulseId = `pulse_${Date.now()}`;
            setMapPulses((prev) => [
              ...prev.slice(-3),
              {
                id: pulseId,
                lat: snap.position.lat,
                lon: snap.position.lon,
                type: 'exoneration',
                severity: 'low',
              },
            ]);
            setTimeout(() => {
              setMapPulses((prev) => prev.filter((p) => p.id !== pulseId));
            }, 3000);
          }
          break;
        }
        case 'deduction': {
          driverVoice.chime('harsh');
          triggerHaptic([120, 60, 120]);
          pushCard('deduction', e.title, e.message, 5500);
          break;
        }
        case 'eco-tip': {
          driverVoice.announce(e.message, 3, { chime: 'eco' });
          pushCard('eco', e.title, e.message, 6000);
          break;
        }
        case 'harsh-maneuver': {
          break;
        }
        case 'severe-crash': {
          setCrashData({
            lat: e.lat,
            lon: e.lon,
            speedKmh: e.speedKmh,
            impactG: e.impactG,
          });
          setCrashOpen(true);
          triggerHaptic([300, 100, 300, 100, 500]);
          break;
        }
        case 'trip-started': {
          pushCard('info', 'Trip Started', 'Continuous telematics active.', 3500);
          break;
        }
        case 'trip-ended': {
          pushCard(
            'info',
            'Trip Completed',
            `Distance: ${(e.stats.distanceM / 1000).toFixed(1)} km · ${e.stats.hazardsCleared} hazards negotiated`,
            5000,
          );
          break;
        }
      }
    });

    return () => {
      unsubSnap();
      unsubEvt();
      sim.stop();
      simRef.current = null;
      if (cardTimerRef.current) clearTimeout(cardTimerRef.current);
    };
  }, [pushCard, triggerHaptic]);

  // ---- Dual-Stream: Fastify SSE Live Telemetry + Simulation Fallback ----
  const handleTelemetry = useCallback(
    (t: TelemetryPacket) => {
      const rawGps = t.gps as Record<string, unknown> | null | undefined;
      const rawRecord = t as Record<string, unknown>;
      const speedKmh =
        typeof rawGps?.speed_kmh === 'number'
          ? rawGps.speed_kmh
          : typeof rawRecord.speed_kmh === 'number'
            ? (rawRecord.speed_kmh as number)
            : typeof rawRecord.speed === 'number'
              ? (rawRecord.speed as number)
              : 0;

      // Update live status for this device in our fleet map
      if (t.device_id) {
        setLiveDeviceSpeeds((prev) => ({
          ...prev,
          [t.device_id]: { speedKmh, lastSeen: Date.now() },
        }));
      }

      // STRICT ISOLATION: Reject telemetry from any other vehicle to prevent bouncing
      const targetId = deviceId || 'ROADSCORE_001';
      if (t.device_id !== targetId) return;

      if (speedKmh == null && !rawGps) return;

      const effectiveSpeed = speedKmh ?? 0;
      const rawAccel = t.accel_cal as Record<string, unknown> | null | undefined;
      const aLong = typeof rawAccel?.a_long === 'number' ? rawAccel.a_long : undefined;
      const aLat = typeof rawAccel?.a_lat === 'number' ? rawAccel.a_lat : undefined;
      const lat =
        (typeof rawGps?.lat === 'number' ? (rawGps.lat as number) : undefined) ??
        (typeof rawRecord.lat === 'number' ? (rawRecord.lat as number) : undefined);
      const lon =
        (typeof rawGps?.lon === 'number' ? (rawGps.lon as number) : undefined) ??
        (typeof rawRecord.lon === 'number' ? (rawRecord.lon as number) : undefined);
      const headingDeg =
        (typeof rawGps?.heading === 'number' ? (rawGps.heading as number) : undefined) ??
        (typeof rawRecord.heading === 'number' ? (rawRecord.heading as number) : undefined);

      liveFeedUntilRef.current = Date.now() + 3500;
      simRef.current?.ingestLiveTelemetry({
        speedKmh: effectiveSpeed,
        aLong,
        aLat,
        lat,
        lon,
        headingDeg,
      });
    },
    [deviceId],
  );

  const handleDrivingEvent = useCallback(
    (e: DrivingEventPacket) => {
      const targetId = deviceId || 'ROADSCORE_001';
      if (e.device_id && e.device_id !== targetId) return;
      simRef.current?.ingestLiveDrivingEvent({
        type: e.type,
        magnitude: e.magnitude,
        severity: e.severity,
      });
    },
    [deviceId],
  );

  const handleTripChange = useCallback(
    (payload: any) => {
      if (!payload) return;
      if (deviceId && payload.device_id && payload.device_id !== deviceId) return;
      if (payload.status === 'in_progress' || payload.started_at) {
        pushCard(
          'info',
          'Live Trip Linked',
          `Continuous telematics recording from ${payload.device_id || deviceId || 'hardware'}.`,
          4000,
        );
      } else if (payload.status === 'completed' || payload.ended_at) {
        pushCard(
          'info',
          'Trip Completed',
          `Trip closed · Distance: ${((payload.distance_m || 0) / 1000).toFixed(1)} km`,
          5000,
        );
      }
    },
    [deviceId, pushCard],
  );

  const { isSseActive } = useRealtimeStream({
    supabase,
    onTelemetry: handleTelemetry,
    onDrivingEvent: handleDrivingEvent,
    onTripChange: handleTripChange,
    enabled: launched,
  });

  // Track live freshness
  useEffect(() => {
    const id = setInterval(() => {
      const live = Date.now() < liveFeedUntilRef.current;
      setLiveActive(live);
      if (!live) simRef.current?.setLiveFeed(null);
    }, 500);
    return () => clearInterval(id);
  }, []);

  // ---- Screen Wake Lock & Launch Handler ---------------------------------
  const requestWakeLock = useCallback(async () => {
    try {
      const nav = navigator as unknown as {
        wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
      };
      if (nav.wakeLock) {
        wakeLockRef.current = await nav.wakeLock.request('screen');
      }
    } catch {
      // Wake lock is best effort
    }
  }, []);

  useEffect(() => {
    if (!launched) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void requestWakeLock();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      wakeLockRef.current?.release().catch(() => undefined);
      wakeLockRef.current = null;
    };
  }, [launched, requestWakeLock]);

  const handleLaunch = useCallback(() => {
    driverVoice.prime();
    driverVoice.setEnabled(voiceOn);
    void requestWakeLock();
    setLaunched(true);
    driverVoice.announce(
      'RoadScore co-pilot active. TrueScore shield is armed. Drive safe.',
      2,
      { chime: 'exoneration' },
    );
  }, [voiceOn, requestWakeLock]);

  const toggleVoice = useCallback(() => {
    setVoiceOn((v) => {
      const next = !v;
      driverVoice.setEnabled(next);
      return next;
    });
  }, []);

  const toggleHud = useCallback(() => {
    setHudMode((v) => !v);
  }, []);

  const handlePair = useCallback(
    (id: string) => {
      setPairedDevice(id);
      setPairOpen(false);
      pushCard('info', 'Unit Paired', `Cockpit linked to ${id}.`, 4000);
    },
    [pushCard],
  );

  // ---- Derived Values & Dismissal --------------------------------------
  const [dismissedHazardIds, setDismissedHazardIds] = useState<Set<string>>(new Set());
  const dismissHazard = useCallback((id: string) => {
    setDismissedHazardIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    simRef.current?.dismissHazard(id);
  }, []);

  const snap = snapshot;
  const isLive = launched && liveActive;
  const feedLabel = isLive ? 'LIVE' : isSseActive ? 'STANDBY' : 'SIM';
  const nextHazard =
    snap && snap.hazards.length > 0
      ? snap.hazards.find((h) => !dismissedHazardIds.has(h.id)) ?? null
      : null;

  // Minimal windshield HUD if HUD mode is toggled
  if (hudMode) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col bg-black text-white select-none"
        style={{ transform: 'scaleX(-1)' }}
      >
        <HudMinimalLayout
          speedKmh={snap?.speedKmh ?? 0}
          speedLimitKmh={snap?.speedLimitKmh ?? 60}
          nextHazard={nextHazard}
          score={snap?.score ?? 100}
          coasting={snap?.coasting ?? false}
          onExit={toggleHud}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black text-white select-none overflow-hidden font-sans">
      {/* ================================================================= */}
      {/* TOP FLOATING HUD BAR (Non-Intrusive, Zero Flex Height Consumption) */}
      {/* ================================================================= */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex items-center justify-between gap-2">
        {/* Top-Left: Floating TrueScore Shield Pill */}
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-emerald-500/40 bg-black/80 px-3 py-1.5 backdrop-blur-xl shadow-xl shadow-black/80">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-live-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <ShieldCheck size={14} className="text-emerald-400" />
          <span className="text-xs font-mono font-black text-white tracking-tight">
            {snap?.score ?? 100}
          </span>
          <span className="hidden sm:inline text-[9px] font-mono font-bold uppercase tracking-wider text-emerald-400/90">
            TrueScore™
          </span>
        </div>

        {/* Top-Center: Floating Next Hazard Capsule */}
        <div className="flex-1 max-w-sm sm:max-w-md mx-auto flex justify-center px-2">
          <NextHazardBar hazard={nextHazard} onDismiss={dismissHazard} />
        </div>

        {/* Top-Right: Floating Glass Control Buttons */}
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-zinc-800/80 bg-black/80 p-1 backdrop-blur-xl shadow-xl shadow-black/80">
          {/* Voice Co-Pilot Toggle */}
          <button
            onClick={toggleVoice}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-all ${
              voiceOn
                ? 'bg-emerald-950/80 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
            title={voiceOn ? 'Voice Co-Pilot Active' : 'Voice Co-Pilot Muted'}
            aria-label={voiceOn ? 'Mute voice' : 'Enable voice'}
          >
            {voiceOn ? <Mic size={14} /> : <MicOff size={14} />}
          </button>

          {/* Windshield HUD Flip */}
          <button
            onClick={toggleHud}
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:text-white transition-all"
            title="Windshield HUD Mode"
            aria-label="Windshield HUD Mode"
          >
            <Moon size={14} />
          </button>

          {/* Simulation Studio Drawer */}
          <button
            onClick={() => setSimOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-violet-400 hover:text-violet-200 transition-all"
            title="Simulation Studio"
            aria-label="Open Simulation Studio"
          >
            <FlaskConical size={14} />
          </button>

          {/* Active Vehicle Orb Selector in Top Bar */}
          <button
            onClick={() => setPairOpen(true)}
            className="flex items-center gap-2 rounded-full border border-zinc-800 bg-black/80 py-1 px-3 backdrop-blur-xl shadow-xl shadow-black/80 hover:border-emerald-500/50 hover:bg-zinc-900 transition-all cursor-pointer"
            title="Click to switch vehicle / hardware unit"
          >
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center border shadow-sm"
              style={{
                backgroundColor: `${activeUnit?.color || '#10b981'}33`,
                borderColor: activeUnit?.color || '#10b981',
              }}
            >
              <Car size={11} style={{ color: activeUnit?.color || '#10b981' }} />
            </div>
            <div className="flex flex-col text-left">
              <span className="text-[10px] font-mono font-bold text-white leading-tight">
                {activeUnit?.deviceId || deviceId || 'ROADSCORE_001'}
              </span>
              <span className="text-[8px] text-zinc-400 leading-none truncate max-w-[90px]">
                {activeUnit?.driverName || 'Driver'}
              </span>
            </div>
            <Radio size={10} className={isLive ? 'text-emerald-400 animate-pulse ml-0.5' : 'text-zinc-600 ml-0.5'} />
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* FULL-BLEED HORIZON VIEWPORT (100% Height, Unobstructed Perspective) */}
      {/* ================================================================= */}
      <main className="relative flex-1 h-full w-full overflow-hidden min-h-0 lg:grid lg:grid-cols-12">
        {/* Primary Radar Horizon (Left Column on Desktop, Full Screen on Mobile) */}
        <div
          className={`relative h-full w-full overflow-hidden bg-black ${
            activeTab === 'radar' ? 'block' : 'hidden lg:block'
          } lg:col-span-7`}
        >
          <HazardHorizonRadar
            hazards={snap?.hazards ?? []}
            speedKmh={snap?.speedKmh ?? 0}
            coasting={snap?.coasting ?? false}
            className="absolute inset-0 h-full w-full"
          />
        </div>

        {/* Live Spatial Map (Right Column on Desktop, Full Screen on Mobile Tab) */}
        <div
          className={`relative h-full w-full overflow-hidden bg-zinc-950 lg:border-l lg:border-zinc-900/80 ${
            activeTab === 'map' ? 'block' : 'hidden lg:block'
          } lg:col-span-5`}
        >
          {snap ? (
            <TripMap
              position={snap.position}
              breadcrumbs={breadcrumbs}
              hazards={snap.hazards}
              trip={snap.trip}
              speedKmh={snap.speedKmh}
              pulses={mapPulses}
              className="h-full w-full"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs font-mono text-zinc-600 font-bold uppercase tracking-wider">
              Initializing Spatial Map…
            </div>
          )}
        </div>

        {/* =============================================================== */}
        {/* FLOATING CORNER COCKPIT INSTRUMENTS                             */}
        {/* =============================================================== */}

        {/* Bottom-Left: Floating Speedometer & Regulatory Speed Limit Sign */}
        <div className="pointer-events-none absolute bottom-4 left-4 z-20">
          <SpeedHero
            speedKmh={snap?.speedKmh ?? 0}
            speedLimitKmh={snap?.speedLimitKmh ?? 60}
            coasting={snap?.coasting ?? false}
          />
        </div>

        {/* Bottom-Right: Floating Compact G-Meter Orb */}
        <div className="pointer-events-none absolute bottom-4 right-4 z-20 flex flex-col items-end gap-1">
          <div className="rounded-2xl border border-zinc-800/80 bg-black/75 p-1.5 backdrop-blur-xl shadow-xl shadow-black/80">
            <RideDynamicsOrb
              aLong={snap?.g.aLong ?? 0}
              aLat={snap?.g.aLat ?? 0}
              className="h-16 w-16 sm:h-20 sm:w-20"
            />
          </div>
        </div>

        {/* Floating View Switcher Pill (Shifted right to keep central road & vehicle avatar clear) */}
        <div className="pointer-events-auto absolute bottom-4 right-20 sm:right-28 z-20 lg:hidden">
          <div className="flex rounded-full border border-zinc-800/90 bg-black/85 p-1 backdrop-blur-xl shadow-2xl">
            <button
              onClick={() => setActiveTab('radar')}
              className={`flex items-center gap-1.5 rounded-full px-3.5 sm:px-4 py-1.5 text-xs font-mono font-bold transition-all ${
                activeTab === 'radar'
                  ? 'bg-zinc-800 text-white shadow-md'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Compass size={13} />
              Radar
            </button>
            <button
              onClick={() => setActiveTab('map')}
              className={`flex items-center gap-1.5 rounded-full px-3.5 sm:px-4 py-1.5 text-xs font-mono font-bold transition-all ${
                activeTab === 'map'
                  ? 'bg-zinc-800 text-white shadow-md'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <MapIcon size={13} />
              Map
            </button>
          </div>
        </div>

        {/* Floating Single-Alert Notification Banner */}
        <div className="pointer-events-none absolute inset-x-4 bottom-16 sm:bottom-20 z-30 flex justify-center">
          <TrueScoreCards cards={cards} onDismiss={dismissCard} />
        </div>
      </main>

      {/* ===== Presenter & Auto-Drive Simulation Drawer =================== */}
      <SimulationStudioDrawer
        open={simOpen}
        onClose={() => setSimOpen(false)}
        speedKmh={snap?.speedKmh ?? 0}
        onSpeedChange={(v) => simRef.current?.setTargetSpeed(v)}
        onTriggerPothole={() => simRef.current?.triggerPothole(60)}
        onTriggerSpeedBump={() => simRef.current?.triggerSpeedBump(40)}
        onTriggerSharpCurve={() => simRef.current?.triggerSharpCurve(180)}
        onTriggerWaterPooling={() => simRef.current?.triggerWaterPooling(120)}
        onSlamBrakes={() => simRef.current?.slamBrakesAndExonerate()}
        onTriggerEcoGlide={() => simRef.current?.triggerEcoGlide()}
        onTriggerSevereCrash={() => simRef.current?.triggerSevereCrash()}
        hudMode={hudMode}
        onToggleHud={toggleHud}
        liveActive={isLive}
        autoDrive={snap?.autoDrive ?? false}
        onToggleAutoDrive={() => simRef.current?.toggleAutoDrive()}
        hapticsOn={hapticsOn}
        onToggleHaptics={() => setHapticsOn((h) => !h)}
      />

      {/* ===== Severe Crash & 911 Emergency Modal ========================= */}
      <CrashEmergencyModal
        open={crashOpen}
        lat={crashData.lat}
        lon={crashData.lon}
        speedBeforeImpactKmh={crashData.speedKmh}
        impactG={crashData.impactG}
        deviceId={deviceId || 'RS-DEV-DEMO'}
        tripId={snap?.trip?.startedAt ? `trip-${snap.trip.startedAt}` : null}
        onClose={() => setCrashOpen(false)}
      />

      {/* ===== Hardware Pairing Modal ===================================== */}
      <DevicePairModal
        open={pairOpen}
        currentDevice={deviceId}
        units={dynamicUnits}
        onPair={handlePair}
        onClose={() => setPairOpen(false)}
      />

      {/* ===== Audio Priming & Launch Modal =============================== */}
      <LaunchModal
        open={!launched}
        deviceId={deviceId}
        feedLabel={feedLabel}
        units={dynamicUnits}
        onSelectDevice={(id) => setPairedDevice(id)}
        onLaunch={handleLaunch}
      />
    </div>
  );
}

export default function DriverPage() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black text-[11px] font-mono font-bold uppercase tracking-widest text-zinc-500">
          Loading Co-Pilot…
        </div>
      }
    >
      <DriverCockpit />
    </Suspense>
  );
}
