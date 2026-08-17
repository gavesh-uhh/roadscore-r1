/**
 * Curated Sri Lankan Locations and Presets for Real OSM Routing
 */

import type { PlacePreset } from '../types.js';

export const SRI_LANKA_PLACES: PlacePreset[] = [
  {
    id: 'colombo-fort',
    name: 'Colombo Fort',
    lat: 6.9344,
    lon: 79.8428,
    description: 'Central Commercial & Transport Hub, Colombo 01',
  },
  {
    id: 'galle-face',
    name: 'Galle Face Green',
    lat: 6.9271,
    lon: 79.8453,
    description: 'Oceanfront promenade, Colombo 03',
  },
  {
    id: 'kollupitiya',
    name: 'Kollupitiya Junction',
    lat: 6.915,
    lon: 79.852,
    description: 'Galle Road / Duplication Rd arterial, Colombo 03',
  },
  {
    id: 'bambalapitiya',
    name: 'Bambalapitiya',
    lat: 6.898,
    lon: 79.855,
    description: 'High density coastal corridor, Colombo 04',
  },
  {
    id: 'wellawatte',
    name: 'Wellawatte',
    lat: 6.878,
    lon: 79.859,
    description: 'Marine Drive & Galle Road, Colombo 06',
  },
  {
    id: 'mount-lavinia',
    name: 'Mount Lavinia',
    lat: 6.835,
    lon: 79.873,
    description: 'Mount Lavinia Junction / Hotel Rd',
  },
  {
    id: 'kandy-lake',
    name: 'Kandy (Dalada Maligawa)',
    lat: 7.2936,
    lon: 80.635,
    description: 'Temple of the Tooth & Kandy Lake Round',
  },
  {
    id: 'galle-fort',
    name: 'Galle Fort',
    lat: 6.0328,
    lon: 80.2168,
    description: 'Historic Galle Fort & Ramparts, Southern Province',
  },
  {
    id: 'negombo-beach',
    name: 'Negombo Beach',
    lat: 7.2285,
    lon: 79.8423,
    description: 'Negombo Coastal Rd / Tourist strip',
  },
  {
    id: 'airport-katunayake',
    name: 'BIA Airport (Katunayake)',
    lat: 7.1808,
    lon: 79.8841,
    description: 'Bandaranaike International Airport & Expressway interchange',
  },
  {
    id: 'matara-city',
    name: 'Matara City',
    lat: 5.9496,
    lon: 80.5469,
    description: 'Matara Fort & Nilwala River Bridge',
  },
  {
    id: 'kurunegala-clocktower',
    name: 'Kurunegala Clock Tower',
    lat: 7.4863,
    lon: 80.3623,
    description: 'North Western central junction / A6 Highway',
  },
  {
    id: 'battaramulla',
    name: 'Battaramulla (Parliament)',
    lat: 6.897,
    lon: 79.918,
    description: 'Administrative capital & Parliamentary ring road',
  },
  {
    id: 'jaffna-town',
    name: 'Jaffna Clock Tower',
    lat: 9.6615,
    lon: 80.0255,
    description: 'Jaffna City Centre & A9 Terminal',
  },
  {
    id: 'trincomalee-harbour',
    name: 'Trincomalee Harbour',
    lat: 8.5711,
    lon: 81.2335,
    description: 'Eastern coastal harbour & Fort Frederick',
  },
];

export function findPlaceByNameOrId(query: string): PlacePreset | undefined {
  const q = query.trim().toLowerCase();
  return SRI_LANKA_PLACES.find(
    (p) =>
      p.id.toLowerCase() === q ||
      p.name.toLowerCase().includes(q) ||
      (p.description && p.description.toLowerCase().includes(q)),
  );
}
