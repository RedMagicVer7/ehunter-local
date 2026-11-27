#!/usr/bin/env node
import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileP = promisify(execFile)

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST_DIR = path.join(PROJECT_DIR, 'dist')
const HOST = '127.0.0.1'
const PORT = Number(process.env.PORT) || 5177
const CACHE_DIR = path.join(os.homedir(), 'Library', 'Caches', 'ehunter-local')
const META_CACHE_FILE = path.join(CACHE_DIR, 'meta-v1.json')
const THUMB_MAX_SIZE = 480
const THUMB_CONCURRENCY = 3
const HAS_SIPS = fs.existsSync('/usr/bin/sips')

const IMAGE_MIME = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
}
const STATIC_MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webmanifest': 'application/manifest+json',
}
const ARCHIVE_EXT = new Set(['.cbz', '.zip'])

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })
const naturalCompare = (a, b) => collator.compare(a, b)

const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
let gbkDecoder = null
try {
    gbkDecoder = new TextDecoder('gbk')
} catch {
    gbkDecoder = null
}

function expandHome(p) {
    return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
}

function resolveLibraryRoots() {
    const fromArgs = process.argv.slice(2)
    const raw = fromArgs.length > 0
        ? fromArgs
        : (process.env.EHUNTER_LIBRARY || '').split(path.delimiter)
    return raw.map(item => item.trim()).filter(Boolean).map(item => path.resolve(expandHome(item)))
}

const libraryRoots = resolveLibraryRoots()
if (libraryRoots.length === 0) {
    console.error('用法: node server/index.mjs <书库目录或CBZ文件> [更多目录...]')
    console.error('也可以设置环境变量 EHUNTER_LIBRARY（多个路径用 ":" 分隔）')
    process.exit(1)
}

const isImageName = name => !name.startsWith('.') && Object.hasOwn(IMAGE_MIME, path.extname(name).toLowerCase())
const isArchiveName = name => !name.startsWith('.') && ARCHIVE_EXT.has(path.extname(name).toLowerCase())
const hashId = text => crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)

// ---------- zip ----------

function decodeZipName(buf, isUtf8Flag) {
    if (isUtf8Flag) {
        return buf.toString('utf8')
    }
    try {
        return utf8Decoder.decode(buf)
    } catch {
        return gbkDecoder ? gbkDecoder.decode(buf) : buf.toString('latin1')
    }
}

async function readZipCentralDirectory(fh, fileSize) {
    const tailLen = Math.min(fileSize, 65557)
    const tail = Buffer.alloc(tailLen)
    await fh.read(tail, 0, tailLen, fileSize - tailLen)
    let eocd = -1
    for (let i = tailLen - 22; i >= 0; i--) {
        if (tail.readUInt32LE(i) === 0x06054b50) {
            eocd = i
            break
        }
    }
    if (eocd < 0) {
        throw new Error('not a zip file')
    }
    let count = tail.readUInt16LE(eocd + 10)
    let cdSize = tail.readUInt32LE(eocd + 12)
    let cdOffset = tail.readUInt32LE(eocd + 16)
    const locatorPos = eocd - 20
    if ((count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) && locatorPos >= 0
        && tail.readUInt32LE(locatorPos) === 0x07064b50) {
        const zip64EocdOffset = Number(tail.readBigUInt64LE(locatorPos + 8))
        const z = Buffer.alloc(56)
        await fh.read(z, 0, 56, zip64EocdOffset)
        if (z.readUInt32LE(0) === 0x06064b50) {
            count = Number(z.readBigUInt64LE(32))
            cdSize = Number(z.readBigUInt64LE(40))
            cdOffset = Number(z.readBigUInt64LE(48))
        }
    }
    const cd = Buffer.alloc(cdSize)
    await fh.read(cd, 0, cdSize, cdOffset)
    const entries = []
    let p = 0
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
        if (cd.readUInt32LE(p) !== 0x02014b50) {
            break
        }
        const flags = cd.readUInt16LE(p + 8)
        const method = cd.readUInt16LE(p + 10)
        let compSize = cd.readUInt32LE(p + 20)
        let size = cd.readUInt32LE(p + 24)
        const nameLen = cd.readUInt16LE(p + 28)
        const extraLen = cd.readUInt16LE(p + 30)
        const commentLen = cd.readUInt16LE(p + 32)
        let localOffset = cd.readUInt32LE(p + 42)
        const name = decodeZipName(cd.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0)
        if (size === 0xffffffff || compSize === 0xffffffff || localOffset === 0xffffffff) {
            let e = p + 46 + nameLen
            const extraEnd = e + extraLen
            while (e + 4 <= extraEnd) {
                const id = cd.readUInt16LE(e)
                const len = cd.readUInt16LE(e + 2)
                if (id === 0x0001) {
                    let q = e + 4
                    if (size === 0xffffffff) { size = Number(cd.readBigUInt64LE(q)); q += 8 }
                    if (compSize === 0xffffffff) { compSize = Number(cd.readBigUInt64LE(q)); q += 8 }
                    if (localOffset === 0xffffffff) { localOffset = Number(cd.readBigUInt64LE(q)) }
                    break
                }
                e += 4 + len
            }
        }
        entries.push({ name, method, compSize, size, localOffset, isDir: name.endsWith('/') })
        p += 46 + nameLen + extraLen + commentLen
    }
    return entries
}

