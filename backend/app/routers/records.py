"""Patient/caregiver edits to their own record. Everything written here is labelled
'patient-reported'; doctor-entered and AI-extracted rows can't be edited from this side."""

from datetime import date
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from psycopg import sql
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .. import storage
from ..access import require_manage, require_read, resolve_managed_patient
from ..auth import CurrentUser, current_user
from ..db import tx

router = APIRouter(prefix="/api/records", tags=["records"])

Table = Literal["conditions", "medications", "allergies", "history_entries", "emergency_contacts"]

# Columns a patient/caregiver may set per table (everything else is server-controlled).
EDITABLE: dict[str, set[str]] = {
    "conditions": {"name", "status", "onset_date", "notes", "is_critical"},
    "medications": {"name", "dose", "frequency", "start_date", "end_date", "status", "prescriber", "is_critical", "reminder_times"},
    "allergies": {"substance", "reaction", "severity"},
    "history_entries": {"type", "title", "details", "event_date"},
    "emergency_contacts": {"name", "relationship", "phone", "priority"},
}
REQUIRED = {"conditions": "name", "medications": "name", "allergies": "substance", "history_entries": "title",
            "emergency_contacts": "phone"}
HAS_SOURCE = {"conditions", "medications", "allergies", "history_entries"}


class RecordIn(BaseModel):
    patient_id: UUID | None = None
    data: dict


def _clean(table: str, data: dict) -> dict:
    out = {k: v for k, v in data.items() if k in EDITABLE[table]}
    for k, v in list(out.items()):
        if isinstance(v, str):
            out[k] = v.strip() or None
        if k == "priority" and out[k] is not None:
            try:
                out[k] = int(out[k])
            except (TypeError, ValueError):
                raise HTTPException(422, "priority must be a number")
        if k == "details":
            out[k] = Jsonb(v or {})
        if k in ("onset_date", "start_date", "end_date", "event_date") and out[k]:
            try:
                out[k] = date.fromisoformat(str(out[k])[:10])
            except ValueError:
                raise HTTPException(422, f"{k} must be a date (YYYY-MM-DD)")
    return out


@router.post("/{table}")
def create(table: Table, body: RecordIn, user: CurrentUser = Depends(current_user)):
    data = _clean(table, body.data)
    if not data.get(REQUIRED[table]):
        raise HTTPException(422, f"{REQUIRED[table]} is required")
    with tx(user.profile_id) as cur:
        pid = resolve_managed_patient(cur, user, body.patient_id)
        data["patient_id"] = pid
        if table in HAS_SOURCE:
            data.update(source="patient-reported", verified=False, recorded_by=user.profile_id)
        cols = list(data)
        cur.execute(
            sql.SQL("insert into {} ({}) values ({}) returning *").format(
                sql.Identifier(table), sql.SQL(", ").join(map(sql.Identifier, cols)),
                sql.SQL(", ").join(sql.Placeholder() * len(cols))),
            [data[c] for c in cols],
        )
        return cur.fetchone()


def _load_own(cur, table: str, record_id: UUID, user: CurrentUser) -> dict:
    cur.execute(sql.SQL("select * from {} where id = %s").format(sql.Identifier(table)), (record_id,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Record not found")
    require_manage(cur, user, row["patient_id"])
    if table in HAS_SOURCE and row["source"] != "patient-reported":
        raise HTTPException(403, f"This entry is {row['source']}; only a doctor can change it")
    return row


class PatchIn(BaseModel):
    data: dict


@router.patch("/{table}/{record_id}")
def update(table: Table, record_id: UUID, body: PatchIn, user: CurrentUser = Depends(current_user)):
    data = _clean(table, body.data)
    if not data:
        raise HTTPException(422, "Nothing to update")
    with tx(user.profile_id) as cur:
        _load_own(cur, table, record_id, user)
        cur.execute(
            sql.SQL("update {} set {} where id = %s returning *").format(
                sql.Identifier(table),
                sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(c)) for c in data)),
            [*data.values(), record_id],
        )
        return cur.fetchone()


@router.delete("/{table}/{record_id}")
def delete(table: Table, record_id: UUID, user: CurrentUser = Depends(current_user)):
    with tx(user.profile_id) as cur:
        _load_own(cur, table, record_id, user)
        cur.execute(sql.SQL("delete from {} where id = %s").format(sql.Identifier(table)), (record_id,))
    return {"ok": True}


class PatientUpdate(BaseModel):
    patient_id: UUID | None = None
    full_name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    dob: date | None = None
    gender: Literal["female", "male", "other", "undisclosed"] | None = None
    blood_group: Literal["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"] | None = None
    has_cognitive_condition: bool | None = None
    emergency_note: str | None = Field(default=None, max_length=500)
    city: str | None = Field(default=None, max_length=80)


