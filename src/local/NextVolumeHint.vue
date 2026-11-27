<template>
    <transition name="next-hint">
        <a v-if="visible" class="next-volume-hint" :href="href">
            <span class="label">{{ next ? '已读到最后一页 · 下一卷' : '已全部读完' }}</span>
            <span class="title">{{ next ? next.title : '返回书库' }}</span>
            <span class="arrow">→</span>
        </a>
    </transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { store } from '../../core/store/app'
import type { AlbumNeighbor } from './api'

const props = defineProps<{ next: AlbumNeighbor | null }>()

const visible = computed(() => store.pageCount > 0 && store.curViewIndex >= store.pageCount - 1)
const href = computed(() => (props.next ? `/read/${props.next.id}` : '/'))
</script>

<style lang="scss" scoped>
.next-volume-hint {
    position: fixed;
    left: 50%;
    bottom: 28px;
    z-index: 10001;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 20px;
    border-radius: 22px;
    background: rgba(0, 0, 0, 0.78);
    color: #fff;
    font-family: PingFang SC, Microsoft YaHei, Helvetica Neue, Arial, sans-serif;
    font-size: 14px;
    text-decoration: none;
    white-space: nowrap;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
    transform: translateX(-50%);
    transition: background 0.2s;

    .label {
        color: rgba(255, 255, 255, 0.75);
    }

    .title {
        color: hsl(145, 63%, 60%);
        font-weight: 600;
    }

    &:hover {
        background: hsl(145, 63%, 36%);

        .title {
            color: #fff;
        }
    }
}

.next-hint-enter-active,
.next-hint-leave-active {
    transition: opacity 0.3s, transform 0.3s;
}

.next-hint-enter-from,
.next-hint-leave-to {
    opacity: 0;
    transform: translate(-50%, 12px);
}
</style>