async function resolveZipDataOffset(fh, entry) {
    if (entry.dataOffset !== undefined) {
        return entry.dataOffset
    }
    const header = Buffer.alloc(30)
    await fh.read(header, 0, 30, entry.localOffset)
    if (header.readUInt32LE(0) !== 0x04034b50) {
        throw new Error(`bad local header: ${entry.name}`)
    }
    entry.dataOffset = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
    return entry.dataOffset
}

async function readWholeZipEntry(zipPath, fh, entry) {
    const offset = await resolveZipDataOffset(fh, entry)
    const raw = Buffer.alloc(entry.compSize)
    await fh.read(raw, 0, entry.compSize, offset)
    if (entry.method === 0) {
        return raw
    }
    if (entry.method === 8) {
        return zlib.inflateRawSync(raw)
    }
    throw new Error(`unsupported zip compression method ${entry.method} in ${zipPath}`)
}

// ---------- image dimensions ----------

async function readImageSize(readAt, totalSize) {
    const head = await readAt(0, 32)
    if (head.length >= 24 && head.readUInt32BE(0) === 0x89504e47) {
        return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) }
    }
    if (head.length >= 10 && head.toString('ascii', 0, 3) === 'GIF') {
        return { w: head.readUInt16LE(6), h: head.readUInt16LE(8) }
    }
    if (head.length >= 30 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') {
        const chunk = head.toString('ascii', 12, 16)
        if (chunk === 'VP8X') {
            return { w: 1 + head.readUIntLE(24, 3), h: 1 + head.readUIntLE(27, 3) }
        }
        if (chunk === 'VP8 ') {
            return { w: head.readUInt16LE(26) & 0x3fff, h: head.readUInt16LE(28) & 0x3fff }
        }
        if (chunk === 'VP8L') {
            const bits = head.readUInt32LE(21)
            return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }
        }
    }
    if (head.length >= 2 && head[0] === 0xff && head[1] === 0xd8) {
        let pos = 2
        while (pos + 4 <= totalSize) {
            const m = await readAt(pos, 9)
            if (m.length < 4) {
                break
            }
            if (m[0] !== 0xff) {
                pos++
                continue
            }
            const marker = m[1]
            if (marker === 0xff) {
                pos++
                continue
            }
            if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
                pos += 2
                continue
            }
            const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
            if (isSof && m.length >= 9) {
                return { h: m.readUInt16BE(5), w: m.readUInt16BE(7) }
            }
            pos += 2 + m.readUInt16BE(2)
        }
    }
    return null
}

function readerForBuffer(buf) {
    return async (offset, length) => buf.subarray(offset, Math.min(buf.length, offset + length))
}

