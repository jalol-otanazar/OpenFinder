import { ALL_COUNTRIES, type CountryCode } from '../../core/types/registry.js';
import type { RegistryProvider } from '../provider.js';
import { AustraliaTeqsaProvider } from './australia-teqsa.js';
import { AustriaBmbwfProvider } from './austria-bmbwf.js';
import { BelgiumUnionProvider } from './belgium-union.js';
import { CanadaProvider } from './canada.js';
import { ChinaMoeProvider } from './china-moe.js';
import { DenmarkUfmProvider } from './denmark-ufm.js';
import { FinlandOphProvider } from './finland-oph.js';
import { FranceDataEsrProvider } from './france-dataesr.js';
import { GermanyHochschulkompassProvider } from './germany-hochschulkompass.js';
import { IrelandHeaProvider } from './ireland-hea.js';
import { ItalyMurProvider } from './italy-mur.js';
import { JapanUnionProvider } from './japan-union.js';
import { KoreaUnionProvider } from './korea-union.js';
import { NetherlandsDuoProvider } from './netherlands-duo.js';
import { NorwayNokutProvider } from './norway-nokut.js';
import { SingaporeMoeProvider } from './singapore-moe.js';
import { SpainRuctProvider } from './spain-ruct.js';
import { SwedenUkaProvider } from './sweden-uka.js';
import { SwitzerlandSwissUniversitiesProvider } from './switzerland-swissuniversities.js';
import { UkUnionProvider } from './uk-union.js';
import { UsIpedsProvider } from './us-ipeds.js';

/** The registry provider for a country. */
export function getRegistryProvider(country: CountryCode): RegistryProvider {
  switch (country) {
    // Original six.
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
    // Western Europe.
    case 'France':
      return new FranceDataEsrProvider();
    case 'Italy':
      return new ItalyMurProvider();
    case 'Spain':
      return new SpainRuctProvider();
    case 'Switzerland':
      return new SwitzerlandSwissUniversitiesProvider();
    case 'Austria':
      return new AustriaBmbwfProvider();
    case 'Belgium':
      return new BelgiumUnionProvider();
    case 'Ireland':
      return new IrelandHeaProvider();
    // Nordics.
    case 'Sweden':
      return new SwedenUkaProvider();
    case 'Norway':
      return new NorwayNokutProvider();
    case 'Denmark':
      return new DenmarkUfmProvider();
    case 'Finland':
      return new FinlandOphProvider();
    // Asia.
    case 'China':
      return new ChinaMoeProvider();
    case 'Japan':
      return new JapanUnionProvider();
    case 'Korea':
      return new KoreaUnionProvider();
    case 'Singapore':
      return new SingaporeMoeProvider();
  }
}

export function allRegistryProviders(): RegistryProvider[] {
  return ALL_COUNTRIES.map(getRegistryProvider);
}
