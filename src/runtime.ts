import { APP_ID, CORE_ENTITY_COUNT, DATASET_VERSION, ENGINE_VERSION, ENRICHMENT_VERSION, EXPORT_FORMAT_VERSION, INDEXED_DB_VERSION, PERSISTENCE_SCHEMA_VERSION, PRODUCT_VERSION, REGISTRY_ENTITY_COUNT } from "./config";

export type Capability = "recognition" | "meaning" | "spelling" | "context";

export interface RuntimeEntity {
  stableId: string;
  lemma: string;
  pos: string;
  senses: Array<{ senseId: string; glossJa: string }>;
  capabilities: Capability[];
  prompts: Partial<Record<Capability, unknown[]>>;
  priority?: "S" | "A" | "B" | "C" | string;
  studyLayer?: string;
  targetBand?: string;
  schedules?: string[];
  quizEligible?: boolean;
  diagnosticEligible?: boolean;
  observedFrequency: number;
  years: number[];
  sourceSchedules: string[];
  categories: string[];
  evidence: SourceEvidence[];
  sourceExample: SourceExample | null;
  generatedExample: GeneratedExample | null;
  cloze: ClozeExample | null;
}

export interface SourceEvidence { year: number; schedule: "A" | "B"; page: number; count: number; category: string; }
export interface SourceExample { sentence: string; matchedForm: string; year: number; schedule: "A" | "B"; page: number; }
export interface GeneratedExample { sentence: string; ja: string; provenance: "generated-from-rikkyo-patterns"; }
export interface ClozeExample { sentence: string; answer: string; provenance: "past-paper-derived" | "generated-from-rikkyo-patterns"; }

export interface RuntimeBundle {
  release: {
    appId: string;
    productVersion: string;
    engineVersion: string;
    datasetVersion: string;
    persistenceSchemaVersion: number;
    exportFormatVersion: number;
    indexedDbVersion: number;
    commonEngineCommit: string;
    enrichmentVersion: string;
  };
  manifest: {
    appId: string;
    dataVersion: string;
    registryEntityCount: number;
    coreEntityCount: number;
    generatedFromPhase: 24;
    enrichmentVersion: string;
    sourcePapers: string[];
  };
  registry: Array<{ stableId: string }>;
  core: RuntimeEntity[];
}

type CompactManifest = RuntimeBundle["manifest"] & {
  registryVersion?: string;
  enrichment: string;
  chunks: string[];
};

interface EnrichmentFile {
  format: "rikkyo-vocab-enrichment/v1";
  version: string;
  entityCount: number;
  sourceMatchedEntityCount: number;
  generatedFallbackCount: number;
  entities: Record<string, Pick<RuntimeEntity, "observedFrequency" | "years" | "sourceSchedules" | "categories" | "evidence" | "sourceExample" | "generatedExample" | "cloze">>;
}

type CompactRow = [
  stableId: string,
  lemma: string,
  meaningJa: string,
  pos: string | null,
  priority: string,
  studyLayer: string,
  targetBand: string,
  schedules: string[],
  quizEligible: boolean,
  diagnosticEligible: boolean,
];

export async function fetchReleaseAsset(baseUrl: string, path: string): Promise<Response> {
  const separator = path.includes("?") ? "&" : "?";
  const currentUrl = `${baseUrl}${path}${separator}appRelease=${encodeURIComponent(PRODUCT_VERSION)}`;
  try {
    const response = await fetch(currentUrl, { cache: "no-store" });
    if (response.ok) return response;
  } catch {
    // An offline launch can still use the unversioned asset held by the active service worker.
  }
  return fetch(`${baseUrl}${path}`, { cache: "no-store" });
}

export interface GateReport {
  ok: boolean;
  reasons: string[];
  mappedCore: number;
  expectedCore: number;
}

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const allowedCapabilities = new Set<Capability>(["recognition", "meaning", "spelling", "context"]);