function readerForRange(fh, start, size) {
    return async (offset, length) => {
        const len = Math.max(0, Math.min(length, size - offset))
        const buf = Buffer.alloc(len)
        if (len > 0) {
            await fh.read(buf, 0, len, start + offset)
        }
        return buf
    }
}

// ---------- ComicInfo ----------

function decodeXmlText(text) {
    return text
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&amp;/g, '&').trim()
}

function parseComicInfo(xml) {
    const pick = tag => {
        const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
        return m ? decodeXmlText(m[1]) : ''
    }
    return { title: pick('Title'), series: pick('Series'), number: pick('Number') }
}

// ---------- metadata cache ----------

let metaCache = {}
try {
    metaCache = JSON.parse(fs.readFileSync(META_CACHE_FILE, 'utf8'))
} catch {
    metaCache = {}
}
let metaCacheDirty = false
let metaCacheTimer = null

function scheduleMetaCacheFlush() {
    metaCacheDirty = true
    if (metaCacheTimer) {
        return
    }
    metaCacheTimer = setTimeout(async () => {
        metaCacheTimer = null
        if (!metaCacheDirty) {
            return
        }
        metaCacheDirty = false
        await fsp.mkdir(CACHE_DIR, { recursive: true })
        const tmp = `${META_CACHE_FILE}.${process.pid}.tmp`
        await fsp.writeFile(tmp, JSON.stringify(metaCache))
        await fsp.rename(tmp, META_CACHE_FILE)
    }, 500)
}

// ---------- albums ----------

const DEFAULT_SIZE = { w: 1000, h: 1414 }

async function loadZipAlbum(zipPath, stat) {
    const stamp = `${stat.size}-${Math.floor(stat.mtimeMs)}`
    const fh = await fsp.open(zipPath, 'r')
    try {
        const entries = await readZipCentralDirectory(fh, stat.size)
        const pageEntries = entries
            .filter(e => !e.isDir && !e.name.split('/').some(part => part.startsWith('.') || part === '__MACOSX'))
            .filter(e => isImageName(path.basename(e.name)))
            .sort((a, b) => naturalCompare(a.name, b.name))
        const cacheKey = `zip:${zipPath}`
        let meta = metaCache[cacheKey]
        if (!meta || meta.stamp !== stamp) {
            const infoEntry = entries.find(e => path.basename(e.name).toLowerCase() === 'comicinfo.xml')
            const info = infoEntry
                ? parseComicInfo((await readWholeZipEntry(zipPath, fh, infoEntry)).toString('utf8'))
                : { title: '', series: '', number: '' }
            const sizes = []
            for (const entry of pageEntries) {
                let size = null
                try {
                    if (entry.method === 0) {
                        const offset = await resolveZipDataOffset(fh, entry)
                        size = await readImageSize(readerForRange(fh, offset, entry.compSize), entry.compSize)
                    } else {
                        const buf = await readWholeZipEntry(zipPath, fh, entry)
                        size = await readImageSize(readerForBuffer(buf), buf.length)
                    }
                } catch {
                    size = null
                }
                sizes.push(size || DEFAULT_SIZE)
            }
            meta = { stamp, info, sizes, names: pageEntries.map(e => e.name) }
            metaCache[cacheKey] = meta
            scheduleMetaCacheFlush()
        }
        const name = path.basename(zipPath, path.extname(zipPath))
        return {
            id: hashId(zipPath),
            kind: 'zip',
            source: zipPath,
            stamp,
            name,
            info: meta.info,
            pages: pageEntries.map((entry, i) => ({
                entry,
                name: entry.name,
                ext: path.extname(entry.name).toLowerCase(),
                ...(meta.sizes[i] || DEFAULT_SIZE),
            })),
        }
    } finally {
        await fh.close()
    }
}

