#!/usr/bin/env python3
"""Generate a coarse OBJ mesh for a hybrid hydrogen airship concept.

The reference geometry follows the first-principles design point developed in
this thread:

- Buoyant hull volume: 45,000 m^3
- Hull shape: near-prolate body, fineness ratio 4.7
- Hull dimensions: 123.8 m long x 26.35 m max diameter
- Wing planform: AR 15, area 350 m^2, span 72.5 m, taper 0.32
- Wing type: inflated membrane gas-cell wing with thick buoyant sections

Coordinates use meters with +x forward, +y starboard, +z up.
"""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Vec3:
    x: float
    y: float
    z: float


@dataclass(frozen=True)
class WingSectionSpec:
    span_y: float
    chord: float
    camber_ratio: float
    thickness_ratio: float
    twist_deg: float


@dataclass(frozen=True)
class WingVariant:
    name: str
    dihedral_deg: float
    quarter_chord_root_x: float
    quarter_chord_sweep_deg: float
    thickness_power: float
    sections: tuple[WingSectionSpec, ...]


class Mesh:
    def __init__(self) -> None:
        self.vertices: list[Vec3] = []
        self.faces: list[tuple[int, int, int]] = []

    def add_vertex(self, point: Vec3) -> int:
        self.vertices.append(point)
        return len(self.vertices)

    def add_face(self, a: int, b: int, c: int) -> None:
        self.faces.append((a, b, c))

    def add_quad(self, a: int, b: int, c: int, d: int) -> None:
        self.add_face(a, b, c)
        self.add_face(a, c, d)

    def write_obj(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as handle:
            handle.write("# Hybrid hydrogen airship reference geometry\n")
            for vertex in self.vertices:
                handle.write(f"v {vertex.x:.6f} {vertex.y:.6f} {vertex.z:.6f}\n")
            for face in self.faces:
                handle.write(f"f {face[0]} {face[1]} {face[2]}\n")


def cosine_spacing(samples: int) -> list[float]:
    return [0.5 * (1.0 - math.cos(math.pi * i / (samples - 1))) for i in range(samples)]


def inflated_membrane_profile(
    camber_ratio: float,
    thickness_ratio: float,
    samples: int = 56,
    thickness_power: float = 0.82,
) -> list[tuple[float, float]]:
    upper: list[tuple[float, float]] = []
    lower: list[tuple[float, float]] = []
    for x in cosine_spacing(samples):
        camber = camber_ratio * math.sin(math.pi * x) * (1.0 - 0.22 * x)
        thickness = thickness_ratio * (math.sin(math.pi * x) ** thickness_power)
        upper.append((x, camber + 0.5 * thickness))
        lower.append((x, camber - 0.5 * thickness))
    return list(reversed(upper)) + lower[1:]


def rotate_pitch(x: float, z: float, angle_deg: float, pivot_x: float) -> tuple[float, float]:
    angle = math.radians(angle_deg)
    dx = x - pivot_x
    x_rot = pivot_x + dx * math.cos(angle) + z * math.sin(angle)
    z_rot = -dx * math.sin(angle) + z * math.cos(angle)
    return x_rot, z_rot


def transform_airfoil_section(
    profile: list[tuple[float, float]],
    chord: float,
    leading_edge_x: float,
    span_y: float,
    base_z: float,
    twist_deg: float,
) -> list[Vec3]:
    pivot_x = 0.25 * chord
    points: list[Vec3] = []
    for x_unit, z_unit in profile:
        x_local = x_unit * chord
        z_local = z_unit * chord
        x_rot, z_rot = rotate_pitch(x_local, z_local, twist_deg, pivot_x)
        points.append(Vec3(leading_edge_x + x_rot, span_y, base_z + z_rot))
    return points


def add_section(mesh: Mesh, section: list[Vec3]) -> list[int]:
    return [mesh.add_vertex(point) for point in section]


def loft_sections(mesh: Mesh, section_a: list[int], section_b: list[int]) -> None:
    count = len(section_a)
    for index in range(count):
        a0 = section_a[index]
        a1 = section_a[(index + 1) % count]
        b0 = section_b[index]
        b1 = section_b[(index + 1) % count]
        mesh.add_quad(a0, a1, b1, b0)


def cap_section(mesh: Mesh, section: list[int], reverse: bool) -> None:
    center = Vec3(
        sum(mesh.vertices[index - 1].x for index in section) / len(section),
        sum(mesh.vertices[index - 1].y for index in section) / len(section),
        sum(mesh.vertices[index - 1].z for index in section) / len(section),
    )
    center_index = mesh.add_vertex(center)
    for index in range(len(section)):
        a = section[index]
        b = section[(index + 1) % len(section)]
        if reverse:
            mesh.add_face(center_index, b, a)
        else:
            mesh.add_face(center_index, a, b)


def membrane_section_area_coefficient(
    thickness_ratio: float,
    thickness_power: float = 0.82,
    samples: int = 4000,
) -> float:
    total = 0.0
    for index in range(samples):
        x = (index + 0.5) / samples
        total += thickness_ratio * (math.sin(math.pi * x) ** thickness_power)
    return total / samples


def wing_planform_area(half_sections: tuple[WingSectionSpec, ...]) -> float:
    area_half = 0.0
    for section_a, section_b in zip(half_sections, half_sections[1:]):
        area_half += (section_b.span_y - section_a.span_y) * (
            section_a.chord + section_b.chord
        ) * 0.5
    return area_half * 2.0


def wing_aspect_ratio(half_sections: tuple[WingSectionSpec, ...]) -> float:
    span = half_sections[-1].span_y * 2.0
    return span * span / wing_planform_area(half_sections)


def build_wing_variants() -> dict[str, WingVariant]:
    baseline_span = 72.5
    baseline_half = baseline_span * 0.5
    baseline_area = 350.0
    baseline_taper = 0.32
    baseline_root = 2.0 * baseline_area / (baseline_span * (1.0 + baseline_taper))
    baseline_tip = baseline_taper * baseline_root
    baseline_mid_span = 0.55 * baseline_half
    baseline_mid = baseline_root + (baseline_tip - baseline_root) * (
        baseline_mid_span / baseline_half
    )

    return {
        "baseline": WingVariant(
            name="baseline gas wing",
            dihedral_deg=3.5,
            quarter_chord_root_x=-5.0,
            quarter_chord_sweep_deg=12.0,
            thickness_power=0.82,
            sections=(
                WingSectionSpec(0.0, baseline_root, 0.08, 0.40, 0.4),
                WingSectionSpec(baseline_mid_span, baseline_mid, 0.06, 0.30, -1.1),
                WingSectionSpec(baseline_half, baseline_tip, 0.04, 0.22, -2.6),
            ),
        ),
        "humpback": WingVariant(
            name="humpback shoulder blend",
            dihedral_deg=3.0,
            quarter_chord_root_x=-7.5,
            quarter_chord_sweep_deg=16.0,
            thickness_power=0.82,
            sections=(
                WingSectionSpec(0.0, 12.0, 0.10, 0.58, 0.8),
                WingSectionSpec(8.0, 10.0, 0.08, 0.48, 0.2),
                WingSectionSpec(22.0, 5.2, 0.05, 0.30, -1.4),
                WingSectionSpec(36.25, 2.4, 0.03, 0.20, -3.0),
            ),
        ),
        "bowhead": WingVariant(
            name="bowhead blended centerbody",
            dihedral_deg=2.5,
            quarter_chord_root_x=-9.5,
            quarter_chord_sweep_deg=18.0,
            thickness_power=0.82,
            sections=(
                WingSectionSpec(0.0, 16.0, 0.12, 0.70, 1.0),
                WingSectionSpec(10.0, 13.0, 0.09, 0.55, 0.0),
                WingSectionSpec(24.0, 5.8, 0.05, 0.30, -1.6),
                WingSectionSpec(36.25, 2.5, 0.03, 0.18, -3.2),
            ),
        ),
        "manta": WingVariant(
            name="manta-whale blended body",
            dihedral_deg=2.0,
            quarter_chord_root_x=-11.5,
            quarter_chord_sweep_deg=20.0,
            thickness_power=0.82,
            sections=(
                WingSectionSpec(0.0, 20.0, 0.13, 0.78, 1.0),
                WingSectionSpec(12.0, 15.0, 0.10, 0.60, 0.0),
                WingSectionSpec(24.0, 7.0, 0.06, 0.35, -1.8),
                WingSectionSpec(36.25, 3.2, 0.03, 0.22, -3.4),
            ),
        ),
    }


def add_body(mesh: Mesh, length: float, diameter: float, center: Vec3, long_steps: int = 44, circ_steps: int = 56) -> None:
    nose = mesh.add_vertex(Vec3(center.x - 0.5 * length, center.y, center.z))
    tail = mesh.add_vertex(Vec3(center.x + 0.5 * length, center.y, center.z))
    rings: list[list[int]] = []
    radius = 0.5 * diameter
    for step in range(1, long_steps):
        u = -1.0 + 2.0 * step / long_steps
        x = center.x + 0.5 * length * u
        r = radius * math.sqrt(max(0.0, 1.0 - u * u))
        ring: list[int] = []
        for seg in range(circ_steps):
            theta = 2.0 * math.pi * seg / circ_steps
            y = center.y + r * math.cos(theta)
            z = center.z + r * math.sin(theta)
            ring.append(mesh.add_vertex(Vec3(x, y, z)))
        rings.append(ring)
    first_ring = rings[0]
    for seg in range(circ_steps):
        mesh.add_face(nose, first_ring[(seg + 1) % circ_steps], first_ring[seg])
    for ring_a, ring_b in zip(rings, rings[1:]):
        loft_sections(mesh, ring_a, ring_b)
    last_ring = rings[-1]
    for seg in range(circ_steps):
        mesh.add_face(tail, last_ring[seg], last_ring[(seg + 1) % circ_steps])


def add_wing(mesh: Mesh, variant: WingVariant) -> float:
    thickness_power = variant.thickness_power

    def station(
        span_y: float,
        chord: float,
        camber_ratio: float,
        thickness_ratio: float,
        twist_deg: float,
    ) -> list[Vec3]:
        quarter_chord_x = variant.quarter_chord_root_x + math.tan(
            math.radians(variant.quarter_chord_sweep_deg)
        ) * abs(span_y)
        leading_edge_x = quarter_chord_x - 0.25 * chord
        base_z = math.tan(math.radians(variant.dihedral_deg)) * abs(span_y)
        return transform_airfoil_section(
            inflated_membrane_profile(
                camber_ratio=camber_ratio,
                thickness_ratio=thickness_ratio,
                thickness_power=thickness_power,
            ),
            chord=chord,
            leading_edge_x=leading_edge_x,
            span_y=span_y,
            base_z=base_z,
            twist_deg=twist_deg,
        )

    right_sections = [
        add_section(
            mesh,
            station(
                span_y=spec.span_y,
                chord=spec.chord,
                camber_ratio=spec.camber_ratio,
                thickness_ratio=spec.thickness_ratio,
                twist_deg=spec.twist_deg,
            ),
        )
        for spec in variant.sections
    ]
    left_sections = [
        add_section(
            mesh,
            station(
                span_y=-spec.span_y,
                chord=spec.chord,
                camber_ratio=spec.camber_ratio,
                thickness_ratio=spec.thickness_ratio,
                twist_deg=spec.twist_deg,
            ),
        )
        for spec in variant.sections
    ]

    loft_sections(mesh, right_sections[0], right_sections[1])
    loft_sections(mesh, right_sections[1], right_sections[2])
    loft_sections(mesh, left_sections[0], left_sections[1])
    loft_sections(mesh, left_sections[1], left_sections[2])
    cap_section(mesh, right_sections[-1], reverse=False)
    cap_section(mesh, left_sections[-1], reverse=True)

    section_areas = [
        membrane_section_area_coefficient(
            thickness_ratio=spec.thickness_ratio,
            thickness_power=thickness_power,
        )
        * spec.chord * spec.chord
        for spec in variant.sections
    ]
    mid_spans = [spec.span_y for spec in variant.sections]
    wing_gas_volume = 2.0 * (
        sum(
            (y1 - y0) * (a0 + a1) * 0.5
            for y0, y1, a0, a1 in zip(
                mid_spans,
                mid_spans[1:],
                section_areas,
                section_areas[1:],
            )
        )
    )
    return wing_gas_volume


def add_keel_pod(mesh: Mesh) -> None:
    add_body(
        mesh,
        length=30.0,
        diameter=6.0,
        center=Vec3(5.0, 0.0, -17.0),
        long_steps=18,
        circ_steps=28,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("generated/hybrid_airship_reference.obj"),
        help="Path to the OBJ file to create.",
    )
    parser.add_argument(
        "--variant",
        choices=sorted(build_wing_variants().keys()),
        default="baseline",
        help="Wing morphology preset to generate.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    variants = build_wing_variants()
    variant = variants[args.variant]
    mesh = Mesh()
    add_body(
        mesh,
        length=123.8235361552909,
        diameter=26.345433224529977,
        center=Vec3(0.0, 0.0, 0.0),
    )
    wing_gas_volume = add_wing(mesh, variant)
    add_keel_pod(mesh)
    mesh.write_obj(args.out)
    print(f"Wrote {args.out}")
    print("Reference hull: 123.8 m x 26.35 m, 45,000 m^3 equivalent")
    print(
        f"Wing variant: {variant.name}, area {wing_planform_area(variant.sections):.1f} m^2, "
        f"AR {wing_aspect_ratio(variant.sections):.2f}"
    )
    print(f"Estimated wing gas volume: {wing_gas_volume:.1f} m^3")


if __name__ == "__main__":
    main()
