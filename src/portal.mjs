import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { openWindowsCredentials, openWindowsBrowser } from "./windows-credentials.mjs";
import { signInChatGPT } from "./chatgpt-host.mjs";
import { checkChatGPT, signOutChatGPT } from "./chatgpt-session.mjs";
import { signInOpenRouter, checkOpenRouter } from "./openrouter-host.mjs";
import { createCopilotHost } from "./copilot-host.mjs";
import { join } from "node:path";
import { accountModels, testInference, publicModels, validModel } from "./inference.mjs";

const PROVIDERS = ["chatgpt", "openrouter", "copilot"];
const LOGOS = Object.freeze(Object.fromEntries([["chatgpt", "openai"], ["openrouter", "openrouter"], ["copilot", "copilot"]].map(([id, name]) => [id, "data:image/svg+xml;base64," + readFileSync(new URL(`./logos/${name}.svg`, import.meta.url)).toString("base64")])));
const FAILURE_REASONS = ["sign-in-incomplete", "account-check-failed", "models-failed", "test-failed", "sign-out-failed", "credential-store-locked", "credential-store-unavailable", "browser-unavailable", "sign-in-prepare-failed", "callback-incomplete", "authorization-not-granted", "token-exchange-failed", "identity-verification-failed", "account-mismatch", "sign-in-timeout"];
export async function startPortal({ directory, copilot, perform, openBrowser = openWindowsBrowser }) {
  const token = randomBytes(32).toString("hex");
  const states = Object.fromEntries(PROVIDERS.map((provider) => [provider, "not-checked"]));
  const busy = new Set();
  const models = Object.fromEntries(PROVIDERS.map(provider => [provider, []]));
  const probes = Object.fromEntries(PROVIDERS.map(provider => [provider, null]));
  const reasons = Object.fromEntries(PROVIDERS.map(provider => [provider, null]));
  const native = copilot ? createCopilotHost({ ...copilot, home: join(directory, "copilot") }) : null;
  const run = perform ?? (async (provider, action, model) => {
    if (provider === "copilot") {
      if (!native || action === "disconnect") return { provider, state: "unavailable" };
      if (action === "models") return { models: await native.models() };
      return native[action](model);
    }
    const credentials = await openWindowsCredentials(join(directory, "credentials"), provider);
    try {
      if (action === "models") return { models: await accountModels(provider, credentials) };
      if (action === "probe") return await testInference(provider, credentials, model);
      // Await while this host still owns the protected store and its lock.
      // Returning a pending Promise would run finally and close it early.
      if (action === "connect") return await (provider === "chatgpt" ? signInChatGPT : signInOpenRouter)({ hostId: credentials.hostId, credentials, openBrowser });
      if (action === "check") return await (provider === "chatgpt" ? checkChatGPT : checkOpenRouter)(credentials);
      if (provider === "chatgpt") return await signOutChatGPT(credentials);
      await credentials.remove(); return { provider, state: "revoked", remoteRevocationConfirmed: false };
    } finally { await credentials.close(); }
  });
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.setHeader("cache-control", "no-store"); res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("content-security-policy", "default-src 'self'; img-src data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const reply = (code, data) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return reply(403, { error: "forbidden" });
    const requestedPage = new URL(req.url ?? "/", origin);
    const pageProvider = requestedPage.searchParams.get("provider");
    if (req.method === "GET" && requestedPage.pathname === "/" &&
        (requestedPage.search === "" || (PROVIDERS.includes(pageProvider) && [...requestedPage.searchParams.keys()].length === 1))) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(portalHtml(pageProvider)); return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) return reply(403, { error: "forbidden" });
    if (req.method === "GET" && req.url === "/status") return reply(200, { states, busy: [...busy], models, probes, reasons });
    const match = /^\/(connect|check|disconnect|models|probe)\/(chatgpt|openrouter|copilot)$/.exec(req.url ?? "");
    if (req.method !== "POST" || !match || req.headers.origin !== origin || req.headers["transfer-encoding"]) return reply(400, { error: "invalid-action" });
    const [, action, provider] = match;
    if (busy.has(provider)) return reply(409, { error: "busy" });
    let model;
    if (action === "probe") {
      const length = Number(req.headers["content-length"]);
      if (!Number.isSafeInteger(length) || length <= 0 || length > 512 || req.headers["content-type"] !== "application/json") return reply(400, { error: "invalid-action" });
      try {
        let bytes = 0; let body = ""; req.setTimeout(5000, () => req.destroy());
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 512) throw new Error(); body += chunk.toString("utf8"); }
        req.setTimeout(0); const value = JSON.parse(body); model = value.model;
        if (Object.keys(value).length !== 1 || !validModel(model) || !models[provider].some(item => item.id === model)) throw new Error();
      } catch { return reply(400, { error: "invalid-model" }); }
      if (busy.has(provider)) return reply(409, { error: "busy" });
    } else if (req.headers["content-length"] && req.headers["content-length"] !== "0") return reply(400, { error: "invalid-action" });
    if (["connect", "disconnect", "models"].includes(action)) { models[provider] = []; probes[provider] = null; }
    reasons[provider] = null;
    const failedAction = { connect: "sign-in-incomplete", check: "account-check-failed", models: "models-failed", probe: "test-failed", disconnect: "sign-out-failed" }[action];
    busy.add(provider); states[provider] = action === "connect" ? "awaiting-user" : "checking";
    reply(202, { ok: true });
    try {
      const result = await run(provider, action, model);
      if (action === "models") { models[provider] = publicModels(result?.models, "copilot"); states[provider] = models[provider].length ? "models-available" : "unavailable"; if (!models[provider].length) reasons[provider] = "models-failed"; return; }
      const allowed = ["connected", "limited", "expired", "not-configured", "unavailable", "revoked", "storage-needs-attention", "inference-completed"];
      states[provider] = allowed.includes(result?.state) ? result.state : "unavailable";
      if (states[provider] === "unavailable") reasons[provider] = FAILURE_REASONS.includes(result?.reason) ? result.reason : failedAction;
      if (action === "probe") probes[provider] = result?.state === "inference-completed" ? { completed: true, exactTestPassed: result.exactTestPassed === true } : { completed: false, exactTestPassed: false };
      if (action === "disconnect" && result?.remoteRevocationConfirmed === false) states[provider] = "local-sign-out-only";
    } catch (error) {
      states[provider] = "unavailable";
      const code = error?.message;
      reasons[provider] = code === "credential-store-locked" ? code : ["credential-store-unavailable", "credential-protection-unavailable", "invalid-credential-record", "unsupported-credential-store"].includes(code) ? "credential-store-unavailable" : code === "browser-unavailable" ? code : failedAction;
      if (action === "probe") probes[provider] = { completed: false, exactTestPassed: false };
    }
    finally { busy.delete(provider); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { url: `http://127.0.0.1:${server.address().port}/#${token}`, stop: async () => { native?.stop(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } };
}

export function portalHtml(provider = null) {
  const selected = PROVIDERS.includes(provider) ? provider : null;
  const heading = selected === "chatgpt" ? "ChatGPT sign-in" : selected === "openrouter" ? "OpenRouter sign-in" : selected === "copilot" ? "GitHub Copilot sign-in" : "Provider connections";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AITMI Lab · Connections</title>
<style>body{font:15px system-ui;background:#f7f7f7;color:#171717;margin:0;padding:28px}main{max-width:820px;margin:auto}h1{font-size:28px}section{background:white;border:1px solid #ddd;border-radius:18px;padding:22px;margin:16px 0}button{border:1px solid #ddd;border-radius:10px;padding:11px 16px;margin:5px 8px 5px 0;cursor:pointer}button[data-action=connect]{background:#ceff35}button:disabled{opacity:.5}p{line-height:1.5;color:#555}.state{font-weight:600;color:#171717}.notice{padding:12px;border-radius:12px;background:#eee}button:focus-visible{outline:3px solid #688700}</style>
<style>[hidden]{display:none!important}.account-actions{display:flex;flex-wrap:wrap;gap:8px}.account-actions button{margin:0}.model-tools{display:grid;grid-template-columns:1fr;gap:12px;border-top:1px solid #ddd;margin-top:24px;padding-top:18px}.model-tools h3,.model-tools p{margin:0}.model-tools label{display:grid;gap:8px}.model-tools select{padding:10px;border:1px solid #ccc;border-radius:8px;width:100%;font:inherit}.model-tools button{justify-self:start;margin:0}.account-help{font-size:13px}.notice{line-height:1.6}main>p:last-child{font-size:13px}@media(max-width:650px){body{padding:16px}section{padding:18px}h1{font-size:24px}}</style>
<main><h1>AI.TMI Lab · ${heading}</h1><p class="notice">Sign in to the separate Lab companion. These checks do not activate a Core AI route or send chats, files or memory. Provider consent opens in your system browser; this panel stays open.</p>
${[["chatgpt","ChatGPT","Sign in with an eligible plan, then verify account access before choosing a test model."],["openrouter","OpenRouter","OAuth creates an API key. Usage is billed through OpenRouter and its downstream provider, not your ChatGPT or Claude subscription."],["copilot","GitHub Copilot","Native GitHub login owns your credentials. The inference test disables tools, skills, repository instructions and session sharing."]].filter(([id]) => !selected || id === selected).map(([id,label,detail]) => `<section data-provider="${id}"><h2 class="provider-heading"><img class="provider-logo" src="${LOGOS[id]}" alt="" width="32" height="32">${label}</h2><p>${detail}</p><p class="state" aria-live="polite">Not checked</p><div class="account-actions"><button data-action="connect">${id === "chatgpt" ? "Continue with ChatGPT" : "Sign in with " + label}</button><button data-action="check">Check saved account</button>${id !== "copilot" ? '<button data-action="disconnect" hidden>Sign out locally</button>' : '<p>Manage or revoke Copilot access in GitHub account settings. This panel does not alter other GitHub CLI sessions.</p>'}</div><p class="account-help">Sign in or check an existing saved account to enable model testing.</p><div class="model-tools" hidden><h3>Test your connection</h3><button data-action="models">Load models</button><label>Test model <select aria-label="${label} test model"><option value="">Load models first</option></select></label><button data-action="probe" disabled>Send harmless inference test</button><p>Only “Reply with exactly AITMI_OK and nothing else.” is sent. This uses plan allowance or API credits. No chats, files or memory are included. Model availability is not proof of inference access.</p></div><p class="probe" aria-live="polite"></p></section>`).join("")}
${selected ? "" : '<section><h2>Claude</h2><p>Disabled stub, as requested. No subscription sign-in is performed.</p><button disabled>Not enabled</button></section>'}<p>Local sign-out alone does not prove remote revocation.${!selected || selected === "openrouter" ? " Revoke OpenRouter keys in its dashboard." : ""}${!selected || selected === "chatgpt" ? " For ChatGPT, a “local sign out only” result requires disconnecting Lab in ChatGPT settings." : ""}</p></main>
<style>.provider-heading{display:flex;align-items:center;gap:12px}.provider-logo{display:block;width:32px;height:32px;flex:none}</style>
<script>
const token=location.hash.slice(1);history.replaceState(null,'',location.pathname+location.search);
const api=(path,body)=>fetch(path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,...(body===null?{}:{'content-type':'application/json'})},...(body?{body:JSON.stringify(body)}:{})});
const failureHelp={'sign-in-incomplete':'Sign-in was not completed or could not be verified. Choose Continue with ChatGPT to start a fresh browser sign-in.','account-check-failed':'The saved account could not be checked. Retry the check, or sign in again.','models-failed':'No usable models were returned. Verify account access, then retry loading models.','test-failed':'The inference test did not complete. Check account access and retry.','sign-out-failed':'Local sign-out did not complete. Your saved connection has not been confirmed removed.','credential-store-locked':'Another Lab process is using this saved account. Finish its sign-in or close that Lab window, then retry.','credential-store-unavailable':'Windows could not open the protected account store. Restart AI.TMI under the same Windows account and retry; do not delete credential files.','browser-unavailable':'The system browser could not be opened. Check your Windows default browser and retry.'};
Object.assign(failureHelp,{'sign-in-prepare-failed':'The local sign-in attempt could not be prepared. Restart AI.TMI and retry.','callback-incomplete':'The browser returned an incomplete or expired sign-in response. Start a fresh sign-in.','authorization-not-granted':'ChatGPT returned without authorization. Retry sign-in and complete the consent step in your browser.','token-exchange-failed':'The browser returned, but OpenAI account access could not be obtained. Start a fresh sign-in; if this repeats, check connectivity.','identity-verification-failed':'The returning account could not be securely verified. No new connection was activated. Start a fresh sign-in.','account-mismatch':'The returning account differs from the saved registration. Sign in with the originally connected account.','sign-in-timeout':'No completed browser sign-in was received within five minutes. Start a fresh sign-in.'});
async function refresh(){try{const r=await api('/status');if(!r.ok)throw 0;const v=await r.json();
for(const s of document.querySelectorAll('[data-provider]')){const p=s.dataset.provider;const busy=v.busy.includes(p);const select=s.querySelector('select');const catalog=JSON.stringify(v.models[p]);
if(select.dataset.catalog!==catalog){const previous=select.value;select.replaceChildren(new Option(v.models[p].length?'Choose a model':'Load models first',''));for(const m of v.models[p])select.add(new Option(m.name,m.id));select.value=previous;select.dataset.catalog=catalog;}
const state=v.states[p];const ready=busy?s.dataset.accountReady==='true':['connected','models-available','inference-completed'].includes(state);s.dataset.accountReady=String(ready);
s.querySelector('.state').textContent=state==='not-checked'?'Not signed in or checked yet':state==='awaiting-user'?'Waiting for sign-in in your browser…':state==='unavailable'?'Connection not verified':state.replaceAll('-',' ');select.disabled=busy||!ready;
s.querySelector('.account-help').textContent=state==='unavailable'?(failureHelp[v.reasons?.[p]]||'The last operation did not complete. Retry sign-in or check the saved account.'):state==='limited'?'Signed in, but ChatGPT plan permission was not granted. Sign in again and review the requested permission.':state==='expired'?'Saved account access has expired. Sign in again to renew access.':state==='awaiting-user'?'Complete sign-in in your system browser. This panel updates when verification finishes.':'Sign in or check an existing saved account to enable model testing.';
s.querySelector('.model-tools').hidden=!ready;s.querySelector('.account-help').hidden=ready;
const disconnect=s.querySelector('[data-action="disconnect"]');if(disconnect)disconnect.hidden=!ready&&!['limited','expired','local-sign-out-only'].includes(state);
for(const b of s.querySelectorAll('button'))b.disabled=busy||(['models','probe'].includes(b.dataset.action)&&!ready)||(b.dataset.action==='probe'&&!select.value);
const probe=v.probes[p];s.querySelector('.probe').textContent=probe?(!probe.completed?'Inference did not complete':probe.exactTestPassed?'Completed inference: test reply matched':'Inference completed, but the test reply did not match'):'';
}}catch{for(const s of document.querySelectorAll('[data-provider]')){s.querySelector('.state').textContent='Companion unavailable';for(const b of s.querySelectorAll('button'))b.disabled=true;}}}
for(const s of document.querySelectorAll('[data-provider]'))s.querySelector('select').onchange=()=>refresh();
for(const b of document.querySelectorAll('[data-action]'))b.onclick=async()=>{const s=b.closest('[data-provider]');const p=s.dataset.provider;const action=b.dataset.action;
if(action==='probe'&&!confirm('Send the displayed harmless test to the selected provider/model? This may consume plan allowance or API credits.'))return;
b.disabled=true;try{const r=await api('/'+action+'/'+p,action==='probe'?{model:s.querySelector('select').value}:null);if(!r.ok)s.querySelector('.probe').textContent='Request refused; reload models and try again';}catch{s.querySelector('.probe').textContent='Companion unavailable';}await refresh();};
refresh();setInterval(refresh,1000);
</script></html>`;
}
