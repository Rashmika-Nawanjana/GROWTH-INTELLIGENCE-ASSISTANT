import { getCached, setCache } from '../supabase';
import type { ToolResult } from './types';

const BASE_URL = 'https://api.patentsview.org/patents/query';

export interface Patent {
  patent_number: string;
  patent_title: string;
  patent_abstract: string;
  patent_date: string;
  assignee_organization?: string;
  patent_url: string;
}

export async function searchPatents(
  query: string,
  assignee?: string,
  limit = 8
): Promise<ToolResult<Patent[]>> {
  const cacheKey = `patents:${assignee ?? ''}:${query}`;
  const cached = await getCached('patents', cacheKey);
  if (cached) return { ...(cached as ToolResult<Patent[]>), cached: true };

  const sinceDate = new Date();
  sinceDate.setFullYear(sinceDate.getFullYear() - 3);

  const queryObj: any = {
    _and: [
      { _text_any: { patent_abstract: query } },
      { _gte: { patent_date: sinceDate.toISOString().split('T')[0] } },
    ],
  };

  if (assignee) {
    queryObj._and.push({ _contains: { assignee_organization: assignee } });
  }

  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: queryObj,
        f: ['patent_number', 'patent_title', 'patent_abstract', 'patent_date', 'assignee_organization'],
        o: { per_page: limit, sort: [{ patent_date: 'desc' }] },
      }),
    });

    if (!res.ok) throw new Error(`PatentsView ${res.status}`);

    const json = await res.json() as any;
    const patents: Patent[] = (json.patents ?? []).map((p: any) => ({
      patent_number: p.patent_number ?? '',
      patent_title: p.patent_title ?? '',
      patent_abstract: (p.patent_abstract ?? '').slice(0, 400),
      patent_date: p.patent_date ?? '',
      assignee_organization: p.assignees?.[0]?.assignee_organization,
      patent_url: `https://patents.google.com/patent/US${p.patent_number}`,
    }));

    const result: ToolResult<Patent[]> = {
      data: patents,
      source: 'USPTO Patents (PatentsView)',
      sourceUrl: `https://patentsview.org/search?q=${encodeURIComponent(query)}`,
      timestamp: new Date().toISOString(),
      confidence: patents.length > 0 ? 0.8 : 0.2,
      cached: false,
    };

    await setCache('patents', cacheKey, result);
    return result;
  } catch {
    return {
      data: [],
      source: 'USPTO Patents',
      timestamp: new Date().toISOString(),
      confidence: 0,
      cached: false,
    };
  }
}

export async function companyPatents(companyName: string, limit = 5): Promise<ToolResult<Patent[]>> {
  return searchPatents(companyName, companyName, limit);
}
