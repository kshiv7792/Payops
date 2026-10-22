import os
import tempfile
import uuid
from pathlib import Path

import pymupdf
from fastapi.testclient import TestClient

test_root = Path(tempfile.gettempdir()) / f"invoiceai-tests-{uuid.uuid4().hex}"
test_root.mkdir()
os.environ["DATABASE_URL"] = f"sqlite:///{test_root / 'test.db'}"
os.environ["UPLOAD_DIR"] = str(test_root / "uploads")
os.environ["DEMO_EMAIL"] = "demo@invoiceai.local"
os.environ["DEMO_PASSWORD"] = "Demo@123"
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Invoice, User  # noqa: E402
from app.security import hash_password  # noqa: E402
from sqlalchemy import select  # noqa: E402


def login(client: TestClient, email: str = "demo@invoiceai.local", password: str = "Demo@123") -> str:
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def test_seeded_demo_and_chat_are_database_grounded():
    with TestClient(app) as client:
        token = login(client)
        headers = {"Authorization": f"Bearer {token}"}
        dashboard = client.get("/api/dashboard/summary", headers=headers)
        assert dashboard.status_code == 200
        assert dashboard.json()["summary"]["total_invoices"] == 28
        answer = client.post("/api/ai/chat", headers=headers, json={"message": "How many invoices are overdue?"})
        assert answer.status_code == 200
        assert "overdue invoices" in answer.json()["answer"]
        assert answer.json()["sources"]


def test_real_text_pdf_is_uploaded_extracted_and_validated():
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((60, 60), "ABC Supplies")
    page.insert_text((60, 85), "TAX INVOICE")
    page.insert_text((60, 110), "Invoice No: ABC-2026-001")
    page.insert_text((60, 135), "Invoice Date: 01/10/2026")
    page.insert_text((60, 160), "Due Date: 31/10/2026")
    page.insert_text((60, 185), "GSTIN: 27ABCDE1234F1Z5")
    page.insert_text((60, 210), "Subtotal: ₹1,000.00")
    page.insert_text((60, 235), "CGST @ 9% ₹90.00")
    page.insert_text((60, 260), "SGST @ 9% ₹90.00")
    page.insert_text((60, 285), "Total: ₹1,180.00")
    content = document.tobytes()
    document.close()
    with TestClient(app) as client:
        token = login(client)
        response = client.post(
            "/api/invoices/upload",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("invoice.pdf", content, "application/pdf")},
        )
        assert response.status_code == 201, response.text
        invoice = response.json()
        assert invoice["invoice_number"] == "ABC-2026-001"
        assert invoice["vendor_name"] == "ABC Supplies"
        assert invoice["total_amount"] == 1180, invoice
        assert invoice["extraction_mode"] == "DEMO_FALLBACK"
        assert invoice["file_url"].startswith("/api/invoices/")


def test_staff_role_cannot_approve_or_reset_demo():
    with TestClient(app) as client:
        with SessionLocal() as db:
            owner = db.scalar(select(User).where(User.email == "demo@invoiceai.local"))
            staff = User(
                name="Demo Staff",
                email="staff@invoiceai.local",
                password_hash=hash_password("Staff@123"),
                role="STAFF",
                company_id=owner.company_id,
            )
            db.add(staff)
            db.commit()
            invoice = db.scalar(select(Invoice).where(Invoice.company_id == owner.company_id))
            invoice_id = invoice.id
        token = login(client, "staff@invoiceai.local", "Staff@123")
        headers = {"Authorization": f"Bearer {token}"}
        assert client.post(f"/api/invoices/{invoice_id}/approve", headers=headers, json={}).status_code == 403
        assert client.post("/api/settings/reset-demo", headers=headers).status_code == 403
