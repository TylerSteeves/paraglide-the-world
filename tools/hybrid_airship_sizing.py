#!/usr/bin/env python3
"""Run first-pass sizing sweeps for the hybrid hydrogen airship reference.

This intentionally stays small and dependency-free so it can run on a fresh Mac
without SciPy or PyYAML.
"""

from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path
from typing import Any


def parse_scalar(raw: str) -> Any:
    value = raw.strip()
    if value in {"", "null", "Null", "NULL"}:
        return None
    if value in {"true", "True"}:
        return True
    if value in {"false", "False"}:
        return False
    if value.startswith('"') and value.endswith('"'):
        return value[1:-1]
    try:
        if any(ch in value for ch in (".", "e", "E")):
            return float(value)
        return int(value)
    except ValueError:
        return value


def parse_simple_yaml(path: Path) -> dict[str, Any]:
    root: dict[str, Any] = {}
    stack: list[tuple[int, dict[str, Any]]] = [(-1, root)]
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        key, _, remainder = line.strip().partition(":")
        while stack and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]
        if remainder.strip() == "":
            node: dict[str, Any] = {}
            parent[key] = node
            stack.append((indent, node))
        else:
            parent[key] = parse_scalar(remainder)
    return root


def isa_atmosphere(altitude_m: float, atmosphere: dict[str, Any]) -> dict[str, float]:
    t0 = float(atmosphere["sea_level_temperature_k"])
    p0 = float(atmosphere["sea_level_pressure_pa"])
    lapse = float(atmosphere["lapse_rate_k_per_m"])
    gas_constant = float(atmosphere["gas_constant_air_j_per_kgk"])
    gravity = float(atmosphere["gravity_m_per_s2"])

    temperature = t0 - lapse * altitude_m
    pressure = p0 * (temperature / t0) ** (gravity / (gas_constant * lapse))
    density = pressure / (gas_constant * temperature)
    return {
        "temperature_k": temperature,
        "pressure_pa": pressure,
        "density_kg_per_m3": density,
    }


def dynamic_pressure(density: float, speed_mps: float) -> float:
    return 0.5 * density * speed_mps * speed_mps


def buoyant_lift_kg(
    density_air: float,
    density_h2: float,
    volume_m3: float,
) -> float:
    return (density_air - density_h2) * volume_m3


def wing_loading(gross_mass_kg: float, wing_area_m2: float) -> float:
    return gross_mass_kg / wing_area_m2


def required_wing_area(
    wing_supported_mass_kg: float,
    density: float,
    speed_mps: float,
    cl: float,
) -> float:
    lift_n = wing_supported_mass_kg * 9.80665
    return lift_n / max(dynamic_pressure(density, speed_mps) * cl, 1e-9)


def required_cl(
    wing_supported_mass_kg: float,
    density: float,
    speed_mps: float,
    wing_area_m2: float,
) -> float:
    lift_n = wing_supported_mass_kg * 9.80665
    return lift_n / max(dynamic_pressure(density, speed_mps) * wing_area_m2, 1e-9)


def membrane_section_area_coefficient(
    thickness_ratio: float,
    thickness_power: float,
    samples: int = 4000,
) -> float:
    total = 0.0
    for index in range(samples):
        x = (index + 0.5) / samples
        thickness = thickness_ratio * (math.sin(math.pi * x) ** thickness_power)
        total += thickness
    return total / samples


def estimate_wing_gas_volume_m3(geometry: dict[str, Any]) -> float:
    span = float(geometry["wing_span_m"])
    half_span = 0.5 * span
    root_chord = float(geometry["wing_root_chord_m"])
    tip_chord = float(geometry["wing_tip_chord_m"])
    mid_span = 0.55 * half_span
    mid_chord = root_chord + (tip_chord - root_chord) * (mid_span / half_span)
    thickness_power = float(geometry["wing_membrane_profile_exponent"])

    specs = (
        (0.0, root_chord, float(geometry["wing_root_thickness_ratio"])),
        (mid_span, mid_chord, float(geometry["wing_mid_thickness_ratio"])),
        (half_span, tip_chord, float(geometry["wing_tip_thickness_ratio"])),
    )
    section_areas = [
        membrane_section_area_coefficient(thickness_ratio, thickness_power) * chord * chord
        for _, chord, thickness_ratio in specs
    ]
    return 2.0 * (
        mid_span * (section_areas[0] + section_areas[1]) * 0.5
        + (half_span - mid_span) * (section_areas[1] + section_areas[2]) * 0.5
    )


