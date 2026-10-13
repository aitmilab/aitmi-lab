export type UiCapability = "protected-input" | "selected-artifact" | "operational-events";
export interface UiManifest { readonly version: 1; readonly id: string; readonly name: string; readonly entry: "index.mjs"; readonly capabilities: readonly UiCapability[] }
export type UiContribution =
  | { readonly type: "panel"; readonly id: string; readonly title: string; readonly text: string }
  | { readonly type: "command"; readonly id: string; readonly label: string; readonly action: "check-compose" | "protect-copy"; readonly capabilities: readonly ["protected-input"] }
  | { readonly type: "status"; readonly id: string; readonly state: "idle" | "busy" | "ready" | "unavailable" }
  | { readonly type: "artifact"; readonly id: string; readonly title: string; readonly format: "text"; readonly content: string }
  | { readonly type: "artifact"; readonly id: string; readonly title: string; readonly format: "table"; readonly content: readonly (readonly string[])[] }
  | { readonly type: "terminal-output"; readonly id: string; readonly phase: "started" | "completed" | "refused" | "unavailable"; readonly count: number | null };
export interface UiPackage { readonly schema: "aitmi-lab-ui/v1"; readonly manifest: UiManifest; readonly contributions: readonly UiContribution[] }
export function parseUiPackage(value: unknown): UiPackage | null;
export function createUi(value: unknown): {
  panel(value: unknown): UiContribution; command(value: unknown): UiContribution; status(value: unknown): UiContribution;
  artifact(value: unknown): UiContribution; terminalOutput(value: unknown): UiContribution; package(): UiPackage;
};
