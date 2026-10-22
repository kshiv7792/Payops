import { pageHeading } from "./shared.js";

const integrations = ["Gmail", "Outlook", "WhatsApp", "Bank Account", "Tally", "Zoho Books"];
export function renderIntegrations() {
  return `<div>${pageHeading("CONNECT YOUR WORKFLOW", "Integrations", "Bring invoice sources and finance tools together.")}<section class="integration-grid">${integrations.map((name) => `<article class="card integration-card"><span class="integration-logo">${name.slice(0, 1)}</span><h2>${name}</h2><p>Connect ${name} to streamline your invoice workflow.</p><span class="coming-soon">Coming Soon</span></article>`).join("")}</section></div>`;
}
