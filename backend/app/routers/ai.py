"""AI endpoints (Groq, Llama 3.3 70B). Only de-identified clinical fields are sent to the model."""

import base64
import hashlib
import io
import json
import re
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .. import drugcheck, storage
from ..access import patient_by_vital_id, require_read
from ..ai import prompts
from ..ai.llm import DISCLAIMER, AIUnavailable, ai_configured, complete_json
from ..ai.schemas import AIDrugCheck, DocumentExtraction, DoctorBrief, NotesAnalysis, PatternReport
from ..audit import audit
from ..auth import CurrentUser, current_user, require_verified_doctor
from ..config import get_settings
from ..db import tx
from ..records import clinical_payload

router = APIRouter(prefix="/api/ai", tags=["ai"])


def _unavailable(e: AIUnavailable) -> HTTPException:
    return HTTPException(503, f"AI is unavailable right now ({e}). The record itself is still fully visible.")


def _clean_citations(obj, known: set[str]):
    """Drop any source id the model cited that isn't actually in the record."""
    if isinstance(obj, dict):
        return {k: ([i for i in v if i in known] if k == "source_ids" else _clean_citations(v, known)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_clean_citations(x, known) for x in obj]
    return obj


def _resolve_patient(cur, user: CurrentUser, vital_id: str | None, patient_id: UUID | None) -> UUID:
    if vital_id:
        pid = patient_by_vital_id(cur, vital_id)["id"]
    elif patient_id:
        pid = patient_id
    elif user.patient_id:
        pid = user.patient_id
    else:
        raise HTTPException(400, "vital_id or patient_id is required")
    require_read(cur, user, pid)
    return pid


@router.get("/status")
def status():
    return {"configured": ai_configured(), "model": get_settings().groq_model}


class BriefIn(BaseModel):
    vital_id: str
    refresh: bool = False


@router.post("/doctor-brief")
def doctor_brief(body: BriefIn, user: CurrentUser = Depends(require_verified_doctor)):
    with tx(user.profile_id) as cur:
        pid = _resolve_patient(cur, user, body.vital_id, None)
        payload, sources = clinical_payload(cur, pid)
        input_hash = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
        cached = None
        if not body.refresh:
            cur.execute(
                """
                select content, model, created_at from ai_summaries
                where patient_id = %s and type = 'doctor_brief' and input_hash = %s
                order by created_at desc limit 1
                """,
                (pid, input_hash),
            )
            cached = cur.fetchone()
        audit(cur, actor_profile_id=user.profile_id, actor_role="doctor", action="ai_brief", patient_id=pid,
              target_type="ai_summaries", meta={"cached": bool(cached)})
    if cached:
        return {**cached["content"], "model": cached["model"], "generated_at": cached["created_at"], "cached": True}
    try:
        brief, model = complete_json(prompts.DOCTOR_BRIEF, json.dumps(payload, default=str), DoctorBrief)
    except AIUnavailable as e:
        raise _unavailable(e)
    content = {"brief": _clean_citations(brief.model_dump(), set(sources)), "sources": sources, "disclaimer": DISCLAIMER}
    with tx(user.profile_id) as cur:
        cur.execute(
            """
            insert into ai_summaries (patient_id, type, content, model, input_hash, created_by)
            values (%s, 'doctor_brief', %s, %s, %s, %s) returning created_at
            """,
            (pid, Jsonb(content), model, input_hash, user.profile_id),
        )
        created = cur.fetchone()["created_at"]
    return {**content, "model": model, "generated_at": created, "cached": False}


class DrugCheckIn(BaseModel):
    drug_name: str = Field(min_length=2, max_length=120)
    vital_id: str | None = None
    patient_id: UUID | None = None
    use_ai: bool = True


@router.post("/drug-check")
def drug_check(body: DrugCheckIn, user: CurrentUser = Depends(current_user)):
    """Rule-based lookup first (always), then the LLM as a second check. Warnings, not advice."""
    with tx() as cur:
        pid = _resolve_patient(cur, user, body.vital_id, body.patient_id)
        cur.execute("select id, name, dose from medications where patient_id = %s and status = 'active'", (pid,))
        meds = cur.fetchall()
        cur.execute("select id, substance, reaction, severity from allergies where patient_id = %s", (pid,))
        allergies = cur.fetchall()
        rule_warnings = drugcheck.check(cur, body.drug_name, meds, allergies)

    ai_result, ai_error, model = None, None, None
    if body.use_ai:
        facts = {
            "proposed_medication": body.drug_name,
            "active_medications": [{"id": str(m["id"]), "name": m["name"], "dose": m["dose"]} for m in meds],
            "allergies": [{"id": str(a["id"]), "substance": a["substance"], "reaction": a["reaction"], "severity": a["severity"]} for a in allergies],
        }
        known = {str(m["id"]) for m in meds} | {str(a["id"]) for a in allergies}
        try:
            result, model = complete_json(prompts.DRUG_CHECK, json.dumps(facts), AIDrugCheck)
            ai_result = _clean_citations(result.model_dump(), known)
        except AIUnavailable as e:
            ai_error = str(e)
    return {
        "drug": body.drug_name,
        "rule_warnings": rule_warnings,
        "ai": ai_result,
        "ai_error": ai_error,
        "model": model,
        "disclaimer": "Warnings to review, not advice. Rule base covers common well-known interactions only. " + DISCLAIMER,
    }


class NotesIn(BaseModel):
    text: str = Field(min_length=10, max_length=6000)
    vital_id: str | None = None


_PHONE = re.compile(r"(\+?\d[\d\s-]{8,}\d)")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")


@router.post("/analyze-notes")
def analyze_notes(body: NotesIn, user: CurrentUser = Depends(require_verified_doctor)):
    text = _EMAIL.sub("[email]", _PHONE.sub("[phone]", body.text))
    pid = None
    if body.vital_id:
        with tx() as cur:
            pid = _resolve_patient(cur, user, body.vital_id, None)
    try:
        result, model = complete_json(prompts.NOTES, text, NotesAnalysis)
    except AIUnavailable as e:
        raise _unavailable(e)
    content = result.model_dump()
    if pid:
        with tx(user.profile_id) as cur:
            cur.execute(
                "insert into ai_summaries (patient_id, type, content, model, created_by) values (%s, 'notes', %s, %s, %s)",
                (pid, Jsonb(content), model, user.profile_id),
            )
    return {**content, "model": model, "disclaimer": DISCLAIMER}


class PatternsIn(BaseModel):
    vital_id: str


@router.post("/patterns")
def patterns(body: PatternsIn, user: CurrentUser = Depends(require_verified_doctor)):
    with tx() as cur:
        pid = _resolve_patient(cur, user, body.vital_id, None)
        payload, sources = clinical_payload(cur, pid, history_limit=80)
    try:
        result, model = complete_json(prompts.PATTERNS, json.dumps(payload, default=str), PatternReport)
    except AIUnavailable as e:
        raise _unavailable(e)
    content = {"report": _clean_citations(result.model_dump(), set(sources)), "sources": sources}
    with tx(user.profile_id) as cur:
        cur.execute(
            "insert into ai_summaries (patient_id, type, content, model, created_by) values (%s, 'pattern', %s, %s, %s)",
            (pid, Jsonb(content), model, user.profile_id),
        )
    return {**content, "model": model, "disclaimer": DISCLAIMER}


def _ocr(data: bytes, mime: str) -> str:
    if mime == "application/pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        return "\n".join((page.extract_text() or "") for page in reader.pages[:10])
    try:
        import pytesseract
        from PIL import Image

        return pytesseract.image_to_string(Image.open(io.BytesIO(data)))
    except Exception:  # tesseract binary not installed: fall back to the vision model
        return ""


class ExtractIn(BaseModel):
    document_id: UUID


@router.post("/extract-document")
def extract_document(body: ExtractIn, user: CurrentUser = Depends(current_user)):
    """OCR + AI extraction. Results are stored as unverified suggestions until someone confirms them."""
    with tx(user.profile_id) as cur:
        cur.execute("select * from documents where id = %s", (body.document_id,))
        doc = cur.fetchone()
        if not doc:
            raise HTTPException(404, "Document not found")
        require_read(cur, user, doc["patient_id"])
        cur.execute("update documents set extraction_status = 'processing' where id = %s", (doc["id"],))
    try:
        data = storage.download("documents", doc["storage_path"])
        text = _ocr(data, doc["mime_type"] or "")
        if text.strip():
            result, model = complete_json(prompts.EXTRACTION, text[:12000], DocumentExtraction)
        elif (doc["mime_type"] or "").startswith("image/"):
            image_url = f"data:{doc['mime_type']};base64,{base64.b64encode(data).decode()}"
            result, model = complete_json(
                prompts.EXTRACTION,
                [{"type": "text", "text": "Extract the data from this document image."},
                 {"type": "image_url", "image_url": {"url": image_url}}],
                DocumentExtraction,
                model=get_settings().groq_vision_model,
            )
        else:
            raise AIUnavailable("No readable text found in the document")
    except Exception as e:
        with tx(user.profile_id) as cur:
            cur.execute("update documents set extraction_status = 'failed' where id = %s", (doc["id"],))
        if isinstance(e, AIUnavailable):
            raise _unavailable(e)
        raise HTTPException(502, f"Could not read the document: {e}")
    extracted = {**result.model_dump(), "model": model}
    with tx(user.profile_id) as cur:
        cur.execute(
            "update documents set extraction_status = 'needs_review', extracted_json = %s where id = %s",
            (Jsonb(extracted), doc["id"]),
        )
    return {"document_id": doc["id"], "extracted": extracted, "status": "needs_review",
            "disclaimer": "AI-extracted and unverified. Check every field against the document before saving."}


def _parse_date(value) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except ValueError:
        return None


class ConfirmIn(BaseModel):
    medications: list[dict] = Field(default_factory=list)
    conditions: list[dict] = Field(default_factory=list)
    allergies: list[dict] = Field(default_factory=list)
    lab_results: list[dict] = Field(default_factory=list)


@router.post("/documents/{document_id}/confirm")
def confirm_extraction(document_id: UUID, body: ConfirmIn, user: CurrentUser = Depends(current_user)):
    """Saves the fields the user reviewed (and possibly corrected) as ai-extracted, verified entries."""
    with tx(user.profile_id) as cur:
        cur.execute("select * from documents where id = %s", (document_id,))
        doc = cur.fetchone()
        if not doc:
            raise HTTPException(404, "Document not found")
        require_read(cur, user, doc["patient_id"])
        pid = doc["patient_id"]
        doc_date = _parse_date((doc["extracted_json"] or {}).get("document_date"))
        for m in body.medications:
            if m.get("name"):
                cur.execute(
                    """insert into medications (patient_id, name, dose, frequency, start_date, source, verified, recorded_by)
                       values (%s, %s, %s, %s, %s, 'ai-extracted', true, %s)""",
                    (pid, m["name"], m.get("dose"), m.get("frequency"), doc_date, user.profile_id),
                )
        for c in body.conditions:
            if c.get("name"):
                cur.execute(
                    """insert into conditions (patient_id, name, onset_date, source, verified, recorded_by)
                       values (%s, %s, %s, 'ai-extracted', true, %s)""",
                    (pid, c["name"], doc_date, user.profile_id),
                )
        for a in body.allergies:
            if a.get("substance"):
                cur.execute(
                    """insert into allergies (patient_id, substance, reaction, source, verified, recorded_by)
                       values (%s, %s, %s, 'ai-extracted', true, %s)""",
                    (pid, a["substance"], a.get("reaction"), user.profile_id),
                )
        if body.lab_results:
            cur.execute(
                """insert into history_entries (patient_id, type, title, details, event_date, source, verified, recorded_by)
                   values (%s, 'lab', %s, %s, %s, 'ai-extracted', true, %s)""",
                (pid, f"Lab results from {doc['filename']}", Jsonb({"results": body.lab_results, "document_id": str(document_id)}),
                 doc_date, user.profile_id),
            )
        cur.execute("update documents set extraction_status = 'confirmed' where id = %s", (document_id,))
    return {"ok": True}
