import os
import re
from datetime import date, timedelta
from typing import Any

import httpx

from ..models import Invoice, Vendor


def get_invoice_summary(invoices: list[Invoice]) -> dict[str, float | int]:
    return {
        "invoice_count": len(invoices),
        "total_amount": sum(invoice.total_amount for invoice in invoices),
        "paid_amount": sum(invoice.total_amount for invoice in invoices if invoice.payment_status == "PAID"),
    }


def get_overdue_invoices(invoices: list[Invoice], today: date | None = None) -> list[Invoice]:
    today = today or date.today()
    return [
        invoice for invoice in invoices
        if invoice.status not in {"REJECTED", "DUPLICATE"}
        and invoice.payment_status != "PAID"
        and invoice.due_date and invoice.due_date < today
    ]


def get_due_invoices(invoices: list[Invoice], today: date | None = None) -> list[Invoice]:
    today = today or date.today()
    return [
        invoice for invoice in invoices
        if invoice.status not in {"REJECTED", "DUPLICATE"}
        and invoice.payment_status != "PAID"
        and invoice.due_date and today <= invoice.due_date <= today + timedelta(days=7)
    ]


def get_vendor_summary(invoices: list[Invoice], vendors: list[Vendor], outstanding_only: bool) -> list[tuple[str, float, list[Invoice]]]:
    names = {vendor.id: vendor.name for vendor in vendors}
    amounts: dict[str, float] = {}
    rows: dict[str, list[Invoice]] = {}
    for invoice in invoices:
        if invoice.status in {"REJECTED", "DUPLICATE"} or (outstanding_only and invoice.payment_status == "PAID"):
            continue
        vendor_id = invoice.vendor_id or ""
        amounts[vendor_id] = amounts.get(vendor_id, 0) + invoice.total_amount
        rows.setdefault(vendor_id, []).append(invoice)
    return [(names.get(vendor_id, "Unknown vendor"), total, rows[vendor_id]) for vendor_id, total in sorted(amounts.items(), key=lambda entry: entry[1], reverse=True)[:5]]


def get_invoice_by_number(invoices: list[Invoice], invoice_number: str) -> Invoice | None:
    return next((invoice for invoice in invoices if invoice.invoice_number.casefold() == invoice_number.casefold()), None)


def get_payment_summary(invoices: list[Invoice], after: date | None = None, vendor_id: str | None = None) -> list[Any]:
    return [
        payment
        for invoice in invoices
        if (vendor_id is None or invoice.vendor_id == vendor_id)
        for payment in invoice.payments
        if after is None or payment.payment_date >= after
    ]


def get_validation_issues(invoice: Invoice) -> list[Any]:
    return [issue for issue in invoice.validations if issue.status == "OPEN"]


def find_possible_duplicates(invoices: list[Invoice]) -> list[Invoice]:
    flagged_ids = {
        issue.invoice_id
        for invoice in invoices
        for issue in invoice.validations
        if "DUPLICATE" in issue.validation_type
    }
    return [invoice for invoice in invoices if invoice.id in flagged_ids or invoice.status == "DUPLICATE"]


