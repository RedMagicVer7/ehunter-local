import { store, storeAction } from './app'
import { i18n, lang } from './i18n'
import config from '../../src/config'
import { getWelcomeInstructionText } from '../assets/instructions'

function getEhunterElem() : HTMLDivElement|null {
    return document.querySelector('.ehunter-container')
}

let resizeTimeoutId: number = 0
function updateViewportSize() {
    let elem = getEhunterElem()
    if (elem) {
        storeAction.setViewportWidth(elem.offsetWidth)
        storeAction.setViewportHeight(elem.offsetHeight)
    }
}

export function initViewportSizeUpdater() {
    updateViewportSize()
    window.addEventListener('resize', () => {
        window.clearTimeout(resizeTimeoutId)
        resizeTimeoutId = window.setTimeout(() => {
            updateViewportSize()
        }, 50)
    });
}

const keyboardUpdater = 'keyboard'
// Modifier keys bound as shortcuts fire on release, so Shift+Space etc. don't trigger them
const soloModifierKeys = new Set(['Shift', 'Control'])
let pendingSoloModifier: string | null = null

function isEditableTarget(target: HTMLElement | null): boolean {
    if (!target) {
        return false
    }
    const tagName = (target.tagName || '').toLowerCase()
    return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable
}

function scrollOneScreen(direction: 1 | -1) {
    if (store.readingMode == 0) {
        const scroller = document.querySelector('.album-scroll-view .awesome-scroll-view') as HTMLElement | null
        if (scroller) {
            scroller.scrollBy({ top: direction * scroller.clientHeight * 0.9, behavior: 'smooth' })
        }
        return
    }
    if (direction > 0 && store.curViewIndex + store.pagesPerScreen >= store.pageCount) {
        return
    }
    storeAction.setCurViewIndex(store.curViewIndex + direction * store.pagesPerScreen, keyboardUpdater)
}

function handleKeyboardEvent(e: any) {
    const rawKey = typeof e.key === 'string' ? e.key : ''
    if (isEditableTarget(e.target as HTMLElement | null)) {
        return
    }
    if (soloModifierKeys.has(rawKey)) {
        if (!e.repeat) {
            pendingSoloModifier = rawKey
        }
        return
    }
    pendingSoloModifier = null

    if (e.metaKey || e.ctrlKey) {
        if (rawKey === '=' || rawKey === '+') {
            e.preventDefault()
            storeAction.stepWidthScale(1)
        } else if (rawKey === '-' || rawKey === '_') {
            e.preventDefault()
            storeAction.stepWidthScale(-1)
        }
        return
    }

    if (rawKey === ' ' && !e.altKey) {
        e.preventDefault()
        scrollOneScreen(e.shiftKey ? -1 : 1)
        return
    }
    if (rawKey === 'Home' || rawKey === 'End') {
        e.preventDefault()
        storeAction.setCurViewIndex(rawKey === 'Home' ? 0 : store.pageCount - 1, keyboardUpdater)
        return
    }

    runShortcutActions(rawKey)
}

function handleKeyUpEvent(e: any) {
    const rawKey = typeof e.key === 'string' ? e.key : ''
    if (pendingSoloModifier === null || rawKey !== pendingSoloModifier) {
        return
    }
    pendingSoloModifier = null
    if (isEditableTarget(e.target as HTMLElement | null)) {
        return
    }
    runShortcutActions(rawKey)
}

function preventPinchZoom(e: WheelEvent) {
    // trackpad pinch arrives as ctrl+wheel; stop the browser from zooming the page
    if (e.ctrlKey) {
        e.preventDefault()
    }
}

function runShortcutActions(rawKey: string) {
    const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey
    const shortcutMap = buildShortcutLookup()
    const actionList = shortcutMap[key]
    if (!actionList || actionList.length === 0) {
        return
    }

    for (const action of actionList) {
        switch (action) {
        case 'goPrev':
            if (store.readingMode == 0) {
                storeAction.setCurViewIndex(store.curViewIndex - 1, keyboardUpdater)
            } else if (store.readingMode == 1) {
                storeAction.setCurViewIndex(store.curViewIndex - store.pagesPerScreen, keyboardUpdater)
            }
            break
        case 'goNext':
            if (store.readingMode == 0) {
                storeAction.setCurViewIndex(store.curViewIndex + 1, keyboardUpdater)
            } else if (store.readingMode == 1 && store.curViewIndex + store.pagesPerScreen < store.pageCount) {
                storeAction.setCurViewIndex(store.curViewIndex + store.pagesPerScreen, keyboardUpdater)
            }
            break
        case 'toggleMoreSettings':
            storeAction.toggleShowMoreSettingsDialog()
            break
        case 'toggleTopBar':
            storeAction.toggleShowTopBar()
            break
        case 'toggleThumbView':
            if (store.readingMode == 0) {
                storeAction.toggleShowThumbView()
            } else {
                storeAction.toggleShowBookThumbView()
            }
            break
        case 'toggleQuickPreview':
            if (store.showThumbExpandDialog) {
                storeAction.closeThumbExpandDialog()
            } else {
                storeAction.openThumbExpandDialog()
            }
            break
        case 'increaseWidthScale':
            storeAction.setWidthScale(Math.min(100, storeAction.getEffectiveWidthScale() + 5))
            break
        case 'decreaseWidthScale':
            storeAction.setWidthScale(Math.max(30, storeAction.getEffectiveWidthScale() - 5))
            break
        case 'togglePagination':
            if (store.readingMode == 1) {
                storeAction.toggleShowBookPagination()
            }
            break
        case 'toggleAutoFlip':
            storeAction.toggleIsAutoFlip()
            break
        case 'toggleOddEven':
            storeAction.toggleIsChangeOddEven()
            break
        }
    }
}

