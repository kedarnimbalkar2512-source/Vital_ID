-- Starter rule base for the drug-conflict check. This is reference data, not patient data.
-- It covers well-known, textbook interaction pairs only; it is NOT exhaustive and the app
-- always shows results as warnings to verify against a formulary, never as advice.
-- Extend it by inserting more rows; the backend reads these tables at request time.

insert into public.drug_classes (drug_name, class_name) values
  -- anticoagulants / antiplatelets
  ('warfarin', 'anticoagulant'), ('acenocoumarol', 'anticoagulant'), ('apixaban', 'anticoagulant'),
  ('rivaroxaban', 'anticoagulant'), ('dabigatran', 'anticoagulant'), ('heparin', 'anticoagulant'),
  ('enoxaparin', 'anticoagulant'),
  ('aspirin', 'antiplatelet'), ('clopidogrel', 'antiplatelet'), ('ticagrelor', 'antiplatelet'), ('prasugrel', 'antiplatelet'),
  -- NSAIDs
  ('aspirin', 'nsaid'), ('ibuprofen', 'nsaid'), ('diclofenac', 'nsaid'), ('naproxen', 'nsaid'), ('ketorolac', 'nsaid'),
  ('aceclofenac', 'nsaid'), ('indomethacin', 'nsaid'), ('mefenamic acid', 'nsaid'), ('etoricoxib', 'nsaid'), ('celecoxib', 'nsaid'),
  -- beta-lactams
  ('penicillin', 'penicillin'), ('penicillin v', 'penicillin'), ('benzathine penicillin', 'penicillin'),
  ('amoxicillin', 'penicillin'), ('ampicillin', 'penicillin'), ('cloxacillin', 'penicillin'), ('piperacillin', 'penicillin'),
  ('co-amoxiclav', 'penicillin'), ('amoxicillin-clavulanate', 'penicillin'), ('augmentin', 'penicillin'),
  ('cefalexin', 'cephalosporin'), ('cephalexin', 'cephalosporin'), ('cefuroxime', 'cephalosporin'),
  ('ceftriaxone', 'cephalosporin'), ('cefixime', 'cephalosporin'), ('cefpodoxime', 'cephalosporin'),
  -- other antimicrobials
  ('sulfamethoxazole', 'sulfonamide'), ('co-trimoxazole', 'sulfonamide'), ('cotrimoxazole', 'sulfonamide'),
  ('clarithromycin', 'macrolide'), ('erythromycin', 'macrolide'), ('azithromycin', 'macrolide'),
  ('ciprofloxacin', 'fluoroquinolone'), ('levofloxacin', 'fluoroquinolone'), ('ofloxacin', 'fluoroquinolone'),
  ('fluconazole', 'azole antifungal'), ('metronidazole', 'nitroimidazole'),
  -- CNS
  ('sertraline', 'ssri'), ('fluoxetine', 'ssri'), ('escitalopram', 'ssri'), ('citalopram', 'ssri'), ('paroxetine', 'ssri'),
  ('selegiline', 'maoi'), ('rasagiline', 'maoi'), ('phenelzine', 'maoi'),
  ('tramadol', 'opioid'), ('morphine', 'opioid'), ('codeine', 'opioid'), ('oxycodone', 'opioid'), ('fentanyl', 'opioid'), ('tapentadol', 'opioid'),
  ('alprazolam', 'benzodiazepine'), ('diazepam', 'benzodiazepine'), ('lorazepam', 'benzodiazepine'),
  ('clonazepam', 'benzodiazepine'), ('midazolam', 'benzodiazepine'),
  ('donepezil', 'cholinesterase inhibitor'), ('rivastigmine', 'cholinesterase inhibitor'), ('galantamine', 'cholinesterase inhibitor'),
  ('oxybutynin', 'anticholinergic'), ('diphenhydramine', 'anticholinergic'), ('amitriptyline', 'anticholinergic'),
  ('trihexyphenidyl', 'anticholinergic'), ('chlorpheniramine', 'anticholinergic'), ('tolterodine', 'anticholinergic'),
  ('lithium', 'lithium'),
  -- cardiovascular / renal
  ('enalapril', 'ace inhibitor'), ('ramipril', 'ace inhibitor'), ('lisinopril', 'ace inhibitor'), ('perindopril', 'ace inhibitor'),
  ('losartan', 'arb'), ('telmisartan', 'arb'), ('olmesartan', 'arb'), ('valsartan', 'arb'),
  ('spironolactone', 'potassium-sparing'), ('eplerenone', 'potassium-sparing'), ('amiloride', 'potassium-sparing'),
  ('potassium chloride', 'potassium-sparing'),
  ('metoprolol', 'beta blocker'), ('atenolol', 'beta blocker'), ('propranolol', 'beta blocker'), ('bisoprolol', 'beta blocker'),
  ('nitroglycerin', 'nitrate'), ('isosorbide mononitrate', 'nitrate'), ('isosorbide dinitrate', 'nitrate'),
  ('sildenafil', 'pde5 inhibitor'), ('tadalafil', 'pde5 inhibitor'),
  ('simvastatin', 'statin'), ('atorvastatin', 'statin'), ('rosuvastatin', 'statin'),
  ('digoxin', 'digoxin'), ('amiodarone', 'antiarrhythmic'),
  ('omeprazole', 'ppi'), ('esomeprazole', 'ppi'), ('pantoprazole', 'ppi'),
  -- metabolic / immunology
  ('glimepiride', 'sulfonylurea'), ('gliclazide', 'sulfonylurea'), ('glibenclamide', 'sulfonylurea'),
  ('methotrexate', 'methotrexate'), ('allopurinol', 'xanthine oxidase inhibitor'), ('azathioprine', 'thiopurine')