async function loadFolderAlbum(dirPath, dirStat, imageNames) {
    const stamp = `${imageNames.length}-${Math.floor(dirStat.mtimeMs)}`
    const sorted = [...imageNames].sort(naturalCompare)
    const cacheKey = `dir:${dirPath}`
    let meta = metaCache[cacheKey]
    if (!meta || meta.stamp !== stamp) {
        let info = { title: '', series: '', number: '' }
        try {
            info = parseComicInfo(await fsp.readFile(path.join(dirPath, 'ComicInfo.xml'), 'utf8'))
        } catch {
            // no ComicInfo.xml
        }
        const sizes = []
        for (const fileName of sorted) {
            const filePath = path.join(dirPath, fileName)
            let size = null
            try {
                const fh = await fsp.open(filePath, 'r')
                try {
                    const st = await fh.stat()
                    size = await readImageSize(readerForRange(fh, 0, st.size), st.size)
                } finally {
                    await fh.close()
                }
            } catch {
                size = null
            }
            sizes.push(size || DEFAULT_SIZE)
        }
        meta = { stamp, info, sizes, names: sorted }
        metaCache[cacheKey] = meta
        scheduleMetaCacheFlush()
    }
    return {
        id: hashId(dirPath),
        kind: 'dir',
        source: dirPath,
        stamp,
        name: path.basename(dirPath),
        info: meta.info,
        pages: sorted.map((fileName, i) => ({
            file: path.join(dirPath, fileName),
            name: fileName,
            ext: path.extname(fileName).toLowerCase(),
            ...(meta.sizes[i] || DEFAULT_SIZE),
        })),
    }
}

async function listImageNames(dirPath) {
    const dirents = await fsp.readdir(dirPath, { withFileTypes: true })
    return dirents.filter(d => d.isFile() && isImageName(d.name)).map(d => d.name)
}

let albumList = []
let albumMap = new Map()
let scanPromise = null

async function scanLibrary() {
    const albums = []
    for (const root of libraryRoots) {
        let st
        try {
            st = await fsp.stat(root)
        } catch {
            console.warn(`[library] 路径不存在: ${root}`)
            continue
        }
        try {
            if (st.isFile() && isArchiveName(path.basename(root))) {
                albums.push(await loadZipAlbum(root, st))
                continue
            }
            if (!st.isDirectory()) {
                continue
            }
            const rootImages = await listImageNames(root)
            if (rootImages.length > 0) {
                albums.push(await loadFolderAlbum(root, st, rootImages))
            }
            const dirents = (await fsp.readdir(root, { withFileTypes: true }))
                .filter(d => !d.name.startsWith('.'))
                .sort((a, b) => naturalCompare(a.name, b.name))
            for (const d of dirents) {
                const childPath = path.join(root, d.name)
                try {
                    if (d.isFile() && isArchiveName(d.name)) {
                        albums.push(await loadZipAlbum(childPath, await fsp.stat(childPath)))
                    } else if (d.isDirectory()) {
                        const images = await listImageNames(childPath)
                        if (images.length > 0) {
                            albums.push(await loadFolderAlbum(childPath, await fsp.stat(childPath), images))
                        }
                    }
                } catch (err) {
                    console.warn(`[library] 跳过 ${childPath}: ${err.message}`)
                }
            }
        } catch (err) {
            console.warn(`[library] 扫描失败 ${root}: ${err.message}`)
        }
    }
    albumList = albums.filter(a => a.pages.length > 0)
    albumMap = new Map(albumList.map(a => [a.id, a]))
    return albumList
}

function rescan() {
    if (!scanPromise) {
        scanPromise = scanLibrary().finally(() => {
            scanPromise = null
        })
    }
    return scanPromise
}

async function getAlbum(id) {
    if (!albumMap.has(id)) {
        await rescan()
    }
    return albumMap.get(id) || null
}

function displayTitle(album) {
    const { title, series, number } = album.info
    if (series && title) {
        return number ? `${series} · 第${number}卷 · ${title}` : `${series} · ${title}`
    }
    return title || album.name
}

function albumSummary(album) {
    return {
        id: album.id,
        name: album.name,
        title: album.info.title || album.name,
        series: album.info.series,
        number: album.info.number,
        displayTitle: displayTitle(album),
        pageCount: album.pages.length,
        cover: `/thumb/${album.id}/0`,
    }
}

