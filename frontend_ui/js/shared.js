export const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

export const money = (value = 0, currency = "INR") => new Intl.NumberFormat("en-IN", {
  style: "currency", currency, maximumFractionDigits: 0,
}).format(Number(value) || 0);

export const date = (value) => value
  ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
  : "—";

export const statusBadge = (value = "UNKNOWN") => {
  const normalized = String(value).toUpperCase();
  const label = normalized.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  const tone = normalized.includes("PAID") ? "green" : normalized.includes("OVERDUE") || normalized.includes("REJECT") || normalized.includes("CRITICAL") ? "red" : normalized.includes("APPROVED") ? "blue" : normalized.includes("DUPLICATE") ? "violet" : "amber";
  return `<span class="badge badge-${tone}">${escapeHtml(label)}</span>`;
};

export const icon = (name, size = 18) => {
  const paths = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    invoices: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
    vendors: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    approvals: '<path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="10"/>',
    payments: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M7 15h3"/>',
    assistant: '<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.64 5.64l2.12 2.12m8.48 8.48 2.12 2.12m0-12.72-2.12 2.12m-8.48 8.48-2.12 2.12"/><circle cx="12" cy="12" r="4"/>',
    reports: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-5 5"/>',
    integrations: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.8 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.8-1l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.8-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.8 1l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
    arrow: '<path d="M5 12h14m-7-7 7 7-7 7"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="m18 6-12 12M6 6l12 12"/>',
    sparkle: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Zm7 12 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/>',
  };
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.invoices}</svg>`;
};

export const emptyState = (title, copy) => `<div class="empty-state">${icon("invoices", 26)}<strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy)}</p></div>`;
export const errorState = (copy) => `<div class="inline-error">${escapeHtml(copy)}</div>`;
export const button = (label, action, variant = "secondary", attrs = "") => `<button class="button button-${variant}" data-action="${escapeHtml(action)}" ${attrs}>${label}</button>`;
export const pageHeading = (eyebrow, title, subtitle, actions = "") => `<header class="page-heading"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><div class="heading-actions">${actions}</div></header>`;
export const metric = (label, value, caption, iconName, tone = "blue") => `<article class="card metric-card"><div class="metric-top"><span class="metric-icon ${tone}">${icon(iconName)}</span></div><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong><small class="metric-caption">${escapeHtml(caption)}</small></article>`;
