"use client";

import {
  Activity, AlertCircle, ArrowLeft, ArrowRight, ArrowUpRight, BadgeIndianRupee,
  Bell, Bot, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp,
  Clock3, Download, FileCheck2, FileClock, FileText, Filter, HandCoins,
  Home, LayoutGrid, LifeBuoy, LoaderCircle, LogOut, Menu, MoreHorizontal,
  MessageCircle, Paperclip, PlayCircle, Plus, Search, Send, Settings, ShieldAlert, Sparkles, Upload, Users, Wallet, X,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { api, clearToken, downloadCsv, getToken, saveToken } from "@/lib/api";
import { Button, Card, EmptyState, LoadingPanel, StatusPill } from "@/components/ui";
import type { Dashboard, Invoice, User, Vendor } from "@/types";

type Section = "Dashboard" | "Invoices" | "Vendors" | "Approvals" | "Payments" | "AI Assistant" | "Reports" | "Integrations" | "Settings";
type LoginResponse = { access_token: string; user: User; company: { name: string } };
type InvoicePage = { items: Invoice[]; total: number; page: number; page_size: number };
type ChatLine = { role: "user" | "assistant"; content: string; sources?: { type: string; id?: string; label: string }[] };
type PaymentData = { items: (Invoice & { balance: number; is_overdue: boolean })[]; summary: { total_payable: number; due_this_week: number; overdue: number; paid: number } };

const navigation: { label: Section; icon: typeof Home; group: string }[] = [
  { label: "Dashboard", icon: Home, group: "Workspace" },
  { label: "Invoices", icon: FileText, group: "Workspace" },
  { label: "Vendors", icon: Users, group: "Workspace" },
  { label: "Approvals", icon: FileCheck2, group: "Workspace" },
  { label: "Payments", icon: Wallet, group: "Workspace" },
  { label: "AI Assistant", icon: Bot, group: "Workspace" },
  { label: "Reports", icon: Activity, group: "Manage" },
  { label: "Integrations", icon: LayoutGrid, group: "Manage" },
  { label: "Settings", icon: Settings, group: "Manage" },
];

const inr = (value: number) => `₹${Math.round(value || 0).toLocaleString("en-IN")}`;
const shortDate = (value?: string | null) => value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const monthKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
const statusLabel = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [showLanding, setShowLanding] = useState(true);
  const [signupOnEntry, setSignupOnEntry] = useState(false);
  const [section, setSection] = useState<Section>("Dashboard");
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [notice, setNotice] = useState("");
  const [pageError, setPageError] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [invoiceData, setInvoiceData] = useState<InvoicePage | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [payments, setPayments] = useState<PaymentData | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [invoicePage, setInvoicePage] = useState(1);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatLines, setChatLines] = useState<ChatLine[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  const loadPageData = useCallback(async () => {
    if (!user) return;
    setPageError("");
    try {
      if (section === "Dashboard") setDashboard(await api<Dashboard>("/api/dashboard/summary"));
      if (section === "Invoices") {
        const params = new URLSearchParams();
        if (query.trim()) params.set("search", query.trim());
        if (statusFilter !== "ALL") params.set("status", statusFilter);
        params.set("page", String(invoicePage));
        setInvoiceData(await api<InvoicePage>(`/api/invoices?${params.toString()}`));
      }
      if (section === "Vendors") setVendors((await api<{ items: Vendor[] }>("/api/vendors")).items);
      if (section === "Approvals") setInvoiceData(await api<InvoicePage>("/api/approvals"));
      if (section === "Payments") setPayments(await api<PaymentData>("/api/payments"));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not load this page.");
    }
  }, [user, section, query, statusFilter, invoicePage]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoadingAuth(false);
      return;
    }
    api<User>("/api/auth/me").then(setUser).catch(() => clearToken()).finally(() => setLoadingAuth(false));
  }, []);

  useEffect(() => {
    if (user) void loadPageData();
  }, [user, loadPageData]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function signIn(email: string, password: string) {
    setLoginBusy(true);
    setLoginError("");
    try {
      const result = await api<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      saveToken(result.access_token);
      setUser({ ...result.user, company: result.company.name });
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setLoginBusy(false);
    }
  }

  function logout() {
    clearToken();
    setUser(null);
    setShowLanding(true);
    setSignupOnEntry(false);
    setDashboard(null);
    setSelectedInvoice(null);
  }

  async function uploadFile(file?: File) {
    if (!file) return;
    setUploading(true);
    setPageError("");
    setNotice("AI is reading your invoice…");
    try {
      const body = new FormData();
      body.append("file", file);
      const invoice = await api<Invoice>("/api/invoices/upload", { method: "POST", body });
      setSelectedInvoice(invoice);
      setNotice(invoice.extraction_mode === "DEMO_FALLBACK"
        ? "Invoice processed in clearly labeled fallback mode."
        : "Invoice extracted and validated.");
      setSection("Invoices");
      await loadPageData();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Invoice upload failed.");
      setNotice("");
    } finally {
      setUploading(false);
    }
  }

  async function openInvoice(invoice: Invoice) {
    try {
      setPageError("");
      const detail = await api<Invoice>(`/api/invoices/${invoice.id}`);
      setSelectedInvoice(detail);
      setSection("Invoices");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not open this invoice.");
    }
  }

  function openVendorInvoices(name: string) {
    setQuery(name);
    setStatusFilter("ALL");
    setInvoicePage(1);
    setSelectedInvoice(null);
    setSection("Invoices");
  }

  async function decision(invoice: Invoice, action: "approve" | "reject") {
    if (action === "approve" && !window.confirm(`Approve ${invoice.invoice_number} for ${inr(invoice.total_amount)}?`)) return;
    const comment = action === "reject" ? window.prompt("Please provide a reason for rejecting this invoice:") : undefined;
    if (action === "reject" && !comment?.trim()) return;
    setBusyAction(true);
    try {
      const updated = await api<Invoice>(`/api/invoices/${invoice.id}/${action}`, {
        method: "POST", body: JSON.stringify({ comment }),
      });
      setSelectedInvoice(updated);
      setNotice(action === "approve" ? "Invoice approved." : "Invoice rejected.");
      await loadPageData();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not update this invoice.");
    } finally {
      setBusyAction(false);
    }
  }

  async function requestChanges(invoice: Invoice) {
    const comment = window.prompt("Describe the changes needed before this invoice can be reviewed:");
    if (!comment?.trim()) return;
    setBusyAction(true);
    try {
      await api<Invoice>(`/api/invoices/${invoice.id}/request-changes`, {
        method: "POST", body: JSON.stringify({ comment }),
      });
      setNotice("Invoice returned for changes.");
      await loadPageData();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not request invoice changes.");
    } finally {
      setBusyAction(false);
    }
  }

  async function markPaid(invoice: Invoice) {
    if (!window.confirm(`Record full payment of ${inr(invoice.total_amount)} for ${invoice.invoice_number}?`)) return;
    setBusyAction(true);
    try {
      const updated = await api<Invoice>(`/api/invoices/${invoice.id}/mark-paid`, { method: "POST", body: JSON.stringify({ payment_method: "Bank transfer" }) });
      setSelectedInvoice(updated);
      setNotice("Payment recorded.");
      await loadPageData();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not record payment.");
    } finally {
      setBusyAction(false);
    }
  }

  async function sendChat(message = chatInput) {
    if (!message.trim() || chatBusy) return;
    setChatLines((lines) => [...lines, { role: "user", content: message }]);
    setChatInput("");
    setChatBusy(true);
    try {
      const result = await api<{ answer: string; conversation_id: string; sources: ChatLine["sources"] }>("/api/ai/chat", {
        method: "POST", body: JSON.stringify({ message, conversation_id: conversationId }),
      });
      setConversationId(result.conversation_id);
      setChatLines((lines) => [...lines, { role: "assistant", content: result.answer, sources: result.sources }]);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "The assistant could not answer this question.");
    } finally {
      setChatBusy(false);
    }
  }

  async function resetDemo() {
    if (!window.confirm("Reset all demo invoices, vendors, payments and chat history? This cannot be undone.")) return;
    setBusyAction(true);
    try {
      const result = await api<{ message: string; access_token: string; user: User; company: { name: string } }>("/api/settings/reset-demo", { method: "POST" });
      saveToken(result.access_token);
      setUser({ ...result.user, company: result.company.name });
      setNotice(result.message);
      setSelectedInvoice(null);
      setChatLines([]);
      setConversationId(undefined);
      await loadPageData();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not reset demo data.");
    } finally {
      setBusyAction(false);
    }
  }

  if (loadingAuth) return <div className="auth-loading"><LoaderCircle className="spin" /> Checking your workspace…</div>;
  if (!user && showLanding) return <LandingPage
    onSignIn={() => { setSignupOnEntry(false); setShowLanding(false); }}
    onGetStarted={() => { setSignupOnEntry(true); setShowLanding(false); }}
  />;
  if (!user) return <LoginScreen busy={loginBusy} error={loginError} initialSignup={signupOnEntry} onBack={() => { setShowLanding(true); setLoginError(""); }} onLogin={signIn} onRegister={async (payload) => {
    setLoginBusy(true);
    setLoginError("");
    try {
      const result = await api<LoginResponse>("/api/auth/register", { method: "POST", body: JSON.stringify(payload) });
      saveToken(result.access_token);
      setUser({ ...result.user, company: result.company.name });
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Unable to create an account.");
    } finally {
      setLoginBusy(false);
    }
  }} />;

  const notificationCount = dashboard?.notifications.length ?? 0;
  const sectionTitle = selectedInvoice && section === "Invoices" ? selectedInvoice.invoice_number : section;
  return (
    <div className="app-frame">
      <aside className={`sidebar desktop-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup"><span className="brand-mark"><FileCheck2 size={18} /></span><span>Pay<span className="brand-ai">Ops</span></span></div>
        <div className="workspace-switch"><span className="workspace-avatar">S</span><span className="workspace-copy"><strong>{user.company || "Shiv Traders"}</strong><small>Business workspace</small></span><ChevronDown size={15} /></div>
        {["Workspace", "Manage"].map((group) => (
          <div className="nav-group" key={group}>
            <p className="nav-caption">{group}</p>
            {navigation.filter((item) => item.group === group).map(({ label, icon: Icon }) => (
              <button key={label} onClick={() => { setSection(label); setSelectedInvoice(null); setSidebarOpen(false); }} className={`nav-item ${section === label ? "nav-active" : ""}`}>
                <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
                {label === "Approvals" && dashboard?.summary.pending_approval_count ? <span className="nav-count">{dashboard.summary.pending_approval_count}</span> : null}
              </button>
            ))}
          </div>
        ))}
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon"><LifeBuoy size={17} /></span><div><strong>Need a hand?</strong><small>Explore the demo flows</small></div><ChevronRight size={14} /></div>
          <div className="user-card"><span className="user-avatar">{user.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><span className="user-copy"><strong>{user.name}</strong><small>{statusLabel(user.role)}</small></span><button aria-label="Sign out" className="icon-button" onClick={logout}><LogOut size={16} /></button></div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen((open) => !open)} aria-label="Toggle navigation"><Menu size={19} /></button>
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{sectionTitle}</strong></div>
          <div className="top-actions">
            <span className="demo-badge"><span /> Demo workspace</span>
            <button aria-label="Notifications" className="icon-button notification-button" onClick={() => setNotificationsOpen((open) => !open)}><Bell size={17} />{notificationCount > 0 && <i />}</button>
            <button className="top-avatar" onClick={logout} title="Sign out">{user.name.slice(0, 1)}</button>
          </div>
          {notificationsOpen && <div className="notification-popover"><div className="popover-head"><strong>Notifications</strong><button className="icon-button" onClick={() => setNotificationsOpen(false)}><X size={15} /></button></div>{dashboard?.notifications.length ? dashboard.notifications.map((item) => <button className="notification-row" key={item.id} onClick={() => { setSection("Invoices"); setNotificationsOpen(false); }}><span className={`notification-dot ${item.type}`} /><span><strong>{item.title}</strong><small>{item.description}</small></span></button>) : <p className="muted-copy">You’re all caught up.</p>}</div>}
        </header>
        {pageError && <div className="error-banner"><AlertCircle size={17} /><span>{pageError}</span><button onClick={() => setPageError("")} aria-label="Dismiss"><X size={15} /></button></div>}
        {notice && <div className="toast"><CheckCircle2 size={16} />{notice}</div>}
        <div className="page-content page-scroll">
          {section === "Dashboard" && <DashboardView data={dashboard} userName={user.name} onNavigate={setSection} onOpen={openInvoice} onUpload={uploadFile} uploading={uploading} />}
          {section === "Invoices" && (selectedInvoice
            ? <InvoiceDetail invoice={selectedInvoice} user={user} busy={busyAction} onBack={() => setSelectedInvoice(null)} onOpenInvoice={openInvoice} onApprove={() => decision(selectedInvoice, "approve")} onReject={() => decision(selectedInvoice, "reject")} onPaid={() => markPaid(selectedInvoice)} onEdit={async (values) => {
              try {
                const updated = await api<Invoice>(`/api/invoices/${selectedInvoice.id}`, { method: "PUT", body: JSON.stringify(values) });
                setSelectedInvoice(updated); setNotice("Invoice details saved."); await loadPageData();
              } catch (error) { setPageError(error instanceof Error ? error.message : "Could not save changes."); }
            }} />
            : <InvoicesView data={invoiceData} query={query} statusFilter={statusFilter} onQuery={(value) => { setQuery(value); setInvoicePage(1); }} onFilter={(value) => { setStatusFilter(value); setInvoicePage(1); }} page={invoicePage} onPageChange={setInvoicePage} onOpen={openInvoice} onUpload={uploadFile} uploading={uploading} />)}
          {section === "Vendors" && <VendorsView vendors={vendors} onViewInvoices={openVendorInvoices} onOpenInvoice={openInvoice} />}
          {section === "Approvals" && <ApprovalsView data={invoiceData} onOpen={openInvoice} onApprove={(invoice) => decision(invoice, "approve")} onReject={(invoice) => decision(invoice, "reject")} onRequestChanges={requestChanges} busy={busyAction} />}
          {section === "Payments" && <PaymentsView data={payments} onOpen={openInvoice} onPaid={markPaid} busy={busyAction} />}
          {section === "AI Assistant" && <AssistantView lines={chatLines} input={chatInput} busy={chatBusy} onInput={setChatInput} onSend={sendChat} />}
          {section === "Reports" && <ReportsView data={dashboard} onExport={async () => { try { await downloadCsv(); setNotice("CSV report downloaded."); } catch (error) { setPageError(error instanceof Error ? error.message : "Export failed."); } }} />}
          {section === "Integrations" && <IntegrationsView />}
          {section === "Settings" && <SettingsView user={user} busy={busyAction} onReset={resetDemo} onLogout={logout} />}
        </div>
      </main>
      {sidebarOpen && <button className="mobile-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />}
    </div>
  );
}

function LandingPage({ onSignIn, onGetStarted }: { onSignIn: () => void; onGetStarted: () => void }) {
  const captureOptions = [
    { label: "Upload", detail: "PDF or image", icon: Upload, available: true },
    { label: "Scan / photo", detail: "Image invoice", icon: FileText, available: true },
    { label: "Email", detail: "Coming soon", icon: Paperclip, available: false },
    { label: "WhatsApp", detail: "Coming soon", icon: MessageCircle, available: false },
  ];
  return <main className="landing-page">
    <header className="landing-header">
      <a className="brand-lockup landing-brand" href="#home" aria-label="PayOps home"><span className="brand-mark"><FileCheck2 size={18} /></span><span>Pay<span className="brand-ai">Ops</span></span></a>
      <nav className="landing-nav" aria-label="Landing page">
        <a href="#product">Product</a><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#resources">Resources</a>
      </nav>
      <div className="landing-actions"><button className="button button-secondary" onClick={onSignIn}>Sign in</button><button className="button button-primary" onClick={onGetStarted}>Get started</button></div>
    </header>
    <section className="landing-hero" id="home">
      <div className="landing-copy" id="product">
        <span className="landing-pill"><Sparkles size={13} /> AI-POWERED ACCOUNTS PAYABLE</span>
        <h1>Never manage invoices manually again.</h1>
        <p>Upload invoice PDFs or photos. PayOps extracts, verifies and tracks them automatically — so you can focus on growing your business.</p>
        <div className="landing-cta"><button className="button button-primary" onClick={onGetStarted}>Get started free <ArrowRight size={16} /></button><a className="button button-secondary" href="#workflow"><PlayCircle size={16} /> Watch demo</a></div>
        <div className="capture-grid">{captureOptions.map(({ label, detail, icon: Icon, available }) => <div className={`capture-tile ${available ? "" : "capture-soon"}`} key={label}><span className="capture-icon">{label === "WhatsApp" ? "W" : <Icon size={19} />}</span><strong>{label}</strong><small>{detail}</small></div>)}</div>
        <div className="landing-proof"><span><Check size={14} /> GST checks</span><span><Check size={14} /> Duplicate detection</span><span><Check size={14} /> Approval tracking</span></div>
      </div>
      <div className="landing-visual" aria-label="Illustration of an invoice being processed">
        <div className="processing-chip"><Sparkles size={14} /> Invoice processed and validated</div>
        <div className="preview-paper"><span className="preview-logo">SUPPLIER INVOICE</span><i /><i /><i /><b /><i /><i /><div className="preview-total"><span>Total due</span><strong>₹49,560</strong></div></div>
        <div className="preview-arrow"><ArrowRight size={24} /></div>
        <article className="extraction-preview">
          <div className="extraction-heading"><span className="brand-mark"><FileCheck2 size={14} /></span><div><strong>PayOps extraction</strong><small>Review-ready invoice data</small></div><CheckCircle2 className="preview-check" size={17} /></div>
          <div className="extraction-row"><span>Vendor</span><strong>ABC Electricals</strong></div>
          <div className="extraction-row"><span>Invoice No.</span><strong>INV-20391</strong></div>
          <div className="extraction-row"><span>Invoice Date</span><strong>15 Oct 2026</strong></div>
          <div className="extraction-row"><span>Due Date</span><strong>14 Nov 2026</strong></div>
          <div className="extraction-row"><span>Subtotal</span><strong>₹42,000</strong></div>
          <div className="extraction-row"><span>GST</span><strong>₹7,560</strong></div>
          <div className="extraction-total"><span>Total amount</span><strong>₹49,560</strong></div>
          <div className="validation-chip"><CheckCircle2 size={13} /> Validated · Ready for approval</div>
        </article>
        <span className="visual-caption">Illustrative invoice preview</span>
      </div>
    </section>
    <section className="landing-workflow" id="workflow">
      <span className="landing-section-kicker">FROM DOCUMENT TO DONE</span><h2>Every invoice. One clear workflow.</h2><p>See how PayOps turns an invoice into a checked, trackable payable.</p>
      <div className="workflow-cards"><article><span>01</span><Upload size={19} /><h3>Capture</h3><p>Upload a PDF or image invoice into your secure workspace.</p></article><article><span>02</span><Sparkles size={19} /><h3>Verify</h3><p>Review extracted fields, tax checks and potential duplicates.</p></article><article><span>03</span><CheckCircle2 size={19} /><h3>Approve & track</h3><p>Record decisions and payments with a clear invoice history.</p></article></div>
    </section>
    <section className="landing-bottom" id="features"><div><span className="landing-section-kicker">BUILT FOR SMALL BUSINESS</span><h2>Less chasing. More clarity.</h2><p>Keep invoices, approvals, vendors and payment status together — without turning your workflow into a full accounting ERP.</p></div><button className="button button-primary" onClick={onGetStarted}>Explore the workspace <ArrowRight size={16} /></button></section>
    <section className="landing-pricing" id="pricing"><span className="landing-section-kicker">GET STARTED</span><h2>Explore PayOps at your pace.</h2><p>Start with the demo workspace. Production plans are Coming Soon.</p><button className="button button-primary" onClick={onGetStarted}>Try PayOps free <ArrowRight size={15} /></button></section>
    <footer className="landing-footer" id="resources"><a className="brand-lockup" href="#home"><span className="brand-mark"><FileCheck2 size={16} /></span><span>Pay<span className="brand-ai">Ops</span></span></a><span>Invoice operations, made easier.</span><a href="#workflow">Explore the workflow</a></footer>
  </main>;
}

function LoginScreen({ busy, error, initialSignup = false, onBack, onLogin, onRegister }: { busy: boolean; error: string; initialSignup?: boolean; onBack: () => void; onLogin: (email: string, password: string) => void; onRegister: (payload: { name: string; email: string; password: string; company_name: string }) => void }) {
  const [email, setEmail] = useState("demo@invoiceai.local");
  const [password, setPassword] = useState("Demo@123");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [isSignup, setIsSignup] = useState(initialSignup);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (isSignup) onRegister({ name, email, password, company_name: company });
    else onLogin(email, password);
  };
  return <div className="login-page">
    <div className="login-card">
      <button className="landing-back" onClick={onBack}><ArrowLeft size={14} /> Back to PayOps</button>
      <div className="brand-lockup login-brand"><span className="brand-mark"><FileCheck2 size={18} /></span><span>Pay<span className="brand-ai">Ops</span></span></div>
      <span className="eyebrow"><Sparkles size={14} /> PAYOPS · AI-POWERED INVOICE OPERATIONS</span>
      <h1>{isSignup ? <>A calmer way to<br /><span>manage invoices.</span></> : <>Invoices under control.<br /><span>Without the busywork.</span></>}</h1>
      <p className="login-subtitle">Extract, verify, approve and track every invoice — all in one calm workspace.</p>
      <form onSubmit={submit} className="login-form">
        {isSignup && <label>Your name<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} autoComplete="name" /></label>}
        {isSignup && <label>Business name<input value={company} onChange={(event) => setCompany(event.target.value)} required minLength={2} autoComplete="organization" /></label>}
        <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" /></label>
        <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete={isSignup ? "new-password" : "current-password"} /></label>
        {error && <p className="inline-error"><AlertCircle size={15} />{error}</p>}
        <Button type="submit" disabled={busy} className="login-submit">{busy ? <><LoaderCircle size={16} className="spin" /> {isSignup ? "Creating workspace…" : "Signing in…"}</> : <>{isSignup ? "Create workspace" : "Sign in to workspace"} <ArrowRight size={16} /></>}</Button>
      </form>
      <button className="try-demo-button" disabled={busy} onClick={() => setIsSignup((value) => !value)}>{isSignup ? "Already have an account? Sign in" : "Create a new business account"}</button>
      {!isSignup && <button className="try-demo-button demo-link" disabled={busy} onClick={() => onLogin("demo@invoiceai.local", "Demo@123")}>Try the demo workspace <ArrowRight size={15} /></button>}
      <div className="login-note"><ShieldAlert size={14} /> Demo data is isolated to this workspace.</div>
    </div>
    <aside className="login-aside">
      <div className="aside-orb orb-one" /><div className="aside-orb orb-two" />
      <span className="aside-pill"><Sparkles size={13} /> A clearer way to pay</span>
      <h2>Your inbox isn’t<br />your accounts payable.</h2>
      <p>PayOps reads every bill, catches what deserves a second look and keeps approvals moving.</p>
      <div className="floating-invoice">
        <div className="float-head"><span className="brand-mark small"><FileCheck2 size={13} /></span><span>Invoice processed</span><CheckCircle2 size={16} className="float-check" /></div>
        <div className="float-line"><span>Vendor</span><strong>ABC Electricals</strong></div>
        <div className="float-line"><span>Invoice no.</span><strong>INV-20391</strong></div>
        <div className="float-line"><span>Due date</span><strong>14 Nov 2026</strong></div>
        <div className="float-total"><span>Total amount</span><strong>₹49,650</strong></div>
      </div>
      <div className="aside-points"><span><Check size={14} /> GST checks built in</span><span><Check size={14} /> Your data stays yours</span></div>
      <small className="aside-foot">Upload a real invoice to see the workflow end to end.</small>
    </aside>
  </div>;
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <div className="heading-eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</div>;
}

function MetricCard({ label, value, detail, icon: Icon, tint, trend }: { label: string; value: string; detail: string; icon: typeof Home; tint: string; trend?: string }) {
  return <Card className="metric-card"><div className="metric-top"><span className={`metric-icon ${tint}`}><Icon size={18} /></span>{trend && <span className="metric-trend"><ArrowUpRight size={13} />{trend}</span>}</div><p className="metric-label">{label}</p><strong className="metric-value">{value}</strong><span className="metric-detail">{detail}</span></Card>;
}

function InvoiceTable({ rows, onOpen, compact = false, showConfidence = false }: { rows: Invoice[]; onOpen: (invoice: Invoice) => void; compact?: boolean; showConfidence?: boolean }) {
  if (!rows.length) return <EmptyState title="No invoices to show" description="Upload a bill or adjust your filters to see invoices here." />;
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>Invoice</th><th>Vendor</th><th>Invoice date</th><th>Due date</th><th className="align-right">Amount</th><th>Workflow</th><th>Payment</th>{showConfidence && <th>AI confidence</th>}<th aria-label="Actions" /></tr></thead><tbody>{rows.map((invoice) => <tr key={invoice.id} onClick={() => onOpen(invoice)} className="click-row"><td><strong className="invoice-number">{invoice.invoice_number}</strong>{!compact && <small className="cell-sub">{invoice.source === "EMAIL" ? "Email" : "Uploaded"}</small>}</td><td><span className="vendor-cell"><span className="vendor-avatar">{invoice.vendor_name.slice(0, 1)}</span>{invoice.vendor_name}</span></td><td>{shortDate(invoice.invoice_date)}</td><td className={invoice.payment_status === "OVERDUE" ? "overdue-text" : ""}>{shortDate(invoice.due_date)}</td><td className="align-right amount-cell">{inr(invoice.total_amount)}</td><td><StatusPill value={invoice.status} /></td><td><StatusPill value={invoice.payment_status} /></td>{showConfidence && <td><span className="confidence"><span className="confidence-track"><i style={{ width: `${Math.round(invoice.ai_confidence * 100)}%` }} /></span>{Math.round(invoice.ai_confidence * 100)}%</span></td>}<td><button className="icon-button row-more" onClick={(event) => { event.stopPropagation(); onOpen(invoice); }} aria-label={`Open ${invoice.invoice_number}`}><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div>;
}

function DashboardView({ data, userName, onNavigate, onOpen, onUpload, uploading }: { data: Dashboard | null; userName: string; onNavigate: (section: Section) => void; onOpen: (invoice: Invoice) => void; onUpload: (file?: File) => void; uploading: boolean }) {
  if (!data) return <LoadingPanel message="Loading your business overview…" />;
  const s = data.summary;
  return <div>
    <PageHeading eyebrow={new Date().toLocaleDateString("en-US", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).toUpperCase()} title={`Good morning, ${userName.split(" ")[0]}`} description="Here’s what’s happening with your invoices." actions={<><span className="select-control">Last 6 months</span><UploadButton uploading={uploading} onFile={onUpload} /></>} />
    <div className="metric-grid">
      <MetricCard label="Total invoices" value={s.total_invoices.toLocaleString("en-IN")} detail={`${s.pending_approval_count} waiting for approval`} icon={FileText} tint="blue" trend="+12%" />
      <MetricCard label="Total invoice value" value={inr(s.total_amount)} detail="Across all invoices" icon={BadgeIndianRupee} tint="violet" trend="+8%" />
      <MetricCard label="Outstanding" value={inr(s.unpaid_amount)} detail={`${s.unpaid_count} unpaid invoices`} icon={HandCoins} tint="amber" />
      <MetricCard label="Overdue" value={inr(s.overdue_amount)} detail={`${s.overdue_count} invoices need attention`} icon={Clock3} tint="red" />
    </div>
    <div className="dashboard-grid">
      <Card className="chart-card trend-card">
        <div className="card-heading"><div><h2>Invoice activity</h2><p>Invoice value received over time</p></div><button className="period-button">6 months <ChevronDown size={14} /></button></div>
        <div className="chart-legend"><span><i className="legend-blue" /> Invoiced</span><span><i className="legend-green" /> Paid</span></div>
        <div className="trend-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.trend} margin={{ left: -15, right: 8, top: 12, bottom: 0 }}><defs><linearGradient id="invoicedFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3773f4" stopOpacity={0.13} /><stop offset="100%" stopColor="#3773f4" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#eef1f6" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#8791a4", fontSize: 11 }} dy={8} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#8791a4", fontSize: 10 }} tickFormatter={(v) => v >= 100000 ? `${Math.round(v / 100000)}L` : `${Math.round(v / 1000)}k`} /><Tooltip formatter={(value) => inr(Number(value))} contentStyle={{ border: "1px solid #e9edf4", borderRadius: 12, boxShadow: "0 8px 24px #14244312" }} /><Area type="monotone" dataKey="invoiced" name="Invoiced" stroke="#3773f4" strokeWidth={2.3} fill="url(#invoicedFill)" /><Area type="monotone" dataKey="paid" name="Paid" stroke="#19a77b" strokeWidth={2.1} fill="transparent" /></AreaChart></ResponsiveContainer></div>
      </Card>
      <Card className="chart-card payment-card">
        <div className="card-heading"><div><h2>Payment status</h2><p>Invoice distribution</p></div><button className="icon-button"><MoreHorizontal size={18} /></button></div>
        <div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.payment_mix} dataKey="value" nameKey="name" innerRadius={55} outerRadius={72} paddingAngle={3} stroke="none">{data.payment_mix.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip contentStyle={{ border: "1px solid #e9edf4", borderRadius: 10 }} /></PieChart></ResponsiveContainer><div className="donut-center"><strong>{s.total_invoices ? Math.round((s.paid_count / s.total_invoices) * 100) : 0}%</strong><span>paid</span></div></div>
        <div className="payment-legend">{data.payment_mix.map((item) => <div key={item.name}><span><i style={{ background: item.color }} />{item.name}</span><strong>{item.value}</strong></div>)}</div>
      </Card>
      <Card className="alerts-card">
        <div className="card-heading"><div><h2>AI insights</h2><p>Things that may need your attention</p></div><span className="sparkle-mark"><Sparkles size={15} /></span></div>
        <div className="insight-list">
          {data.alerts.length ? data.alerts.slice(0, 4).map((alert) => <button key={alert.id} className="insight-row" onClick={() => onOpen(data.recent_invoices.find((row) => row.id === alert.invoice_id) ?? { id: alert.invoice_id } as Invoice)}><span className={`insight-icon insight-${alert.type}`}><AlertCircle size={15} /></span><span>{alert.message}<small>{alert.invoice_number} · Review invoice</small></span><ChevronRight size={15} /></button>) : <div className="no-insights"><CheckCircle2 size={18} /><span>Nothing urgent. Your invoice checks look good.</span></div>}
          {s.due_this_week_count > 0 && <button className="insight-row" onClick={() => onNavigate("Payments")}><span className="insight-icon insight-due"><FileClock size={15} /></span><span>{s.due_this_week_count} invoices due this week<small>{inr(s.due_this_week_amount)} coming up</small></span><ChevronRight size={15} /></button>}
        </div>
      </Card>
    </div>
    <div className="dashboard-bottom-grid">
      <Card className="table-card">
        <div className="card-heading"><div><h2>Recent invoices</h2><p>Your latest invoice activity</p></div><button className="text-button" onClick={() => onNavigate("Invoices")}>View all invoices <ArrowRight size={15} /></button></div>
        <InvoiceTable rows={data.recent_invoices} onOpen={onOpen} compact />
      </Card>
      <PaymentWatch due={data.upcoming_payments} overdue={data.overdue_invoices} onOpen={onOpen} />
    </div>
    <input id="dashboard-upload" className="visually-hidden" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(event) => { void onUpload(event.target.files?.[0]); event.currentTarget.value = ""; }} />
  </div>;
}

function UploadButton({ uploading, onFile }: { uploading: boolean; onFile: (file?: File) => void }) {
  return <label className={`button button-primary upload-label ${uploading ? "button-disabled" : ""}`}><input type="file" accept=".pdf,.png,.jpg,.jpeg" disabled={uploading} onChange={(event: ChangeEvent<HTMLInputElement>) => { void onFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />{uploading ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}{uploading ? "Reading invoice…" : "Upload invoice"}</label>;
}

function PaymentWatch({ due, overdue, onOpen }: { due: Invoice[]; overdue: Invoice[]; onOpen: (invoice: Invoice) => void }) {
  const [tab, setTab] = useState<"Due soon" | "Overdue">("Due soon");
  const rows = tab === "Due soon" ? due : overdue;
  return <Card className="watch-card"><div className="card-heading"><div><h2>Payment watch</h2><p>Know what needs attention</p></div><span className="watch-icon"><Clock3 size={15} /></span></div><div className="watch-tabs">{(["Due soon", "Overdue"] as const).map((name) => <button className={tab === name ? "watch-tab active-watch-tab" : "watch-tab"} key={name} onClick={() => setTab(name)}>{name}<span>{name === "Due soon" ? due.length : overdue.length}</span></button>)}</div>{rows.length ? <div className="watch-list">{rows.map((invoice) => <button className="watch-row" key={invoice.id} onClick={() => onOpen(invoice)}><span className={`watch-date ${tab === "Overdue" ? "watch-date-overdue" : ""}`}>{shortDate(invoice.due_date).replace(/,\s*\d{4}$/, "")}</span><span className="watch-invoice"><strong>{invoice.vendor_name}</strong><small>{invoice.invoice_number}</small></span><span className="watch-amount">{inr(invoice.total_amount)}<ChevronRight size={13} /></span></button>)}</div> : <div className="watch-empty"><CheckCircle2 size={17} />{tab === "Due soon" ? "Nothing due in the next 7 days." : "No overdue invoices."}</div>}</Card>;
}

function InvoicesView({ data, query, statusFilter, onQuery, onFilter, page, onPageChange, onOpen, onUpload, uploading }: { data: InvoicePage | null; query: string; statusFilter: string; onQuery: (value: string) => void; onFilter: (value: string) => void; page: number; onPageChange: (value: number) => void; onOpen: (invoice: Invoice) => void; onUpload: (file?: File) => void; uploading: boolean }) {
  const statuses = ["ALL", "PENDING_REVIEW", "PENDING_APPROVAL", "UNPAID", "OVERDUE", "PAID", "REJECTED"];
  const shown = data?.items.filter((invoice) => statusFilter === "ALL" || invoice.status === statusFilter || invoice.payment_status === statusFilter) ?? [];
  return <div>
    <PageHeading eyebrow="INVOICE OPERATIONS" title="Invoices" description="Review, validate and keep every bill moving." actions={<UploadButton uploading={uploading} onFile={onUpload} />} />
    <Card className="list-card">
      <div className="tabs-line">{statuses.map((status) => <button className={`filter-tab ${statusFilter === status ? "filter-active" : ""}`} key={status} onClick={() => onFilter(status)}>{status === "ALL" ? "All invoices" : statusLabel(status)}</button>)}</div>
      <div className="list-toolbar"><label className="search-field"><Search size={16} /><input placeholder="Search invoice or vendor…" value={query} onChange={(event) => onQuery(event.target.value)} /></label><Button variant="secondary" className="filter-button" onClick={() => onFilter("ALL")}><Filter size={15} />Filters <span className="filter-count">1</span></Button><button className="icon-button" aria-label="More filters"><MoreHorizontal size={18} /></button></div>
      {!data ? <LoadingPanel message="Fetching invoices…" /> : <><InvoiceTable rows={shown} onOpen={onOpen} showConfidence /><div className="pagination-row"><span>Showing <strong>{data.total ? (page - 1) * data.page_size + 1 : 0}–{Math.min(page * data.page_size, data.total)}</strong> of <strong>{data.total}</strong> invoices</span><div><button className="icon-button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button><span className="page-indicator">{page} / {Math.max(1, Math.ceil(data.total / data.page_size))}</span><button className="icon-button" disabled={page >= Math.ceil(data.total / data.page_size)} onClick={() => onPageChange(page + 1)} aria-label="Next page"><ChevronRight size={16} /></button></div></div></>}
    </Card>
  </div>;
}

function InvoiceDetail({ invoice, user, busy, onBack, onOpenInvoice, onApprove, onReject, onPaid, onEdit }: { invoice: Invoice; user: User; busy: boolean; onBack: () => void; onOpenInvoice: (invoice: Invoice) => void; onApprove: () => void; onReject: () => void; onPaid: () => void; onEdit: (values: Record<string, unknown>) => Promise<void> }) {
  const [tab, setTab] = useState("Extracted data");
  const [editing, setEditing] = useState(false);
  const [documentUrl, setDocumentUrl] = useState("");
  const [documentError, setDocumentError] = useState("");
  const [form, setForm] = useState({ invoice_number: invoice.invoice_number, vendor_name: invoice.vendor_name, invoice_date: invoice.invoice_date ?? "", due_date: invoice.due_date ?? "", subtotal: invoice.subtotal, total_tax: invoice.total_tax, total_amount: invoice.total_amount });
  const canApprove = ["OWNER", "MANAGER"].includes(user.role);
  const canPay = ["OWNER", "ACCOUNTANT"].includes(user.role);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const save = async () => { await onEdit({ ...form, invoice_date: form.invoice_date || null, due_date: form.due_date || null }); setEditing(false); };
  useEffect(() => {
    if (!invoice.file_url) { setDocumentUrl(""); return; }
    let active = true;
    let objectUrl = "";
    setDocumentError("");
    fetch(`${apiUrl}${invoice.file_url}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error("The attached invoice document could not be loaded.");
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setDocumentUrl(objectUrl);
      })
      .catch((error: unknown) => setDocumentError(error instanceof Error ? error.message : "The attached invoice document could not be loaded."));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [apiUrl, invoice.file_url]);
  return <div>
    <div className="detail-back"><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> All invoices</button><span className="crumb-slash">/</span><strong>{invoice.invoice_number}</strong></div>
    <PageHeading title={invoice.invoice_number} description={`${invoice.vendor_name} · Added ${shortDate(invoice.invoice_date)}`} actions={<>
      <StatusPill value={invoice.status} />
      {invoice.payment_status !== "PAID" && ["APPROVED", "OVERDUE"].includes(invoice.status) && canPay && <Button variant="secondary" disabled={busy} onClick={onPaid}><CheckCircle2 size={15} /> Mark as paid</Button>}
      {["PENDING_APPROVAL", "PENDING_REVIEW", "PROCESSING"].includes(invoice.status) && canApprove && <Button disabled={busy} onClick={onApprove}><Check size={15} /> Approve</Button>}
      {["PENDING_APPROVAL", "PENDING_REVIEW", "PROCESSING"].includes(invoice.status) && canApprove && <Button variant="danger" disabled={busy} onClick={onReject}>Reject</Button>}
      <Button variant="secondary" onClick={() => setEditing((value) => !value)}>{editing ? "Cancel edit" : "Edit details"}</Button>
    </>} />
    {invoice.extraction_mode === "DEMO_FALLBACK" && <div className="fallback-banner"><Sparkles size={15} /><span><strong>DEMO FALLBACK MODE</strong> · Extracted using local PDF text rules. Connect an AI/OCR provider for richer automated field capture. Always verify invoice details before approving.</span></div>}
    <div className="detail-layout">
      <Card className="document-card"><div className="document-toolbar"><div><strong>Original document</strong><small>{invoice.original_filename || "No file attached"}</small></div>{documentUrl && <a href={documentUrl} download={invoice.original_filename || "invoice"} className="icon-button" aria-label="Download invoice"><Download size={16} /></a>}</div>
        {documentError ? <EmptyState icon={AlertCircle} title="Document preview unavailable" description={documentError} /> : invoice.file_url ? documentUrl ? <iframe title={`Invoice ${invoice.invoice_number}`} src={`${documentUrl}#toolbar=1&navpanes=0`} className="document-frame" /> : <LoadingPanel message="Loading original invoice…" /> : <EmptyState icon={FileText} title="No document preview" description="This invoice record has no uploaded document." />}
      </Card>
      <div className="detail-side">
        <Card className="extracted-card"><div className="card-heading extracted-heading"><div><span className="ai-title"><Sparkles size={15} /> AI extracted data</span><p>Review the values identified from this document</p></div><span className={`confidence-badge ${invoice.ai_confidence >= .8 ? "confidence-good" : "confidence-low"}`}>{Math.round(invoice.ai_confidence * 100)}% confidence</span></div>
          <div className="detail-tabs">{["Extracted data", "Line items", "Validation", "Timeline"].map((item) => <button key={item} className={tab === item ? "detail-tab active-detail-tab" : "detail-tab"} onClick={() => setTab(item)}>{item}{item === "Validation" && invoice.validations.length > 0 && <span className="tab-counter">{invoice.validations.length}</span>}</button>)}</div>
          {editing ? <div className="edit-grid">{[
            ["invoice_number", "Invoice number", "text"], ["vendor_name", "Vendor", "text"], ["invoice_date", "Invoice date", "date"], ["due_date", "Due date", "date"], ["subtotal", "Subtotal (₹)", "number"], ["total_tax", "Total GST (₹)", "number"], ["total_amount", "Total amount (₹)", "number"],
          ].map(([key, label, type]) => <label key={key}>{label}<input type={type} value={String(form[key as keyof typeof form])} onChange={(event) => setForm((state) => ({ ...state, [key]: type === "number" ? Number(event.target.value) : event.target.value }))} /></label>)}<Button className="save-edit" onClick={() => void save()}>Save changes</Button></div>
            : tab === "Extracted data" ? <><div className="extracted-grid">{[
              ["Vendor", invoice.vendor_name], ["Invoice number", invoice.invoice_number], ["Invoice date", shortDate(invoice.invoice_date)], ["Due date", shortDate(invoice.due_date)], ["Subtotal", inr(invoice.subtotal)], ["CGST", inr(invoice.cgst)], ["SGST", inr(invoice.sgst)], ["IGST", inr(invoice.igst)], ["Total GST", inr(invoice.total_tax)], ["Total amount", inr(invoice.total_amount)], ["GSTIN", invoice.vendor_gstin || "Not detected"], ["Payment terms", invoice.payment_terms || "Not specified"],
            ].map(([label, value]) => <div className="detail-value" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
            {invoice.bank_details && Object.values(invoice.bank_details).some(Boolean) && <div className="bank-details"><strong>Vendor bank details</strong>{Object.entries(invoice.bank_details).filter(([, value]) => value).map(([key, value]) => <div key={key}><span>{statusLabel(key)}</span><strong>{value}</strong></div>)}</div>}</>
            : tab === "Line items" ? invoice.items.length ? <div className="line-items">{invoice.items.map((item) => <div className="line-item" key={item.id}><span>{item.description}<small>{item.quantity} × {inr(item.unit_price)}</small></span><strong>{inr(item.total)}</strong></div>)}</div> : <EmptyState icon={FileText} title="No line items extracted" description="Review the original document and enter details manually if needed." />
            : tab === "Validation" ? <div className="validation-list">{invoice.validations.length ? invoice.validations.map((item) => <div className="validation-item" key={item.id}><span className={`validation-symbol ${item.severity.toLowerCase()}`}>{item.severity === "INFO" ? <Check size={14} /> : <AlertCircle size={14} />}</span><span><strong>{statusLabel(item.validation_type)}</strong><small>{item.message}</small>{item.related_invoice_id && <button className="validation-link" onClick={() => onOpenInvoice({ id: item.related_invoice_id } as Invoice)}>View related invoice <ArrowRight size={12} /></button>}</span><StatusPill value={item.severity} /></div>) : <div className="validation-good"><CheckCircle2 size={18} /><span>Key invoice checks passed.</span></div>}</div>
            : <div className="timeline-list"><div><span className="timeline-dot" /><span><strong>Invoice uploaded</strong><small>{shortDate(invoice.invoice_date)} · {invoice.source}</small></span></div><div><span className="timeline-dot ai" /><span><strong>AI extraction completed</strong><small>{invoice.extraction_mode === "DEMO_FALLBACK" ? "Fallback extraction" : "AI document extraction"} · {Math.round(invoice.ai_confidence * 100)}% confidence</small></span></div><div><span className="timeline-dot" /><span><strong>Status: {statusLabel(invoice.status)}</strong><small>Current workflow state</small></span></div></div>}
        </Card>
        <Card className="approval-card"><div className="approval-card-top"><span className="approval-icon"><FileCheck2 size={16} /></span><div><strong>Approval workflow</strong><small>Invoice actions are recorded in the activity log.</small></div></div>{invoice.status === "PENDING_APPROVAL" || invoice.status === "PENDING_REVIEW" ? <div className="approval-progress"><span className="progress-step done"><Check size={12} /> Received</span><i /><span className="progress-step done"><Check size={12} /> AI checked</span><i /><span className="progress-step active"><Clock3 size={12} /> Review</span><i /><span className="progress-step"><Check size={12} /> Payment</span></div> : <div className="approval-state"><CheckCircle2 size={16} /> Current status: <strong>{statusLabel(invoice.status)}</strong></div>}</Card>
      </div>
    </div>
  </div>;
}

function ApprovalsView({ data, onOpen, onApprove, onReject, onRequestChanges, busy }: { data: InvoicePage | null; onOpen: (invoice: Invoice) => void; onApprove: (invoice: Invoice) => void; onReject: (invoice: Invoice) => void; onRequestChanges: (invoice: Invoice) => void; busy: boolean }) {
  const [tab, setTab] = useState("Pending");
  const items = (data?.items ?? []).filter((invoice) => {
    if (tab === "Pending") return ["PENDING_APPROVAL", "PENDING_REVIEW"].includes(invoice.status);
    if (tab === "Approved") return ["APPROVED", "PAID"].includes(invoice.status);
    if (tab === "Rejected") return invoice.status === "REJECTED";
    return true;
  });
  return <div><PageHeading eyebrow="REVIEW QUEUE" title="Approvals" description="Keep invoice reviews moving, with the context to make a confident call." /><Card className="list-card"><div className="tabs-line">{["Pending", "Approved", "Rejected", "All"].map((name) => <button className={`filter-tab ${tab === name ? "filter-active" : ""}`} key={name} onClick={() => setTab(name)}>{name}{name === "Pending" && <span className="inline-count">{(data?.items ?? []).filter((i) => ["PENDING_APPROVAL", "PENDING_REVIEW"].includes(i.status)).length}</span>}</button>)}</div>{!data ? <LoadingPanel message="Loading approvals…" /> : !items.length ? <EmptyState icon={FileCheck2} title="Your queue is clear" description="Invoices waiting for review will appear here." /> : <div className="approval-rows">{items.map((invoice) => <div className="approval-row" key={invoice.id}><button className="approval-main" onClick={() => onOpen(invoice)}><span className="invoice-icon"><FileText size={17} /></span><span><strong>{invoice.invoice_number} <StatusPill value={invoice.status} /></strong><small>{invoice.vendor_name} · Received {shortDate(invoice.invoice_date)}</small><span className="approval-row-meta"><span><BadgeIndianRupee size={13} />{inr(invoice.total_amount)}</span><span><Sparkles size={13} />{Math.round(invoice.ai_confidence * 100)}% AI confidence</span><span className={invoice.validations.some((v) => ["ERROR", "CRITICAL"].includes(v.severity)) ? "review-warning" : ""}><ShieldAlert size={13} />{invoice.validations.length ? `${invoice.validations.length} validation checks` : "Checks passed"}</span></span></span></button>{["PENDING_APPROVAL", "PENDING_REVIEW"].includes(invoice.status) && <div className="approval-row-actions"><Button variant="secondary" disabled={busy} onClick={() => onRequestChanges(invoice)}>Request changes</Button><Button variant="secondary" disabled={busy} onClick={() => onReject(invoice)}>Reject</Button><Button disabled={busy} onClick={() => onApprove(invoice)}><Check size={14} /> Approve</Button></div>}</div>)}</div>}</Card></div>;
}

function PaymentsView({ data, onOpen, onPaid, busy }: { data: PaymentData | null; onOpen: (invoice: Invoice) => void; onPaid: (invoice: Invoice) => void; busy: boolean }) {
  const [view, setView] = useState("All");
  const rows = (data?.items ?? []).filter((invoice) => view === "All" || (view === "Overdue" ? invoice.is_overdue : view === "Paid" ? invoice.payment_status === "PAID" : invoice.payment_status !== "PAID"));
  return <div><PageHeading eyebrow="CASH FLOW" title="Payments" description="See what’s payable, what’s coming due and what’s already settled." /><div className="metric-grid payment-metrics"><MetricCard label="Outstanding payable" value={inr(data?.summary.total_payable ?? 0)} detail="Across unpaid invoices" icon={HandCoins} tint="blue" /><MetricCard label="Due this week" value={inr(data?.summary.due_this_week ?? 0)} detail="Next 7 days" icon={FileClock} tint="amber" /><MetricCard label="Overdue" value={inr(data?.summary.overdue ?? 0)} detail="Requires attention" icon={Clock3} tint="red" /><MetricCard label="Paid to date" value={inr(data?.summary.paid ?? 0)} detail="Recorded payments" icon={CheckCircle2} tint="green" /></div><Card className="list-card"><div className="tabs-line">{["All", "Unpaid", "Overdue", "Paid"].map((name) => <button className={`filter-tab ${view === name ? "filter-active" : ""}`} key={name} onClick={() => setView(name)}>{name}</button>)}</div>{!data ? <LoadingPanel message="Loading payments…" /> : !rows.length ? <EmptyState icon={Wallet} title="No payments here yet" description="Payment records will appear as invoices are paid." /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Invoice</th><th>Vendor</th><th>Due date</th><th className="align-right">Invoice total</th><th className="align-right">Balance</th><th>Payment status</th><th>Last payment</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="click-row"><td><button className="link-cell" onClick={() => onOpen(row)}>{row.invoice_number}</button></td><td>{row.vendor_name}</td><td className={row.is_overdue ? "overdue-text" : ""}>{shortDate(row.due_date)}</td><td className="align-right">{inr(row.total_amount)}</td><td className="align-right amount-cell">{inr(row.balance)}</td><td><StatusPill value={row.is_overdue ? "OVERDUE" : row.payment_status} /></td><td>{shortDate(row.payments?.[row.payments.length - 1]?.payment_date)}</td><td>{row.payment_status !== "PAID" && ["APPROVED", "OVERDUE"].includes(row.status) && <Button variant="secondary" className="small-button" disabled={busy} onClick={() => onPaid(row)}>Mark paid</Button>}</td></tr>)}</tbody></table></div>}</Card></div>;
}