function thumbSize(page) {
    const scale = Math.min(1, THUMB_MAX_SIZE / Math.max(page.w, page.h))
    return { tw: Math.max(1, Math.round(page.w * scale)), th: Math.max(1, Math.round(page.h * scale)) }
}

// ---------- page streams & thumbnails ----------

async function openPageStream(album, page) {
    if (album.kind === 'dir') {
        const st = await fsp.stat(page.file)
        return { stream: fs.createReadStream(page.file), length: st.size }
    }
    const fh = await fsp.open(album.source, 'r')
    let offset
    try {
        offset = await resolveZipDataOffset(fh, page.entry)
    } finally {
        await fh.close()
    }
    const raw = fs.createReadStream(album.source, { start: offset, end: offset + page.entry.compSize - 1 })
    if (page.entry.method === 0) {
        return { stream: raw, length: page.entry.compSize }
    }
    if (page.entry.method === 8) {
        return { stream: raw.pipe(zlib.createInflateRaw()), length: page.entry.size }
    }
    raw.destroy()
    throw new Error(`unsupported compression method ${page.entry.method}`)
}

const thumbJobs = new Map()
const thumbQueue = []
let thumbRunning = 0

function runLimited(task) {
    return new Promise((resolve, reject) => {
        thumbQueue.push({ task, resolve, reject })
        pumpThumbQueue()
    })
}

function pumpThumbQueue() {
    while (thumbRunning < THUMB_CONCURRENCY && thumbQueue.length > 0) {
        const { task, resolve, reject } = thumbQueue.shift()
        thumbRunning++
        task().then(resolve, reject).finally(() => {
            thumbRunning--
            pumpThumbQueue()
        })
    }
}

async function ensureThumb(album, index) {
    const page = album.pages[index]
    const dir = path.join(CACHE_DIR, 'thumbs', album.id)
    const out = path.join(dir, `${hashId(album.stamp)}-${index}.jpg`)
    if (fs.existsSync(out)) {
        return out
    }
    if (thumbJobs.has(out)) {
        return thumbJobs.get(out)
    }
    const job = runLimited(async () => {
        await fsp.mkdir(dir, { recursive: true })
        let input = page.file
        let tmpInput = null
        if (album.kind === 'zip') {
            await fsp.mkdir(path.join(CACHE_DIR, 'tmp'), { recursive: true })
            tmpInput = path.join(CACHE_DIR, 'tmp', `${crypto.randomUUID()}${page.ext}`)
            const { stream } = await openPageStream(album, page)
            await pipeline(stream, fs.createWriteStream(tmpInput))
            input = tmpInput
        }
        const partial = `${out}.${process.pid}.part.jpg`
        try {
            await execFileP('/usr/bin/sips', [
                '-Z', String(THUMB_MAX_SIZE),
                '-s', 'format', 'jpeg',
                '-s', 'formatOptions', '82',
                input, '--out', partial,
            ])
            await fsp.rename(partial, out)
        } finally {
            if (tmpInput) {
                await fsp.rm(tmpInput, { force: true })
            }
            await fsp.rm(partial, { force: true })
        }
        return out
    })
    thumbJobs.set(out, job)
    job.finally(() => thumbJobs.delete(out)).catch(() => {})
    return job
}

// ---------- http ----------

function sendJson(res, status, data) {
    const body = JSON.stringify(data)
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
    })
    res.end(body)
}

async function sendStream(res, stream, headers) {
    res.writeHead(200, headers)
    try {
        await pipeline(stream, res)
    } catch {
        stream.destroy()
    }
}

async function servePage(res, album, index) {
    const page = album.pages[index]
    const { stream, length } = await openPageStream(album, page)
    await sendStream(res, stream, {
        'Content-Type': IMAGE_MIME[page.ext] || 'application/octet-stream',
        'Content-Length': length,
        'Cache-Control': 'private, max-age=86400',
    })
}

