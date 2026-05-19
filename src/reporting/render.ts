import type { CostAndFunding, ProgramRecord, Requirements } from '../core/types/program-record.js';
import type { RecommendationTier, ScoredProgram } from '../core/types/scored-program.js';

/**
 * Deterministic reporting renders — the master spreadsheet and the ranked
 * shortlist. Pure transforms of the scored data + the catalog; no LLM. Every
 * in-scope program reaches the spreadsheet, ineligible ones flagged with the
 * reason and never dropped (rule 04.1).
 */

const SPREADSHEET_HEADERS = [
  'Program',
  'University',
  'Country',
  'Degree',
  'Eligibility',
  'Eligibility reason',
  'Admission',
  'Academic fit',
  'Funding fit',
  'Location fit',
  'Visa',
  'Logistics',
  'Weighted total',
  'Tier',
  'Tuition (intl)',
  'Funding likelihood',
  'Deadlines',
  'English tests',
  'Summary',
];

/** The master spreadsheet — one CSV row per program, ineligible flagged. */
export function renderSpreadsheet(scored: ScoredProgram[], catalog: ProgramRecord[]): string {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const rows = scored.map((s) => {
    const program = byId.get(s.program_id);
    return [
      s.identity.program,
      s.identity.university,
      s.identity.country,
      s.identity.degree_type ?? '',
      s.eligibility.verdict,
      s.eligibility.verdict === 'PASS' ? '' : s.eligibility.reasoning,
      s.admission_chance.bucket,
      String(s.academic_fit.score),
      String(s.funding_fit.score),
      String(s.location_fit.score),
      String(s.visa.score),
      String(s.logistics.score),
      String(s.weighted_total),
      s.recommendation_tier,
      formatMoney(program?.cost_and_funding?.tuition_international ?? null),
      program?.cost_and_funding?.funding_likelihood ?? '',
      (program?.logistics?.application_deadlines ?? []).join('; '),
      formatEnglishTests(program?.requirements ?? null),
      s.summary,
    ];
  });
  return [SPREADSHEET_HEADERS, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

/** The ranked shortlist — a Markdown section grouped by recommendation tier. */
export function renderShortlist(scored: ScoredProgram[]): string {
  const lines: string[] = ['## Ranked shortlist', ''];
  const tiers: RecommendationTier[] = ['Priority', 'Apply', 'Backup'];
  let any = false;

  for (const tier of tiers) {
    const inTier = scored
      .filter((s) => s.recommendation_tier === tier)
      .sort((a, b) => b.weighted_total - a.weighted_total);
    if (inTier.length === 0) continue;
    any = true;
    lines.push(`### ${tier} (${inTier.length})`, '');
    for (const s of inTier) {
      lines.push(
        `**${s.identity.program}** — ${s.identity.university} (${s.identity.country}) · ` +
          `${s.admission_chance.bucket} · score ${s.weighted_total}`,
      );
      lines.push(s.summary);
      lines.push(`_Next:_ ${nextAction(s)}`);
      lines.push('');
    }
  }

  if (!any) {
    lines.push('_No programs reached the Priority, Apply, or Backup tiers._', '');
  }
  lines.push(
    '_Programs not listed here (tier "Do Not Apply") are in the master spreadsheet, ' +
      'flagged with the reason — nothing is hidden._',
  );
  return lines.join('\n');
}

/** The concrete next step for a shortlisted program. */
function nextAction(program: ScoredProgram): string {
  if (program.eligibility.verdict === 'UNCERTAIN' && program.eligibility.must_confirm.length > 0) {
    return `Confirm before applying — ${program.eligibility.must_confirm.join('; ')}.`;
  }
  switch (program.recommendation_tier) {
    case 'Priority':
      return 'Top pick — prepare a standout application and apply early.';
    case 'Apply':
      return 'A solid option — include it in your application set.';
    case 'Backup':
      return 'Keep as a safety in case stronger options fall through.';
    default:
      return 'Not recommended for application.';
  }
}

function formatMoney(money: CostAndFunding['tuition_international']): string {
  return money ? `${money.amount} ${money.currency}/${money.period}` : '';
}

function formatEnglishTests(requirements: Requirements | null): string {
  const tests = requirements?.english_tests;
  if (!tests) return '';
  const parts: string[] = [];
  if (tests.ielts) parts.push(`IELTS ${tests.ielts}`);
  if (tests.toefl) parts.push(`TOEFL ${tests.toefl}`);
  if (tests.duolingo) parts.push(`DET ${tests.duolingo}`);
  if (tests.pte) parts.push(`PTE ${tests.pte}`);
  return parts.join('; ');
}

/** RFC-4180 cell escaping — quote when the value holds a comma, quote, or newline. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
