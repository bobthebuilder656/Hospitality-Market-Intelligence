// 7-day forecast for one city, from Open-Meteo (free, no key).
// Shown on the City Events tab when a single city is selected.

const cities = require("./cities");

const TTL_MS = 3 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
const DAYS = 7;
// IMD calls 64.5 mm+ in a day "heavy rain"; 40°C+ is where heatwave alerts start in the plains.
const HEAVY_RAIN_MM = 64.5;
const VERY_HOT_C = 40;

const cache = new Map(); // city id -> { data | null, ts, ttl }

// WMO weather codes -> an icon and a short label.
function describe(code) {
  if (code === 0) return { icon: "☀️", label: "Clear" };
  if (code <= 2) return { icon: "🌤️", label: "Partly cloudy" };
  if (code === 3) return { icon: "☁️", label: "Cloudy" };
  if (code <= 48) return { icon: "🌫️", label: "Fog or haze" };
  if (code <= 57) return { icon: "🌦️", label: "Drizzle" };
  if (code <= 67 || (code >= 80 && code <= 82)) return { icon: "🌧️", label: "Rain" };
  if (code <= 77 || (code >= 85 && code <= 86)) return { icon: "🌨️", label: "Snow" };
  return { icon: "⛈️", label: "Thunderstorm" };
}

async function fetchForecast(city) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&timezone=Asia%2FKolkata&forecast_days=${DAYS}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
  const { daily } = await res.json();

  const days = daily.time.map((date, i) => ({
    date,
    ...describe(daily.weather_code[i]),
    max: Math.round(daily.temperature_2m_max[i]),
    min: Math.round(daily.temperature_2m_min[i]),
    rainMm: Math.round(daily.precipitation_sum[i] || 0),
  }));
  return {
    city: city.id,
    days,
    heavyRainDays: days.filter((d) => d.rainMm >= HEAVY_RAIN_MM).map((d) => d.date),
    veryHotDays: days.filter((d) => d.max >= VERY_HOT_C).map((d) => d.date),
  };
}

async function getWeather(cityId) {
  const city = cities.find((c) => c.id === cityId);
  if (!city) return null;
  const cached = cache.get(cityId);
  if (cached && Date.now() - cached.ts < cached.ttl) return cached.data;

  let data = null;
  let ttl = TTL_MS;
  try {
    data = await fetchForecast(city);
  } catch (err) {
    console.warn(`[weather] forecast failed for ${city.name}: ${err.message}`);
    ttl = MISS_TTL_MS;
  }
  cache.set(cityId, { data, ts: Date.now(), ttl });
  return data;
}

module.exports = { getWeather };
