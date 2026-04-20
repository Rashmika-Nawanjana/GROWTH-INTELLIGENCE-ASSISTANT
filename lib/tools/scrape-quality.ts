// Scrape quality checker — validates and scores scraped content.
// Detects block pages, low-information content, and semantic completeness.

export interface ScrapeQualityReport {
  isValid: boolean;           // pass/fail for basic usability
  qualityScore: number;       // 0-1 overall quality estimate
  reasons: string[];          // why the score is what it is
  isBlockPage: boolean;       // detected captcha/access-denied/403
  isLowInfo: boolean;         // mostly nav/footer/boilerplate
  hasKeyContent: boolean;     // detected product/pricing/feature sections
  contentLength: number;      // byte count of actual content
}

/**
 * Check if markdown content looks like a block page (captcha, access denied, etc).
 */
function detectBlockPage(markdown: string): boolean {
  const blockPatterns = [
    /access denied/i,
    /you may have been blocked/i,
    /robot|captcha|verification/i,
    /rate limit|too many requests/i,
    /403|401|unauthorized/i,
    /page not available/i,
  ];

  return blockPatterns.some(p => p.test(markdown));
}

/**
 * Check if content is mostly boilerplate (nav, footer, low signal).
 * Heuristic: if > 70% matches nav/footer/cookie patterns, mark as low-info.
 */
function detectLowInfo(markdown: string): boolean {
  const boilerplatePatterns = [
    /navbar|navigation|menu/gi,
    /footer|copyright|terms|privacy/gi,
    /cookie|consent/gi,
    /sign in|log in|register|create account/gi,
    /search/gi,
  ];

  const totalMatches = boilerplatePatterns.reduce((sum, p) => {
    const matches = markdown.match(p);
    return sum + (matches ? matches.length : 0);
  }, 0);

  const lines = markdown.split('\n').length;
  const boilerplateRatio = totalMatches / Math.max(lines, 1);
  return boilerplateRatio > 0.3; // > 30% boilerplate = low-info
}

/**
 * Detect semantic content (pricing sections, features, product info, claims).
 * Heuristic: look for keywords that signal real product content.
 */
function detectKeyContent(markdown: string): boolean {
  const contentPatterns = [
    /pricing|price|cost|plans|tier/i,
    /feature|capability|benefit|advantage/i,
    /product|service|solution|platform/i,
    /comparison|vs|versus|alternative/i,
    /testimonial|review|customer|case study/i,
    /why|how|use case|workflow/i,
  ];

  const matches = contentPatterns.filter(p => p.test(markdown)).length;
  return matches >= 2; // at least 2 content categories detected
}

/**
 * Score overall content quality on 0-1 scale.
 */
function computeQualityScore(
  markdown: string,
  isBlockPage: boolean,
  isLowInfo: boolean,
  hasKeyContent: boolean,
): number {
  if (isBlockPage) return 0.1; // blocked = nearly worthless
  if (markdown.trim().length === 0) return 0;
  if (markdown.trim().length < 100) return 0.2; // too short

  let score = 0.6; // baseline for any content

  if (hasKeyContent) score += 0.25;
  if (!isLowInfo) score += 0.1;

  // bonus for length (more content usually = better, up to a point)
  const length = markdown.length;
  if (length > 5000) score += 0.05;

  return Math.min(1, score);
}

/**
 * Run full quality assessment on scraped markdown.
 */
export function assessScrapeQuality(
  markdown: string,
  url: string = '',
): ScrapeQualityReport {
  const isBlockPage = detectBlockPage(markdown);
  const isLowInfo = detectLowInfo(markdown);
  const hasKeyContent = detectKeyContent(markdown);
  const contentLength = markdown.length;

  const qualityScore = computeQualityScore(markdown, isBlockPage, isLowInfo, hasKeyContent);
  const isValid = qualityScore >= 0.3; // threshold for "usable"

  const reasons: string[] = [];
  if (isBlockPage) reasons.push('Detected block/access page');
  if (isLowInfo) reasons.push('Mostly boilerplate content');
  if (hasKeyContent) reasons.push('Contains product/feature/pricing content');
  if (contentLength < 200) reasons.push('Content very short');
  if (contentLength > 10000) reasons.push('Content comprehensive');

  return {
    isValid,
    qualityScore,
    reasons,
    isBlockPage,
    isLowInfo,
    hasKeyContent,
    contentLength,
  };
}
