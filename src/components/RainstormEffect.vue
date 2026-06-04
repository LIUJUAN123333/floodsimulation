<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import * as Cesium from 'cesium';

const props = defineProps<{
  viewer: Cesium.Viewer;
  active: boolean;
}>();

let rainStage: Cesium.PostProcessStage | null = null;
let originalFogEnabled: boolean | null = null;
let originalFogDensity: number | null = null;
let originalSkyHueShift: number | null = null;
let originalSkySaturationShift: number | null = null;
let originalSkyBrightnessShift: number | null = null;

const rainFragmentShader = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;

float hash(float x) {
  return fract(sin(x * 133.3) * 13.13);
}

void main(void) {
  vec2 resolution = czm_viewport.zw;
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 color = texture(colorTexture, v_textureCoordinates);

  float time = czm_frameNumber * 0.012;
  float angle = -0.36;
  mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 rainUv = rotation * (uv * vec2(2.0, 1.0));

  float columns = 95.0;
  float column = floor(rainUv.x * columns);
  float localX = fract(rainUv.x * columns);
  float speed = mix(0.55, 1.35, hash(column));
  float localY = fract(rainUv.y * 7.5 + time * speed + hash(column) * 6.0);

  float streak = smoothstep(0.11, 0.0, abs(localX - 0.5)) * smoothstep(0.72, 1.0, localY);
  float fineMist = smoothstep(0.96, 0.2, hash(floor(uv.x * 260.0) + floor((uv.y + time) * 180.0)));
  float rain = clamp(streak * 0.72 + fineMist * 0.045, 0.0, 0.82);

  vec3 stormTint = vec3(0.58, 0.70, 0.82);
  vec3 darkened = color.rgb * vec3(0.58, 0.66, 0.76);
  vec3 rainColor = mix(darkened, stormTint, rain);
  out_FragColor = vec4(rainColor, color.a);
}
`;

const rememberSceneSettings = () => {
  const { scene } = props.viewer;

  if (originalFogEnabled === null) {
    originalFogEnabled = scene.fog.enabled;
    originalFogDensity = scene.fog.density;
  }

  if (scene.skyAtmosphere && originalSkyHueShift === null) {
    originalSkyHueShift = scene.skyAtmosphere.hueShift;
    originalSkySaturationShift = scene.skyAtmosphere.saturationShift;
    originalSkyBrightnessShift = scene.skyAtmosphere.brightnessShift;
  }
};

const applyStormAtmosphere = () => {
  const { scene } = props.viewer;
  rememberSceneSettings();

  scene.fog.enabled = true;
  scene.fog.density = 0.00022;

  if (scene.skyAtmosphere) {
    scene.skyAtmosphere.hueShift = -0.18;
    scene.skyAtmosphere.saturationShift = -0.42;
    scene.skyAtmosphere.brightnessShift = -0.36;
  }

  scene.requestRender();
};

const restoreSceneSettings = () => {
  const { scene } = props.viewer;

  if (originalFogEnabled !== null) {
    scene.fog.enabled = originalFogEnabled;
  }

  if (originalFogDensity !== null) {
    scene.fog.density = originalFogDensity;
  }

  if (scene.skyAtmosphere && originalSkyHueShift !== null) {
    scene.skyAtmosphere.hueShift = originalSkyHueShift;
    scene.skyAtmosphere.saturationShift = originalSkySaturationShift ?? scene.skyAtmosphere.saturationShift;
    scene.skyAtmosphere.brightnessShift = originalSkyBrightnessShift ?? scene.skyAtmosphere.brightnessShift;
  }

  originalFogEnabled = null;
  originalFogDensity = null;
  originalSkyHueShift = null;
  originalSkySaturationShift = null;
  originalSkyBrightnessShift = null;
  scene.requestRender();
};

const enableRainstorm = () => {
  const { scene } = props.viewer;
  if (rainStage) {
    applyStormAtmosphere();
    return;
  }

  rainStage = new Cesium.PostProcessStage({
    name: 'rainstorm_effect',
    fragmentShader: rainFragmentShader
  });

  scene.postProcessStages.add(rainStage);
  applyStormAtmosphere();
};

const disableRainstorm = () => {
  const { scene } = props.viewer;

  if (rainStage) {
    scene.postProcessStages.remove(rainStage);
    rainStage = null;
  }

  restoreSceneSettings();
};

watch(
  () => props.active,
  (active) => {
    if (active) {
      enableRainstorm();
    } else {
      disableRainstorm();
    }
  },
  { immediate: true }
);

onBeforeUnmount(disableRainstorm);
</script>

<template></template>
