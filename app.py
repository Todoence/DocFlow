# backend/app.py

import os, re, uuid, json, httpx, asyncpg
from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import csv

# load full catalog on startup
CATALOG: list[str] = []
with open("unique_fastener_catalog.csv", newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    CATALOG = [row["Description"] for row in reader]

load_dotenv()

DATABASE_URL   = os.getenv("DATABASE_URL")
EXTRACT_API_URL = os.getenv("EXTRACT_API_URL")
MATCH_API_URL   = os.getenv("MATCH_API_URL")
UPLOAD_DIR      = os.getenv("UPLOAD_DIR", "uploads")
SAVE_DIR        = os.getenv("SAVE_DIR", "saves")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(SAVE_DIR, exist_ok=True)

app = FastAPI(title="Document Processing Backend")
app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_methods=["*"],
  allow_headers=["*"],
)

# we'll keep a global pool
pool: asyncpg.Pool

@app.on_event("startup")
async def on_startup():
    global pool
    pool = await asyncpg.create_pool(DATABASE_URL)

@app.on_event("shutdown")
async def on_shutdown():
    await pool.close()


def parse_number(raw_val):
    if raw_val is None:
        return 0
    s = str(raw_val).replace(",", "")
    m = re.search(r"[\d.]+", s)
    return float(m.group(0)) if m else 0


def normalize_item(raw: dict) -> dict:
    # <your existing normalization>
    if raw.get("Qty") is not None:
        qty = raw["Qty"]
    elif raw.get("Quantity") is not None:
        qty = raw["Quantity"]
    else:
        qty = raw.get("Amount") or 0

    up = raw.get("Cost") or raw.get("Price") or raw.get("Unit Cost") or raw.get("Unit Price")

    if raw.get("Total") is not None:
        tot = raw["Total"]
    elif (raw.get("Qty") or raw.get("Quantity")) and raw.get("Amount") is not None:
        tot = raw["Amount"]
    else:
        tot = raw.get("Ext Cost") or 0

    return {
        "Quantity":     parse_number(qty),
        "Request Item": raw.get("Request Item") or raw.get("Item") or "",
        "Unit Price":   parse_number(up),
        "Total Amount": parse_number(tot),
    }


@app.post("/extract")
async def extract(file: UploadFile = File(...)):
    # 1) read & save PDF locally
    contents = await file.read()
    path = os.path.join(UPLOAD_DIR, file.filename)
    with open(path, "wb") as f:
        f.write(contents)

    # 2) forward to your extraction API
    files = {"file": (file.filename, contents, file.content_type)}
    async with httpx.AsyncClient() as client:
        resp = await client.post(EXTRACT_API_URL, files=files)
    if resp.status_code != 200:
        raise HTTPException(500, "Extraction service error")

    raw_list   = resp.json()
    normalized = [normalize_item(item) for item in raw_list]

    # 3) persist into extracted_items
    order_id = file.filename
    records = [
      (order_id,
       idx,
       it["Request Item"],
       it["Quantity"],
       it["Unit Price"],
       it["Total Amount"])
      for idx, it in enumerate(normalized)
    ]
    await pool.executemany(
      """
      INSERT INTO extracted_items
        (order_id, line_idx, request_item, quantity, unit_price, total_amount)
      VALUES($1,$2,$3,$4,$5,$6)
      """,
      records
    )

    return normalized


@app.post("/save-draft")
async def save_draft(payload: dict = Body(...)):
    # existing file snapshot
    order_id = payload.get("order_id", uuid.uuid4().hex)
    items    = payload.get("items", [])
    path     = os.path.join(SAVE_DIR, f"{order_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)

    # now also persist into order_drafts
    records = [
      (order_id,
       idx,
       it["Request Item"],
       it["Quantity"],
       it["Unit Price"],
       it["Total Amount"])
      for idx, it in enumerate(items)
    ]
    await pool.executemany(
      """
      INSERT INTO order_drafts
        (order_id, line_idx, request_item, quantity, unit_price, total_amount)
      VALUES($1,$2,$3,$4,$5,$6)
      """,
      records
    )

    return {"status": "ok", "file": path}

@app.post("/match")
async def match_items(
    queries: list[str] = Body(..., embed=True, description="List of item descriptions to match")
):
    """
    Query the 5 best match catalog items
    """
    params = {"limit": 5}
    payload = {"queries": queries}

    async with httpx.AsyncClient() as client:
        resp = await client.post(MATCH_API_URL, params=params, json=payload)

    if resp.status_code != 200:
        raise HTTPException(status_code=500, detail="Matching service error")

    return resp.json()

@app.get("/catalog/search")
async def catalog_search(
    q: str = Query(..., min_length=1, description="Search term"),
    limit: int = Query(10, description="Max number of results"),
):
    """
    return up to `limit` catalog entries containing substring `q`
    """
    ql = q.lower()
    results = [name for name in CATALOG if ql in name.lower()][:limit]
    return {"results": results}

@app.post("/save-final")
async def save_final(
    payload: dict = Body(
        ...,
        example={
            "order_id": "current_order",
            "items": [
                {
                    "Request Item": "Titanium Washer M4 30mm …",
                    "Match Item":   "Titanium Washer M4 30mm …",
                    "Quantity":      25,
                    "Unit Price":    90.866,
                    "Total Amount":  2271.65
                },
                # …
            ],
        },
    )
):
    """
    Persist the final chosen match for each line into matched_items table.
    """
    order_id = payload.get("order_id", uuid.uuid4().hex)
    items    = payload.get("items", [])
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="`items` must be a list")

    records = []
    for idx, it in enumerate(items):
        records.append((
            order_id,
            idx,
            it["Request Item"],
            it["Match Item"],
            it["Quantity"],
            it["Unit Price"],
            it["Total Amount"],
        ))

    await pool.executemany(
        """
        INSERT INTO matched_items
          (order_id, line_idx, request_item, match_item, quantity, unit_price, total_amount)
        VALUES($1,$2,$3,$4,$5,$6,$7)
        """,
        records
    )

    return {"status": "ok", "order_id": order_id}
