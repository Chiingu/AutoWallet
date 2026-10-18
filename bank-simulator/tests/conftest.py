"""Bank simulator test setup.

Puts the simulator's own directory on the import path so tests can
`import main` (the app module lives one level above tests/).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
