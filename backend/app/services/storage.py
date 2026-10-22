import uuid
from pathlib import Path


class LocalFileStorage:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def save(self, contents: bytes, extension: str) -> str:
        stored_name = f"{uuid.uuid4().hex}{extension}"
        (self.root / stored_name).write_bytes(contents)
        return stored_name

    def resolve(self, stored_name: str) -> Path | None:
        path = (self.root / Path(stored_name).name).resolve()
        if path.parent != self.root or not path.is_file():
            return None
        return path
