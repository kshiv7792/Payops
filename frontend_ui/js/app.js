import { api, auth } from "./api.js";
import { renderLanding, renderLogin } from "./auth.js";
import { renderDashboard } from "./dashboard.js";
import { renderInvoices } from "./invoices.js";
import { renderInvoiceDetail } from "./invoice-detail.js";
import { renderApprovals } from "./approvals.js";
import { renderPayments } from "./payments.js";
import { renderVendors } from "./vendors.js";
import { renderAssistant } from "./ai-assistant.js";
import { renderReports } from "./reports.js";
import { renderIntegrations } from "./integrations.js";
import { renderSettings } from "./settings.js";
import { escapeHtml, icon } from "./shared.js";

const app = document.querySelector("#app");
const state = {
  user: null, section: "Dashboard", invoiceId: null, invoiceTab: "Extracted Data",
  approvalsFilter: "PENDING", paymentsFilter: "All", invoicePage: 1, invoiceSearch: "",
  invoiceStatus: "", invoiceSort: "created_at", authMode: "login", authError: "",
  authBusy: false, chatMessages: [], chatError: "", chatBusy: false, conversationId: null,
  mobileOpen: false, vendor: null, detailFileUrl: null,
};
const nav = [
  ["Dashboard", "dashboard"], ["Invoices", "invoices"], ["Vendors", "vendors"],
  ["Approvals", "approvals"], ["Payments", "payments"], ["AI Assistant", "assistant"],
  ["Reports", "reports"], ["Integrations", "integrations"], ["Settings", "settings"],
];

function toast(message, tone = "success") {
  const host = document.querySelector("#toast-region");
  host.innerHTML = `<div class="toast toast-${tone}">${escapeHtml(message)}</div>`;
  window.setTimeout(() => { host.innerHTML = ""; }, 3600);
}

function showLogin() {
  if (state.detailFileUrl) URL.revokeObjectURL(state.detailFileUrl);
  state.detailFileUrl = null;
  state.user = null;
  state.section = "Dashboard";
  app.innerHTML = renderLogin(state.authError, state.authBusy, state.authMode);
}

function showLanding() {
  state.user = null;
  state.authError = "";
  app.innerHTML = renderLanding();
}

function renderShell(body) {
  const current = state.invoiceId ? "Invoices" : state.section;
  app.innerHTML = `<div class="app-frame">
    <aside class="sidebar ${state.mobileOpen ? "sidebar-open" : ""}" aria-label="Main navigation">
      <a class="brand-lockup" href="#" data-section="Dashboard"><span class="brand-mark">${icon("invoices")}</span><span>Pay<span class="brand-ai">Ops</span></span></a>
      <div class="workspace-switch"><span class="workspace-avatar">${escapeHtml((state.user.company || "W").slice(0, 1))}</span><span><strong>${escapeHtml(state.user.company || "Workspace")}</strong><small>${escapeHtml(state.user.role)}</small></span></div>
      <p class="nav-caption">WORKSPACE</p><nav>${nav.slice(0, 7).map(([label, iconName]) => `<button class="nav-item ${current === label ? "nav-active" : ""}" data-section="${label}">${icon(iconName, 17)}<span>${label}</span>${label === "Approvals" && state.pendingCount ? `<i class="nav-count">${state.pendingCount}</i>` : ""}</button>`).join("")}</nav>
      <p class="nav-caption nav-caption-lower">PREFERENCES</p><nav>${nav.slice(7).map(([label, iconName]) => `<button class="nav-item ${current === label ? "nav-active" : ""}" data-section="${label}">${icon(iconName, 17)}<span>${label}</span></button>`).join("")}</nav>
      <div class="sidebar-bottom"><div class="help-card"><span>✦</span><div><strong>Need a hand?</strong><small>Your invoice workflow, simplified.</small></div></div><div class="user-card"><span class="user-avatar">${escapeHtml(state.user.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase())}</span><span class="user-copy"><strong>${escapeHtml(state.user.name)}</strong><small>${escapeHtml(state.user.role)}</small></span><button class="icon-button" data-action="logout" title="Log out">${icon("close", 16)}</button></div></div>
    </aside>
    ${state.mobileOpen ? `<button class="mobile-scrim" data-action="close-menu" aria-label="Close navigation"></button>` : ""}
    <section class="main-content"><header class="topbar"><div class="breadcrumbs"><button class="mobile-menu icon-button" data-action="toggle-menu" aria-label="Toggle menu">${icon("menu")}</button><span>Workspace</span><b>/</b><strong>${state.invoiceId ? "Invoice detail" : current}</strong></div><div class="top-actions"><span class="demo-badge"><i></i> Live workspace</span><button class="top-avatar" data-action="logout" title="Log out">${escapeHtml(state.user.name[0].toUpperCase())}</button></div></header><div class="page-content">${body}</div></section></div>`;
}

