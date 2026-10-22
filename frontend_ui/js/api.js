const TOKEN_KEY = "payops_access_token";
const configuredBase = localStorage.getItem("payops_api_base_url") || window.PAYOPS_CONFIG?.API_BASE_URL || "http://localhost:8000";
export const API_BASE_URL = configuredBase.replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const auth = {
  token: () => localStorage.getItem(TOKEN_KEY),
  save: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = auth.token();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, cache: "no-store" });
  } catch {
    throw new ApiError(`Backend unavailable. Check that the PayOps API is running at ${API_BASE_URL}.`);
  }
  if (response.status === 401) {
    auth.clear();
    window.dispatchEvent(new CustomEvent("invoiceai:session-expired"));
    throw new ApiError("Your session has expired. Please sign in again.", 401);
  }
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = typeof payload.detail === "string" ? payload.detail : "";
    } catch { /* Non-JSON error response. */ }
    if (detail.includes("Invoice was saved for manual review. Extraction failed:")) {
      detail = "Invoice saved for manual review, but automatic extraction failed. Refresh the invoice list to open it and enter the details manually.";
    }
    throw new ApiError(detail || `The request could not be completed (${response.status}).`, response.status);
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json") ? response.json() : response;
}

const json = (method, data) => ({ method, body: JSON.stringify(data ?? {}) });
export const api = {
  request,
  login: (email, password) => request("/api/auth/login", json("POST", { email, password })),
  register: (data) => request("/api/auth/register", json("POST", data)),
  me: () => request("/api/auth/me"),
  health: () => request("/api/health"),
  getDashboard: () => request("/api/dashboard/summary"),
  getInvoices: (params = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== "" && value != null));
    return request(`/api/invoices?${query}`);
  },
  getInvoice: (id) => request(`/api/invoices/${encodeURIComponent(id)}`),
  uploadInvoice: (file) => {
    const body = new FormData();
    body.append("file", file);
    return request("/api/invoices/upload", { method: "POST", body });
  },
  getInvoiceFile: (id) => request(`/api/invoices/${encodeURIComponent(id)}/file`),
  editInvoice: (id, data) => request(`/api/invoices/${encodeURIComponent(id)}`, json("PUT", data)),
  approveInvoice: (id, comment = "") => request(`/api/invoices/${encodeURIComponent(id)}/approve`, json("POST", { comment })),
  rejectInvoice: (id, comment) => request(`/api/invoices/${encodeURIComponent(id)}/reject`, json("POST", { comment })),
  requestChanges: (id, comment) => request(`/api/invoices/${encodeURIComponent(id)}/request-changes`, json("POST", { comment })),
  markInvoicePaid: (id, payment) => request(`/api/invoices/${encodeURIComponent(id)}/mark-paid`, json("POST", payment)),
  getApprovals: (status = "ALL") => request(`/api/approvals?status=${encodeURIComponent(status)}`),
  getPayments: () => request("/api/payments"),
  getVendors: () => request("/api/vendors"),
  getVendor: (id) => request(`/api/vendors/${encodeURIComponent(id)}`),
  sendAIMessage: (message, conversation_id) => request("/api/ai/chat", json("POST", { message, conversation_id })),
  getAIHistory: (conversation_id) => request(`/api/ai/history${conversation_id ? `?conversation_id=${encodeURIComponent(conversation_id)}` : ""}`),
  getValidations: () => request("/api/validations"),
  downloadReport: () => request("/api/reports/summary.csv"),
  resetDemo: () => request("/api/settings/reset-demo", json("POST")),
};