on conflict do nothing;

insert into public.drug_interactions (term_a, term_b, severity, description, reference) values
  ('anticoagulant', 'nsaid', 'major', 'Combined anticoagulant and NSAID use substantially raises bleeding risk, especially GI bleeding.', 'BNF interactions'),
  ('anticoagulant', 'antiplatelet', 'major', 'Anticoagulant plus antiplatelet therapy increases bleeding risk.', 'BNF interactions'),
  ('warfarin', 'fluconazole', 'major', 'Fluconazole inhibits warfarin metabolism and can sharply raise INR.', 'BNF interactions'),
  ('warfarin', 'metronidazole', 'major', 'Metronidazole potentiates warfarin and raises INR.', 'BNF interactions'),
  ('warfarin', 'amiodarone', 'major', 'Amiodarone increases the anticoagulant effect of warfarin.', 'BNF interactions'),
  ('warfarin', 'ciprofloxacin', 'moderate', 'Ciprofloxacin may increase the anticoagulant effect of warfarin; monitor INR.', 'BNF interactions'),
  ('warfarin', 'macrolide', 'moderate', 'Macrolides may increase the anticoagulant effect of warfarin; monitor INR.', 'BNF interactions'),
  ('ssri', 'maoi', 'contraindicated', 'Risk of serotonin syndrome.', 'BNF interactions'),
  ('tramadol', 'ssri', 'major', 'Risk of serotonin syndrome and lowered seizure threshold.', 'BNF interactions'),
  ('tramadol', 'maoi', 'contraindicated', 'Risk of serotonin syndrome.', 'BNF interactions'),
  ('ssri', 'nsaid', 'moderate', 'SSRIs with NSAIDs increase the risk of GI bleeding.', 'BNF interactions'),
  ('ssri', 'anticoagulant', 'moderate', 'SSRIs may increase bleeding risk with anticoagulants.', 'BNF interactions'),
  ('opioid', 'benzodiazepine', 'major', 'Additive CNS and respiratory depression; higher fall risk in older adults.', 'FDA boxed warning'),
  ('ace inhibitor', 'potassium-sparing', 'major', 'Risk of hyperkalaemia.', 'BNF interactions'),
  ('arb', 'potassium-sparing', 'major', 'Risk of hyperkalaemia.', 'BNF interactions'),
  ('ace inhibitor', 'arb', 'major', 'Dual RAAS blockade raises risk of hyperkalaemia, hypotension and renal impairment.', 'BNF interactions'),
  ('simvastatin', 'clarithromycin', 'contraindicated', 'Raised simvastatin levels; risk of myopathy and rhabdomyolysis.', 'BNF interactions'),
  ('simvastatin', 'erythromycin', 'contraindicated', 'Raised simvastatin levels; risk of myopathy and rhabdomyolysis.', 'BNF interactions'),
  ('atorvastatin', 'clarithromycin', 'moderate', 'Raised atorvastatin levels; risk of myopathy.', 'BNF interactions'),
  ('cholinesterase inhibitor', 'anticholinergic', 'major', 'Opposing mechanisms; anticholinergics can blunt dementia treatment and worsen confusion.', 'Beers Criteria'),
  ('cholinesterase inhibitor', 'beta blocker', 'moderate', 'Additive bradycardia; risk of syncope and falls.', 'BNF interactions'),
  ('nitrate', 'pde5 inhibitor', 'contraindicated', 'Severe, potentially fatal hypotension.', 'BNF interactions'),
  ('digoxin', 'antiarrhythmic', 'major', 'Amiodarone raises digoxin levels; risk of toxicity.', 'BNF interactions'),
  ('lithium', 'nsaid', 'major', 'NSAIDs reduce lithium excretion; risk of lithium toxicity.', 'BNF interactions'),
  ('lithium', 'ace inhibitor', 'major', 'ACE inhibitors raise lithium levels; risk of toxicity.', 'BNF interactions'),
  ('methotrexate', 'nsaid', 'major', 'NSAIDs reduce methotrexate excretion; risk of toxicity.', 'BNF interactions'),
  ('methotrexate', 'sulfonamide', 'major', 'Co-trimoxazole with methotrexate increases risk of bone-marrow suppression.', 'BNF interactions'),
  ('xanthine oxidase inhibitor', 'thiopurine', 'major', 'Allopurinol markedly raises azathioprine toxicity.', 'BNF interactions'),
  ('sulfonylurea', 'fluoroquinolone', 'moderate', 'Risk of hypo- or hyperglycaemia.', 'BNF interactions'),
  ('clopidogrel', 'ppi', 'moderate', 'Omeprazole/esomeprazole may reduce clopidogrel activation.', 'BNF interactions')
on conflict do nothing;

insert into public.allergy_cross_reactivity (allergen, drug_term, severity, description) values
  ('penicillin', 'cephalosporin', 'moderate', 'Small cross-reactivity risk between penicillins and cephalosporins; use with caution and monitoring.'),
  ('aspirin', 'nsaid', 'major', 'Aspirin-sensitive patients often react to other NSAIDs.'),
  ('nsaid', 'aspirin', 'major', 'NSAID-sensitive patients may react to aspirin.'),
  ('sulfa', 'sulfonamide', 'contraindicated', 'Recorded sulfa allergy; sulfonamide antibiotics should be avoided.'),
  ('cephalosporin', 'penicillin', 'moderate', 'Small cross-reactivity risk between cephalosporins and penicillins.')
on conflict do nothing;