def answer_from_workspace(message: str, invoices: list[Invoice], vendors: list[Vendor]) -> tuple[str, list[dict[str, Any]]]:
    lower = message.casefold()
    vendor_by_id = {vendor.id: vendor.name for vendor in vendors}
    overdue = get_overdue_invoices(invoices)
    due_week = get_due_invoices(invoices)
    sources: list[dict[str, Any]] = []
    paid_vendor = next((vendor for vendor in vendors if vendor.name.casefold() in lower and "paid" in lower), None)
    if paid_vendor:
        month_start = date.today().replace(day=1) if "month" in lower else None
        payments = get_payment_summary(invoices, after=month_start, vendor_id=paid_vendor.id)
        answer = f"**₹{sum(payment.amount for payment in payments):,.0f}** was paid to **{paid_vendor.name}**"
        answer += " this month." if month_start else f" across {len(payments)} recorded payment{'s' if len(payments) != 1 else ''}."
        sources = [{"type": "invoice", "id": payment.invoice_id, "label": payment.invoice.invoice_number} for payment in payments]
    elif any(word in lower for word in ("overdue", "late", "past due")):
        answer = f"You have **{len(overdue)} overdue invoices** totalling **₹{sum(invoice.total_amount for invoice in overdue):,.0f}**."
        chosen = sorted(overdue, key=lambda invoice: invoice.due_date)[:8]
        if chosen:
            answer += "\n\n" + "\n".join(f"- {invoice.invoice_number} · {vendor_by_id.get(invoice.vendor_id, 'Vendor')} · ₹{invoice.total_amount:,.0f} (due {invoice.due_date:%d %b})" for invoice in chosen)
        sources = [{"type": "invoice", "id": invoice.id, "label": invoice.invoice_number} for invoice in chosen]
    elif "duplicate" in lower:
        chosen = find_possible_duplicates(invoices)
        answer = f"I found **{len(chosen)} invoice{'s' if len(chosen) != 1 else ''} flagged as a possible duplicate**."
        if chosen:
            answer += "\n\n" + "\n".join(f"- {invoice.invoice_number} · {vendor_by_id.get(invoice.vendor_id, 'Vendor')} · ₹{invoice.total_amount:,.0f}" for invoice in chosen)
        sources = [{"type": "invoice", "id": invoice.id, "label": invoice.invoice_number} for invoice in chosen]
    elif any(word in lower for word in ("this week", "next week", "due soon", "upcoming")):
        answer = f"**{len(due_week)} invoices** totalling **₹{sum(invoice.total_amount for invoice in due_week):,.0f}** are due in the next 7 days."
        answer += "\n\n" + "\n".join(f"- {invoice.invoice_number} · {vendor_by_id.get(invoice.vendor_id, 'Vendor')} · ₹{invoice.total_amount:,.0f} · {invoice.due_date:%d %b}" for invoice in sorted(due_week, key=lambda invoice: invoice.due_date)[:8])
        sources = [{"type": "invoice", "id": invoice.id, "label": invoice.invoice_number} for invoice in due_week[:8]]
    elif any(word in lower for word in ("vendor", "who do i owe", "most")):
        outstanding_only = any(word in lower for word in ("owe", "outstanding", "payable"))
        ranked = get_vendor_summary(invoices, vendors, outstanding_only)
        description = "highest outstanding balances" if outstanding_only else "highest invoice spend"
        answer = f"Your vendors with the {description} are:\n\n" + "\n".join(f"{index}. **{name}** · ₹{amount:,.0f}" for index, (name, amount, _) in enumerate(ranked, 1))
        sources = [{"type": "invoice", "id": invoice.id, "label": invoice.invoice_number} for _, _, rows in ranked for invoice in rows[:2]]
    elif "paid" in lower or "payment" in lower or "owe" in lower or "outstanding" in lower:
        paid_rows = [invoice for invoice in invoices if invoice.payment_status == "PAID"]
        payable = [invoice for invoice in invoices if invoice.status not in {"REJECTED", "DUPLICATE"}]
        if "month" in lower:
            payments = get_payment_summary(invoices, after=date.today().replace(day=1))
            answer = f"You've paid **₹{sum(payment.amount for payment in payments):,.0f}** this month across **{len(payments)} payment{'s' if len(payments) != 1 else ''}**."
            sources = [{"type": "invoice", "id": payment.invoice_id, "label": payment.invoice.invoice_number} for payment in payments]
        else:
            amount_due = sum(invoice.total_amount for invoice in payable if invoice.payment_status != "PAID")
            answer = f"Your outstanding balance is **₹{amount_due:,.0f}** across **{sum(invoice.payment_status != 'PAID' for invoice in payable)} invoices**. You've paid **₹{sum(invoice.total_amount for invoice in paid_rows):,.0f}** across {len(paid_rows)} invoices."
            sources = [{"type": "invoice", "id": invoice.id, "label": invoice.invoice_number} for invoice in paid_rows[:8]]
    elif amount_match := re.search(r"\b(?:above|over|more than)\s*(?:₹|rs\.?\s*)?([\d,]+(?:\.\d+)?)\s*(lakh|lac|k|thousand)?\b", lower):
        amount = float(amount_match.group(1).replace(",", ""))
        if amount_match.group(2) in {"lakh", "lac"}:
            amount *= 100_000
        elif amount_match.group(2) in {"k", "thousand"}:
            amount *= 1_000
        chosen = [invoice for invoice in invoices if invoice.total_amount > amount]
        answer = f"**{len(chosen)} invoices** are above ₹{amount:,.0f}."
        if chosen:
            answer += "\n\n" + "\n".join(f"- {invoice.invoice_number} · {vendor_by_id.get(invoice.vendor_id, 'Vendor')} · ₹{invoice.total_amount:,.0f}" for invoice in sorted(chosen, key=lambda invoice: invoice.total_amount, reverse=True)[:8])
        sources = [{"type": "invoice", "id": invoice.id, "label": invoice.invoice_number} for invoice in chosen[:8]]
    elif invoice_match := re.search(r"\b[A-Z]{2,}-\d+\b", message, re.IGNORECASE):
        invoice = get_invoice_by_number(invoices, invoice_match.group(0))
        if invoice:
            answer = f"**{invoice.invoice_number}** from **{vendor_by_id.get(invoice.vendor_id, 'Vendor')}** is ₹{invoice.total_amount:,.0f}, with status **{invoice.status.replace('_', ' ').title()}** and payment status **{invoice.payment_status.replace('_', ' ').title()}**."
            if any(word in lower for word in ("flag", "validation", "why")):
                issues = get_validation_issues(invoice)
                answer += "\n\n" + ("Validation findings:\n" + "\n".join(f"- {issue.severity}: {issue.message}" for issue in issues) if issues else "No validation issues are recorded for this invoice.")
            sources = [{"type": "invoice", "id": invoice.id, "label": invoice.invoice_number}]
        else:
            answer = f"I couldn't find invoice **{invoice_match.group(0).upper()}** in your workspace."
    else:
        summary = get_invoice_summary(invoices)
        answer = f"Your workspace has **{summary['invoice_count']} invoices** totalling **₹{summary['total_amount']:,.0f}**. Try asking about overdue invoices, payments this month, upcoming bills, vendors or an invoice number."
        sources = [{"type": "workspace", "label": "Invoice summary"}]
    return answer, sources


