import type { GeographyContext } from './types';
import type { SearchLocaleOptions } from '../tools/serpapi';

/** Map classifier geography → SerpAPI/SearXNG locale options. */
export function localeFromGeography(
  geography?: GeographyContext,
): SearchLocaleOptions | undefined {
  if (!geography) return undefined;
  const opts: SearchLocaleOptions = {};
  if (geography.countryCode?.trim()) {
    opts.gl = geography.countryCode.trim().toLowerCase();
  }
  if (geography.hl?.trim()) {
    opts.hl = geography.hl.trim().toLowerCase();
  } else {
    opts.hl = 'en';
  }
  if (geography.name?.trim()) {
    opts.location = geography.name.trim();
  }
  return opts.gl || opts.hl || opts.location ? opts : undefined;
}
