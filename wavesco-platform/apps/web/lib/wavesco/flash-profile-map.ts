// Helpers for flash-card -> AcquisitionProfile mapping
// Kept separate for unit testing and reuse; client sees friendly questions, system gets structured context.

export type Answers = Record<string, string>;

export function answersToPayload(a: Answers): Record<string, unknown> {
  const trim = (v: string | undefined) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
  const num = (v: string | undefined) => {
    if (!v || v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const icp: Record<string, unknown> = {};
  const offer: Record<string, unknown> = {};
  const rules: Record<string, unknown> = {};
  const brand: Record<string, unknown> = {};

  const setIcp = (k: string, v: string | undefined) => {
    const t = trim(v);
    if (t) icp[k] = t;
  };
  const setOffer = (k: string, v: string | undefined) => {
    const t = trim(v);
    if (t) offer[k] = t;
  };
  const setRule = (k: string, v: string | undefined) => {
    const t = trim(v);
    if (t) rules[k] = t;
  };
  const setBrand = (k: string, v: string | undefined) => {
    const t = trim(v);
    if (t) brand[k] = t;
  };

  setIcp("targetCustomer", a["icp_targetCustomer"]);
  setIcp("industry", a["icp_industry"]);
  setIcp("geography", a["icp_geography"]);
  setIcp("companySize", a["icp_companySize"]);
  setIcp("decisionMakerTitles", a["icp_decisionMakerTitles"]);
  setIcp("characteristics", a["icp_characteristics"]);
  setIcp("disqualifiers", a["icp_disqualifiers"]);

  setOffer("productService", a["offer_productService"]);
  setOffer("pricing", a["offer_pricing"]);
  setOffer("valueProp", a["offer_valueProp"]);
  setOffer("differentiators", a["offer_differentiators"]);
  setOffer("proof", a["offer_proof"]);
  setOffer("cta", a["offer_cta"]);

  if (trim(a["icp_geography"])) rules["geoRestrictions"] = trim(a["icp_geography"]);
  if (trim(a["rules_industriesExclude"])) rules["industriesExclude"] = trim(a["rules_industriesExclude"]);
  if (trim(a["rules_outreachRestrictions"])) rules["outreachRestrictions"] = trim(a["rules_outreachRestrictions"]);
  if (trim(a["icp_disqualifiers"])) rules["customerTypesExclude"] = trim(a["icp_disqualifiers"]);

  setBrand("toneOfVoice", a["brand_toneOfVoice"]);
  setBrand("avoidSaying", a["brand_avoidSaying"]);

  const payload: Record<string, unknown> = {};
  if (trim(a["companyName"])) payload.companyName = trim(a["companyName"]);
  if (trim(a["website"])) payload.website = trim(a["website"]);
  if (trim(a["industry"])) payload.industry = trim(a["industry"]);
  if (trim(a["whatWeSell"])) payload.whatWeSell = trim(a["whatWeSell"]);
  if (trim(a["priorityProductService"])) payload.priorityProductService = trim(a["priorityProductService"]);
  if (trim(a["acquisitionObjective"])) payload.acquisitionObjective = trim(a["acquisitionObjective"]);
  if (trim(a["primaryObjective"])) payload.primaryObjective = trim(a["primaryObjective"]);
  const tq = num(a["targetQuantity"]);
  if (tq !== null) payload.targetQuantity = tq;
  if (trim(a["targetTimeframe"])) payload.targetTimeframe = trim(a["targetTimeframe"]);

  if (Object.keys(icp).length) payload.icp = icp;
  if (Object.keys(offer).length) payload.offer = offer;
  if (Object.keys(rules).length) payload.rules = rules;
  if (Object.keys(brand).length) payload.brand = brand;

  return payload;
}

export function payloadToAnswers(profile: any): Answers {
  if (!profile) return {};
  const s = (v: unknown) => (v == null ? "" : String(v));
  const a: Answers = {};
  a["companyName"] = s(profile.companyName);
  a["website"] = s(profile.website);
  a["industry"] = s(profile.industry);
  a["whatWeSell"] = s(profile.whatWeSell);
  a["priorityProductService"] = s(profile.priorityProductService);
  a["acquisitionObjective"] = s(profile.acquisitionObjective);
  a["primaryObjective"] = s(profile.primaryObjective);
  a["targetQuantity"] = s(profile.targetQuantity ?? "");
  a["targetTimeframe"] = s(profile.targetTimeframe ?? "");
  const icp = (profile.icp as any) || {};
  a["icp_targetCustomer"] = s(icp.targetCustomer);
  a["icp_industry"] = s(icp.industry);
  a["icp_geography"] = s(icp.geography);
  a["icp_companySize"] = s(icp.companySize);
  a["icp_decisionMakerTitles"] = s(icp.decisionMakerTitles);
  a["icp_characteristics"] = s(icp.characteristics);
  a["icp_disqualifiers"] = s(icp.disqualifiers);
  const offer = (profile.offer as any) || {};
  a["offer_productService"] = s(offer.productService);
  a["offer_pricing"] = s(offer.pricing);
  a["offer_valueProp"] = s(offer.valueProp);
  a["offer_differentiators"] = s(offer.differentiators);
  a["offer_proof"] = s(offer.proof);
  a["offer_cta"] = s(offer.cta);
  const rules = (profile.rules as any) || {};
  a["rules_industriesExclude"] = s(rules.industriesExclude);
  a["rules_outreachRestrictions"] = s(rules.outreachRestrictions);
  const brand = (profile.brand as any) || {};
  a["brand_toneOfVoice"] = s(brand.toneOfVoice);
  a["brand_avoidSaying"] = s(brand.avoidSaying);
  return a;
}
