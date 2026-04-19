"""
MiroFish Gemini Swarm Service
==============================
A lightweight Flask microservice that mirrors the MiroFish REST API contract
but uses Gemini to power the persona simulation layer instead of camel-ai/OASIS.

This is the production-ready path for the competition:
- Same API endpoints as the real MiroFish backend
- No PyTorch, no camel-ai, no heavyweight ML deps
- Each simulation stores its personas as JSON in ./data/<sim_id>/
- Interview calls have Gemini role-play as the configured swarm of personas
- Results are structurally identical — the TS client is unchanged

Endpoints implemented:
  GET  /api/graph/project/list
  POST /api/graph/build               (accepts multipart/form-data seed file)
  GET  /api/graph/task/<task_id>
  POST /api/simulation/create
  POST /api/simulation/prepare
  POST /api/simulation/prepare/status
  POST /api/simulation/start
  GET  /api/simulation/<sim_id>/run-status
  POST /api/simulation/interview/all  ← the hot path used at query time
  POST /api/simulation/env-status
"""

import os
import json
import uuid
import threading
import time
import re
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, request, jsonify
from flask_cors import CORS
from openai import OpenAI
from dotenv import load_dotenv

# ── Config ────────────────────────────────────────────────────────────────────

load_dotenv()

GEMINI_API_KEY  = os.getenv("LLM_API_KEY", "")
GEMINI_BASE_URL = os.getenv("LLM_BASE_URL",
                             "https://generativelanguage.googleapis.com/v1beta/openai/")
