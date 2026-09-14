import { APP_ID, CORE_ENTITY_COUNT, REGISTRY_ENTITY_COUNT } from "./config";

export type Capability = "recognition" | "meaning" | "spelling" | "context";

export interface RuntimeEntity {
  stableId: string;
  lemma: string;
  pos: string;
  senses: Array<{ senseId: string; glossJa: string }>;
  capabilities: Capability[];
  prompts: Partial<Record<Capability, unknown[]>>;
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

export async function loadRuntimeBundle(baseUrl: string): Promise<{ bundle: RuntimeBundle | null; gate: GateReport }> {
  try {
    const response = await fetch(`${baseUrl}data/runtime-bundle.json`, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const bundle = await response.json() as RuntimeBundle;
    const gate = validateRuntimeBundle(bundle);
    return { bundle: gate.ok ? bundle : null, gate };
  } catch {
    return {
      bundle: null,
      gate: {
        ok: false,
        reasons: ["Phase 17のmanifest / 623 stable-ID Registry / Core 241 app-dataが未接続です。"],
        mappedCore: 0,
        expectedCore: CORE_ENTITY_COUNT,
      },
    };
  }
}
