import { Effect } from '@babylonjs/core/Materials/effect'
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import { Scene } from '@babylonjs/core/scene'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { LnPalette, LnStyleManager } from './LnStyleManager'

const VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec3 normal;
attribute vec4 color;

uniform mat4 world;
uniform mat4 worldViewProjection;

varying vec3 vPositionW;
varying vec3 vNormalW;
varying vec4 vColor;

void main(void) {
    vec4 worldPos = world * vec4(position, 1.0);
    vPositionW = worldPos.xyz;
    vNormalW = normalize(mat3(world) * normal);
    vColor = color;
    gl_Position = worldViewProjection * vec4(position, 1.0);
}
`

const FRAGMENT_SHADER = `
precision highp float;

varying vec3 vPositionW;
varying vec3 vNormalW;
varying vec4 vColor;

uniform vec3 uCameraPos;
uniform vec3 uLightDir;
uniform vec3 uBackgroundColor;
uniform vec3 uTerrainBaseColor;
uniform vec3 uMinorContourColor;
uniform vec3 uMajorContourColor;
uniform float uMinorInterval;
uniform float uMajorInterval;
uniform float uLongitudinalSpacing;
uniform float uFogDensity;
uniform float uIsLineMode;
uniform float uIsIrVision;

void main(void) {
    // 0. Compute Authentic Infrared Thermal Heat Signature
    vec3 flirColor = uTerrainBaseColor;
    if (uIsIrVision > 0.5) {
        vec3 light = normalize(uLightDir);
        float sunHeat = max(0.0, dot(vNormalW, light));

        // Ground thermal trigger heat signatures:
        // A. Solar Farm Array (-500, 2400)
        float dSolar = length(vPositionW.xz - vec2(-500.0, 2400.0));
        float solarHot = 1.0 - smoothstep(120.0, 320.0, dSolar);

        // B. Industrial Warehouse District (300, 1400)
        float dInd = length(vPositionW.xz - vec2(300.0, 1400.0));
        float indHot = 1.0 - smoothstep(90.0, 260.0, dInd);

        // C. Sun-facing mountain launch wall (altitude & direct sun angle)
        float ridgeHot = smoothstep(1150.0, 1850.0, vPositionW.y) * sunHeat;

        // D. Río Cauca cool river depression at x = 1200
        float riverCool = 1.0 - smoothstep(40.0, 180.0, abs(vPositionW.x - 1200.0));

        // Radiometric surface temperature [0.0 = cold, 1.0 = white hot]
        float surfTemp = clamp(sunHeat * 0.35 + solarHot * 0.70 + indHot * 0.55 + ridgeHot * 0.30 - riverCool * 0.40, 0.0, 1.0);

        // FLIR Ironbow radiometric gradient:
        // Cold (Deep indigo) -> Warm (Magenta) -> Hot (Flame amber) -> Critical (Incandescent white-hot)
        if (surfTemp < 0.35) {
            float t = surfTemp / 0.35;
            flirColor = mix(vec3(0.08, 0.02, 0.18), vec3(0.65, 0.08, 0.52), t);
        } else if (surfTemp < 0.70) {
            float t = (surfTemp - 0.35) / 0.35;
            flirColor = mix(vec3(0.65, 0.08, 0.52), vec3(0.98, 0.52, 0.10), t);
        } else if (surfTemp < 0.88) {
            float t = (surfTemp - 0.70) / 0.18;
            flirColor = mix(vec3(0.98, 0.52, 0.10), vec3(1.0, 0.88, 0.25), t);
        } else {
            float t = (surfTemp - 0.88) / 0.12;
            flirColor = mix(vec3(1.0, 0.88, 0.25), vec3(1.0, 0.98, 0.85), t);
        }
    }

    if (uIsLineMode < 0.5) {
        if (uIsIrVision > 0.5) {
            // Infrared Photoreal: Render radiant false-color heat terrain with atmospheric fog
            float dist = length(vPositionW - uCameraPos);
            float fogFactor = clamp(exp(-dist * uFogDensity), 0.0, 1.0);
            gl_FragColor = vec4(mix(uBackgroundColor, flirColor, fogFactor), 1.0);
            return;
        }

        // Standard photoreal mode: display vertex color and natural terrain shading
        vec3 light = normalize(uLightDir);
        vec3 viewDir = normalize(uCameraPos - vPositionW);
        float NdotL = max(0.20, dot(vNormalW, light));
        
        // Ambient sky light from above (cool alpine blue tint in shadows)
        vec3 skyAmbient = vec3(0.68, 0.80, 0.95) * (vNormalW.y * 0.28 + 0.24);
        vec3 sunDirect = vec3(1.0, 0.96, 0.90) * NdotL;
        vec3 lighting = sunDirect + skyAmbient;
        
        // Snow crystalline sun glint
        vec3 halfDir = normalize(light + viewDir);
        float NdotH = max(0.0, dot(vNormalW, halfDir));
        float snowGlint = pow(NdotH, 20.0) * 0.30 * step(0.80, vColor.r);
        
        vec3 col = vColor.rgb * lighting + vec3(snowGlint);

        // Distance fog
        float dist = length(vPositionW - uCameraPos);
        float fogFactor = clamp(exp(-dist * uFogDensity), 0.0, 1.0);
        gl_FragColor = vec4(mix(uBackgroundColor, col, fogFactor), 1.0);
        return;
    }

    // 1. Subtle Paper/Relief Base Shading (or FLIR Heat Map base)
    vec3 baseColor;
    if (uIsIrVision > 0.5) {
        baseColor = flirColor;
    } else {
        vec3 light = normalize(uLightDir);
        float NdotL = dot(vNormalW, light);
        float reliefShade = clamp(NdotL * 0.12 + 0.94, 0.88, 1.06);
        baseColor = uTerrainBaseColor * reliefShade;
    }

    // 2. Elevation Isolines (Horizontal Slices like fogleman/ln)
    float y = vPositionW.y;

    // Minor elevation contours
    float minorVal = y / max(1.0, uMinorInterval);
    float dMinor = abs(fract(minorVal - 0.5) - 0.5);
    float fwMinor = max(0.001, fwidth(minorVal));
    float minorLine = 1.0 - smoothstep(0.0, fwMinor * 1.6, dMinor);

    // Major elevation index contours
    float majorVal = y / max(1.0, uMajorInterval);
    float dMajor = abs(fract(majorVal - 0.5) - 0.5);
    float fwMajor = max(0.001, fwidth(majorVal));
    float majorLine = 1.0 - smoothstep(0.0, fwMajor * 2.6, dMajor);

    // 3. Multi-Frequency Perspective Grid (Warp-Core Vector Grid from Reference Image)
    // Primary longitudinal & transverse grid lines
    float xVal = vPositionW.x / max(1.0, uLongitudinalSpacing);
    float dX = abs(fract(xVal - 0.5) - 0.5);
    float fwX = max(0.001, fwidth(xVal));
    float xLine = 1.0 - smoothstep(0.0, fwX * 1.6, dX);

    float zVal = vPositionW.z / max(1.0, uLongitudinalSpacing);
    float dZ = abs(fract(zVal - 0.5) - 0.5);
    float fwZ = max(0.001, fwidth(zVal));
    float zLine = 1.0 - smoothstep(0.0, fwZ * 1.6, dZ);
    float primaryGrid = max(xLine, zLine);

    // Micro High-Speed Flow Grid (8m spacing) - high-frequency optic flow right under the boots
    float microSpacing = max(4.0, uLongitudinalSpacing * 0.3333);
    float xMicro = vPositionW.x / microSpacing;
    float dXMicro = abs(fract(xMicro - 0.5) - 0.5);
    float fwXMicro = max(0.001, fwidth(xMicro));
    float xMicroLine = 1.0 - smoothstep(0.0, fwXMicro * 1.4, dXMicro);

    float zMicro = vPositionW.z / microSpacing;
    float dZMicro = abs(fract(zMicro - 0.5) - 0.5);
    float fwZMicro = max(0.001, fwidth(zMicro));
    float zMicroLine = 1.0 - smoothstep(0.0, fwZMicro * 1.4, dZMicro);
    float microGrid = max(xMicroLine, zMicroLine) * 0.35;

    // Chromatic vector line styling (Cyan, Amber, Violet, Ivory accents like media_1791328695151.png)
    float gridCoord = floor(vPositionW.x / max(1.0, uLongitudinalSpacing));
    float colorPhase = fract(gridCoord * 0.173 + vPositionW.z * 0.0005);
    vec3 vectorLineColor = uMinorContourColor;
    if (colorPhase < 0.30) {
        vectorLineColor = mix(uMinorContourColor, vec3(0.00, 0.94, 0.98), 0.80); // Electric cyan
    } else if (colorPhase < 0.60) {
        vectorLineColor = mix(uMinorContourColor, vec3(0.98, 0.68, 0.15), 0.80); // Solar amber
    } else if (colorPhase < 0.85) {
        vectorLineColor = mix(uMinorContourColor, vec3(0.78, 0.35, 0.98), 0.80); // Ultraviolet
    } else {
        vectorLineColor = mix(uMinorContourColor, vec3(1.00, 1.00, 1.00), 0.90); // Pure ivory
    }

    // 4. Slope-Adaptive Hatching on Steep Cliffs
    float slope = clamp(1.0 - abs(vNormalW.y), 0.0, 1.0);
    float slopeHatch = 0.0;
    if (slope > 0.45) {
        float denseVal = (vPositionW.x + vPositionW.y) / (uMinorInterval * 0.5);
        float dDense = abs(fract(denseVal - 0.5) - 0.5);
        float fwDense = max(0.001, fwidth(denseVal));
        slopeHatch = (1.0 - smoothstep(0.0, fwDense * 1.5, dDense)) * (slope - 0.45) * 0.6;
    }

    // 5. Composite Inks onto Paper
    vec3 result = baseColor;

    // Micro optic flow grid
    result = mix(result, uMinorContourColor, microGrid * 0.50);

    // Primary perspective grid lines with chromatic vector accents
    result = mix(result, vectorLineColor, primaryGrid * 0.88);

    // Minor contour lines
    result = mix(result, uMinorContourColor, minorLine * 0.82);

    // Cliff slope hatching
    result = mix(result, uMinorContourColor, slopeHatch);

    // Major index contours (Boldest & accented color)
    result = mix(result, uMajorContourColor, majorLine * 0.95);

    // 6. Exponential Distance Fog (Fades into paper or void background seamlessly)
    float dist = length(vPositionW - uCameraPos);
    float fogFactor = clamp(exp(-dist * uFogDensity), 0.0, 1.0);
    vec3 finalColor = mix(uBackgroundColor, result, fogFactor);

    gl_FragColor = vec4(finalColor, 1.0);
}
`

export class TopographicLineMaterial {
  private static shaderRegistered = false
  public material: ShaderMaterial

  constructor(name: string, scene: Scene) {
    TopographicLineMaterial.registerShaders()

    this.material = new ShaderMaterial(
      name,
      scene,
      {
        vertex: 'topographicLine',
        fragment: 'topographicLine',
      },
      {
        attributes: ['position', 'normal', 'color'],
        uniforms: [
          'world',
          'worldViewProjection',
          'uCameraPos',
          'uLightDir',
          'uBackgroundColor',
          'uTerrainBaseColor',
          'uMinorContourColor',
          'uMajorContourColor',
          'uMinorInterval',
          'uMajorInterval',
          'uLongitudinalSpacing',
          'uFogDensity',
          'uIsLineMode',
          'uIsIrVision',
        ],
      },
    )

    this.applyPalette(LnStyleManager.getInstance().palette)
  }

  public static registerShaders(): void {
    if (TopographicLineMaterial.shaderRegistered) return
    Effect.ShadersStore['topographicLineVertexShader'] = VERTEX_SHADER
    Effect.ShadersStore['topographicLineFragmentShader'] = FRAGMENT_SHADER
    TopographicLineMaterial.shaderRegistered = true
  }

  public applyPalette(pal: LnPalette): void {
    const isLine = pal.isLineMode ? 1.0 : 0.0
    const isIr = pal.isIrVision ? 1.0 : 0.0
    this.material.setFloat('uIsLineMode', isLine)
    this.material.setFloat('uIsIrVision', isIr)
    this.material.setColor3('uBackgroundColor', pal.backgroundRgb)
    this.material.setColor3('uTerrainBaseColor', pal.terrainBaseRgb)
    this.material.setColor3('uMinorContourColor', pal.minorContourRgb)
    this.material.setColor3('uMajorContourColor', pal.majorContourRgb)
    this.material.setFloat('uMinorInterval', pal.minorIntervalMeters)
    this.material.setFloat('uMajorInterval', pal.majorIntervalMeters)
    this.material.setFloat('uLongitudinalSpacing', pal.longitudinalSpacingMeters)
    this.material.setFloat('uFogDensity', pal.fogDensity)

    // Sun directional vector for relief shading
    const sunDir = new Vector3(0.5, 0.85, 0.3).normalize()
    this.material.setVector3('uLightDir', sunDir)
  }

  public update(cameraPosition: Vector3): void {
    this.material.setVector3('uCameraPos', cameraPosition)
  }

  public dispose(): void {
    this.material.dispose()
  }
}
