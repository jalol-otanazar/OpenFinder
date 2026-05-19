import { ALL_COUNTRIES, type CountryCode } from '../../core/types/registry.js';
import type { RegistryProvider } from '../provider.js';
import { AustraliaTeqsaProvider } from './australia-teqsa.js';
import { CanadaProvider } from './canada.js';
import { GermanyHochschulkompassProvider } from './germany-hochschulkompass.js';
import { NetherlandsDuoProvider } from './netherlands-duo.js';
import { UkUnionProvider } from './uk-union.js';
import { UsIpedsProvider } from './us-ipeds.js';

/** The registry provider for a country. */
export function getRegistryProvider(country: CountryCode): RegistryProvider {
  switch (country) {
    case 'US':
      return new UsIpedsProvider();
    case 'UK':
      return new UkUnionProvider();
    case 'Canada':
      return new CanadaProvider();
    case 'Australia':
      return new AustraliaTeqsaProvider();
    case 'Germany':
      return new GermanyHochschulkompassProvider();
    case 'Netherlands':
      return new NetherlandsDuoProvider();
  }
}

export function allRegistryProviders(): RegistryProvider[] {
  return ALL_COUNTRIES.map(getRegistryProvider);
}
