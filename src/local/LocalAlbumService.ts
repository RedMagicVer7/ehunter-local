import type { AlbumService } from '../../core/service/AlbumService'
import { ThumbMode, type ImgPageInfo, type ImgSrcMode, type PreviewThumbnailStyle, type ThumbInfo } from '../../core/model/model'
import { fetchAlbum, type AlbumDetail } from './api'
import { readProgress } from './progress'

export class LocalAlbumService implements AlbumService {
    private detail: AlbumDetail | null = null
    private imgPageInfos: ImgPageInfo[] = []
    private thumbInfos: ThumbInfo[] = []

    constructor(private readonly albumId: string) {}

    async init(): Promise<Error | void> {
        try {
            this.detail = await fetchAlbum(this.albumId)
        } catch (e) {
            return e instanceof Error ? e : new Error(String(e))
        }
        const id = this.albumId
        this.imgPageInfos = this.detail.pages.map((page, i) => ({
            id: i,
            index: i,
            pageUrl: `/img/${id}/${i}`,
            src: '',
            heightOfWidth: page.h / page.w,
            preciseHeightOfWidth: page.h / page.w,
            thumbWidth: page.tw,
            thumbHeight: page.th,
        }))
        this.thumbInfos = this.detail.pages.map((page, i) => ({
            id: i,
            src: `/thumb/${id}/${i}`,
            mode: ThumbMode.IMG,
            width: page.tw,
            height: page.th,
        }))
    }

    getDetail(): AlbumDetail | null {
        return this.detail
    }

    isSupportOriginImg(): boolean {
        return false
    }

    isSupportImgChangeSource(): boolean {
        return false
    }

    isSupportThumbView(): boolean {
        return true
    }

    getTitle(): string {
        return this.detail?.displayTitle ?? ''
    }

    getAlbumId(): string {
        return this.albumId
    }

    getIntroUrl(): string {
        return '/'
    }

    getPageCount(): number {
        return this.imgPageInfos.length
    }

    getCurPageIndex(): number {
        const progress = readProgress(this.albumId)
        if (!progress || this.imgPageInfos.length === 0) {
            return 0
        }
        return Math.min(Math.max(progress.index, 0), this.imgPageInfos.length - 1)
    }

    getThumbInfos(_isDisableCache: boolean): Array<ThumbInfo> {
        return this.thumbInfos
    }

    getImgPageInfos(): Array<ImgPageInfo> {
        return this.imgPageInfos
    }

    async getImgSrc(index: number, _mode: ImgSrcMode): Promise<ImgPageInfo | Error> {
        const info = this.imgPageInfos[index]
        if (!info) {
            return new Error('ERROR_NO_PAGE')
        }
        info.src = info.pageUrl
        return info
    }

    getPreviewThumbnailStyle(index: number): PreviewThumbnailStyle {
        return {
            'background-image': `url(${this.thumbInfos[index]?.src ?? ''})`,
            'background-position': 'center',
            'background-size': 'cover',
        }
    }
}
