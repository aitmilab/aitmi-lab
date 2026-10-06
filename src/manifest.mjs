const CAPABILITIES = new Set(["protected-input", "selected-artifact", "operational-events"]);
/** Manifest validation grants no authority. Host consent is required per call. */
export function validateManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (Object.keys(value).sort().join(",") !== "capabilities,entry,id,name,version") return false;
  return value.version === 1 && /^[a-z][a-z0-9-]{1,63}$/.test(value.name ?? "") && value.id === `aitmi-lab.${value.name}` &&
    value.entry === "index.mjs" && Array.isArray(value.capabilities) && new Set(value.capabilities).size === value.capabilities.length && value.capabilities.every((capability) => CAPABILITIES.has(capability));
}