function normalizeShortcutToken(token: string): string {
    const trimmed = token.trim()
    if (trimmed.length === 1) {
        return trimmed.toLowerCase()
    }
    return trimmed
}

function buildShortcutLookup(): Record<string, string[]> {
    const result: Record<string, string[]> = {}
    const shortcutBindings = store.shortcutBindings
    for (const actionName of Object.keys(shortcutBindings)) {
        const keyList = (shortcutBindings as Record<string, string>)[actionName]
            .split(',')
            .map(item => normalizeShortcutToken(item))
            .filter(item => item.length > 0)
        for (const key of keyList) {
            if (!result[key]) {
                result[key] = []
            }
            result[key].push(actionName)
        }
    }
    return result
}

export function initKeyboardListener() {
    document.addEventListener('keydown', handleKeyboardEvent)
    document.addEventListener('keyup', handleKeyUpEvent)
    window.addEventListener('wheel', preventPinchZoom, { passive: false })
}


let autoFlipTimerID: number = 0
function handleAutoFlipEvent() {
    if (store.curViewIndex < store.pageCount - 1) {
        let step = store.readingMode == 1 ? store.pagesPerScreen : 1
        storeAction.setCurViewIndex(store.curViewIndex + step, 'autoflip')
    }
}

export function resetAutoFlipTimer() {
    if (autoFlipTimerID) {
        window.clearTimeout(autoFlipTimerID)
    }
    if (store.readingMode == 1 && store.isAutoFlip && store.autoFlipFrequency > 0) {
        autoFlipTimerID = window.setTimeout(handleAutoFlipEvent, store.autoFlipFrequency * 1000)
    }
}

let wheelDelta = 0
let wheelDeltaTimer = 0
export function handleWheelFlipEvent(e: any) {
    if (typeof e.deltaY === 'undefined') {
        e.deltaY = e.wheelDeltaY;
    }
    if (e.metaKey || e.ctrlKey || e.deltaY === 0) {
        return;
    }
    wheelDelta += e.deltaY
    if (wheelDeltaTimer > 0) {
        window.clearTimeout(wheelDeltaTimer)
    }
    wheelDeltaTimer = window.setTimeout(() => {
        wheelDelta = 0
    }, 100)
    if (Math.abs(wheelDelta) < store.wheelSensitivity) {
        return
    }
    // action
    let isToNext = false
    if ((wheelDelta > 0 && !store.IsReverseBookWheeFliplDirection) || wheelDelta < 0 && store.IsReverseBookWheeFliplDirection) {
        isToNext = true
    }
    if (isToNext && store.curViewIndex + store.pagesPerScreen < store.pageCount) {
        storeAction.setCurViewIndex(store.curViewIndex + store.pagesPerScreen, 'wheel')
    }
    if (!isToNext) {
        storeAction.setCurViewIndex(store.curViewIndex - store.pagesPerScreen, 'wheel')
    }
    wheelDelta = 0
    window.clearTimeout(wheelDeltaTimer)
}

export function checkInstructions() {
    if (store.showInstructionDialog) {
        return
    }
    if (!store.hasShownWelcomeInstruction) {
        let uaLang = navigator.language.toLowerCase()
        if (uaLang.startsWith('zh')) {
            storeAction.setLang('cn')
        } else if (uaLang.startsWith('ja') || uaLang.includes('jp')) {
            storeAction.setLang('jp')
        } else {
            storeAction.setLang('en')
        }
        storeAction.markWelcomeInstructionShown()
        return
    }
}

export function openWelcomeInstructionDialog(isCompulsive = false) {
    storeAction.openInstructionDialog({
        title: i18n.value.instructionsAndAbouts,
        mdText: getWelcomeInstructionText(lang.value, config.homePage),
        isCompulsive,
    })
}
