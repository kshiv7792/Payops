import hashlib
import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pymupdf
from fastapi.testclient import TestClient
from sqlalchemy import select

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
from app.models import AuthSession, Invoice, User  # noqa: E402
from app.security import hash_password  # noqa: E402


def login(client: TestClient, email: str = "demo@invoiceai.local", password: str = "Demo@123") -> str:
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def test_login_creates_hashed_sessions_and_supports_multiple_devices():
    with TestClient(app) as client:
        first_response = client.post(
            "/api/auth/login",
            json={"email": "demo@invoiceai.local", "password": "Demo@123"},
        )
        assert first_response.status_code == 200, first_response.text
        first_token = first_response.json()["access_token"]
        assert first_response.json()["token_type"] == "bearer"

        second_token = login(client)
        assert second_token != first_token

        with SessionLocal() as db:
            first_session = db.scalar(
                select(AuthSession).where(
                    AuthSession.token_hash == hashlib.sha256(first_token.encode()).hexdigest()
                )
            )
            second_session = db.scalar(
                select(AuthSession).where(
                    AuthSession.token_hash == hashlib.sha256(second_token.encode()).hexdigest()
                )
            )
            assert first_session is not None
            assert second_session is not None
            assert isinstance(first_session.id, int)
            assert first_session.user_id == second_session.user_id
            assert first_session.token_hash != first_token
            assert second_session.token_hash != second_token
            assert first_session.expires_at is not None
            assert len(first_session.token_hash) == 64

            session_columns = AuthSession.__table__.c
            assert session_columns.id.type.python_type is int
            assert session_columns.user_id.type.python_type is str
            user_id_fk = next(iter(session_columns.user_id.foreign_keys))
            assert user_id_fk.target_fullname == "users.id"
            assert session_columns.token_hash.type.length == 128
            assert session_columns.created_at.type.timezone is True
            assert session_columns.expires_at.type.timezone is True

        first_headers = {"Authorization": f"Bearer {first_token}"}
        second_headers = {"Authorization": f"Bearer {second_token}"}
        assert client.post("/api/auth/logout", headers=first_headers).status_code == 200
        assert client.get("/api/auth/me", headers=first_headers).status_code == 401
        assert client.get("/api/auth/me", headers=second_headers).status_code == 200


def test_session_protection_expiry_logout_and_health():
    with TestClient(app) as client:
        token = login(client)
        headers = {"Authorization": f"Bearer {token}"}
        assert client.get("/api/invoices?page=1", headers=headers).status_code == 200
        assert client.get("/api/dashboard/summary", headers=headers).status_code == 200
        assert client.get("/api/health").status_code == 200
        assert client.get(
            "/api/invoices?page=1",
            headers={"Authorization": "Bearer invalid-session-token"},
        ).status_code == 401

        with SessionLocal() as db:
            auth_session = db.scalar(
                select(AuthSession).where(
                    AuthSession.token_hash == hashlib.sha256(token.encode()).hexdigest()
                )
            )
            assert auth_session is not None
            auth_session.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
            db.commit()
        assert client.get("/api/auth/me", headers=headers).status_code == 401

        other_token = login(client)
        other_headers = {"Authorization": f"Bearer {other_token}"}
        response = client.post("/api/auth/logout", headers=other_headers)
        assert response.status_code == 200
        assert client.get("/api/auth/me", headers=other_headers).status_code == 401

        active_token = login(client)
        assert client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {active_token}"},
        ).status_code == 200


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
