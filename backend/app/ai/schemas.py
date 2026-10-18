from typing import Literal

from pydantic import BaseModel, Field


class Cited(BaseModel):
    text: str
    source_ids: list[str] = Field(default_factory=list, description="ids of the records this statement is based on")


class DoctorBrief(BaseModel):
    one_line: str = Field(description="one-sentence overview, no name")
    key_conditions: list[Cited] = Field(default_factory=list)
    active_medications: list[Cited] = Field(default_factory=list)
    allergies: list[Cited] = Field(default_factory=list)
    red_flags: list[Cited] = Field(default_factory=list)
    recent_changes: list[Cited] = Field(default_factory=list)
    cognitive_status: Cited | None = None


Severity = Literal["minor", "moderate", "major", "contraindicated"]


class AIDrugWarning(BaseModel):
    severity: Severity
    involves: list[str] = Field(description="drug or allergy names involved")
    explanation: str
    source_ids: list[str] = Field(default_factory=list)


class AIDrugCheck(BaseModel):
    warnings: list[AIDrugWarning] = Field(default_factory=list)
    summary: str


class PossibleCondition(BaseModel):
    name: str
    likelihood: Literal["low", "medium", "high"]
    rationale: str


class NotesAnalysis(BaseModel):
    symptoms: list[str] = Field(default_factory=list)
    possible_conditions: list[PossibleCondition] = Field(default_factory=list)
    suggested_next_steps: list[str] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    severity: Literal["low", "moderate", "high", "critical"]


class Pattern(BaseModel):
    title: str
    detail: str
    trend: Literal["worsening", "improving", "stable", "recurring"]
    source_ids: list[str] = Field(default_factory=list)


class RiskFlag(BaseModel):
    title: str
    detail: str
    level: Literal["low", "medium", "high"]
    source_ids: list[str] = Field(default_factory=list)


class PatternReport(BaseModel):
    patterns: list[Pattern] = Field(default_factory=list)
    risk_flags: list[RiskFlag] = Field(default_factory=list)


class ExtractedMedication(BaseModel):
    name: str
    dose: str | None = None
    frequency: str | None = None


class ExtractedCondition(BaseModel):
    name: str


class ExtractedAllergy(BaseModel):
    substance: str
    reaction: str | None = None


class ExtractedLab(BaseModel):
    test: str
    value: str
    unit: str | None = None
    reference_range: str | None = None


class DocumentExtraction(BaseModel):
    document_date: str | None = Field(default=None, description="YYYY-MM-DD if present")
    medications: list[ExtractedMedication] = Field(default_factory=list)
    conditions: list[ExtractedCondition] = Field(default_factory=list)
    allergies: list[ExtractedAllergy] = Field(default_factory=list)
    lab_results: list[ExtractedLab] = Field(default_factory=list)
    summary: str | None = None


class AlertSummary(BaseModel):
    summary: str = Field(description="2-3 plain-language sentences for a caregiver or doctor")