export function validateRuntimeBundle(value: unknown): GateReport {
  const reasons: string[] = [];
  const data = value as Partial<RuntimeBundle> | null;
  if (!data || typeof data !== "object") {
    return { ok: false, reasons: ["runtime bundleがありません。"], mappedCore: 0, expectedCore: CORE_ENTITY_COUNT };
  }
  const manifest = data.manifest;
  const release = data.release;
  if (release?.appId !== APP_ID) reasons.push("release manifest appIdが一致しません。");
  if (release?.productVersion !== PRODUCT_VERSION) reasons.push("productVersionが一致しません。");
  if (release?.engineVersion !== ENGINE_VERSION) reasons.push("engineVersionが一致しません。");
  if (release?.datasetVersion !== DATASET_VERSION || release.datasetVersion !== manifest?.dataVersion) reasons.push("datasetVersion tupleが一致しません。");
  if (release?.persistenceSchemaVersion !== PERSISTENCE_SCHEMA_VERSION) reasons.push("persistenceSchemaVersionが一致しません。");
  if (release?.exportFormatVersion !== EXPORT_FORMAT_VERSION) reasons.push("exportFormatVersionが一致しません。");
  if (release?.indexedDbVersion !== INDEXED_DB_VERSION) reasons.push("indexedDbVersionが一致しません。");
  if (release?.enrichmentVersion !== ENRICHMENT_VERSION) reasons.push("enrichmentVersionが一致しません。");
  if (manifest?.appId !== APP_ID) reasons.push("manifest.appIdが立教専用appIdと一致しません。");
  if (!nonEmpty(manifest?.dataVersion)) reasons.push("manifest.dataVersionがありません。");
  if (manifest?.registryEntityCount !== REGISTRY_ENTITY_COUNT) reasons.push(`Registryは${REGISTRY_ENTITY_COUNT}件である必要があります。`);
  if (manifest?.coreEntityCount !== CORE_ENTITY_COUNT) reasons.push(`Coreは${CORE_ENTITY_COUNT}件である必要があります。`);
  if (manifest?.generatedFromPhase !== 24) reasons.push("Phase 24語彙難度再々選定データであることを確認できません。");
  if (manifest?.enrichmentVersion !== ENRICHMENT_VERSION) reasons.push("過去問enrichment版が一致しません。");
  if (!Array.isArray(manifest?.sourcePapers) || manifest.sourcePapers.length !== 6) reasons.push("FY24-FY26 A/Bの6冊を確認できません。");

  const registry = Array.isArray(data.registry) ? data.registry : [];
  const core = Array.isArray(data.core) ? data.core : [];
  if (registry.length !== REGISTRY_ENTITY_COUNT) reasons.push(`Registry実体が${REGISTRY_ENTITY_COUNT}件ではありません。`);
  if (core.length !== CORE_ENTITY_COUNT) reasons.push(`Core実体が${CORE_ENTITY_COUNT}件ではありません。`);

  const registryIds = new Set<string>();
  for (const item of registry) {
    if (!nonEmpty(item?.stableId) || registryIds.has(item.stableId)) reasons.push("Registry stable IDが空または重複しています。");
    else registryIds.add(item.stableId);
  }

  let mappedCore = 0;
  const coreIds = new Set<string>();
  for (const entity of core) {
    let entityOk = true;
    if (!nonEmpty(entity?.stableId) || coreIds.has(entity.stableId)) entityOk = false;
    else coreIds.add(entity.stableId);
    if (!registryIds.has(entity?.stableId)) entityOk = false;
    if (!nonEmpty(entity?.lemma) || !nonEmpty(entity?.pos) || !Array.isArray(entity?.senses) || entity.senses.length === 0) entityOk = false;
    if (entity?.senses?.some((sense) => !nonEmpty(sense?.senseId) || !nonEmpty(sense?.glossJa))) entityOk = false;
    if (!Array.isArray(entity?.capabilities) || entity.capabilities.length === 0) entityOk = false;
    if (!Number.isFinite(entity?.observedFrequency) || !Array.isArray(entity?.evidence) || !Array.isArray(entity?.years)) entityOk = false;
    for (const capability of entity?.capabilities ?? []) {
      if (!allowedCapabilities.has(capability)) entityOk = false;
      if (!Array.isArray(entity?.prompts?.[capability]) || entity.prompts[capability]!.length === 0) entityOk = false;
    }
    if (entityOk) mappedCore += 1;
  }
  if (mappedCore !== CORE_ENTITY_COUNT) reasons.push(`Capability Adapter mappingが${mappedCore}/${CORE_ENTITY_COUNT}です。`);
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)], mappedCore, expectedCore: CORE_ENTITY_COUNT };
}

