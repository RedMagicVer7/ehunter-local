export interface AlbumSummary {
    id: string
    name: string
    title: string
    series: string
    number: string
    displayTitle: string
    pageCount: number
    cover: string
}

export interface AlbumNeighbor {
    id: string
    title: string
    displayTitle: string
}

export interface AlbumPage {
    w: number
    h: number
    tw: number
    th: number
}

export interface AlbumDetail extends AlbumSummary {
    pages: AlbumPage[]
    prev: AlbumNeighbor | null
    next: AlbumNeighbor | null
}

export interface LibraryResponse {
    roots: string[]
    albums: AlbumSummary[]
}

async function getJson<T>(url: string): Promise<T> {
    const resp = await fetch(url, { cache: 'no-store' })
    if (!resp.ok) {
        throw new Error(`${url} -> HTTP ${resp.status}`)
    }
    return resp.json() as Promise<T>
}

export function fetchLibrary(): Promise<LibraryResponse> {
    return getJson<LibraryResponse>('/api/library')
}

export function fetchAlbum(id: string): Promise<AlbumDetail> {
    return getJson<AlbumDetail>(`/api/album/${id}`)
}
