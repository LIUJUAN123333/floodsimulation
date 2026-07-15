<script setup lang="ts">
import VGELogo from '../assets/icons/logo.png';

const props = withDefaults(defineProps<{
  embedded?: boolean;
}>(), {
  embedded: false
});
</script>

<template>
  <div
    class="logo-container"
    :class="{ embedded: props.embedded }"
    aria-label="西南交通大学 VGE团队 版权所有"
  >
    <div class="copyright-group">
      <div class="main-text">
        西南交通大学 <span class="highlight">VGE团队</span>
      </div>
      <div class="sub-text">版权所有 © 2025 All Rights Reserved</div>
    </div>
    <div class="divider-vertical"></div>
    <img :src="VGELogo" alt="VGE Logo" class="logo-img" />
  </div>
</template>

<style scoped>
.logo-container {
  position: absolute;
  bottom: 10px;
  right: 10px;
  z-index: 9999;
  pointer-events: none;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 15px;
}

.logo-container.embedded {
  position: relative;
  right: auto;
  bottom: auto;
  z-index: auto;
  height: 100%;
  gap: 12px;
}

.copyright-group {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-family: "Microsoft YaHei", sans-serif;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
}

.main-text {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 0.5px;
  margin-bottom: 2px;
}

.logo-container.embedded .main-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.88);
}

.highlight {
  font-weight: 800;
  background: linear-gradient(120deg, #00d4ff, #0096ff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.sub-text {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.4);
  letter-spacing: 1px;
  text-transform: uppercase;
  font-family: "Helvetica Neue", sans-serif;
}

.logo-container.embedded .sub-text {
  font-size: 8px;
  color: rgba(255, 255, 255, 0.36);
  letter-spacing: 0.7px;
}

.divider-vertical {
  width: 1px;
  height: 28px;
  background: linear-gradient(to bottom, transparent, rgba(255, 255, 255, 0.3), transparent);
}

.logo-container.embedded .divider-vertical {
  height: 24px;
  background: linear-gradient(to bottom, transparent, rgba(0, 229, 255, 0.28), transparent);
}

.logo-img {
  height: 30px;
  width: auto;
  display: block;
  opacity: 0.9;
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  filter: drop-shadow(0 0 10px rgba(0, 212, 255, 0.2));
}

.logo-container.embedded .logo-img {
  height: 28px;
  filter: drop-shadow(0 0 8px rgba(0, 212, 255, 0.18));
}

.logo-container:hover .logo-img {
  transform: scale(1.1) rotate(5deg);
  filter: drop-shadow(0 0 15px rgba(0, 212, 255, 0.6));
  opacity: 1;
}

@media (max-width: 980px) {
  .logo-container {
    gap: 10px;
  }

  .logo-container:not(.embedded) {
    bottom: 6px;
    right: 8px;
  }

  .logo-container.embedded {
    right: auto;
    bottom: auto;
    gap: 9px;
  }

  .main-text {
    font-size: 11px;
  }

  .sub-text {
    display: none;
  }

  .logo-img {
    height: 24px;
  }

  .divider-vertical {
    height: 20px;
  }
}

@media (max-width: 760px) {
  .copyright-group,
  .divider-vertical {
    display: none;
  }

  .logo-container:not(.embedded) {
    background: rgba(8, 16, 30, 0.45);
    border-radius: 6px;
    padding: 4px 6px;
  }

  .logo-container.embedded {
    right: auto;
    bottom: auto;
    gap: 0;
  }

  .logo-container.embedded .logo-img {
    height: 24px;
  }
}
</style>
