import json
import os
import re
import shutil
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

import httpx

from ..schemas.extraction import InvoiceExtraction


class DocumentProcessingError(Exception):
    pass


def _azure_analyze(contents: bytes, content_type: str) -> dict[str, Any] | None:
    endpoint = os.getenv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT")
    key = os.getenv("AZURE_DOCUMENT_INTELLIGENCE_KEY")
    if not endpoint or not key:
        return None
    api_version = os.getenv("AZURE_DOCUMENT_INTELLIGENCE_API_VERSION", "2024-11-30")
    url = f"{endpoint.rstrip('/')}/documentintelligence/documentModels/prebuilt-invoice:analyze"
    headers = {"Ocp-Apim-Subscription-Key": key, "Content-Type": content_type}
    with httpx.Client(timeout=45) as client:
        response = client.post(url, params={"api-version": api_version}, headers=headers, content=contents)
        response.raise_for_status()
        operation_url = response.headers.get("operation-location")
        if not operation_url:
            raise DocumentProcessingError("Document Intelligence did not return an operation URL.")
        for _ in range(30):
            result = client.get(operation_url, headers={"Ocp-Apim-Subscription-Key": key})
            result.raise_for_status()
            payload = result.json()
            status = payload.get("status")
            if status == "succeeded":
                return _azure_fields(payload)
            if status == "failed":
                raise DocumentProcessingError("Azure Document Intelligence could not read this document.")
            time.sleep(1)
    raise DocumentProcessingError("Azure Document Intelligence timed out while reading this document.")


def _azure_fields(payload: dict[str, Any]) -> dict[str, Any]:
    fields = payload.get("analyzeResult", {}).get("documents", [{}])[0].get("fields", {})

    def value(name: str, default: Any = None) -> Any:
        field = fields.get(name, {})
        return field.get("valueString") or field.get("valueDate") or field.get("valueNumber") or default

    def money(name: str) -> float:
        field = fields.get(name, {}).get("valueCurrency", {})
        return float(field.get("amount") or fields.get(name, {}).get("valueNumber") or 0)

    items = []
    for item in fields.get("Items", {}).get("valueArray", []):
        row = item.get("valueObject", {})
        items.append({
            "description": row.get("Description", {}).get("valueString", "Item"),
            "quantity": row.get("Quantity", {}).get("valueNumber", 1),
            "unit_price": (row.get("UnitPrice", {}).get("valueCurrency") or {}).get("amount", 0),
            "tax_rate": 0,
            "tax_amount": (row.get("Tax", {}).get("valueCurrency") or {}).get("amount", 0),
            "total": (row.get("Amount", {}).get("valueCurrency") or {}).get("amount", 0),
        })
    return {
        "vendor_name": value("VendorName", "Unknown vendor"),
        "vendor_gstin": value("VendorTaxId"),
        "invoice_number": value("InvoiceId"),
        "invoice_date": value("InvoiceDate"),
        "due_date": value("DueDate"),
        "currency": (fields.get("InvoiceTotal", {}).get("valueCurrency") or {}).get("currencyCode", "INR"),
        "subtotal": money("SubTotal"),
        "cgst": 0,
        "sgst": 0,
        "igst": 0,
        "total_tax": money("TotalTax"),
        "total_amount": money("InvoiceTotal"),
        "payment_terms": value("PaymentTerm"),
        "items": items,
        "bank_details": {},
        "confidence": 0.93,
    }


def _ocr_text(contents: bytes, filename: str) -> tuple[str, str | None]:
    suffix = Path(filename).suffix.lower()
    try:
        import pymupdf
        from PIL import Image
        import pytesseract
    except ImportError:
        pymupdf = Image = pytesseract = None

    text = ""
    document_errors: tuple[type[Exception], ...] = (OSError,)
    ocr_errors: tuple[type[Exception], ...] = ()
    if pymupdf:
        document_errors += (pymupdf.FileDataError,)
    if pytesseract:
        ocr_errors = (pytesseract.TesseractError,)
    try:
        if suffix == ".pdf" and pymupdf:
            with pymupdf.open(stream=contents, filetype="pdf") as document:
                text = "\n".join(page.get_text() for page in document)
                if len(text.strip()) < 50 and pytesseract and shutil.which("tesseract"):
                    pages = [page.get_pixmap(matrix=pymupdf.Matrix(1.8, 1.8)) for page in document[:5]]
                    text = "\n".join(
                        pytesseract.image_to_string(Image.frombytes("RGB", [page.width, page.height], page.samples))
                        for page in pages
                    )
        elif suffix in {".png", ".jpg", ".jpeg"} and Image and pytesseract and shutil.which("tesseract"):
            image = Image.open(__import__("io").BytesIO(contents))
            text = pytesseract.image_to_string(image)
    except document_errors as exc:
        raise DocumentProcessingError("The uploaded document could not be opened. Check that it is a valid PDF or image.") from exc
    except ocr_errors as exc:
        raise DocumentProcessingError("OCR could not read this document. Review the file or configure Azure Document Intelligence.") from exc

    if text.strip():
        return text, None

    if suffix in {".png", ".jpg", ".jpeg"}:
        note = "No OCR engine is installed. Configure Azure Document Intelligence or Tesseract to read image-only invoices."
    elif suffix == ".pdf":
        note = "No readable PDF text found. Configure Azure Document Intelligence or Tesseract for scanned PDFs."
    else:
        note = "Could not extract readable text from this document."
    return "", note


def _date_value(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, date):
        return value.isoformat()
    raw = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d %b %Y", "%d %B %Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def _money(text: str, patterns: list[str]) -> float | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if match:
            value = match.group(1).replace(",", "").replace(" ", "")
            try:
                return float(value)
            except ValueError:
                continue
    return None