def sweep_rows(reference: dict[str, Any]) -> list[dict[str, float]]:
    geometry = reference["geometry"]
    design_targets = reference["design_targets"]
    atmosphere = reference["atmosphere"]

    gross_mass_kg = float(design_targets["gross_mass_kg"])
    wing_fraction = float(design_targets["wing_lift_fraction_of_weight"])
    wing_supported_mass_kg = gross_mass_kg * wing_fraction
    wing_area_m2 = float(geometry["wing_area_m2"])
    density_h2 = float(atmosphere["hydrogen_density_kg_per_m3"])
    hull_volume_m3 = float(geometry["hull_volume_m3"])
    wing_gas_volume_m3 = estimate_wing_gas_volume_m3(geometry)

    rows: list[dict[str, float]] = []
    for altitude_m in (0.0, 1000.0, 2000.0, 3000.0):
        isa = isa_atmosphere(altitude_m, atmosphere)
        density = isa["density_kg_per_m3"]
        buoyancy_kg = buoyant_lift_kg(density, density_h2, hull_volume_m3)
        wing_gas_lift_kg = buoyant_lift_kg(density, density_h2, wing_gas_volume_m3)
        for speed_mps in (15.0, 20.0, 25.0, 30.0, 35.0):
            q = dynamic_pressure(density, speed_mps)
            wing_area_for_cl_05 = required_wing_area(
                wing_supported_mass_kg,
                density,
                speed_mps,
                cl=0.5,
            )
            rows.append(
                {
                    "altitude_m": altitude_m,
                    "speed_mps": speed_mps,
                    "density_kg_per_m3": density,
                    "dynamic_pressure_pa": q,
                    "buoyant_lift_kg": buoyancy_kg,
                    "wing_gas_volume_m3": wing_gas_volume_m3,
                    "wing_gas_lift_kg": wing_gas_lift_kg,
                    "total_static_lift_kg": buoyancy_kg + wing_gas_lift_kg,
                    "wing_loading_kg_per_m2": wing_loading(gross_mass_kg, wing_area_m2),
                    "required_cl_for_current_wing_area": required_cl(
                        wing_supported_mass_kg,
                        density,
                        speed_mps,
                        wing_area_m2,
                    ),
                    "required_wing_area_at_cl_0_5_m2": wing_area_for_cl_05,
                }
            )
    return rows


def write_csv(path: Path, rows: list[dict[str, float]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(rows[0].keys())
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def print_summary(reference: dict[str, Any], rows: list[dict[str, float]]) -> None:
    geometry = reference["geometry"]
    design_targets = reference["design_targets"]
    atmosphere = reference["atmosphere"]
    gross_mass_kg = float(design_targets["gross_mass_kg"])
    wing_fraction = float(design_targets["wing_lift_fraction_of_weight"])
    wing_gas_volume_m3 = estimate_wing_gas_volume_m3(geometry)
    hydrogen_density = float(atmosphere["hydrogen_density_kg_per_m3"])
    wing_hydrogen_mass_kg = wing_gas_volume_m3 * hydrogen_density
    wing_hydrogen_energy_kwh = wing_hydrogen_mass_kg * 120.0 / 3.6

    print("Hybrid hydrogen airship sizing summary")
    print(f"  Hull volume: {geometry['hull_volume_m3']} m^3")
    print(
        f"  Hull dimensions: {geometry['hull_length_m']} m x {geometry['hull_max_diameter_m']} m"
    )
    print(
        f"  Wing: span {geometry['wing_span_m']} m, area {geometry['wing_area_m2']} m^2, AR {geometry['wing_aspect_ratio']}"
    )
    print(
        "  Wing gas-cell section:"
        f" t/c root {geometry['wing_root_thickness_ratio']},"
        f" mid {geometry['wing_mid_thickness_ratio']},"
        f" tip {geometry['wing_tip_thickness_ratio']}"
    )
    print(
        f"  Gross mass: {gross_mass_kg:.1f} kg, target wing-supported mass: {gross_mass_kg * wing_fraction:.1f} kg"
    )
    sea_level_cruise = next(
        row for row in rows if math.isclose(row["altitude_m"], 0.0) and math.isclose(row["speed_mps"], 25.0)
    )
    print(
        f"  Sea-level buoyant lift: {sea_level_cruise['buoyant_lift_kg']:.1f} kg"
    )
    print(
        f"  Estimated wing gas volume: {wing_gas_volume_m3:.1f} m^3"
    )
    print(
        f"  Sea-level wing gas lift: {sea_level_cruise['wing_gas_lift_kg']:.1f} kg"
    )
    print(
        f"  Hydrogen stored in wing cells: {wing_hydrogen_mass_kg:.1f} kg ({wing_hydrogen_energy_kwh:.1f} kWh LHV)"
    )
    print(
        f"  Sea-level cruise dynamic pressure at 25 m/s: {sea_level_cruise['dynamic_pressure_pa']:.1f} Pa"
    )
    print(
        f"  Required CL for current wing area at 25 m/s: {sea_level_cruise['required_cl_for_current_wing_area']:.3f}"
    )
    print(
        f"  Required wing area for CL=0.5 at 25 m/s: {sea_level_cruise['required_wing_area_at_cl_0_5_m2']:.1f} m^2"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--reference",
        type=Path,
        default=Path("data/hybrid_airship_reference.yaml"),
        help="Path to the YAML reference data file.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("generated/hybrid_airship_sizing.csv"),
        help="CSV output path.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    reference = parse_simple_yaml(args.reference)
    rows = sweep_rows(reference)
    write_csv(args.out, rows)
    print_summary(reference, rows)
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
