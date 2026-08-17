import { file } from "bun";

/**
 * Parses address.txt into a grouped portfolio of buildings.
 * address.txt is the single source of truth — only properties listed
 * there appear in the portfolio.
 */

export type Building = {
  id: string;
  address: string;
  city: string;
  zip: string | null;
  neighborhood: string;
  units: string[]; // residential unit labels; empty means a single-unit home
  parking: string[]; // garage / parking stall labels
  unitCount: number; // doors: number of residential units (1 for a single home)
};

/**
 * Buildings whose real unit count isn't derivable from address.txt, because the
 * file lists the building on a single line rather than one line per unit.
 */
const UNIT_OVERRIDES: Record<string, number> = {
  "4544 20th Ave NE": 31, // 31-unit studio apartment building
};

/** Garage stalls are listed alongside units in address.txt (e.g. "G1"). */
function isParkingLabel(label: string): boolean {
  return /^G\d+$/.test(label);
}

const STREET_SUFFIXES = new Set([
  "st", "street", "ave", "avenue", "blvd", "boulevard", "pl", "place",
  "rd", "road", "way", "ct", "court", "dr", "drive", "ln", "lane", "ter", "terrace",
]);

const DIRECTIONALS = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);

const KNOWN_CITIES = ["Bellevue", "Kenmore", "Redmond", "Shoreline", "Seattle"];

/**
 * Approximate neighborhood by base address. These were inferred from the
 * street grid — correct any that are off and the site picks it up on restart.
 */
const NEIGHBORHOODS: Record<string, string> = {
  "1213 NE 69th St": "Roosevelt",
  "5236 21st Ave NE": "University District",
  "5238 37th Ave NE": "Bryant",
  "5643 Brooklyn Ave NE": "University District",
  "5641 Brooklyn Ave NE": "University District",
  "6319 Brooklyn Ave NE": "Roosevelt",
  "10722 SE 3rd St": "Bellevue",
  "15216 SE 4th St": "Bellevue",
  "1714 NE 55th Pl": "Ravenna",
  "2017 NE Ravenna Blvd": "Ravenna",
  "4316 36th Ave NE": "Wedgwood",
  "5540 30th Ave NE": "Bryant",
  "5517 17th Ave NE": "University District",
  "5740 34th Ave NE": "Bryant",
  "2117 NE Ravenna Blvd": "Ravenna",
  "2700 E Roy St": "Capitol Hill",
  "3408 NE 57th St": "Bryant",
  "2120 NE 54th St": "Ravenna",
  "1832 NE Ravenna Blvd": "Ravenna",
  "4735 22nd Ave NE": "University District",
  "5220 20th Ave NE": "University District",
  "121 12th Ave E": "Capitol Hill",
  "5714 35th Ave NE": "Bryant",
  "4544 20th Ave NE": "University District",
  "5229 18th Ave NE": "University District",
  "5830 NE 204th Pl": "Kenmore",
  "1200 Bellevue Way": "Bellevue",
};

