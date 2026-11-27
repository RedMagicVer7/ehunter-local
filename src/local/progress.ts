const KEY_PREFIX = 'ehunter-local:progress:'

export interface ReadingProgress {
    index: number
    pageCount: number
    updatedAt: number
}

export function readProgress(albumId: string): ReadingProgress | null {
    try {
        const raw = window.localStorage.getItem(KEY_PREFIX + albumId)
        if (!raw) {
            return null
        }
        const data = JSON.parse(raw)
        if (!Number.isInteger(data?.index) || !Number.isInteger(data?.pageCount)) {
            return null
        }
        return { index: data.index, pageCount: data.pageCount, updatedAt: Number(data.updatedAt) || 0 }
    } catch {
        return null
    }
}

export function writeProgress(albumId: string, index: number, pageCount: number): void {
    const data: ReadingProgress = { index, pageCount, updatedAt: Date.now() }
    window.localStorage.setItem(KEY_PREFIX + albumId, JSON.stringify(data))
}
