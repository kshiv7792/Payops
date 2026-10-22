export type User = {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "ACCOUNTANT" | "MANAGER" | "STAFF";
  company_id: string;
  company?: string;
};

export type Validation = {
  id: string;
  related_invoice_id?: string | null;
  validation_type: string;
  severity: string;
  message: string;
  status: string;
};

export type Invoice = {
  id: string;
  vendor_id: string | null;
  vendor_name: string;
  vendor_gstin?: string | null;
  invoice_number: string;
  invoice_date: string | null;
  due_date: string | null;
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  total_tax: number;
  total_amount: number;
  currency: string;
  status: string;
  payment_status: string;
  source: string;
  original_filename?: string | null;
  ai_confidence: number;
  payment_terms?: string | null;
  extraction_mode?: string;
  bank_details?: Record<string, string | null>;
  file_url?: string | null;
  items: { id: string; description: string; quantity: number; unit_price: number; tax_rate: number; tax_amount: number; total: number }[];
  validations: Validation[];
  payments?: { amount: number; payment_date: string; reference?: string | null }[];
};

export type Dashboard = {
  summary: {
    total_invoices: number;
    total_amount: number;
    unpaid_count: number;
    unpaid_amount: number;
    overdue_count: number;
    overdue_amount: number;
    paid_count: number;
    paid_amount: number;
    pending_approval_count: number;
    due_this_week_count: number;
    due_this_week_amount: number;
  };
  trend: { month: string; invoiced: number; paid: number }[];
  payment_mix: { name: string; value: number; color: string }[];
  recent_invoices: Invoice[];
  alerts: { id: string; type: string; message: string; invoice_id: string; invoice_number: string }[];
  upcoming_payments: Invoice[];
  overdue_invoices: Invoice[];
  notifications: { id: string; title: string; description: string; type: string }[];
};

export type Vendor = {
  id: string;
  name: string;
  gstin: string | null;
  email?: string | null;
  category: string;
  invoice_count: number;
  total_amount: number;
  paid_amount: number;
  outstanding: number;
  overdue_count: number;
};