async function loadSection(section = state.section) {
  state.section = section;
  state.invoiceId = null;
  if (state.detailFileUrl) URL.revokeObjectURL(state.detailFileUrl);
  state.detailFileUrl = null;
  state.mobileOpen = false;
  renderShell(`<div class="loading-panel"><i class="loading-spinner"></i> Loading ${escapeHtml(section.toLowerCase())}…</div>`);
  try {
    let view;
    if (section === "Dashboard") {
      const data = await api.getDashboard();
      state.pendingCount = data.summary.pending_approval_count;
      view = renderDashboard(data, state.user);
    } else if (section === "Invoices") {
      const data = await api.getInvoices({ search: state.invoiceSearch, status: state.invoiceStatus, page: state.invoicePage, page_size: 25, sort_by: state.invoiceSort, order: "desc" });
      view = renderInvoices(data, { search: state.invoiceSearch, status: state.invoiceStatus, sort: state.invoiceSort });
    } else if (section === "Approvals") {
      const data = await api.getApprovals(state.approvalsFilter);
      view = renderApprovals(data, state.approvalsFilter, state.user.role);
    } else if (section === "Payments") {
      view = renderPayments(await api.getPayments(), state.paymentsFilter, state.user.role);
    } else if (section === "Vendors") {
      const data = await api.getVendors();
      view = renderVendors(data, state.vendor);
    } else if (section === "AI Assistant") {
      if (!state.chatMessages.length) {
        const history = await api.getAIHistory();
        const historyItems = history.items || [];
        if (historyItems.length) {
          state.conversationId = historyItems.at(-1).conversation_id;
          state.chatMessages = historyItems.filter((message) => message.conversation_id === state.conversationId);
        }
      }
      view = renderAssistant(state.chatMessages, state.chatBusy, state.chatError);
    } else if (section === "Reports") {
      const [dashboard, payments, validations, vendors] = await Promise.all([api.getDashboard(), api.getPayments(), api.getValidations(), api.getVendors()]);
      view = renderReports(dashboard, payments, validations, vendors);
    } else if (section === "Integrations") view = renderIntegrations();
    else view = renderSettings(state.user);
    renderShell(view);
  } catch (error) {
    if (!state.user) return;
    renderShell(`<section class="card page-error"><h2>Could not load ${escapeHtml(section.toLowerCase())}</h2><p>${escapeHtml(error.message)}</p><button class="button button-secondary" data-action="retry-section">Try again</button></section>`);
  }
}

async function openInvoice(id, tab = "Extracted Data") {
  state.invoiceId = id;
  state.invoiceTab = tab;
  if (state.detailFileUrl) URL.revokeObjectURL(state.detailFileUrl);
  state.detailFileUrl = null;
  state.detailFileError = "";
  renderShell(`<div class="loading-panel"><i class="loading-spinner"></i> Loading invoice…</div>`);
  try {
    const invoice = await api.getInvoice(id);
    if (invoice.file_url) {
      try {
        const response = await api.getInvoiceFile(id);
        state.detailFileUrl = URL.createObjectURL(await response.blob());
      } catch (error) {
        if (error.status === 401) throw error;
        state.detailFileError = error.message;
      }
    }
    if (!state.user) return;
    renderShell(renderInvoiceDetail(invoice, state.invoiceTab, state.detailFileUrl || "", state.user.role, state.detailFileError));
  } catch (error) {
    if (!state.user) return;
    renderShell(`<section class="card page-error"><h2>Could not load invoice</h2><p>${escapeHtml(error.message)}</p>${button("Back to invoices", "navigate-invoices")}</section>`);
  }
}

function button(label, action) {
  return `<button class="button button-secondary" data-action="${action}">${label}</button>`;
}

function openModal(content, title = "PayOps") {
  let modal = document.querySelector("#action-modal");
  if (!modal) {
    document.body.insertAdjacentHTML("beforeend", `<dialog id="action-modal" class="action-modal"><div class="modal-content"></div></dialog>`);
    modal = document.querySelector("#action-modal");
  }
  modal.querySelector(".modal-content").innerHTML = `<div class="modal-heading"><h2>${escapeHtml(title)}</h2><button type="button" class="icon-button" data-action="close-modal" aria-label="Close">${icon("close")}</button></div>${content}`;
  modal.showModal();
}