type VendorProfile = Vendor & { phone?: string | null; address?: string | null; invoices: Invoice[] };

function VendorsView({ vendors, onViewInvoices, onOpenInvoice }: { vendors: Vendor[]; onViewInvoices: (name: string) => void; onOpenInvoice: (invoice: Invoice) => void }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<VendorProfile | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");
  const filtered = vendors.filter((vendor) => vendor.name.toLowerCase().includes(search.toLowerCase()));
  async function openProfile(vendor: Vendor) {
    setLoadingDetail(true);
    setDetailError("");
    try {
      setSelected(await api<VendorProfile>(`/api/vendors/${vendor.id}`));
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Could not load vendor details.");
    } finally {
      setLoadingDetail(false);
    }
  }
  if (selected) {
    const payable = selected.invoices.filter((invoice) => !["REJECTED", "DUPLICATE"].includes(invoice.status));
    const now = new Date();
    const currentMonth = monthKey(now);
    const previousDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousMonth = monthKey(previousDate);
    const currentRows = payable.filter((invoice) => invoice.invoice_date?.startsWith(currentMonth));
    const previousRows = payable.filter((invoice) => invoice.invoice_date?.startsWith(previousMonth));
    const currentSpend = currentRows.reduce((total, invoice) => total + invoice.total_amount, 0);
    const previousSpend = previousRows.reduce((total, invoice) => total + invoice.total_amount, 0);
    const spendChange = currentRows.length >= 2 && previousRows.length >= 2 && previousSpend > 0
      ? Math.round(((currentSpend - previousSpend) / previousSpend) * 100)
      : null;
    return <div>
      <PageHeading eyebrow="VENDOR PROFILE" title={selected.name} description={`${selected.category} · ${selected.gstin || "GSTIN not recorded"}`} actions={<><Button variant="secondary" onClick={() => setSelected(null)}><ArrowLeft size={15} /> All vendors</Button><Button onClick={() => onViewInvoices(selected.name)}>View invoices <ArrowRight size={15} /></Button></>} />
      <div className="vendor-summary-grid"><Card className="vendor-summary"><span className="metric-icon blue"><FileText size={18} /></span><div><strong>{selected.invoice_count}</strong><small>Total invoices</small></div></Card><Card className="vendor-summary"><span className="metric-icon violet"><BadgeIndianRupee size={18} /></span><div><strong>{inr(selected.total_amount)}</strong><small>Total invoiced</small></div></Card><Card className="vendor-summary"><span className="metric-icon amber"><HandCoins size={18} /></span><div><strong>{inr(selected.outstanding)}</strong><small>Outstanding balance</small></div></Card></div>
      <div className="vendor-profile-grid"><Card className="vendor-profile-card"><h2>Vendor details</h2><div className="vendor-profile-fields"><div><span>Email</span><strong>{selected.email || "Not recorded"}</strong></div><div><span>Phone</span><strong>{selected.phone || "Not recorded"}</strong></div><div><span>Address</span><strong>{selected.address || "Not recorded"}</strong></div><div><span>Overdue invoices</span><strong>{selected.overdue_count}</strong></div></div></Card>{spendChange !== null && <Card className="vendor-insight"><span className="sparkle-mark"><Sparkles size={15} /></span><div><strong>Spend movement</strong><p>Invoice value from this vendor {spendChange >= 0 ? "increased" : "decreased"} by <b>{Math.abs(spendChange)}%</b> compared with the previous month, based on {currentRows.length + previousRows.length} invoices.</p></div></Card>}</div>
      <Card className="list-card vendor-history"><div className="card-heading"><div><h2>Invoice history</h2><p>Invoices received from {selected.name}</p></div></div><InvoiceTable rows={selected.invoices} onOpen={onOpenInvoice} /></Card>
    </div>;
  }
  if (loadingDetail) return <LoadingPanel message="Loading vendor profile…" />;
  return <div><PageHeading eyebrow="SUPPLIER DIRECTORY" title="Vendors" description="Your supplier relationships and outstanding spend, in one view." /><div className="vendor-summary-grid"><Card className="vendor-summary"><span className="metric-icon blue"><Users size={18} /></span><div><strong>{vendors.length}</strong><small>Active vendors</small></div></Card><Card className="vendor-summary"><span className="metric-icon violet"><BadgeIndianRupee size={18} /></span><div><strong>{inr(vendors.reduce((total, vendor) => total + vendor.total_amount, 0))}</strong><small>Total invoiced</small></div></Card><Card className="vendor-summary"><span className="metric-icon amber"><HandCoins size={18} /></span><div><strong>{inr(vendors.reduce((total, vendor) => total + vendor.outstanding, 0))}</strong><small>Outstanding balance</small></div></Card></div>{detailError && <div className="error-banner"><AlertCircle size={16} />{detailError}<button onClick={() => setDetailError("")} aria-label="Dismiss"><X size={14} /></button></div>}<Card className="list-card"><div className="vendor-toolbar"><label className="search-field"><Search size={16} /><input placeholder="Search vendors…" value={search} onChange={(event) => setSearch(event.target.value)} /></label><span className="muted-copy">{filtered.length} vendors</span></div>{filtered.length ? <div className="vendor-grid">{filtered.map((vendor, index) => <div className="vendor-card" key={vendor.id}><div className="vendor-card-top"><span className={`vendor-avatar large avatar-${index % 6}`}>{vendor.name.slice(0, 1)}</span><span className="vendor-category">{vendor.category}</span><button className="text-button vendor-profile-link" disabled={loadingDetail} onClick={() => void openProfile(vendor)}>View profile <ArrowRight size={13} /></button></div><h3>{vendor.name}</h3><p>{vendor.gstin || "GSTIN not recorded"}</p><div className="vendor-stats"><div><span>Invoices</span><strong>{vendor.invoice_count}</strong></div><div><span>Total spend</span><strong>{inr(vendor.total_amount)}</strong></div><div><span>Outstanding</span><strong>{inr(vendor.outstanding)}</strong></div></div><div className="vendor-card-foot"><span>{vendor.email || "Email not recorded"}</span><button className="text-button" onClick={() => onViewInvoices(vendor.name)}>View invoices <ArrowRight size={13} /></button>{vendor.overdue_count > 0 && <StatusPill value="OVERDUE" />}</div></div>)}</div> : <EmptyState icon={Users} title="No matching vendors" description="Try another vendor name." />}</Card><p className="page-footnote"><CircleHelp size={14} /> Vendor records are created automatically when a new supplier invoice is uploaded.</p></div>;
}

