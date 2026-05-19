import { describe, expect, it } from 'vitest';
import { disambiguateId, makeInstitutionId, makeProgramId, slug } from '../../src/core/ids.js';

describe('slug', () => {
  it('lower-cases and underscore-collapses', () => {
    expect(slug('University of Sheffield')).toBe('university_of_sheffield');
  });

  it('folds accents (German, French)', () => {
    expect(slug('Université de Montréal')).toBe('universite_de_montreal');
    expect(slug('Technische Universität München')).toBe('technische_universitat_munchen');
  });

  it('folds ß and expands &', () => {
    expect(slug('Gießen & Marburg')).toBe('giessen_and_marburg');
  });

  it('trims leading/trailing separators and punctuation', () => {
    expect(slug('  --Foo!! College--  ')).toBe('foo_college');
  });
});

describe('makeInstitutionId', () => {
  it('prefixes by country', () => {
    expect(makeInstitutionId('UK', 'University of Southampton')).toBe(
      'uk_university_of_southampton',
    );
    expect(makeInstitutionId('US', 'MIT')).toBe('us_mit');
    expect(makeInstitutionId('Germany', 'Universität Köln')).toBe('de_universitat_koln');
  });
});

describe('disambiguateId', () => {
  it('appends a region slug', () => {
    expect(disambiguateId('uk_x', 'South East')).toBe('uk_x__south_east');
  });

  it('returns the base when region is empty', () => {
    expect(disambiguateId('uk_x', '')).toBe('uk_x');
  });
});

describe('makeProgramId', () => {
  it('joins the institution id to the slugged program name', () => {
    expect(makeProgramId('uk_university_of_sheffield', 'MSc in Artificial Intelligence')).toBe(
      'uk_university_of_sheffield_msc_in_artificial_intelligence',
    );
  });

  it('is deterministic and accent-folded', () => {
    expect(makeProgramId('de_x', 'Informatik (M.Sc.)')).toBe('de_x_informatik_m_sc');
  });
});
