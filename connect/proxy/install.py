"""Register the drop-in AGE driver in the pinned, disposable proxy checkout."""
from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1]) / "src/graphxr_database_proxy"
here = Path(__file__).parent
for name in ("age_driver.py", "age_values.py"):
    shutil.copyfile(here / name, root / "drivers" / name)

def patch(path, before, after):
    text = path.read_text()
    if after in text:
        return
    if text.count(before) != 1:
        raise SystemExit(f"Pinned proxy contract changed: {path.name}; refusing to patch")
    path.write_text(text.replace(before, after, 1))

patch(root / "models/project.py", '    SPANNER = "spanner"', '    AGE = "age"\n    SPANNER = "spanner"')
patch(root / "drivers/factory.py", "from .base import BaseDatabaseDriver", "from .base import BaseDatabaseDriver\nfrom .age_driver import AgeDriver")
patch(root / "drivers/factory.py", "DatabaseType.SPANNER: SpannerDriver,", "DatabaseType.AGE: AgeDriver,\n        DatabaseType.SPANNER: SpannerDriver,")

# The locked Starlette version implements PNA itself and rejects it by default.
# Upstream's outer middleware adds a header but cannot undo that 400 response.
patch(root / "main.py", '    allow_origins=["*"],', '    allow_private_network=True,\n    allow_origins=["*"],')
