<template>
    <div class="library">
        <header class="library-header">
            <span class="brand">EHUNTER</span>
            <span class="brand-sub">LOCAL</span>
            <span class="spacer"></span>
            <span v-if="albums.length" class="count">{{ albums.length }} 本</span>
        </header>
        <main class="library-main">
            <p v-if="error" class="state error">无法读取书库：{{ error }}</p>
            <p v-else-if="loading" class="state">正在读取书库…</p>
            <div v-else-if="albums.length === 0" class="state">
                <p>书库里没有找到漫画（支持 CBZ / ZIP / 图片文件夹）</p>
                <code v-for="root in roots" :key="root">{{ root }}</code>
            </div>
            <template v-else>
                <a v-if="lastRead" class="continue" :href="readUrl(lastRead.album.id)">
                    <span class="continue-label">继续阅读</span>
                    <span class="continue-title">{{ lastRead.album.title }}</span>
                    <span class="continue-page">第 {{ lastRead.index + 1 }} / {{ lastRead.album.pageCount }} 页</span>
                    <span class="continue-arrow">→</span>
                </a>
                <section v-for="group in groups" :key="group.name" class="group">
                    <h2 v-if="group.name" class="group-title">{{ group.name }}</h2>
                    <div class="grid">
                        <a v-for="album in group.albums" :key="album.id" class="card" :href="readUrl(album.id)"
                            :title="album.name">
                            <div class="cover">
                                <img :src="album.cover" alt="" loading="lazy" draggable="false" />
                                <span v-if="album.number" class="badge">{{ album.number }}</span>
                            </div>
                            <div class="info">
                                <div class="title">{{ album.title }}</div>
                                <div class="meta">{{ statusText(album) }}</div>
                                <div class="bar">
                                    <div class="fill" :style="{ width: `${percent(album)}%` }"></div>
                                </div>
                            </div>
                        </a>
                    </div>
                </section>
            </template>
        </main>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { fetchLibrary, type AlbumSummary } from './api'
import { readProgress, type ReadingProgress } from './progress'

const albums = ref<AlbumSummary[]>([])
const roots = ref<string[]>([])
const loading = ref(true)
const error = ref('')
const progressMap = ref<Record<string, ReadingProgress | null>>({})

onMounted(async () => {
    try {
        const data = await fetchLibrary()
        albums.value = data.albums
        roots.value = data.roots
        progressMap.value = Object.fromEntries(data.albums.map(a => [a.id, readProgress(a.id)]))
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e)
    } finally {
        loading.value = false
    }
})

const groups = computed(() => {
    const result: Array<{ name: string, albums: AlbumSummary[] }> = []
    for (const album of albums.value) {
        const name = album.series || ''
        let group = result.find(g => g.name === name)
        if (!group) {
            group = { name, albums: [] }
            result.push(group)
        }
        group.albums.push(album)
    }
    return result
})

const lastRead = computed(() => {
    let best: { album: AlbumSummary, index: number, updatedAt: number } | null = null
    for (const album of albums.value) {
        const p = progressMap.value[album.id]
        if (!p || p.index >= album.pageCount - 1) {
            continue
        }
        if (!best || p.updatedAt > best.updatedAt) {
            best = { album, index: p.index, updatedAt: p.updatedAt }
        }
    }
    return best
})

function readUrl(id: string): string {
    return `/read/${id}`
}

function statusText(album: AlbumSummary): string {
    const p = progressMap.value[album.id]
    if (!p) {
        return `${album.pageCount} 页 · 未读`
    }
    if (p.index >= album.pageCount - 1) {
        return `${album.pageCount} 页 · 已读完`
    }
    return `读到 ${p.index + 1} / ${album.pageCount}`
}

function percent(album: AlbumSummary): number {
    const p = progressMap.value[album.id]
    if (!p || album.pageCount === 0) {
        return 0
    }
    return Math.min(100, ((p.index + 1) / album.pageCount) * 100)
}
</script>

<style lang="scss" scoped>
$primary: hsl(145, 63%, 49%);
$primary-light: hsl(145, 63%, 60%);

.library {
    min-height: 100vh;
    background: #2b2b2b;
    color: #e6e6e6;
    font-family: PingFang SC, Microsoft YaHei, Hiragino Sans GB, Helvetica Neue, Arial, sans-serif;
}

.library-header {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: baseline;
    gap: 8px;
    height: 56px;
    padding: 0 32px;
    line-height: 56px;
    background: $primary;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);

    .brand {
        color: #fff;
        font-size: 24px;
        font-weight: 700;
        letter-spacing: 2px;
    }

    .brand-sub {
        color: rgba(255, 255, 255, 0.75);
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 3px;
    }

    .spacer {
        flex: 1;
    }

    .count {
        color: rgba(255, 255, 255, 0.9);
        font-size: 14px;
    }
}

.library-main {
    max-width: 1400px;
    margin: 0 auto;
    padding: 28px 32px 64px;
}

.state {
    margin-top: 80px;
    text-align: center;
    color: #aaa;
    font-size: 15px;

    &.error {
        color: #e74c3c;
    }

    code {
        display: block;
        margin-top: 8px;
        color: #888;
    }
}

.continue {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 28px;
    padding: 14px 20px;
    border-radius: 8px;
    background: #383838;
    border-left: 4px solid $primary;
    color: #e6e6e6;
    text-decoration: none;
    transition: background 0.2s;

    &:hover {
        background: #424242;
    }

    .continue-label {
        color: $primary-light;
        font-weight: 600;
    }

    .continue-title {
        font-size: 16px;
        font-weight: 600;
    }

    .continue-page {
        color: #999;
        font-size: 13px;
    }

    .continue-arrow {
        margin-left: auto;
        color: $primary-light;
        font-size: 18px;
    }
}

.group + .group {
    margin-top: 40px;
}

.group-title {
    margin: 0 0 18px;
    color: #f0f0f0;
    font-size: 20px;
    font-weight: 600;
}

.grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 28px 24px;
}

.card {
    display: flex;
    flex-direction: column;
    border-radius: 8px;
    overflow: hidden;
    background: #363636;
    color: inherit;
    text-decoration: none;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    transition: transform 0.2s ease, box-shadow 0.2s ease;

    &:hover {
        transform: translateY(-4px);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45);

        .title {
            color: $primary-light;
        }
    }
}

.cover {
    position: relative;
    aspect-ratio: 352 / 480;
    background: #2f2f2f;

    img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }

    .badge {
        position: absolute;
        top: 8px;
        left: 8px;
        min-width: 24px;
        height: 24px;
        padding: 0 6px;
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.65);
        color: #fff;
        font-size: 13px;
        font-weight: 600;
        line-height: 24px;
        text-align: center;
    }
}

.info {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 12px 14px;

    .title {
        font-size: 15px;
        font-weight: 600;
        line-height: 1.35;
        transition: color 0.2s;
    }

    .meta {
        color: #9a9a9a;
        font-size: 12px;
    }

    .bar {
        height: 3px;
        border-radius: 2px;
        background: #4a4a4a;
        overflow: hidden;

        .fill {
            height: 100%;
            background: $primary;
        }
    }
}
</style>
