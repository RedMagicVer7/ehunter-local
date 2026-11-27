import { createApp, h, ref, watch } from 'vue'
import TestApp from '../../core/TestApp.vue'
import LoadingView from '../../core/components/LoadingView.vue'
import '../../core/style/_normalize.scss'
import { NameAlbumService } from '../../core/service/AlbumService'
import { store } from '../../core/store/app'
import { initializeWithTimeout } from '../platform/initializer'
import { Platform, type InitializationError } from '../platform/types'
import { LocalAlbumService } from './LocalAlbumService'
import LibraryView from './LibraryView.vue'
import NextVolumeHint from './NextVolumeHint.vue'
import { writeProgress } from './progress'

// core dialogs teleport into #ehunter-app and fullscreen targets it
const root = document.getElementById('ehunter-app')!
const readMatch = window.location.pathname.match(/^\/read\/([0-9a-f]{12})\/?$/)

function backToLibrary() {
    window.location.href = '/'
}

function mountReader(albumId: string) {
    // ReaderView's close button calls this bridge
    ;(window as any).__EHUNTER_UI__ = {
        open: () => {},
        close: backToLibrary,
        toggle: () => {},
    }
    root.classList.add('normalize', 'reader-root')

    const service = new LocalAlbumService(albumId)
    const app = createApp({
        setup() {
            const isLoading = ref(true)
            const error = ref<InitializationError | null>(null)

            initializeWithTimeout(service, Platform.LOCAL)
                .then(() => {
                    document.title = service.getTitle()
                    let timer = 0
                    watch(() => store.curViewIndex, index => {
                        window.clearTimeout(timer)
                        timer = window.setTimeout(() => writeProgress(albumId, index, service.getPageCount()), 300)
                    })
                    isLoading.value = false
                })
                .catch(err => {
                    error.value = err as InitializationError
                    isLoading.value = false
                })

            return () => h(LoadingView, {
                isLoading: isLoading.value,
                error: error.value,
                onClose: backToLibrary,
            }, {
                default: () => [
                    h(TestApp),
                    h(NextVolumeHint, { next: service.getDetail()?.next ?? null }),
                ],
            })
        },
    })
    app.provide(NameAlbumService, service)
    app.mount(root)
}

if (readMatch) {
    mountReader(readMatch[1])
} else {
    document.title = 'eHunter Local · 书库'
    createApp(LibraryView).mount(root)
}
