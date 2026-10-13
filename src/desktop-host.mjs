import { startPortal } from "./portal.mjs";
import { createDesktopBrowser } from "./desktop-browser.mjs";
const browser = createDesktopBrowser();
const portal = await startPortal({ directory: process.env.AITMI_LAB_ROOT,
  openBrowser: browser.open,
  copilot: { executable: process.env.AITMI_COPILOT_EXE, sdkEntry: process.env.AITMI_COPILOT_SDK } });
process.stdout.write(JSON.stringify({ kind: "lab-ready", url: portal.url }) + "\n");
process.on("message", async (value) => { if (value?.kind === "stop") { browser.close(); await portal.stop(); process.exit(0); } });
process.on("disconnect", () => { browser.close(); process.exit(0); });
