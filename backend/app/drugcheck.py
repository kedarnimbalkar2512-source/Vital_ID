"""Rule-based drug-drug and drug-allergy checks against the reference tables in the database."""

import re

from psycopg import Cursor

SEVERITY_RANK = {"minor": 0, "moderate": 1, "major": 2, "contraindicated": 3}


def normalise(name: str) -> str:
    """'Warfarin Sodium 5 mg tab' -> 'warfarin sodium'. Strengths and dosage forms are dropped."""
    n = name.lower().strip()
    n = re.sub(r"\(.*?\)", " ", n)
    n = re.sub(r"\b\d+(\.\d+)?\s*(mg|mcg|g|ml|iu|units?|%)\b", " ", n)
    n = re.sub(r"\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syrup|inj|injection|sr|er|xr|od|bd|tds)\b", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def terms_for(cur: Cursor, name: str) -> set[str]:
    """A drug's own name(s) plus the classes it belongs to."""
    names, classes = names_and_classes(cur, name)
    return names | classes


def names_and_classes(cur: Cursor, name: str) -> tuple[set[str], set[str]]:
    """Matches multi-word names on word boundaries, so 'warfarin sodium' still maps to 'warfarin'."""
    n = normalise(name)
    names, classes = {n}, set()
    cur.execute(
        r"""
        select drug_name, class_name from drug_classes
        where %s = drug_name or %s ~ ('(^|[^a-z])' || regexp_replace(drug_name, '([.+*?^$()\[\]{}|\\-])', '\\\1', 'g') || '([^a-z]|$)')
        """,
        (n, n),
    )
    for r in cur.fetchall():
        names.add(r["drug_name"])
        classes.add(r["class_name"])
    return names, classes


def allergy_terms(cur: Cursor, substance: str) -> set[str]:
    n = normalise(substance)
    terms = terms_for(cur, n)
    # "sulfa drugs", "penicillins" -> "sulfa", "penicillin"
    for word in n.split():
        terms.add(word.rstrip("s"))
    if "sulfa" in n or "sulpha" in n:
        terms.add("sulfa")
    return terms


def check(cur: Cursor, new_drug: str, current_meds: list[dict], allergies: list[dict]) -> list[dict]:
    """Returns warnings sorted most severe first. Each warning names the existing record it involves."""
    new_names, new_classes = names_and_classes(cur, new_drug)
    new_terms = new_names | new_classes
    warnings: dict[tuple, dict] = {}

    def add(key: tuple, w: dict) -> None:
        if key not in warnings or SEVERITY_RANK[w["severity"]] > SEVERITY_RANK[warnings[key]["severity"]]:
            warnings[key] = w

    for med in current_meds:
        med_names, med_classes = names_and_classes(cur, med["name"])
        med_terms = med_names | med_classes
        if new_names & med_names:
            add(("dup", str(med["id"])), {
                "type": "duplicate", "severity": "moderate", "involves": [new_drug, med["name"]],
                "description": f"{med['name']} is already an active medication.", "source_ids": [str(med["id"])],
                "reference": None,
            })
            continue
        shared = new_classes & med_classes
        if shared:
            add(("class", str(med["id"])), {
                "type": "duplicate-class", "severity": "moderate", "involves": [new_drug, med["name"]],
                "description": f"Both are {', '.join(sorted(shared))} drugs: possible therapeutic duplication.",
                "source_ids": [str(med["id"])], "reference": None,
            })
        cur.execute(
            """
            select * from drug_interactions
            where (term_a = any(%s) and term_b = any(%s)) or (term_b = any(%s) and term_a = any(%s))
            """,
            (list(new_terms), list(med_terms), list(new_terms), list(med_terms)),
        )
        for r in cur.fetchall():
            add(("ddi", str(med["id"])), {
                "type": "drug-drug", "severity": r["severity"], "involves": [new_drug, med["name"]],
                "description": r["description"], "source_ids": [str(med["id"])], "reference": r["reference"],
            })

    for a in allergies:
        a_terms = allergy_terms(cur, a["substance"])
        overlap = (a_terms & new_terms) - {""}
        if overlap:
            add(("allergy", str(a["id"])), {
                "type": "drug-allergy", "severity": "contraindicated", "involves": [new_drug, a["substance"]],
                "description": f"Recorded {a['severity']} allergy to {a['substance']}"
                + (f" ({a['reaction']})" if a.get("reaction") else "")
                + f"; {new_drug} belongs to the same drug/class ({', '.join(sorted(overlap))}).",
                "source_ids": [str(a["id"])], "reference": None,
            })
            continue
        cur.execute(
            "select * from allergy_cross_reactivity where allergen = any(%s) and drug_term = any(%s)",
            (list(a_terms), list(new_terms)),
        )
        for r in cur.fetchall():
            add(("cross", str(a["id"])), {
                "type": "cross-reactivity", "severity": r["severity"], "involves": [new_drug, a["substance"]],
                "description": r["description"], "source_ids": [str(a["id"])], "reference": None,
            })

    return sorted(warnings.values(), key=lambda w: -SEVERITY_RANK[w["severity"]])