function AssistantView({ lines, input, busy, onInput, onSend }: { lines: ChatLine[]; input: string; busy: boolean; onInput: (value: string) => void; onSend: (value?: string) => void }) {
  const suggestions = ["How many invoices are overdue?", "How much did I pay this month?", "Which vendor do I owe the most?", "What’s due this week?", "Find duplicate invoices"];
  return <div><PageHeading eyebrow="GROUNDED IN YOUR WORKSPACE" title="AI Invoice Assistant" description="Ask anything about your invoices. Answers are based on your actual workspace data." actions={<span className="grounded-pill"><span /> Database connected</span>} /><div className="assistant-layout"><Card className="chat-card"><div className="chat-head"><span className="assistant-avatar"><Bot size={19} /></span><span><strong>PayOps Assistant</strong><small>Answers grounded in your invoice data</small></span><span className="online-dot" /></div><div className="chat-transcript">{lines.length === 0 ? <div className="chat-welcome"><span className="welcome-orb"><Sparkles size={23} /></span><h2>How can I help with your invoices?</h2><p>Ask about payments, due dates, vendors or a particular invoice.</p><div className="prompt-grid">{suggestions.map((prompt) => <button key={prompt} onClick={() => onSend(prompt)}>{prompt}<ArrowUpRight size={14} /></button>)}</div></div> : lines.map((line, index) => <div className={`chat-message ${line.role}`} key={`${line.role}-${index}`}><span className="message-avatar">{line.role === "assistant" ? <Sparkles size={14} /> : "S"}</span><div className="message-bubble">{line.content.split("\n").map((paragraph, i) => <p key={i}>{paragraph.replaceAll("**", "")}</p>)}{line.sources?.length ? <div className="source-chips"><span>Based on</span>{line.sources.slice(0, 3).map((source) => <span className="source-chip" key={`${source.id}-${source.label}`}>{source.label}</span>)}</div> : null}</div></div>)}{busy && <div className="chat-message assistant"><span className="message-avatar"><Sparkles size={14} /></span><div className="thinking"><i /><i /><i /></div></div>}</div><form className="chat-input-row" onSubmit={(event) => { event.preventDefault(); onSend(); }}><input placeholder="Ask about your invoices…" value={input} onChange={(event) => onInput(event.target.value)} disabled={busy} /><button type="button" className="attach-button" title="Assistant uses workspace data"><Paperclip size={17} /></button><Button type="submit" disabled={busy || !input.trim()} aria-label="Send message"><Send size={16} /></Button></form><div className="chat-disclaimer"><ShieldAlert size={13} /> AI responses are generated from your workspace records. Verify important decisions.</div></Card><aside className="assistant-context"><Card><div className="context-heading"><Sparkles size={15} /><strong>Try asking</strong></div>{suggestions.map((prompt) => <button className="context-prompt" key={prompt} onClick={() => onSend(prompt)}>{prompt}<ArrowRight size={13} /></button>)}</Card><Card className="context-data"><span className="context-label">YOUR WORKSPACE</span><div><FileText size={16} /><span>Invoices<small>Ask about status and totals</small></span></div><div><Users size={16} /><span>Vendors<small>Compare outstanding spend</small></span></div><div><Wallet size={16} /><span>Payments<small>Understand what’s been paid</small></span></div></Card></aside></div></div>;
}

