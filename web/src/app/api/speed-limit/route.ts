import { NextRequest, NextResponse } from 'next/server';

interface SpeedLimitCacheEntry {
  speedLimitKmh: number;
  roadName: string;
  highwayType: string;
  timestamp: number;
}

// In-memory spatial cache (grid resolution ~60m)
const cache = new Map<string, SpeedLimitCacheEntry>();
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes

function getSpatialCacheKey(lat: number, lon: number): string {
  // Round to ~60m spatial buckets
  const latKey = (Math.round(lat * 1500) / 1500).toFixed(4);
  const lonKey = (Math.round(lon * 1500) / 1500).toFixed(4);
  return `${latKey},${lonKey}`;
}

function parseMaxSpeed(maxspeedTag?: string, highwayTag?: string): number {
  if (maxspeedTag) {
    const clean = maxspeedTag.trim().toLowerCase();
    
    // Country-specific preset codes
    if (clean.includes('motorway') || clean.includes('expressway')) return 100;
    if (clean.includes('rural')) return 70;
    if (clean.includes('urban')) return 50;
    
    // Numeric parsing
    if (clean.includes('mph')) {
      const num = parseFloat(clean);
      if (Number.isFinite(num) && num > 0) {
        return Math.round(num * 1.60934);
      }
    }
    
    const num = parseFloat(clean);
    if (Number.isFinite(num) && num > 0 && num <= 250) {
      return Math.round(num);
    }
  }

  // Highway classification fallback (Vienna / Sri Lanka Road Standard)
  switch (highwayTag) {
    case 'motorway':
    case 'motorway_link':
      return 100;
    case 'trunk':
    case 'trunk_link':
      return 70;
    case 'primary':
    case 'primary_link':
      return 60;
    case 'secondary':
    case 'secondary_link':
      return 50;
    case 'tertiary':
    case 'tertiary_link':
      return 50;
    case 'unclassified':
      return 50;
    case 'residential':
      return 40;
    case 'living_street':
    case 'service':
    case 'pedestrian':
      return 30;
    default:
      return 60;
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const latStr = searchParams.get('lat');
    const lonStr = searchParams.get('lon');

    if (!latStr || !lonStr) {
      return NextResponse.json(
        { error: 'lat and lon query parameters required' },
        { status: 400 },
      );
    }

    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 });
    }

    const cacheKey = getSpatialCacheKey(lat, lon);
    const cached = cache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return NextResponse.json({
        speedLimitKmh: cached.speedLimitKmh,
        roadName: cached.roadName,
        highwayType: cached.highwayType,
        cached: true,
      });
    }

    // Query Overpass API with a strict 3-second timeout
    const overpassQuery = `[out:json][timeout:3];way(around:45,${lat},${lon})[highway];out tags 1;`;
    const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(
      overpassQuery,
    )}`;

    let speedLimitKmh = 60;
    let roadName = 'Road Network';
    let highwayType = 'primary';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3200);

    try {
      const resp = await fetch(overpassUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'RoadScore-CoPilot/1.0 (telematics@roadscore.io)',
        },
      });

      if (resp.ok) {
        const data = await resp.json();
        const element = data?.elements?.[0];
        if (element && element.tags) {
          const tags = element.tags;
          highwayType = tags.highway || 'primary';
          speedLimitKmh = parseMaxSpeed(tags.maxspeed, highwayType);
          roadName = tags.name || tags.ref || `${highwayType.toUpperCase()} Road`;
        }
      }
    } catch {
      // If Overpass timed out or failed, check coordinates for broad urban vs expressway context
      // Expressway corridor Colombo-Katunayake or Southern Expressway check
      if (lat >= 6.98 && lat <= 7.18 && lon >= 79.86 && lon <= 79.91) {
        speedLimitKmh = 100;
        highwayType = 'motorway';
        roadName = 'Colombo - Katunayake Expressway (E03)';
      } else if (lat < 6.85 && lon > 79.92) {
        speedLimitKmh = 100;
        highwayType = 'motorway';
        roadName = 'Southern Expressway (E01)';
      } else {
        speedLimitKmh = 60;
        highwayType = 'primary';
        roadName = 'City Corridor';
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const result: SpeedLimitCacheEntry = {
      speedLimitKmh,
      roadName,
      highwayType,
      timestamp: now,
    };

    // Cache clean-up if memory grows large
    if (cache.size > 2000) {
      cache.clear();
    }
    cache.set(cacheKey, result);

    return NextResponse.json({
      speedLimitKmh,
      roadName,
      highwayType,
      cached: false,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        speedLimitKmh: 60,
        roadName: 'Roadway',
        highwayType: 'primary',
        error: error?.message,
      },
      { status: 200 },
    );
  }
}
