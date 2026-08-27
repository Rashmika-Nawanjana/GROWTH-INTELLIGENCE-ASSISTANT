"""POST /api/steal-strategy — one-shot strategy brief."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.auth import CurrentUser
from app.gemini import generate_json

router = APIRouter()


@router.post("/api/steal-strategy")
async def steal_strategy(request: Request, _user: CurrentUser):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    company = (body.get("company") or "").strip()
    if len(company) < 2:
        raise HTTPException(
            status_code=400, detail="company is required (at least 2 characters)"
        )
    new_co = (body.get("newCompanyContext") or "").strip()
    market = (body.get("market") or "").strip()

    system = (
        "You are a business strategy analyst. Respond with valid JSON only, no markdown fences.\n"
        "This is a case-study style analysis of widely reported business history and competitive "
        "strategy — not instructions to break laws, harm competitors, or act unethically.\n"
        'Frame moves as "documented or commonly cited" where appropriate. If uncertain, say so.'
    )

    user_prompt = f"""Company to analyse: {company}
{f"Market / category: {market}" + chr(10) if market else ""}{f"New entrant or reader context: {new_co}" + chr(10) if new_co else ""}
Produce a JSON object with this exact shape:
{{
  "summary": "2-3 sentences",
  "historicalCompetitiveMoves": [ {{ "move": "", "context": "timeframe / product area", "effectOnRivals": "strategic effect on same-type competitors" }} ],
  "modernEntrantPlaybook": [ {{ "analogy": "which past pattern maps here", "applicationToday": "how a new company competes in the same type of market now (channels, product, GTM, data)", "exampleTactics": ["concrete, ethical levers"] }} ],
  "guardrails": "one paragraph: legal, ethical, and IP boundaries; this is education not a playbook to harm"
}}
Include 3-5 items in each array. Use English."""

    try:
        data = await generate_json(system, user_prompt, max_new_tokens=3500, temperature=0.25)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err) or "Strategy generation failed")

    if not data.get("summary") or not isinstance(data.get("historicalCompetitiveMoves"), list):
        raise HTTPException(status_code=502, detail="Model returned an incomplete structure")

    return data