async function serveThumb(res, album, index) {
    if (!HAS_SIPS) {
        return servePage(res, album, index)
    }
    let file
    try {
        file = await ensureThumb(album, index)
    } catch (err) {
        console.warn(`[thumb] 生成失败 ${album.name} #${index}: ${err.message}`)
        return servePage(res, album, index)
    }
    const st = await fsp.stat(file)
    await sendStream(res, fs.createReadStream(file), {
        'Content-Type': 'image/jpeg',
        'Content-Length': st.size,
        'Cache-Control': 'private, max-age=86400',
    })
}

async function serveStatic(res, pathname) {
    let rel
    try {
        rel = decodeURIComponent(pathname)
    } catch {
        return sendJson(res, 400, { error: 'bad path' })
    }
    let file = path.normalize(path.join(DIST_DIR, rel))
    if (file !== DIST_DIR && !file.startsWith(DIST_DIR + path.sep)) {
        return sendJson(res, 403, { error: 'forbidden' })
    }
    let st = null
    try {
        st = await fsp.stat(file)
    } catch {
        st = null
    }
    if (!st || st.isDirectory()) {
        file = path.join(DIST_DIR, 'index.html')
        try {
            st = await fsp.stat(file)
        } catch {
            return sendJson(res, 500, { error: '找不到 dist/index.html，请先运行 npm run build' })
        }
    }
    const ext = path.extname(file).toLowerCase()
    const isAsset = rel.startsWith('/assets/')
    await sendStream(res, fs.createReadStream(file), {
        'Content-Type': STATIC_MIME[ext] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
}

function parseIndex(album, raw) {
    const index = Number.parseInt(raw, 10)
    if (!Number.isInteger(index) || index < 0 || index >= album.pages.length) {
        return null
    }
    return index
}

async function handle(req, res) {
    const url = new URL(req.url, `http://${HOST}`)
    const { pathname } = url
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: 'method not allowed' })
    }

    if (pathname === '/api/library') {
        const albums = await rescan()
        return sendJson(res, 200, { roots: libraryRoots, albums: albums.map(albumSummary) })
    }

    let m = pathname.match(/^\/api\/album\/([0-9a-f]{12})$/)
    if (m) {
        const album = await getAlbum(m[1])
        if (!album) {
            return sendJson(res, 404, { error: 'album not found' })
        }
        const pos = albumList.indexOf(album)
        const neighbor = a => (a ? { id: a.id, title: a.info.title || a.name, displayTitle: displayTitle(a) } : null)
        return sendJson(res, 200, {
            ...albumSummary(album),
            pages: album.pages.map(p => ({ w: p.w, h: p.h, ...thumbSize(p) })),
            prev: neighbor(albumList[pos - 1]),
            next: neighbor(albumList[pos + 1]),
        })
    }

    m = pathname.match(/^\/(img|thumb)\/([0-9a-f]{12})\/(\d+)$/)
    if (m) {
        const album = await getAlbum(m[2])
        const index = album ? parseIndex(album, m[3]) : null
        if (!album || index === null) {
            return sendJson(res, 404, { error: 'page not found' })
        }
        return m[1] === 'img' ? servePage(res, album, index) : serveThumb(res, album, index)
    }

    if (pathname.startsWith('/api/')) {
        return sendJson(res, 404, { error: 'not found' })
    }
    return serveStatic(res, pathname)
}

const server = http.createServer((req, res) => {
    handle(req, res).catch(err => {
        console.error(`[http] ${req.url}: ${err.stack || err.message}`)
        if (!res.headersSent) {
            sendJson(res, 500, { error: err.message })
        } else {
            res.destroy()
        }
    })
})

server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
        console.error(`端口 ${PORT} 已被占用（可能已经在运行）。可用 PORT=xxxx 指定其他端口。`)
        process.exit(2)
    }
    throw err
})

await rescan()
server.listen(PORT, HOST, () => {
    console.log(`eHunter Local 已启动: http://${HOST}:${PORT}`)
    console.log(`书库: ${libraryRoots.join(', ')}（${albumList.length} 本）`)
    if (!HAS_SIPS) {
        console.log('未找到 sips，缩略图将直接使用原图')
    }
})
