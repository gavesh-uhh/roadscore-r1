import { NextRequest, NextResponse } from 'next/server';

export interface EmergencyDispatchRecord {
  id: string;
  eventId: string;
  deviceId: string;
  tripId?: string | null;
  lat: number;
  lon: number;
  speedBeforeImpactKmh: number;
  impactG: number;
  status: 'pre_alert' | 'confirmed_dispatch' | 'cancelled_by_driver' | 'resolved';
  createdAt: string;
  dispatchedAt?: string | null;
  emsUnit?: string;
  etaMinutes?: number;
  liveMapUrl: string;
}

// In-memory active emergency cache for high-speed fleet sync & simulation
const activeDispatches = new Map<string, EmergencyDispatchRecord>();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      eventId = `crash-${Date.now()}`,
      deviceId = 'RS-DEV-DEMO',
      tripId = null,
      lat = 12.9716,
      lon = 77.5946,
      speedBeforeImpactKmh = 62,
      impactG = 6.8,
      status = 'confirmed_dispatch',
    } = body;

    const id = body.id || `sos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const liveMapUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;

    const record: EmergencyDispatchRecord = {
      id,
      eventId,
      deviceId,
      tripId,
      lat,
      lon,
      speedBeforeImpactKmh,
      impactG,
      status,
      createdAt: new Date().toISOString(),
      dispatchedAt: status === 'confirmed_dispatch' ? new Date().toISOString() : null,
      emsUnit: status === 'confirmed_dispatch' ? 'EMS-PARAMEDIC-09' : undefined,
      etaMinutes: status === 'confirmed_dispatch' ? 4 : undefined,
      liveMapUrl,
    };

    if (status === 'cancelled_by_driver' || status === 'resolved') {
      activeDispatches.delete(id);
    } else {
      activeDispatches.set(id, record);
    }

    // In a production setup, here we would invoke Twilio Voice/SMS or eCall webhook:
    // console.log('[eCall / 911 Webhook Triggered]', record);

    return NextResponse.json({
      success: true,
      dispatch: record,
      message:
        status === 'cancelled_by_driver'
          ? 'Emergency dispatch cancelled by driver.'
          : 'Emergency services (911/EMS) notified with telemetry incident packet.',
    });
  } catch (error) {
    console.error('Error in /api/emergency/dispatch:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process emergency dispatch.' },
      { status: 500 }
    );
  }
}

export async function GET() {
  const list = Array.from(activeDispatches.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return NextResponse.json({
    activeEmergencies: list,
    count: list.length,
  });
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (id) {
      activeDispatches.delete(id);
    } else {
      activeDispatches.clear();
    }
    return NextResponse.json({ success: true, message: 'Emergencies cleared.' });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to clear emergencies.' }, { status: 500 });
  }
}