function rowToEntity(row: CompactRow, enrichment: EnrichmentFile["entities"][string]): RuntimeEntity {
  const [stableId, lemma, meaningJa, pos, priority, studyLayer, targetBand, schedules, quizEligible, diagnosticEligible] = row;
  const capabilities: Capability[] = quizEligible ? ["recognition", "spelling"] : ["recognition"];
  return {
    stableId,
    lemma,
    pos: pos ?? "phrase",
    senses: [{ senseId: `${stableId}::main`, glossJa: meaningJa }],
    capabilities,
    prompts: {
      recognition: [{ kind: "english-to-japanese" }],
      ...(quizEligible ? { spelling: [{ kind: "japanese-to-english" }] } : {}),
    },
    priority,
    studyLayer,
    targetBand,
    schedules,
    quizEligible,
    diagnosticEligible,
    observedFrequency: enrichment.observedFrequency,
    years: enrichment.years,
    sourceSchedules: enrichment.sourceSchedules,
    categories: enrichment.categories,
    evidence: enrichment.evidence,
    sourceExample: enrichment.sourceExample,
    generatedExample: enrichment.generatedExample,
    cloze: enrichment.cloze,
  };
}

export async function loadRuntimeBundle(baseUrl: string): Promise<{ bundle: RuntimeBundle | null; gate: GateReport }> {
  try {
    const releaseResponse = await fetchReleaseAsset(baseUrl, "release-manifest.json");
    if (!releaseResponse.ok) throw new Error(`release:${releaseResponse.status}`);
    const release = await releaseResponse.json() as RuntimeBundle["release"];
    const manifestResponse = await fetchReleaseAsset(baseUrl, "data/manifest.json");
    if (!manifestResponse.ok) throw new Error(`manifest:${manifestResponse.status}`);
    const manifest = await manifestResponse.json() as CompactManifest;
    if (!Array.isArray(manifest.chunks) || manifest.chunks.length === 0) throw new Error("chunks");

    const registryResponse = await fetchReleaseAsset(baseUrl, "data/registry.json");
    if (!registryResponse.ok) throw new Error(`registry:${registryResponse.status}`);
    const stableIds = await registryResponse.json() as string[];

    const enrichmentResponse = await fetchReleaseAsset(baseUrl, `data/${manifest.enrichment}`);
    if (!enrichmentResponse.ok) throw new Error(`enrichment:${enrichmentResponse.status}`);
    const enrichment = await enrichmentResponse.json() as EnrichmentFile;
    if (enrichment.format !== "rikkyo-vocab-enrichment/v1" || enrichment.version !== ENRICHMENT_VERSION || enrichment.entityCount !== CORE_ENTITY_COUNT) throw new Error("enrichment-contract");

    const chunkRows = await Promise.all(manifest.chunks.map(async (chunk) => {
      const response = await fetchReleaseAsset(baseUrl, `data/${chunk}`);
      if (!response.ok) throw new Error(`${chunk}:${response.status}`);
      return response.json() as Promise<CompactRow[]>;
    }));

    const bundle: RuntimeBundle = {
      release,
      manifest: {
        appId: manifest.appId,
        dataVersion: manifest.dataVersion,
        registryEntityCount: manifest.registryEntityCount,
        coreEntityCount: manifest.coreEntityCount,
        generatedFromPhase: manifest.generatedFromPhase,
        enrichmentVersion: manifest.enrichmentVersion,
        sourcePapers: manifest.sourcePapers,
      },
      registry: stableIds.map((stableId) => ({ stableId })),
      core: chunkRows.flat().map((row) => {
        const item = enrichment.entities[row[0]];
        if (!item) throw new Error(`enrichment-missing:${row[0]}`);
        return rowToEntity(row, item);
      }),
    };
    const gate = validateRuntimeBundle(bundle);
    return { bundle: gate.ok ? bundle : null, gate };
  } catch (error) {
    console.error("Runtime bundle load failed", error);
    return {
      bundle: null,
      gate: {
        ok: false,
        reasons: ["Core 241教材データを読み込めませんでした。"],
        mappedCore: 0,
        expectedCore: CORE_ENTITY_COUNT,
      },
    };
  }
}