function uploadModal() {
  openModal(`<form id="upload-form"><label class="upload-drop">${icon("upload", 26)}<strong>Select an invoice document</strong><span>PDF, PNG, JPG or JPEG · Maximum file size follows backend configuration</span><input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" required></label><ol class="processing-steps"><li>Uploading…</li><li>Reading invoice…</li><li>Extracting information…</li><li>Validating…</li><li>Checking duplicates…</li></ol><p class="upload-status muted-copy">The real document will be sent to the PayOps backend.</p><button class="button button-primary" type="submit">Upload and process</button></form>`, "Upload invoice");
}

async function performAction(action, id = state.invoiceId) {
  if (!id) return;
  const promptText = action === "approve" ? "Approve this invoice?" : action === "reject" ? "Enter a rejection reason:" : action === "changes" ? "Describe the changes needed:" : action === "pay" ? "Payment amount (leave blank to pay the remaining balance):" : "";
  if (action === "approve") {
    if (!window.confirm(promptText)) return;
    await api.approveInvoice(id, "");
  } else if (action === "reject" || action === "changes") {
    if (!window.confirm(action === "reject" ? "Reject this invoice?" : "Request changes to this invoice?")) return;
    const comment = window.prompt(promptText);
    if (!comment?.trim()) return;
    if (action === "reject") await api.rejectInvoice(id, comment.trim());
    else await api.requestChanges(id, comment.trim());
  } else if (action === "pay") {
    const raw = window.prompt(promptText, "");
    if (raw === null) return;
    const today = new Date();
    const payment = { payment_method: "Bank transfer", payment_date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}` };
    if (raw.trim()) {
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid payment amount.");
      payment.amount = amount;
    }
    await api.markInvoicePaid(id, payment);
  }
  toast(action === "pay" ? "Payment recorded." : action === "changes" ? "Change request sent." : `Invoice ${action === "approve" ? "approved" : "rejected"}.`);
  if (state.invoiceId) await openInvoice(id, state.invoiceTab);
  else await loadSection();
}

async function submitChat(message) {
  const question = message.trim();
  if (!question || state.chatBusy) return;
  state.chatMessages.push({ role: "user", content: question });
  state.chatBusy = true;
  state.chatError = "";
  await loadSection("AI Assistant");
  try {
    const answer = await api.sendAIMessage(question, state.conversationId);
    state.conversationId = answer.conversation_id;
    state.chatMessages.push({ role: "assistant", content: answer.answer, sources: answer.sources || [] });
  } catch (error) {
    state.chatError = error.message;
  } finally {
    state.chatBusy = false;
    if (state.user) await loadSection("AI Assistant");
  }
}

async function handleClick(event) {
  const target = event.target.closest("[data-action], [data-section], [data-invoice], [data-detail-tab], [data-invoice-filter], [data-approval-filter], [data-payment-filter], [data-prompt]");
  if (!target) return;
  if (target.dataset.section) {
    if (target.dataset.section === "Vendors") state.vendor = null;
    return loadSection(target.dataset.section);
  }
  if (target.dataset.invoice) return openInvoice(target.dataset.invoice);
  if (target.dataset.detailTab) return openInvoice(state.invoiceId, target.dataset.detailTab);
  if (target.dataset.invoiceFilter !== undefined) {
    state.invoiceStatus = target.dataset.invoiceFilter;
    state.invoicePage = 1;
    return loadSection("Invoices");
  }
  if (target.dataset.invoiceFilter !== undefined) {
    state.invoiceStatus = target.dataset.invoiceFilter;
    state.invoicePage = 1;
    return loadSection("Invoices");
  }
  if (target.dataset.approvalFilter) {
    state.approvalsFilter = target.dataset.approvalFilter;
    return loadSection("Approvals");
  }
  if (target.dataset.paymentFilter) {
    state.paymentsFilter = target.dataset.paymentFilter;
    return loadSection("Payments");
  }
  if (target.dataset.prompt) return submitChat(target.dataset.prompt);
  const [action, id] = (target.dataset.action || "").split(":");
  try {
    if (action === "logout") { auth.clear(); state.chatMessages = []; return showLanding(); }
    if (action === "open-login") { state.authMode = "login"; return showLogin(); }
    if (action === "open-signup") { state.authMode = "register"; return showLogin(); }
    if (action === "back-to-landing") return showLanding();
    if (action === "toggle-auth") { state.authMode = state.authMode === "login" ? "register" : "login"; state.authError = ""; return showLogin(); }
    if (action === "open-upload") return uploadModal();
    if (action === "close-modal") return document.querySelector("#action-modal")?.close();
    if (action === "toggle-menu" || action === "close-menu") {
      state.mobileOpen = action === "toggle-menu" ? !state.mobileOpen : false;
      const content = document.querySelector(".page-content")?.innerHTML || "";
      return renderShell(content);
    }
    if (action === "retry-section") return loadSection(state.section);
    if (action === "navigate-invoices") return loadSection("Invoices");
    if (action === "invoice-prev") { state.invoicePage = Math.max(1, state.invoicePage - 1); return loadSection("Invoices"); }
    if (action === "invoice-next") { state.invoicePage += 1; return loadSection("Invoices"); }
    if (action === "approve-invoice") return await performAction("approve");
    if (action === "reject-invoice") return await performAction("reject");
    if (action === "request-changes") return await performAction("changes");
    if (action === "mark-paid") return await performAction("pay");
    if (action.startsWith("approve") || action.startsWith("reject") || action.startsWith("changes") || action.startsWith("pay")) return await performAction(action, id);
    if (action === "reminder-coming") return toast("Reminders are Coming Soon; the backend has no reminder route.", "info");
    if (action === "vendors-back") { state.vendor = null; return loadSection("Vendors"); }
    if (action === "export-report") {
      const response = await api.downloadReport();
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = blobUrl; link.download = "invoice-summary.csv"; link.click(); URL.revokeObjectURL(blobUrl);
      return toast("Invoice report downloaded.");
    }
    if (action === "reset-demo") {
      if (!window.confirm("Reset the seeded demo workspace? This replaces its current demo records.")) return;
      const result = await api.resetDemo();
      auth.save(result.access_token);
      state.user = { ...result.user, company: result.company.name };
      state.chatMessages = [];
      toast(result.message);
      return loadSection("Dashboard");
    }
    if (action.startsWith("vendor")) {
      const vendorId = action.split(":")[1] || id;
      state.vendor = await api.getVendor(vendorId);
      return loadSection("Vendors");
    }
  } catch (error) { toast(error.message, "error"); }
}

document.addEventListener("click", handleClick);
document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (form.id === "auth-form") {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    state.authBusy = true; state.authError = ""; showLogin();
    try {
      const result = form.dataset.mode === "register" ? await api.register(data) : await api.login(data.email, data.password);
      auth.save(result.access_token);
      state.user = { ...result.user, company: result.company.name };
      state.authMode = "login";
      await loadSection("Dashboard");
    } catch (error) { state.authBusy = false; state.authError = error.message; showLogin(); }
  }
  if (form.id === "upload-form") {
    event.preventDefault();
    const file = new FormData(form).get("file");
    const submit = form.querySelector('[type="submit"]');
    const status = form.querySelector(".upload-status");
    const steps = [...form.querySelectorAll(".processing-steps li")];
    if (!(file instanceof File) || !file.size) { status.textContent = "Choose a PDF, PNG or JPG invoice."; return; }
    submit.disabled = true;
    status.textContent = "Uploading your original invoice securely…";
    let currentStep = 0;
    const timer = window.setInterval(() => {
      currentStep = Math.min(currentStep + 1, steps.length - 1);
      steps.forEach((step, index) => step.classList.toggle("step-active", index === currentStep));
      status.textContent = steps[currentStep].textContent;
    }, 900);
    try {
      const invoice = await api.uploadInvoice(file);
      window.clearInterval(timer);
      document.querySelector("#action-modal")?.close();
      toast(`Invoice ${invoice.invoice_number} uploaded and processed.`);
      await openInvoice(invoice.id);
    } catch (error) {
      window.clearInterval(timer);
      status.textContent = error.message;
      status.classList.add("upload-error");
      submit.disabled = false;
    }
  }
  if (form.id === "chat-form") {
    event.preventDefault();
    const input = form.elements.message;
    const value = input.value;
    input.value = "";
    await submitChat(value);
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "invoice-status") { state.invoiceStatus = event.target.value; state.invoicePage = 1; loadSection("Invoices"); }
  if (event.target.id === "invoice-sort") { state.invoiceSort = event.target.value; loadSection("Invoices"); }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "invoice-search") {
    state.invoiceSearch = event.target.value;
    state.invoicePage = 1;
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => loadSection("Invoices"), 300);
  }
  if (event.target.id === "vendor-search") {
    const query = event.target.value.toLowerCase();
    document.querySelectorAll(".vendor-card").forEach((card) => { card.hidden = !card.textContent.toLowerCase().includes(query); });
  }
});

window.addEventListener("invoiceai:session-expired", () => {
  document.querySelector("#action-modal")?.close();
  showLogin();
  toast("Your session expired. Please sign in again.", "error");
});

async function start() {
  if (!auth.token()) return showLanding();
  try {
    state.user = await api.me();
    await loadSection("Dashboard");
  } catch (error) {
    if (error.status !== 401) { auth.clear(); state.authError = error.message; }
    showLogin();
  }
}
start();