@router.patch("/patient")
def update_patient(body: PatientUpdate, user: CurrentUser = Depends(current_user)):
    fields = body.model_dump(exclude_unset=True, exclude={"patient_id"})
    profile_fields = {k: fields.pop(k) for k in ("full_name", "phone") if k in fields}
    with tx(user.profile_id) as cur:
        pid = resolve_managed_patient(cur, user, body.patient_id)
        if fields:
            cur.execute(
                sql.SQL("update patients set {} where id = %s").format(
                    sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(c)) for c in fields)),
                [*fields.values(), pid],
            )
        if profile_fields:
            if user.patient_id != pid:
                raise HTTPException(403, "Only the patient can change their name and phone")
            cur.execute(
                sql.SQL("update profiles set {} where id = %s").format(
                    sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(c)) for c in profile_fields)),
                [*profile_fields.values(), user.profile_id],
            )
    return {"ok": True}


ALLOWED_MIME = {"image/png", "image/jpeg", "image/webp", "application/pdf"}
MAX_BYTES = 10 * 1024 * 1024


@router.post("/documents")
async def upload_document(
    file: UploadFile = File(...),
    doc_type: str = Form("other"),
    patient_id: UUID | None = Form(None),
    user: CurrentUser = Depends(current_user),
):
    """Stores the file in the private 'documents' bucket under <patient_id>/ and records it."""
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(415, "Upload a PDF, PNG, JPEG or WebP file")
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File is larger than 10 MB")
    with tx() as cur:
        pid = resolve_managed_patient(cur, user, patient_id)
    safe_name = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in (file.filename or "document"))[-80:]
    path = f"{pid}/{uuid4().hex}-{safe_name}"
    try:
        storage.upload("documents", path, data, file.content_type)
    except Exception as e:
        raise HTTPException(502, f"Storage upload failed: {e}")
    with tx(user.profile_id) as cur:
        cur.execute(
            """insert into documents (patient_id, storage_path, doc_type, filename, mime_type, size, uploaded_by)
               values (%s, %s, %s, %s, %s, %s, %s) returning id, doc_type, filename, mime_type, size, extraction_status, created_at""",
            (pid, path, doc_type if doc_type in ("prescription", "lab_report", "discharge_summary", "imaging", "other") else "other",
             file.filename or safe_name, file.content_type, len(data), user.profile_id),
        )
        return cur.fetchone()


@router.get("/documents/{document_id}/url")
def document_url(document_id: UUID, user: CurrentUser = Depends(current_user)):
    with tx() as cur:
        cur.execute("select patient_id, storage_path from documents where id = %s", (document_id,))
        doc = cur.fetchone()
        if not doc:
            raise HTTPException(404, "Document not found")
        require_read(cur, user, doc["patient_id"])
    url = storage.signed_url("documents", doc["storage_path"], 300)
    if not url:
        raise HTTPException(502, "Could not create a download link")
    return {"url": url, "expires_in": 300}


@router.delete("/documents/{document_id}")
def delete_document(document_id: UUID, user: CurrentUser = Depends(current_user)):
    with tx(user.profile_id) as cur:
        cur.execute("select patient_id, storage_path from documents where id = %s", (document_id,))
        doc = cur.fetchone()
        if not doc:
            raise HTTPException(404, "Document not found")
        require_manage(cur, user, doc["patient_id"])
        cur.execute("delete from documents where id = %s", (document_id,))
    storage.remove("documents", doc["storage_path"])
    return {"ok": True}


@router.post("/photo")
async def upload_photo(file: UploadFile = File(...), patient_id: UUID | None = Form(None),
                       user: CurrentUser = Depends(current_user)):
    if file.content_type not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(415, "Upload a PNG, JPEG or WebP image")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "Photo is larger than 5 MB")
    with tx() as cur:
        pid = resolve_managed_patient(cur, user, patient_id)
    path = f"{pid}/photo-{uuid4().hex[:8]}"
    try:
        storage.upload("photos", path, data, file.content_type)
    except Exception as e:
        raise HTTPException(502, f"Storage upload failed: {e}")
    with tx(user.profile_id) as cur:
        cur.execute("select photo_url from patients where id = %s", (pid,))
        old = cur.fetchone()["photo_url"]
        cur.execute("update patients set photo_url = %s where id = %s", (path, pid))
    if old:
        storage.remove("photos", old)
    return {"ok": True}


@router.get("/photo")
def photo_url(patient_id: UUID | None = None, user: CurrentUser = Depends(current_user)):
    with tx() as cur:
        pid = patient_id or user.patient_id
        if not pid:
            raise HTTPException(400, "patient_id is required")
        require_read(cur, user, pid)
        cur.execute("select photo_url from patients where id = %s", (pid,))
        path = cur.fetchone()["photo_url"]
    return {"url": storage.signed_url("photos", path, 300) if path else None}