def _fallback_extract(text: str, filename: str) -> dict[str, Any]:
    clean = " ".join(text.split())
    def first(pattern: str, default: str = "") -> str:
        match = re.search(pattern, clean, re.IGNORECASE)
        return match.group(1).strip(" ,:") if match else default

    invoice_number = first(r"(?:invoice\s*(?:no\.?|number|#)|tax\s*invoice\s*(?:no\.?|#))\s*[:#-]?\s*([A-Z0-9/-]{3,})")
    vendor = first(r"^\s*([A-Z][A-Za-z0-9&.,' -]{2,}?)\s+(?:TAX\s+INVOICE|INVOICE|GSTIN)")
    gstin = first(r"\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9])\b")
    invoice_date_raw = first(r"(?:invoice\s*date|date)\s*[:#-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})")
    due_date_raw = first(r"(?:due\s*date|payment\s*due)\s*[:#-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})")
    amount = r"[^0-9\r\n]{0,20}([\d,]+(?:\.\d{1,2})?)"
    subtotal = _money(clean, [r"(?:sub[\s-]?total|taxable\s*(?:value|amount))" + amount])
    cgst = _money(clean, [r"CGST(?:\s*@\s*\d+%?)?" + amount]) or 0
    sgst = _money(clean, [r"SGST(?:\s*@\s*\d+%?)?" + amount]) or 0
    igst = _money(clean, [r"IGST(?:\s*@\s*\d+%?)?" + amount]) or 0
    total = _money(clean, [r"(?<![A-Za-z])(?:grand\s*total|total\s*amount|invoice\s*total|amount\s*due|total(?!\s*tax))" + amount])
    if not total:
        amounts = [float(value.replace(",", "")) for value in re.findall(r"(?:₹|INR)\s*([\d,]+\.\d{2})", clean, re.IGNORECASE)]
        total = max(amounts, default=0)
    subtotal = subtotal if subtotal is not None else max(0, (total or 0) - cgst - sgst - igst)
    return {
        "vendor_name": vendor or "Unknown vendor",
        "vendor_gstin": gstin or None,
        "invoice_number": invoice_number or "Needs review",
        "invoice_date": _date_value(invoice_date_raw),
        "due_date": _date_value(due_date_raw),
        "currency": "INR",
        "subtotal": round(subtotal, 2),
        "cgst": round(cgst, 2),
        "sgst": round(sgst, 2),
        "igst": round(igst, 2),
        "total_tax": round(cgst + sgst + igst, 2),
        "total_amount": round(total or subtotal + cgst + sgst + igst, 2),
        "payment_terms": "",
        "items": [],
        "bank_details": {},
        "confidence": 0.45 if text.strip() else 0.1,
    }


def _llm_extract(text: str, filename: str) -> dict[str, Any] | None:
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("AZURE_OPENAI_API_KEY")
    if not api_key:
        return None
    url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/") + "/chat/completions"
    if os.getenv("AZURE_OPENAI_ENDPOINT"):
        url = os.getenv("AZURE_OPENAI_ENDPOINT", "").rstrip("/") + "/openai/deployments/" + os.getenv("AZURE_OPENAI_DEPLOYMENT", "")
        url += "/chat/completions?api-version=" + os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21")
    model = os.getenv("OPENAI_MODEL") or os.getenv("AZURE_OPENAI_DEPLOYMENT") or "gpt-4o-mini"
    headers = {"Content-Type": "application/json"}
    headers["api-key" if os.getenv("AZURE_OPENAI_ENDPOINT") else "Authorization"] = (
        api_key if os.getenv("AZURE_OPENAI_ENDPOINT") else f"Bearer {api_key}"
    )
    schema = {
        "vendor_name": "string", "vendor_gstin": "string|null", "invoice_number": "string",
        "invoice_date": "YYYY-MM-DD|null", "due_date": "YYYY-MM-DD|null", "currency": "string",
        "subtotal": "number", "cgst": "number", "sgst": "number", "igst": "number",
        "total_tax": "number", "total_amount": "number", "payment_terms": "string",
        "items": [{"description": "string", "quantity": "number", "unit_price": "number", "tax_rate": "number", "tax_amount": "number", "total": "number"}],
        "bank_details": {"account_name": "string", "account_number": "string", "ifsc": "string", "bank_name": "string"},
        "confidence": "number between 0 and 1",
    }
    body = {
        "model": model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": "Extract only facts visible in the invoice. Never invent missing values; use null, empty strings, or 0. Return JSON matching the supplied structure. Dates must be ISO 8601."},
            {"role": "user", "content": f"Expected JSON fields: {json.dumps(schema)}\nFilename: {filename}\nInvoice text:\n{text[:24000]}"},
        ],
    }
    with httpx.Client(timeout=45) as client:
        response = client.post(url, headers=headers, json=body)
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
    result = json.loads(content)
    result["invoice_date"] = _date_value(result.get("invoice_date"))
    result["due_date"] = _date_value(result.get("due_date"))
    result["confidence"] = max(0, min(float(result.get("confidence", 0.7)), 1))
    return result


def extract_invoice(contents: bytes, filename: str, content_type: str) -> tuple[dict[str, Any], str, str | None]:
    azure = _azure_analyze(contents, content_type)
    if azure:
        return InvoiceExtraction.model_validate(azure).model_dump(mode="json"), "AZURE_DOCUMENT_INTELLIGENCE", None
    text, warning = _ocr_text(contents, filename)
    ai_result = _llm_extract(text, filename) if text else None
    if ai_result:
        return InvoiceExtraction.model_validate(ai_result).model_dump(mode="json"), "OPENAI", warning
    return InvoiceExtraction.model_validate(_fallback_extract(text, filename)).model_dump(mode="json"), "DEMO_FALLBACK", warning