function ReportsView({ data, onExport }: { data: Dashboard | null; onExport: () => void }) {
  return <div><PageHeading eyebrow="BUSINESS VISIBILITY" title="Reports" description="A clear picture of invoice volume, vendor spend and payables." actions={<Button onClick={onExport}><Download size={15} /> Export invoice CSV</Button>} /><div className="report-grid"><MetricCard label="Invoice volume" value={`${data?.summary.total_invoices ?? 0}`} detail="Invoices in this workspace" icon={FileText} tint="blue" /><MetricCard label="Total spend" value={inr(data?.summary.total_amount ?? 0)} detail="Invoiced amount to date" icon={BadgeIndianRupee} tint="violet" /><MetricCard label="Outstanding payables" value={inr(data?.summary.unpaid_amount ?? 0)} detail={`${data?.summary.unpaid_count ?? 0} open invoices`} icon={HandCoins} tint="amber" /><MetricCard label="Overdue exposure" value={inr(data?.summary.overdue_amount ?? 0)} detail={`${data?.summary.overdue_count ?? 0} overdue invoices`} icon={Clock3} tint="red" /></div><Card className="report-chart-card"><div className="card-heading"><div><h2>Invoice and payment trends</h2><p>Monthly totals from your workspace data</p></div></div><div className="report-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data?.trend ?? []} margin={{ left: 0, right: 16, top: 12, bottom: 0 }}><CartesianGrid vertical={false} stroke="#eef1f6" /><XAxis dataKey="month" axisLine={false} tickLine={false} /><YAxis axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} /><Tooltip formatter={(value) => inr(Number(value))} /><Area type="monotone" dataKey="invoiced" name="Invoiced" stroke="#3773f4" fill="#3773f41a" /><Area type="monotone" dataKey="paid" name="Paid" stroke="#19a77b" fill="#19a77b1a" /></AreaChart></ResponsiveContainer></div></Card><p className="page-footnote"><CircleHelp size={14} /> CSV exports include invoice amounts and workflow/payment statuses for this company only.</p></div>;
}

