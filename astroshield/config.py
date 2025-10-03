"""Configuration module for AstroShield.

Loads environment-backed configuration with sensible defaults suitable for a
hackathon deployment. Uses python-dotenv to enable `.env` files during local
runs while keeping runtime dependencies explicit.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import os

from dotenv import load_dotenv

# Load environment variables from a `.env` file if present.
load_dotenv(dotenv_path=Path.cwd() / ".env", override=False)


@dataclass(frozen=True)
class Settings:
    """Container for tunable runtime parameters."""

    debug: bool = bool(int(os.getenv("ASTROSHIELD_DEBUG", "1")))
    default_asteroid_id: str = os.getenv("ASTROSHIELD_ASTEROID_ID", "Impactor-2025")
    default_latitude: float = float(os.getenv("ASTROSHIELD_DEFAULT_LAT", "34.05"))
    default_longitude: float = float(os.getenv("ASTROSHIELD_DEFAULT_LON", "-118.25"))
    moid_threshold_km: float = float(os.getenv("ASTROSHIELD_MOID_THRESHOLD_KM", "75000"))
    simulation_sample_points: int = int(os.getenv("ASTROSHIELD_ORBIT_SAMPLES", "180"))
    nasa_api_key: str = os.getenv("NASA_API_KEY", "DEMO_KEY")
    use_live_apis: bool = bool(int(os.getenv("ASTROSHIELD_USE_LIVE_APIS", "1")))


def get_settings() -> Settings:
    """Factory returning immutable settings instance."""

    return Settings()
