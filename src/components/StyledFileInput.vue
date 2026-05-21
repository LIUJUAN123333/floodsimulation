<script setup lang="ts">
import { computed, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    accept?: string;
    buttonText?: string;
    directory?: boolean;
    disabled?: boolean;
    inputId?: string;
    multiple?: boolean;
    name?: string;
    placeholder?: string;
    required?: boolean;
  }>(),
  {
    accept: '',
    buttonText: '选择',
    directory: false,
    disabled: false,
    inputId: undefined,
    multiple: false,
    name: undefined,
    placeholder: '未选择文件',
    required: false
  }
);

const emit = defineEmits<{
  (event: 'change', value: Event): void;
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const selectedFiles = ref<File[]>([]);

const fileLabel = computed(() => {
  if (selectedFiles.value.length === 0) {
    return props.placeholder;
  }

  if (props.directory) {
    return `已选择 ${selectedFiles.value.length} 个文件`;
  }

  if (selectedFiles.value.length === 1) {
    return selectedFiles.value[0].name;
  }

  return `${selectedFiles.value[0].name} 等 ${selectedFiles.value.length} 个文件`;
});

const openPicker = () => {
  if (!props.disabled) {
    inputRef.value?.click();
  }
};

const handleChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  selectedFiles.value = Array.from(target.files ?? []);
  emit('change', event);
};
</script>

<template>
  <div
    class="styled-file-input"
    :class="{ disabled: props.disabled, filled: selectedFiles.length > 0 }"
    role="button"
    tabindex="0"
    @click="openPicker"
    @keydown.enter.prevent="openPicker"
    @keydown.space.prevent="openPicker"
  >
    <input
      :id="props.inputId"
      ref="inputRef"
      class="native-file-input"
      type="file"
      :accept="props.accept"
      :disabled="props.disabled"
      :directory="props.directory || undefined"
      :multiple="props.multiple || props.directory"
      :name="props.name"
      :required="props.required"
      :webkitdirectory="props.directory || undefined"
      @change="handleChange"
    >
    <span class="file-action">
      <span class="file-glyph" aria-hidden="true">+</span>
      {{ props.buttonText }}
    </span>
    <span class="file-name" :title="fileLabel">{{ fileLabel }}</span>
  </div>
</template>

<style scoped>
.styled-file-input {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  width: 100%;
  min-height: 42px;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.88);
  background:
    linear-gradient(180deg, rgba(12, 32, 50, 0.86), rgba(5, 18, 31, 0.92)),
    rgba(5, 18, 31, 0.92);
  border: 1px solid rgba(0, 229, 255, 0.22);
  border-radius: 6px;
  box-shadow: inset 0 0 18px rgba(0, 229, 255, 0.04);
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.styled-file-input:hover,
.styled-file-input:focus-visible {
  border-color: rgba(0, 229, 255, 0.58);
  box-shadow: 0 0 18px rgba(0, 229, 255, 0.14), inset 0 0 18px rgba(0, 229, 255, 0.06);
  outline: none;
}

.styled-file-input:active {
  transform: translateY(1px);
}

.styled-file-input.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.native-file-input {
  position: absolute;
  inset: 0;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.file-action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: stretch;
  padding: 0 14px;
  color: var(--sys-theme-color, #00e5ff);
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  background: rgba(0, 229, 255, 0.12);
  border-right: 1px solid rgba(0, 229, 255, 0.22);
}

.file-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-size: 16px;
  line-height: 1;
}

.file-name {
  min-width: 0;
  padding: 0 12px;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.72);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filled .file-name {
  color: rgba(255, 255, 255, 0.94);
}
</style>
