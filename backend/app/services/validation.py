from datetime import date

from ..models import Invoice, Vendor


def validate_invoice(invoice: Invoice, vendor: Vendor | None, existing: list[Invoice], ocr_warning: str | None = None) -> list[dict[str, str | None]]:
    findings: list[dict[str, str | None]] = []

    def add(kind: str, severity: str, message: str, expected: str | None = None, actual: str | None = None, related_invoice_id: str | None = None):
        findings.append({
            "validation_type": kind,
            "severity": severity,
            "message": message,
            "expected_value": expected,
            "actual_value": actual,
            "related_invoice_id": related_invoice_id,
            "status": "OPEN",
        })

    calculated_tax = invoice.cgst + invoice.sgst + invoice.igst
    if abs(calculated_tax - invoice.total_tax) > 0.02:
        add("GST_MISMATCH", "ERROR", "GST components do not match the extracted total tax.", f"{calculated_tax:.2f}", f"{invoice.total_tax:.2f}")
    expected_total = invoice.subtotal + invoice.total_tax
    if invoice.total_amount and abs(expected_total - invoice.total_amount) > max(1, invoice.total_amount * 0.01):
        add("CALCULATION_MISMATCH", "ERROR", "Subtotal plus tax does not match the invoice total.", f"{expected_total:.2f}", f"{invoice.total_amount:.2f}")
    if not vendor or not vendor.gstin:
        add("MISSING_GSTIN", "WARNING", "Vendor GSTIN is missing; verify tax registration.")
    if ocr_warning:
        add("OCR_UNAVAILABLE", "WARNING", ocr_warning)
    if not invoice.invoice_number or invoice.invoice_number.casefold() in {"needs review", "processing"} or invoice.invoice_number.startswith("READ-"):
        add("MISSING_INVOICE_NUMBER", "WARNING", "Invoice number could not be confidently identified.")
    if not invoice.invoice_date:
        add("MISSING_INVOICE_DATE", "WARNING", "Invoice date could not be confidently identified.")
    if invoice.total_amount <= 0:
        add("MISSING_TOTAL", "WARNING", "Invoice total could not be confidently identified.")
    if invoice.due_date and invoice.invoice_date and invoice.due_date < invoice.invoice_date:
        add("INVALID_DUE_DATE", "ERROR", "Due date is earlier than the invoice date.")
    for old in existing:
        if old.id == invoice.id:
            continue
        has_number = invoice.invoice_number.casefold() not in {"needs review", "processing"}
        if has_number and old.vendor_id == invoice.vendor_id and old.invoice_number.casefold() == invoice.invoice_number.casefold():
            add("POSSIBLE_DUPLICATE", "CRITICAL", f"Invoice number matches existing invoice {old.invoice_number}.", related_invoice_id=old.id)
            break
        same_vendor = old.vendor_id == invoice.vendor_id
        same_amount = abs(old.total_amount - invoice.total_amount) < 0.01
        similar_date = bool(old.invoice_date and invoice.invoice_date and abs((old.invoice_date - invoice.invoice_date).days) <= 7)
        if same_vendor and same_amount and similar_date:
            add("POSSIBLE_DUPLICATE", "WARNING", f"Similar vendor, amount and date to invoice {old.invoice_number}.", related_invoice_id=old.id)
            break
    if invoice.total_amount > 1_000_000:
        add("HIGH_AMOUNT", "WARNING", "Invoice amount is unusually high and should be reviewed.")
    for item in invoice.items:
        expected_tax = item.quantity * item.unit_price * item.tax_rate / 100
        if item.tax_rate and abs(expected_tax - item.tax_amount) > max(1, expected_tax * 0.02):
            add("GST_RATE_MISMATCH", "ERROR", f"GST for line item '{item.description}' does not match its stated rate.", f"{expected_tax:.2f}", f"{item.tax_amount:.2f}")
    if not findings:
        add("CHECKS_PASSED", "INFO", "Key invoice calculations and fields look consistent.")
    return findings