function IntegrationsView() {
  const items = [
    ["Gmail", "Automatically capture invoices from your inbox.", "Google"],
    ["Outlook", "Bring supplier invoices into one workspace.", "Microsoft"],
    ["WhatsApp", "Receive invoices from your business number.", "Messaging"],
    ["Bank account", "Reconcile payments with invoice records.", "Banking"],
    ["Tally", "Keep your existing bookkeeping workflow.", "Accounting"],
    ["Zoho Books", "Sync vendor and payment information.", "Accounting"],
  ];
  return <div><PageHeading eyebrow="CONNECTED WORKFLOWS" title="Integrations" description="Connect the tools your business already uses. Integrations are clearly marked by availability." /><div className="integration-grid">{items.map(([name, description, category], index) => <Card className="integration-card" key={name}><div className={`integration-logo integration-${index}`}>{name === "WhatsApp" ? "◉" : name.slice(0, 1)}</div><span className="integration-category">{category}</span><h3>{name}</h3><p>{description}</p><div className="coming-soon-row"><span className="coming-dot" /> Coming soon</div><Button variant="secondary" disabled>Connect</Button></Card>)}</div><p className="page-footnote"><ShieldAlert size={14} /> No integrations are connected in this demo; connect buttons will activate when a provider is implemented.</p></div>;
}

