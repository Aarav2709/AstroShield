"""Backend package for AstroShield.

Exposes utility factories for physics calculations and data acquisition.
"""
from __future__ import annotations

from .data_mock import MockDataManager
from .physics_engine import (
    calculate_crater_scaling,
    calculate_kinetic_energy,
    calculate_seismic_magnitude,
    simulate_orbital_change,
)

__all__ = [
    "MockDataManager",
    "calculate_kinetic_energy",
    "calculate_crater_scaling",
    "calculate_seismic_magnitude",
    "simulate_orbital_change",
]
