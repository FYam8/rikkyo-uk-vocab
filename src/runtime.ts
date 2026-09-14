import { APP_ID, CORE_ENTITY_COUNT, REGISTRY_ENTITY_COUNT } from "./config";

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
}

export interface RuntimeBundle {
  manifest: {
    appId: string;
    dataVersion: string;
    registryEntityCount: number;
    coreEntityCount: number;
    generatedFromPhase: 17;
  };
  registry: Array<{ stableId: string }>;
  core: RuntimeEntity[];
}

interface CompactManifest extends RuntimeBundle["manifest"] {
  registryVersion?: string;
  chunks: string[];
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
  if (manifest?.appId !== APP_ID) reasons.push("manifest.appIdが立教専用appIdと一致しません。");
  if (!nonEmpty(manifest?.dataVersion)) reasons.push("manifest.dataVersionがありません。");
  if (manifest?.registryEntityCount !== REGISTRY_ENTITY_COUNT) reasons.push(`Registryは${REGISTRY_ENTITY_COUNT}件である必要があります。`);
  if (manifest?.coreEntityCount !== CORE_ENTITY_COUNT) reasons.push(`Coreは${CORE_ENTITY_COUNT}件である必要があります。`);
  if (manifest?.generatedFromPhase !== 17) reasons.push("Phase 17由来であることを確認できません。");

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
    for (const capability of entity?.capabilities ?? []) {
      if (!allowedCapabilities.has(capability)) entityOk = false;
      if (!Array.isArray(entity?.prompts?.[capability]) || entity.prompts[capability]!.length === 0) entityOk = false;
    }
    if (entityOk) mappedCore += 1;
  }
  if (mappedCore !== CORE_ENTITY_COUNT) reasons.push(`Capability Adapter mappingが${mappedCore}/${CORE_ENTITY_COUNT}です。`);
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)], mappedCore, expectedCore: CORE_ENTITY_COUNT };
}

function rowToEntity(row: CompactRow): RuntimeEntity {
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
  };
}

export async function loadRuntimeBundle(baseUrl: string): Promise<{ bundle: RuntimeBundle | null; gate: GateReport }> {
  try {
    const manifestResponse = await fetch(`${baseUrl}data/manifest.json`, { cache: "no-store" });
    if (!manifestResponse.ok) throw new Error(`manifest:${manifestResponse.status}`);
    const manifest = await manifestResponse.json() as CompactManifest;
    if (!Array.isArray(manifest.chunks) || manifest.chunks.length === 0) throw new Error("chunks");

    const registryResponse = await fetch(`${baseUrl}data/registry.json`, { cache: "no-store" });
    if (!registryResponse.ok) throw new Error(`registry:${registryResponse.status}`);
    const stableIds = await registryResponse.json() as string[];

    const chunkRows = await Promise.all(manifest.chunks.map(async (chunk) => {
      const response = await fetch(`${baseUrl}data/${chunk}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${chunk}:${response.status}`);
      return response.json() as Promise<CompactRow[]>;
    }));

    const bundle: RuntimeBundle = {
      manifest: {
        appId: manifest.appId,
        dataVersion: manifest.dataVersion,
        registryEntityCount: manifest.registryEntityCount,
        coreEntityCount: manifest.coreEntityCount,
        generatedFromPhase: manifest.generatedFromPhase,
      },
      registry: stableIds.map((stableId) => ({ stableId })),
      core: chunkRows.flat().map(rowToEntity),
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
