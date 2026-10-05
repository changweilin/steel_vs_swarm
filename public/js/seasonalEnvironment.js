// Stylized environmental proxies, not climatological observations. Seasons are local
// named seasons: southern latitude does not turn an explicitly selected winter into summer.
const clamp = v => Math.max(0, Math.min(1, v));
const finite = (v, fallback) => Number.isFinite(v) ? v : fallback;
export const FOREST_GEOLOGY_PH = { limestone: 7.8, granite: 5.2, sandstone: 5.6, basalt: 5.8, volcanic: 5.8, alluvium: 6.8, sand: 6.5, peat: 4.8 };
export const GEOLOGY_MINERAL_COLORS = { basalt: 0x46545d, granite: 0xa5a2a0, limestone: 0xd1c4a0, sandstone: 0xc29864, alluvium: 0x887055 };
// Generic landforms inherit the substrate; named rock types and vegetated hills
// keep their authored material even when the surrounding soil differs.
const SUBSTRATE_LANDFORMS = new Set(['cliff', 'mountain', 'mound', 'moraine', 'island', 'rockery', 'landslide', 'debris']);
export function geologyColor(kind, geology, fallback) {
  return SUBSTRATE_LANDFORMS.has(kind) ? GEOLOGY_MINERAL_COLORS[geology] ?? fallback : fallback;
}
const CLIMATE = {
  tropical: { temperature: 26, moisture: .8, latitude: 10 },
  temperate: { temperature: 13, moisture: .6, latitude: 35 },
  boreal: { temperature: 2, moisture: .5, latitude: 60 },
  arid: { temperature: 27, moisture: .15, latitude: 25 },
  mediterranean: { temperature: 18, moisture: .3, latitude: 35 },
  alpine: { temperature: 3, moisture: .55, latitude: 45 },
};

// Broad coordinate bands choose game appearance, never measured lithology or climate.
const GEOGRAPHIC_APPEARANCE = [
  { bbox: [-48, 165, 48, 180], climate: 'temperate', geology: 'basalt' },
  { bbox: [-12, 95, 46, 150], climate: null, geology: 'basalt' },
  { bbox: [15, -18, 35, 65], climate: 'arid', geology: 'sandstone' },
  { bbox: [-35, 110, -15, 145], climate: 'arid', geology: 'sandstone' },
  { bbox: [20, -120, 38, -100], climate: 'arid', geology: 'sandstone' },
  { bbox: [30, -12, 46, 45], climate: 'mediterranean', geology: 'limestone' },
];

export function geographicEnvironment(latitude, longitude) {
  if (![latitude, longitude].every(Number.isFinite) || Math.abs(latitude) >= 85 || Math.abs(longitude) > 180) return null;
  const lat = Math.abs(latitude);
  const band = GEOGRAPHIC_APPEARANCE.find(({ bbox: [s, w, n, e] }) => latitude >= s && latitude <= n && longitude >= w && longitude <= e);
  const climate = band?.climate || (lat < 23.5 ? 'tropical' : lat >= 55 ? 'boreal' : 'temperate');
  const geology = band?.geology || (lat >= 50 ? 'granite' : climate === 'tropical' ? 'alluvium' : 'sandstone');
  return { latitude, longitude, climate, geology, geologyInferred: true,
    volcanic: geology === 'basalt' ? .8 : 0, fault: geology === 'basalt' ? .6 : .1 };
}

// Habitat uses the long-term baseline so visual dormancy never relocates trees.
export function forestEnvironment(latitude, altitude, input = {}) {
  const climate = CLIMATE[input.climate] || {};
  latitude = finite(latitude, 25); altitude = finite(altitude, 0);
  return {
    temperature: finite(input.temperature, climate.temperature ?? 29 - Math.abs(latitude) * .48 - Math.max(0, altitude) * .006),
    moisture: clamp(finite(input.moisture, input.wet ? .95 : climate.moisture ?? .55)),
    ph: finite(input.ph, FOREST_GEOLOGY_PH[input.geology]),
    rainfall: finite(input.rainfall, undefined), salinity: clamp(finite(input.salinity, 0)),
    slope: finite(input.slope, undefined), wet: !!input.wet,
  };
}

export function seasonalEnvironment(input = {}) {
  const latitude = Math.max(-90, Math.min(90, finite(input.latitude, 25)));
  const altitude = finite(input.altitude, 0);
  const season = ['spring', 'summer', 'autumn', 'winter'].includes(input.season) ? input.season : 'summer';
  const baseline = forestEnvironment(latitude, altitude, input);
  const climate = CLIMATE[input.climate];
  const seasonalStrength = clamp((Math.abs(latitude) - 8) / 32 + Math.max(0, altitude) / 6000);
  const geographicCooling = climate ? Math.max(0, altitude) * .0065 + (Math.abs(latitude) - climate.latitude) * .25 : 0;
  const temperature = finite(input.temperature, baseline.temperature - geographicCooling
    + { spring: 0, summer: 6, autumn: -3, winter: -12 }[season] * seasonalStrength);
  const weather = input.weather || 'clear';
  const precipitation = ['rain', 'heavy_rain', 'snow'].includes(weather)
    || (['storm', 'windy'].includes(weather) && ['summer', 'winter'].includes(season));
  const moisture = precipitation ? Math.max(.8, baseline.moisture) : baseline.moisture;
  const cold = clamp((2 - temperature) / 8);
  const snow = cold * (weather === 'snow' ? 1 : moisture)
    * (season === 'winter' || weather === 'snow' || temperature < -3 ? 1 : 0);
  const autumn = season === 'autumn' ? seasonalStrength : 0;
  const growth = clamp((temperature - 2) / 10) * clamp(moisture / .35);
  return { ...baseline, latitude, altitude, season, weather, temperature, moisture,
    climate: climate ? input.climate : temperature < 0 ? 'alpine' : Math.abs(latitude) > 55 ? 'boreal' : temperature > 22 ? 'tropical' : 'temperate',
    geology: input.geology || 'unknown', seasonalStrength, autumn, snow, growth,
    wetness: temperature > 0 && precipitation ? moisture : 0,
    drought: clamp((.3 - moisture) / .3) * clamp((temperature - 10) / 15),
  };
}