function SettingsView({ user, busy, onReset, onLogout }: { user: User; busy: boolean; onReset: () => void; onLogout: () => void }) {
  return <div><PageHeading eyebrow="WORKSPACE PREFERENCES" title="Settings" description="Your account, demo environment and operational preferences." /><div className="settings-layout"><Card className="settings-card"><div className="settings-section-head"><span className="settings-avatar">{user.name.slice(0, 1)}</span><div><h2>Profile</h2><p>Your PayOps workspace identity</p></div></div><div className="settings-fields"><div><span>Name</span><strong>{user.name}</strong></div><div><span>Email</span><strong>{user.email}</strong></div><div><span>Role</span><strong><StatusPill value={user.role} /></strong></div><div><span>Workspace</span><strong>{user.company || "Shiv Traders"}</strong></div></div></Card><Card className="settings-card"><div className="settings-section-head"><span className="metric-icon violet"><Sparkles size={18} /></span><div><h2>Demo workspace</h2><p>Reset seeded invoices and sample payment history.</p></div></div><div className="settings-callout"><AlertCircle size={17} /><span>Resetting replaces your demo invoices, validations, payment history and assistant conversations. Uploaded documents are not removed.</span></div><Button variant="danger" disabled={busy || user.email !== "demo@invoiceai.local"} onClick={onReset}><Activity size={15} /> Reset demo data</Button></Card><Card className="settings-card"><div className="settings-section-head"><span className="metric-icon blue"><ShieldAlert size={18} /></span><div><h2>Security</h2><p>Signed in as {user.email}</p></div></div><p className="muted-copy">Your session uses an expiring access token. Sign out when you’re finished on a shared device.</p><Button variant="secondary" onClick={onLogout}><LogOut size={15} /> Sign out</Button></Card></div></div>;
}
