<script setup lang="ts">
defineProps<{
  rainstormEnabled: boolean;
  riverRunoffEnabled: boolean;
}>();

const emit = defineEmits<{
  toggleRainstorm: [];
  toggleRiverRunoff: [];
}>();
</script>

<template>
  <section class="scene-effects-panel" aria-label="场景效果面板">
    <div class="panel-heading">
      <span>场景效果</span>
      <b>{{ rainstormEnabled ? '运行中' : '待开启' }}</b>
    </div>

    <button
      type="button"
      class="effect-toggle"
      :class="{ active: rainstormEnabled }"
      @click="emit('toggleRainstorm')"
    >
      <span class="effect-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M7 4L4 10M13 3L10 9M19 4L16 10M8 14L5 20M14 13L11 21M20 14L17 20" />
        </svg>
      </span>
      <span class="effect-copy">
        <strong>暴雨效果</strong>
        <small>{{ rainstormEnabled ? '已开启' : '已关闭' }}</small>
      </span>
      <span class="toggle-track" aria-hidden="true">
        <i></i>
      </span>
    </button>

    <button
      type="button"
      class="effect-toggle"
      :class="{ active: riverRunoffEnabled }"
      @click="emit('toggleRiverRunoff')"
    >
      <span class="effect-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M4 7C7 5 10 5 13 7C15.8 8.8 18.2 8.6 20 7" />
          <path d="M4 12C7 10 10 10 13 12C15.8 13.8 18.2 13.6 20 12" />
          <path d="M4 17C7 15 10 15 13 17C15.8 18.8 18.2 18.6 20 17" />
        </svg>
      </span>
      <span class="effect-copy">
        <strong>河网汇流</strong>
        <small>{{ riverRunoffEnabled ? '汇流中' : '待触发' }}</small>
      </span>
      <span class="toggle-track" aria-hidden="true">
        <i></i>
      </span>
    </button>

    <div class="effect-slots">
      <span>台风</span>
      <span>雾效</span>
      <button
        type="button"
        :class="{ active: riverRunoffEnabled }"
        @click="emit('toggleRiverRunoff')"
      >
        洪水渲染
      </button>
    </div>
  </section>
</template>

<style scoped>
.scene-effects-panel {
  width: 238px;
  padding: 12px;
  border: 1px solid rgba(42, 86, 148, 0.6);
  border-radius: 8px;
  color: #e7f8ff;
  background:
    radial-gradient(circle at 14% 0%, rgba(67, 111, 178, 0.26), transparent 42%),
    linear-gradient(180deg, rgba(14, 28, 55, 0.94), rgba(7, 16, 34, 0.92));
  box-shadow: inset 0 0 22px rgba(66, 138, 214, 0.08), 0 14px 34px rgba(0, 0, 0, 0.46);
  backdrop-filter: blur(12px);
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding: 2px 2px 10px;
  border-bottom: 1px solid rgba(128, 164, 214, 0.14);
}

.panel-heading span {
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0;
}

.panel-heading b {
  min-width: 48px;
  padding: 3px 8px;
  border: 1px solid rgba(0, 229, 255, 0.24);
  border-radius: 999px;
  color: #93e9ff;
  background: rgba(0, 229, 255, 0.08);
  font-size: 11px;
  font-weight: 600;
  text-align: center;
}

.effect-toggle {
  width: 100%;
  min-height: 58px;
  margin: 0 0 9px;
  padding: 9px 10px;
  border: 1px solid rgba(92, 127, 178, 0.3);
  border-radius: 7px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 42px;
  align-items: center;
  gap: 10px;
  color: #dff7ff;
  background: rgba(15, 29, 55, 0.74);
  cursor: pointer;
  text-align: left;
  transition: all 0.2s ease;
}

.effect-toggle:hover,
.effect-toggle.active {
  border-color: rgba(0, 229, 255, 0.72);
  background: rgba(17, 54, 84, 0.74);
  box-shadow: 0 0 16px rgba(0, 229, 255, 0.12), inset 0 0 12px rgba(0, 229, 255, 0.06);
}

.effect-icon {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #8eefff;
  background: rgba(0, 229, 255, 0.1);
}

.effect-icon svg {
  width: 22px;
  height: 22px;
}

.effect-icon path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.effect-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.effect-copy strong {
  color: #ffffff;
  font-size: 13px;
}

.effect-copy small {
  color: #8fb8d8;
  font-size: 11px;
}

.toggle-track {
  position: relative;
  width: 38px;
  height: 20px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  box-shadow: inset 0 0 5px rgba(0, 0, 0, 0.45);
  transition: background 0.2s ease;
}

.toggle-track i {
  position: absolute;
  left: 3px;
  top: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.32);
  transition: transform 0.2s ease;
}

.effect-toggle.active .toggle-track {
  background: #00e5ff;
}

.effect-toggle.active .toggle-track i {
  transform: translateX(18px);
}

.effect-slots {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 0;
}

.effect-slots span,
.effect-slots button {
  min-height: 28px;
  border: 1px dashed rgba(128, 164, 214, 0.22);
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgba(174, 205, 230, 0.46);
  background: rgba(255, 255, 255, 0.025);
  font-size: 11px;
}

.effect-slots button {
  grid-column: 1 / -1;
  color: #8feeff;
  border-color: rgba(0, 229, 255, 0.28);
  background: rgba(0, 229, 255, 0.06);
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s ease;
}

.effect-slots button:hover,
.effect-slots button.active {
  color: #ffffff;
  border-color: rgba(0, 229, 255, 0.72);
  background: rgba(0, 229, 255, 0.14);
  box-shadow: 0 0 12px rgba(0, 229, 255, 0.12);
}
</style>