GEMINI_MODEL    = os.getenv("LLM_MODEL_NAME", "gemini-2.0-flash")
DATA_DIR        = Path(os.getenv("DATA_DIR", "./data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Use OpenAI-compat client pointing at Gemini
ai = OpenAI(api_key=GEMINI_API_KEY, base_url=GEMINI_BASE_URL)

app = Flask(__name__)
CORS(app)

# ── In-memory task registry ───────────────────────────────────────────────────
# { task_id: { status, result, error } }
TASKS: dict[str, dict] = {}
TASKS_LOCK = threading.Lock()


def new_task_id() -> str:
    return f"task_{uuid.uuid4().hex[:12]}"

def new_sim_id() -> str:
    return f"sim_{uuid.uuid4().hex[:12]}"

def new_project_id() -> str:
    return f"proj_{uuid.uuid4().hex[:12]}"

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def sim_dir(simulation_id: str) -> Path:
    d = DATA_DIR / "simulations" / simulation_id
    d.mkdir(parents=True, exist_ok=True)
    return d

def proj_dir(project_id: str) -> Path:
    d = DATA_DIR / "projects" / project_id
    d.mkdir(parents=True, exist_ok=True)
    return d

def load_json(path: Path) -> dict:
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return {}

def save_json(path: Path, data: dict):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)

def gemini(prompt: str, json_mode: bool = False) -> str:
    """Single Gemini call via OpenAI-compat endpoint."""
    kwargs: dict = dict(
        model=GEMINI_MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=4096,
    )
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    resp = ai.chat.completions.create(**kwargs)
    return resp.choices[0].message.content or ""

def strip_code_fences(text: str) -> str:
    text = re.sub(r"^```(?:json)?\s*", "", text.strip())
    text = re.sub(r"\s*```$", "", text)
    return text.strip()

# ── Persona generation ────────────────────────────────────────────────────────

def generate_personas(seed_text: str, product: str, num_personas: int = 20) -> list[dict]:
    """
    Given seed material about a product/market, generate a diverse swarm of
    simulated market personas.  Each persona has a background, beliefs, and
    prior context derived from the seed text.
    """
    prompt = f"""You are building a swarm simulation of market personas for competitive intelligence.

Product / market context:
\"\"\"
{seed_text[:4000]}
\"\"\"

Generate {num_personas} highly diverse, realistic market personas who would be relevant to
analysing this product and market.  Include a mix of:
- End users (power users, casual users, churned users)
- Buyers / decision-makers (CTO, VP Sales, Procurement, CFO)
- Competitors' customers
- Industry analysts / investors
- Developers / technical evaluators
- Sceptics and enthusiastic advocates

For each persona output a JSON object with:
{{
  "id": <integer 0-based>,
  "name": "<first name + last name>",
  "role": "<job title>",
  "company_type": "<startup / enterprise / mid-market / investor / analyst / individual>",
  "background": "<2-3 sentence background>",
  "stance": "<positive / neutral / negative / sceptical>",
  "platform_preference": "<twitter or reddit>"
}}

Reply with ONLY a JSON array of {num_personas} persona objects.  No markdown, no explanation."""

    raw = gemini(prompt)
    try:
        personas = json.loads(strip_code_fences(raw))
        if isinstance(personas, list):
            return personas[:num_personas]
    except Exception:
        pass

    # Fallback: minimal persona set
    stances = ["positive", "neutral", "negative", "sceptical"]
    return [
        {
            "id": i,
            "name": f"Persona {i}",
            "role": "Market Participant",
            "company_type": "enterprise",
            "background": f"Experienced professional in the {product} space.",
            "stance": stances[i % 4],
            "platform_preference": "twitter" if i % 2 == 0 else "reddit",
        }
        for i in range(num_personas)
    ]


# ── Graph / project endpoints ─────────────────────────────────────────────────

@app.route("/api/graph/project/list", methods=["GET"])
def list_projects():
    projects_root = DATA_DIR / "projects"
    projects_root.mkdir(parents=True, exist_ok=True)
    result = []
    for p in projects_root.iterdir():
        meta_path = p / "meta.json"
        if meta_path.exists():
            result.append(load_json(meta_path))
    return jsonify({"success": True, "data": result, "count": len(result)})


@app.route("/api/graph/build", methods=["POST"])
def build_graph():
    """
    Accept a seed file upload.  Immediately extract text from the file,
    generate personas in a background thread, and return a task_id to poll.
    """
    project_id = request.form.get("project_id") or new_project_id()
    file = request.files.get("file")

    seed_text = ""
    if file:
        raw = file.read()
        # Try to decode as text; fall back to PyMuPDF for PDF
        try:
            seed_text = raw.decode("utf-8", errors="replace")
        except Exception:
            seed_text = raw.decode("latin-1", errors="replace")

    if not seed_text.strip():
        seed_text = f"Market intelligence seed for project {project_id}."

    task_id = new_task_id()
    graph_id = f"graph_{uuid.uuid4().hex[:12]}"

    # Save project meta
    p_dir = proj_dir(project_id)
    save_json(p_dir / "meta.json", {
        "project_id": project_id,
        "graph_id": graph_id,
        "status": "building",
        "created_at": now_iso(),
    })
    save_json(p_dir / "seed.json", {"text": seed_text})

    with TASKS_LOCK:
        TASKS[task_id] = {"status": "running", "result": None, "error": None}

    # Background: extract a product name + generate ontology summary
    def build_worker():
        try:
            # Extract product name from seed
            product_name = "the product"
            try:
                extract_prompt = f"""From this text, extract the primary product or company name being described.
Reply with ONLY the product/company name, nothing else.

Text: {seed_text[:500]}"""
                product_name = gemini(extract_prompt).strip().strip('"').strip("'")
            except Exception:
                pass

            # Build ontology summary
            ontology_prompt = f"""You are building a knowledge graph ontology for a market simulation.

Seed material about {product_name}:
\"\"\"
{seed_text[:3000]}
\"\"\"

Extract a structured ontology with:
- Main entities (product, company, competitors, market segments)
- Key relationships
- Market context

Reply with JSON:
{{
  "product": "<name>",
  "market": "<1-line description>",
  "entities": ["entity1", "entity2", ...],
  "competitors": ["comp1", "comp2", ...],
  "key_themes": ["theme1", "theme2", ...]
}}"""
            ontology_raw = gemini(ontology_prompt, json_mode=True)
            try:
                ontology = json.loads(strip_code_fences(ontology_raw))
            except Exception:
                ontology = {"product": product_name, "market": "technology", "entities": [], "competitors": [], "key_themes": []}

            # Save ontology + update project
            save_json(p_dir / "ontology.json", ontology)
            meta = load_json(p_dir / "meta.json")
            meta["status"] = "completed"
            meta["product_name"] = ontology.get("product", product_name)
            meta["updated_at"] = now_iso()
            save_json(p_dir / "meta.json", meta)

            with TASKS_LOCK:
                TASKS[task_id] = {
                    "status": "completed",
                    "result": {"graph_id": graph_id, "project_id": project_id, "ontology": ontology},
                    "error": None,
                }
        except Exception as e:
            with TASKS_LOCK:
                TASKS[task_id] = {"status": "failed", "result": None, "error": str(e)}
            meta = load_json(p_dir / "meta.json")
            meta["status"] = "failed"
            meta["error"] = str(e)
            save_json(p_dir / "meta.json", meta)

    threading.Thread(target=build_worker, daemon=True).start()

    return jsonify({
        "success": True,
        "data": {"task_id": task_id, "graph_id": graph_id, "project_id": project_id},
    })


@app.route("/api/graph/task/<task_id>", methods=["GET"])
def get_task(task_id: str):
    with TASKS_LOCK:
        task = TASKS.get(task_id, {"status": "not_found", "result": None, "error": None})
    result = task.get("result") or {}
    return jsonify({
        "success": True,
        "data": {
            "task_id": task_id,
            "status": task["status"],
            "graph_id": result.get("graph_id"),
            "project_id": result.get("project_id"),
            "result": result,
            "error": task.get("error"),
        },
    })


# ── Simulation lifecycle endpoints ────────────────────────────────────────────

@app.route("/api/simulation/create", methods=["POST"])
def create_simulation():
    data = request.get_json() or {}
    project_id = data.get("project_id", "")
    graph_id   = data.get("graph_id", "")

    if not project_id:
        return jsonify({"success": False, "error": "project_id required"}), 400

    simulation_id = new_sim_id()
    s_dir = sim_dir(simulation_id)

    # Link project data
    p_meta = load_json(proj_dir(project_id) / "meta.json") if project_id else {}
    ontology = load_json(proj_dir(project_id) / "ontology.json") if project_id else {}
    seed_data = load_json(proj_dir(project_id) / "seed.json") if project_id else {}

    save_json(s_dir / "meta.json", {
        "simulation_id": simulation_id,
        "project_id": project_id,
        "graph_id": graph_id,
        "status": "created",
        "product_name": p_meta.get("product_name", project_id),
        "ontology": ontology,
        "seed_text": seed_data.get("text", ""),
        "created_at": now_iso(),
    })

    return jsonify({"success": True, "data": {"simulation_id": simulation_id}})


@app.route("/api/simulation/prepare", methods=["POST"])
def prepare_simulation():
    """
    Generate the full persona swarm for this simulation.
    Returns a task_id to poll.  Fast (< 30s for 20 personas).
    """
    data = request.get_json() or {}
    simulation_id = data.get("simulation_id", "")

    if not simulation_id:
        return jsonify({"success": False, "error": "simulation_id required"}), 400

    task_id = new_task_id()
    s_dir = sim_dir(simulation_id)
    meta = load_json(s_dir / "meta.json")

    with TASKS_LOCK:
        TASKS[task_id] = {"status": "running", "result": None, "error": None}

    def prepare_worker():
        try:
            seed_text    = meta.get("seed_text", "") or meta.get("product_name", simulation_id)
            product_name = meta.get("product_name", "the product")
            personas = generate_personas(seed_text, product_name, num_personas=20)

            save_json(s_dir / "personas.json", {"personas": personas, "generated_at": now_iso()})

            meta["status"] = "prepared"
            meta["persona_count"] = len(personas)
            meta["updated_at"] = now_iso()
            save_json(s_dir / "meta.json", meta)

            with TASKS_LOCK:
                TASKS[task_id] = {
                    "status": "completed",
                    "result": {"simulation_id": simulation_id, "persona_count": len(personas)},
                    "error": None,
                }
        except Exception as e:
            with TASKS_LOCK:
                TASKS[task_id] = {"status": "failed", "result": None, "error": str(e)}
            meta["status"] = "prepare_failed"
            meta["error"] = str(e)
            save_json(s_dir / "meta.json", meta)

    threading.Thread(target=prepare_worker, daemon=True).start()

    return jsonify({"success": True, "data": {"task_id": task_id, "simulation_id": simulation_id}})


@app.route("/api/simulation/prepare/status", methods=["POST"])
def prepare_status():
    data = request.get_json() or {}
    task_id = data.get("task_id", "")
    with TASKS_LOCK:
        task = TASKS.get(task_id, {"status": "not_found", "result": None, "error": None})
    return jsonify({"success": True, "data": {"task_id": task_id, "status": task["status"], "error": task.get("error")}})


@app.route("/api/simulation/start", methods=["POST"])
def start_simulation():
    data = request.get_json() or {}
    simulation_id = data.get("simulation_id", "")

    if not simulation_id:
        return jsonify({"success": False, "error": "simulation_id required"}), 400

    s_dir = sim_dir(simulation_id)
    meta = load_json(s_dir / "meta.json")
    meta["status"] = "waiting_command"
    meta["started_at"] = now_iso()
    meta["updated_at"] = now_iso()
    save_json(s_dir / "meta.json", meta)

    return jsonify({"success": True, "data": {"simulation_id": simulation_id, "status": "waiting_command"}})


@app.route("/api/simulation/<simulation_id>/run-status", methods=["GET"])
def run_status(simulation_id: str):
    s_dir = sim_dir(simulation_id)
    meta = load_json(s_dir / "meta.json")
    status = meta.get("status", "idle")

    return jsonify({
        "success": True,
        "data": {
            "simulation_id": simulation_id,
            "runner_status": status,
            "status": status,
            "current_round": 1,
            "total_rounds": 1,
            "progress_percent": 100 if status == "waiting_command" else 0,
            "persona_count": meta.get("persona_count", 0),
            "started_at": meta.get("started_at"),
            "updated_at": meta.get("updated_at"),
        },
    })


@app.route("/api/simulation/env-status", methods=["POST"])
def env_status():
    data = request.get_json() or {}
    simulation_id = data.get("simulation_id", "")
    s_dir = sim_dir(simulation_id)
    meta = load_json(s_dir / "meta.json")
    alive = meta.get("status") in ("waiting_command", "completed", "running")
    return jsonify({"success": True, "data": {"simulation_id": simulation_id, "env_alive": alive}})


# ── Interview all — the hot production path ───────────────────────────────────

@app.route("/api/simulation/interview/all", methods=["POST"])
def interview_all():
    """
    Poll the full persona swarm with a question.
    Each persona responds in their voice using Gemini with their background as context.
    Uses batched Gemini calls (5 personas per call) to stay fast.
    """
    data = request.get_json() or {}
    simulation_id = data.get("simulation_id", "")
    prompt        = data.get("prompt", "")
    platform      = data.get("platform")           # twitter / reddit / None
    timeout_sec   = int(data.get("timeout", 180))

    if not simulation_id:
        return jsonify({"success": False, "error": "simulation_id required"}), 400
    if not prompt:
        return jsonify({"success": False, "error": "prompt required"}), 400

    s_dir_path = sim_dir(simulation_id)
    meta = load_json(s_dir_path / "meta.json")

    if not meta:
        return jsonify({"success": False, "error": f"Simulation {simulation_id} not found"}), 404

    # Load personas
    personas_data = load_json(s_dir_path / "personas.json")
    personas: list[dict] = personas_data.get("personas", [])

    if not personas:
        return jsonify({"success": False, "error": "Simulation not prepared. Call /prepare first."}), 400

    # Filter by platform preference if requested
    if platform in ("twitter", "reddit"):
        personas = [p for p in personas if p.get("platform_preference") == platform] or personas

    product_name = meta.get("product_name", "the product")
    ontology     = meta.get("ontology", {})
    market_ctx   = ontology.get("market", "") if ontology else ""

    # Batched interview: 5 personas per Gemini call for speed + quality
    BATCH = 5
    all_results: dict[str, dict] = {}
    deadline = time.time() + timeout_sec

    persona_batches = [personas[i:i+BATCH] for i in range(0, len(personas), BATCH)]

    for batch in persona_batches:
        if time.time() > deadline:
            break

        persona_descriptions = "\n".join([
            f"[{p['id']}] {p.get('name','?')} — {p.get('role','?')} ({p.get('company_type','?')}). "
            f"Background: {p.get('background','')} Stance: {p.get('stance','neutral')}."
            for p in batch
        ])

        batch_prompt = f"""You are simulating a swarm of market personas evaluating {product_name}.
{f'Market context: {market_ctx}' if market_ctx else ''}

The following personas are being asked:
"{prompt}"

Personas:
{persona_descriptions}

For EACH persona (in ID order), write their authentic response in first person, reflecting their role, background, and stance.
Each response should:
- Be 2-4 sentences
- Include a probabilistic estimate where relevant (e.g. "I'd put this at ~70%")  
- Reference their specific professional context
- Be distinctly different from other personas

Reply with ONLY a JSON object (no markdown) mapping persona ID to response string:
{{"0": "response...", "1": "response...", ...}}"""

        try:
            raw = gemini(batch_prompt, json_mode=True)
            batch_responses = json.loads(strip_code_fences(raw))
        except Exception:
            # Per-persona fallback if batch parse fails
            batch_responses = {}
            for p in batch:
                batch_responses[str(p["id"])] = f"As a {p.get('role','professional')}, I see this as {p.get('stance','neutral')}."

        for p in batch:
            pid = p["id"]
            response_text = batch_responses.get(str(pid), f"No strong view from {p.get('role','?')}.")
            plat = p.get("platform_preference", "twitter")
            key = f"{plat}_{pid}"
            all_results[key] = {
                "agent_id": pid,
                "response": response_text,
                "platform": plat,
                "persona": p.get("name", f"Persona {pid}"),
                "role": p.get("role", ""),
                "stance": p.get("stance", "neutral"),
                "timestamp": now_iso(),
            }

    # Save interview to history
    history_path = s_dir_path / "interview_history.json"
    history = []
    if history_path.exists():
        try:
            history = json.loads(history_path.read_text())
        except Exception:
            history = []
    history.append({
        "prompt": prompt,
        "timestamp": now_iso(),
        "responses_count": len(all_results),
    })
    history_path.write_text(json.dumps(history[-100:], indent=2))  # keep last 100

    return jsonify({
        "success": True,
        "data": {
            "interviews_count": len(all_results),
            "result": {
                "interviews_count": len(all_results),
                "results": all_results,
            },
            "timestamp": now_iso(),
        },
    })


# ── Health check ──────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "mirofish-gemini", "model": GEMINI_MODEL, "time": now_iso()})


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5001))
    print(f"[MiroFish Gemini Swarm] Starting on port {port}")
    print(f"[MiroFish Gemini Swarm] Model: {GEMINI_MODEL}")
    print(f"[MiroFish Gemini Swarm] Data dir: {DATA_DIR.resolve()}")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