def refine_grounded_answer(question: str, answer: str, sources: list[dict[str, Any]], invoices: list[Invoice], vendors: list[Vendor]) -> str | None:
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("AZURE_OPENAI_API_KEY")
    if not api_key:
        return None
    url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/") + "/chat/completions"
    is_azure = bool(os.getenv("AZURE_OPENAI_ENDPOINT"))
    model = os.getenv("OPENAI_MODEL") or os.getenv("AZURE_OPENAI_DEPLOYMENT") or "gpt-4o-mini"
    if is_azure:
        url = os.getenv("AZURE_OPENAI_ENDPOINT", "").rstrip("/") + "/openai/deployments/" + os.getenv("AZURE_OPENAI_DEPLOYMENT", "")
        url += "/chat/completions?api-version=" + os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21")
    headers = {"Content-Type": "application/json"}
    headers["api-key" if is_azure else "Authorization"] = api_key if is_azure else f"Bearer {api_key}"
    source_ids = {str(source.get("id")) for source in sources if source.get("id")}
    vendor_names = {vendor.id: vendor.name for vendor in vendors}
    evidence = [
        {
            "invoice_number": invoice.invoice_number,
            "vendor": vendor_names.get(invoice.vendor_id or "", "Unknown vendor"),
            "invoice_date": invoice.invoice_date.isoformat() if invoice.invoice_date else None,
            "due_date": invoice.due_date.isoformat() if invoice.due_date else None,
            "total_amount_inr": invoice.total_amount,
            "workflow_status": invoice.status,
            "payment_status": invoice.payment_status,
        }
        for invoice in invoices if invoice.id in source_ids
    ]
    body = {
        "model": model,
        "temperature": 0,
        "messages": [
            {
                "role": "system",
                "content": "You are an invoice assistant. Rewrite the supplied database answer clearly and concisely. Treat the database answer and evidence as the only facts. Never add, infer, or change amounts, dates, names, counts, or statuses. If the evidence does not answer the question, say so.",
            },
            {
                "role": "user",
                "content": f"Question: {question}\nDatabase answer: {answer}\nInvoice evidence: {evidence}",
            },
        ],
    }
    with httpx.Client(timeout=30) as client:
        response = client.post(url, headers=headers, json=body)
        response.raise_for_status()
        refined = response.json()["choices"][0]["message"]["content"]
    if not isinstance(refined, str) or not refined.strip():
        raise ValueError("The configured AI service returned an empty chat answer.")
    return refined.strip()