/** Title-case a token, keeping directionals and ordinals correct (ne -> NE, 21St -> 21st). */
function normalizeToken(token: string): string {
  const lower = token.toLowerCase();
  if (DIRECTIONALS.has(lower)) return lower.toUpperCase();
  if (/^\d+(st|nd|rd|th)$/.test(lower)) return lower;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type ParsedLine = { base: string; unit: string | null; city: string; zip: string | null };

export function parseAddressLine(raw: string): ParsedLine | null {
  let line = raw.trim();
  if (!line) return null;

  // Trailing ZIP.
  let zip: string | null = null;
  const zipMatch = line.match(/\b(\d{5})\s*$/);
  if (zipMatch) {
    zip = zipMatch[1];
    line = line.slice(0, zipMatch.index).trim();
  }

  // Trailing city name.
  let city = "Seattle";
  for (const candidate of KNOWN_CITIES) {
    const re = new RegExp(`\\s+${candidate}\\s*$`, "i");
    if (re.test(line)) {
      city = candidate;
      line = line.replace(re, "").trim();
      break;
    }
  }

  // Explicit unit marker: "# 205", "#205", "Unit 3", "Apt B".
  let unit: string | null = null;
  const hashMatch = line.match(/\s*(?:#|\bunit\b|\bapt\b)\s*([A-Za-z0-9-]+)\s*$/i);
  if (hashMatch) {
    unit = hashMatch[1].toUpperCase();
    line = line.slice(0, hashMatch.index).trim();
  }

  const tokens = line.split(/\s+/).filter(Boolean);

  // Find the street suffix, then allow one trailing directional after it.
  // Anything past that is an implicit unit label (e.g. "... Ave NE U1").
  let suffixIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (STREET_SUFFIXES.has(tokens[i].toLowerCase().replace(/\.$/, ""))) {
      suffixIdx = i;
      break;
    }
  }

  if (suffixIdx !== -1 && unit === null) {
    let endIdx = suffixIdx;
    if (endIdx + 1 < tokens.length && DIRECTIONALS.has(tokens[endIdx + 1].toLowerCase())) {
      endIdx += 1;
    }
    if (endIdx + 1 < tokens.length) {
      unit = tokens.slice(endIdx + 1).join(" ").toUpperCase();
      tokens.length = endIdx + 1;
    }
  }

  const base = tokens.map(normalizeToken).join(" ");
  return { base, unit, city, zip };
}

/**
 * Public map payload. Deliberately carries no street addresses — the portfolio
 * map is meant to convey footprint and scale, not to identify individual homes,
 * most of which are currently occupied.
 *
 * Coordinates are rounded to PIN_PRECISION decimal places (~110m, roughly a
 * city block) so the map reads accurately at neighborhood zoom without
 * publishing the exact position of a tenant's home.
 */
const PIN_PRECISION = 3;

export type MapPin = { lat: number; lng: number; neighborhood: string; units: number };

export type PortfolioMap = {
  stats: { properties: number; units: number; neighborhoods: number; cities: number };
  areas: Array<{ neighborhood: string; properties: number; units: number }>;
  pins: MapPin[];
};

const round = (n: number) => Number(n.toFixed(PIN_PRECISION));

export function toMapPayload(
  buildings: Building[],
  geo: Record<string, { lat: number; lng: number }>,
): PortfolioMap {
  const pins: MapPin[] = [];
  for (const b of buildings) {
    const g = geo[b.id];
    if (!g) continue;
    pins.push({
      lat: round(g.lat),
      lng: round(g.lng),
      neighborhood: b.neighborhood,
      units: b.unitCount,
    });
  }

  const areaMap = new Map<string, { neighborhood: string; properties: number; units: number }>();
  for (const b of buildings) {
    const entry = areaMap.get(b.neighborhood) ?? {
      neighborhood: b.neighborhood,
      properties: 0,
      units: 0,
    };
    entry.properties += 1;
    entry.units += b.unitCount;
    areaMap.set(b.neighborhood, entry);
  }

  const areas = [...areaMap.values()].sort(
    (a, b) => b.properties - a.properties || a.neighborhood.localeCompare(b.neighborhood),
  );

  return {
    stats: {
      properties: buildings.length,
      units: buildings.reduce((s, b) => s + b.unitCount, 0),
      neighborhoods: areas.length,
      cities: new Set(buildings.map((b) => b.city)).size,
    },
    areas,
    pins,
  };
}

export async function loadPortfolio(addressPath: string): Promise<Building[]> {
  const text = await file(addressPath).text();
  const lines = text.split("\n");

  const byBase = new Map<string, Building>();

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip blanks and the "Address" column header.
    if (!trimmed || /^address$/i.test(trimmed)) continue;

    const parsed = parseAddressLine(trimmed);
    if (!parsed) continue;

    const key = `${parsed.base}|${parsed.city}`;
    let building = byBase.get(key);

    if (!building) {
      building = {
        id: slugify(`${parsed.base}-${parsed.city}`),
        address: parsed.base,
        city: parsed.city,
        zip: parsed.zip,
        neighborhood: NEIGHBORHOODS[parsed.base] ?? parsed.city,
        units: [],
        parking: [],
        unitCount: 0,
      };
      byBase.set(key, building);
    }

    if (parsed.zip && !building.zip) building.zip = parsed.zip;
    if (parsed.unit) {
      const bucket = isParkingLabel(parsed.unit) ? building.parking : building.units;
      if (!bucket.includes(parsed.unit)) bucket.push(parsed.unit);
    }
  }

  const buildings = [...byBase.values()];
  for (const b of buildings) {
    // A bare address with no unit labels is a single home, unless overridden.
    b.unitCount = UNIT_OVERRIDES[b.address] ?? Math.max(b.units.length, 1);
    // Cities appearing as a neighborhood label are the city itself.
    if (KNOWN_CITIES.includes(b.neighborhood)) b.city = b.neighborhood;
  }
  buildings.sort(
    (a, b) =>
      a.neighborhood.localeCompare(b.neighborhood) || a.address.localeCompare(b.address),
  );
  return buildings;
}
