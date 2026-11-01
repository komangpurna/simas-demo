/* js/asc-schedule-parser.js - Parser aSc Timetables XML & Smart Matching Guru */

import { cfClient } from './cloudflare-client.js';

// Key Cache LocalStorage
const XML_CACHE_KEY = 'simas_asc_schedule_cache';
const XML_CACHE_TS_KEY = 'simas_asc_schedule_cache_ts';
const CUSTOM_MAPPING_KEY = 'simas_asc_teacher_mapping';

// State Internal Module
let parsedScheduleData = null;
let customTeacherMapping = {};

/**
 * Normalisasi nama untuk pencocokan Level 1 (menghapus gelar, tanda baca, huruf kecil)
 */
export function normalizeTeacherName(name) {
    if (!name) return '';
    let clean = name.toLowerCase();

    // 1. Normalisasi variasi spasi dalam inisial gelar (misal: 's. pd' -> 's.pd', 'm. pd. h' -> 'm.pd.h')
    clean = clean.replace(/\b([a-z])\.\s+([a-z])\b/gi, '$1.$2');
    clean = clean.replace(/\b([a-z])\.\s+([a-z])\b/gi, '$1.$2');

    // 2. Hapus gelar umum & singkatan lengkap
    const titlePatterns = [
        /\bm\.?\s*pd\.?\s*h\.?\b/gi,
        /\bs\.?\s*pd\.?\s*h\.?\b/gi,
        /\bm\.?\s*pd\.?\b/gi,
        /\bs\.?\s*pd\.?\b/gi,
        /\bs\.?\s*ag\.?\b/gi,
        /\bs\.?\s*kom\.?\b/gi,
        /\bs\.?\s*e\.?\b/gi,
        /\bs\.?\s*t\.?\b/gi,
        /\bm\.?\s*si\.?\b/gi,
        /\bm\.?\s*m\.?\b/gi,
        /\bm\.?\s*p\.?\b/gi,
        /\bs\.?\s*p\.?\b/gi,
        /\bdrs\.?\b/gi,
        /\bdr\.?\b/gi,
        /\bgr\.?\b/gi,
        /\bh\.?\b/gi,
        /\bhj\.?\b/gi,
        /\btim\s*bk\b/gi,
        /\btim\b/gi
    ];
    titlePatterns.forEach(pattern => {
        clean = clean.replace(pattern, ' ');
    });

    clean = clean.replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
    return clean;
}

/**
 * Memuat custom teacher mapping dari Cloudflare D1 / LocalStorage
 */
export async function loadCustomTeacherMapping() {
    try {
        const localMapping = localStorage.getItem(CUSTOM_MAPPING_KEY);
        if (localMapping) {
            customTeacherMapping = JSON.parse(localMapping);
        }

        // Ambil sinkronisasi dari Cloudflare D1 SSOT jika cache lokal belum ada atau sudah melewati TTL check (5 menit)
        const lastCheckStr = localStorage.getItem(XML_LAST_CHECK_TS_KEY);
        const lastCheck = lastCheckStr ? parseInt(lastCheckStr, 10) : 0;
        if (!localMapping || Date.now() - lastCheck > XML_CHECK_TTL_MS) {
            let serverMapping = null;
            if (cfClient && cfClient.enabled) {
                try {
                    const sched = await cfClient.getScheduleConfig();
                    if (sched && sched.teacherMapping) {
                        serverMapping = sched.teacherMapping;
                    }
                } catch (cfErr) {
                    console.error('[ScheduleParser] Gagal memuat mapping dari Cloudflare D1:', cfErr);
                }
            }

            if (serverMapping) {
                customTeacherMapping = {
                    ...customTeacherMapping,
                    ...serverMapping
                };
                localStorage.setItem(CUSTOM_MAPPING_KEY, JSON.stringify(customTeacherMapping));
            }
        }
    } catch (e) {
        console.warn('[ScheduleParser] Gagal memuat custom teacher mapping:', e);
    }
    return customTeacherMapping;
}

/**
 * Menyimpan custom teacher mapping ke LocalStorage dan Cloudflare D1 (SSOT)
 */
export async function saveCustomTeacherMapping(newMapping) {
    try {
        customTeacherMapping = {
            ...customTeacherMapping,
            ...newMapping
        };
        localStorage.setItem(CUSTOM_MAPPING_KEY, JSON.stringify(customTeacherMapping));

        const cachedXml = localStorage.getItem(XML_CACHE_KEY) || '';
        const fileName = localStorage.getItem('simas_asc_xml_filename') || 'Jadwal.xml';

        // Simpan ke Cloudflare D1 (SSOT 0 Firestore Write)
        if (cfClient && cfClient.enabled) {
            try {
                await cfClient.saveScheduleConfig({
                    xmlContent: cachedXml,
                    fileName: fileName,
                    teacherMapping: customTeacherMapping
                });
            } catch (cfErr) {
                console.error('[ScheduleParser] Gagal menyimpan mapping ke Cloudflare D1:', cfErr);
                throw cfErr;
            }
        }

        console.log('[ScheduleParser] Custom mapping berhasil disimpan ke Cloudflare D1');
        // Clear cache parser agar recalculate
        parsedScheduleData = null;
        return true;
    } catch (e) {
        console.error('[ScheduleParser] Gagal menyimpan mapping:', e);
        return false;
    }
}

const XML_LAST_CHECK_TS_KEY = 'simas_asc_last_sync_check';
const XML_CHECK_TTL_MS = 5 * 60 * 1000; // 5 menit TTL pengecekan timestamp SSOT

/**
 * Mengosongkan cache jadwal lokal agar sistem dipaksa membaca ulang dari SSOT Cloudflare D1
 */
export function invalidateScheduleCache() {
    try {
        localStorage.removeItem(XML_CACHE_KEY);
        localStorage.removeItem(XML_CACHE_TS_KEY);
        localStorage.removeItem(XML_LAST_CHECK_TS_KEY);
        localStorage.removeItem('simas_asc_xml_filename');
    } catch (e) {}
    parsedScheduleData = null;
    parsePromise = null;
    console.log('[ScheduleParser] Cache jadwal lokal direset ke SSOT Cloudflare D1.');
}

/**
 * Menyimpan file XML jadwal baru yang diunggah Wakasek Kurikulum ke LocalStorage dan Cloudflare D1 (SSOT)
 */
export async function saveUploadedASCScheduleXML(xmlText, fileName = 'Jadwal_Custom.xml') {
    try {
        const nowIso = new Date().toISOString();
        localStorage.setItem(XML_CACHE_KEY, xmlText);
        localStorage.setItem(XML_CACHE_TS_KEY, nowIso);
        localStorage.setItem(XML_LAST_CHECK_TS_KEY, Date.now().toString());
        localStorage.setItem('simas_asc_xml_filename', fileName);

        // Simpan ke Cloudflare D1 (SSOT terpusat untuk SIMAS, Jurnal, dan Presensi Guru)
        if (cfClient && cfClient.enabled) {
            try {
                await cfClient.saveScheduleConfig({
                    xmlContent: xmlText,
                    fileName: fileName,
                    teacherMapping: customTeacherMapping
                });
                console.log('[ScheduleParser] XML Jadwal baru berhasil disimpan ke Cloudflare D1 (SSOT 0 Firestore Write)');
            } catch (cfErr) {
                console.error('[ScheduleParser] Gagal simpan ke Cloudflare D1:', cfErr);
                throw cfErr;
            }
        }

        parsedScheduleData = null;
        parsePromise = null;

        // Broadcast event agar semua listener/komponen di tab aktif langsung re-render
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('simas-schedule-updated', { detail: { fileName, updatedAt: nowIso } }));
        }

        return true;
    } catch (e) {
        console.error('[ScheduleParser] Error saving XML content:', e);
        return false;
    }
}

/**
 * Mengambil informasi sumber file XML (nama file & timestamp update)
 */
export function getASCScheduleSourceInfo() {
    const fileName = localStorage.getItem('simas_asc_xml_filename') || 'assets/Jadwal.xml';
    const timestamp = localStorage.getItem(XML_CACHE_TS_KEY);
    return {
        fileName,
        isCustom: fileName !== 'assets/Jadwal.xml',
        updatedAt: timestamp ? new Date(timestamp).toLocaleString('id-ID', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) : 'Bawaan Sistem'
    };
}

let parsePromise = null;

/**
 * Mengurai berkas XML Jadwal Pelajaran aSc Timetables
 * @param {string} [customXmlString] - Opsional string XML manual (misal saat preview upload)
 * @param {boolean} [forceFresh=false] - Paksa parsing ulang dan perbarui cache dari SSOT D1
 * @returns {Promise<Object>} Data terstruktur jadwal sekolah
 */
export async function parseASCSchedule(xmlString = null, forceFresh = false) {
    if (parsedScheduleData && !xmlString && !forceFresh) {
        return parsedScheduleData;
    }
    if (parsePromise && !xmlString && !forceFresh) {
        return parsePromise;
    }

    parsePromise = (async () => {
        try {
            await loadCustomTeacherMapping();

        let xmlText = xmlString;

        if (!xmlText) {
            let cachedXml = localStorage.getItem(XML_CACHE_KEY);
            if (cachedXml && !cachedXml.trim().startsWith('<')) {
                // Hapus cache corrupt jika pernah tersimpan data JSON bukannya string XML
                localStorage.removeItem(XML_CACHE_KEY);
                cachedXml = null;
            }

            const cachedTs = localStorage.getItem(XML_CACHE_TS_KEY);
            const lastCheckStr = localStorage.getItem(XML_LAST_CHECK_TS_KEY);
            const lastCheck = lastCheckStr ? parseInt(lastCheckStr, 10) : 0;
            const isCheckStale = forceFresh || !cachedXml || !cachedTs || (Date.now() - lastCheck > XML_CHECK_TTL_MS);

            // Cek ke Cloudflare D1 SSOT jika cache belum ada atau sudah melewati TTL check (5 menit)
            if (isCheckStale) {
                try {
                    localStorage.setItem(XML_LAST_CHECK_TS_KEY, Date.now().toString());

                    let serverData = null;
                    if (cfClient && cfClient.enabled) {
                        try {
                            serverData = await cfClient.getScheduleConfig();
                        } catch (cfErr) {
                            console.error('[ScheduleParser] Gagal memuat jadwal dari Cloudflare D1:', cfErr);
                        }
                    }

                    if (serverData && serverData.xmlContent) {
                        const serverUpdatedAt = serverData.updatedAt || '';

                        // Jika data di server berbeda atau lebih baru dari cache lokal
                        if (!cachedTs || cachedTs !== serverUpdatedAt || !cachedXml) {
                            cachedXml = serverData.xmlContent;
                            localStorage.setItem(XML_CACHE_KEY, cachedXml);
                            localStorage.setItem(XML_CACHE_TS_KEY, serverUpdatedAt || new Date().toISOString());
                            if (serverData.fileName) {
                                localStorage.setItem('simas_asc_xml_filename', serverData.fileName);
                            }
                            if (serverData.teacherMapping) {
                                customTeacherMapping = { ...customTeacherMapping, ...serverData.teacherMapping };
                                localStorage.setItem(CUSTOM_MAPPING_KEY, JSON.stringify(customTeacherMapping));
                            }
                            parsedScheduleData = null; // Invalidate parsed data agar ter-parse ulang
                        }
                    }
                } catch (err) {
                    console.warn('[ScheduleParser] Gagal sinkronisasi SSOT dari D1:', err);
                }
            }

            xmlText = cachedXml;

            // Fallback ke assets/Jadwal.xml default jika belum ada upload khusus
            if (!xmlText) {
                const response = await fetch('assets/Jadwal.xml');
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                xmlText = await response.text();
            }
        }

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");

        // 1. Periods (Jam Pelajaran)
        const periods = [];
        xmlDoc.querySelectorAll("periods > period").forEach(p => {
            periods.push({
                jp: parseInt(p.getAttribute("period")),
                name: p.getAttribute("name"),
                short: p.getAttribute("short"),
                start: p.getAttribute("starttime"),
                end: p.getAttribute("endtime")
            });
        });

        // 2. Subjects (Mata Pelajaran)
        const subjectsMap = new Map();
        xmlDoc.querySelectorAll("subjects > subject").forEach(s => {
            subjectsMap.set(s.getAttribute("id"), {
                id: s.getAttribute("id"),
                name: s.getAttribute("name"),
                short: s.getAttribute("short")
            });
        });

        // 3. Master Guru & Guru BK dari SIMAS (untuk Smart Matching)
        let simasTeachers = [];
        if (typeof window !== 'undefined' && window.getTeachersCache) {
            simasTeachers = await window.getTeachersCache();
        }
        if (!Array.isArray(simasTeachers)) simasTeachers = [];

        let bkTeachersList = [];
        if (typeof window !== 'undefined' && typeof window.getBkTeachersCache === 'function') {
            bkTeachersList = await window.getBkTeachersCache();
        }
        if (!Array.isArray(bkTeachersList)) bkTeachersList = [];

        // 4. Teachers (Guru dari XML)
        const teachersMap = new Map();
        const unmatchedTeachersList = [];

        xmlDoc.querySelectorAll("teachers > teacher").forEach(t => {
            const xmlId = t.getAttribute("id");
            const xmlName = t.getAttribute("name");
            const xmlShort = t.getAttribute("short");

            // Smart Matching 4-Level
            let matchedSimasTeacher = null;

            // Level 4: Custom Mapping Table (Prioritas Utama jika diatur manual)
            if (customTeacherMapping[xmlId]) {
                const mappedId = customTeacherMapping[xmlId];
                matchedSimasTeacher = simasTeachers.find(st => st.id === mappedId || st.nik === mappedId || st.nip === mappedId) ||
                                      bkTeachersList.find(bk => bk.id === mappedId || bk.uid === mappedId || bk.nik === mappedId || bk.nip === mappedId);
            }

            // Level 1: Exact Normalized Match
            if (!matchedSimasTeacher) {
                const normXml = normalizeTeacherName(xmlName);
                matchedSimasTeacher = simasTeachers.find(st => {
                    const normSimas = normalizeTeacherName(st.name);
                    return normXml && normSimas && (normXml === normSimas || normSimas.includes(normXml) || normXml.includes(normSimas));
                });
            }

            // Level 2: Match berdasarkan Kode/NIK/NIP (`short` attribute)
            if (!matchedSimasTeacher && xmlShort) {
                matchedSimasTeacher = simasTeachers.find(st => st.nik === xmlShort || st.nip === xmlShort || st.id === xmlShort);
            }

            // Level 3: Fuzzy Keyword Token Match
            if (!matchedSimasTeacher) {
                const xmlTokens = normalizeTeacherName(xmlName).split(' ').filter(tok => tok.length > 2);
                if (xmlTokens.length > 0) {
                    matchedSimasTeacher = simasTeachers.find(st => {
                        const simasNorm = normalizeTeacherName(st.name);
                        return xmlTokens.every(tok => simasNorm.includes(tok));
                    });
                }
            }

            if (!matchedSimasTeacher) {
                unmatchedTeachersList.push({ xmlId, xmlName, xmlShort });
            }


            teachersMap.set(xmlId, {
                id: xmlId,
                name: xmlName,
                short: xmlShort,
                simasId: matchedSimasTeacher ? matchedSimasTeacher.id : '',
                simasName: matchedSimasTeacher ? matchedSimasTeacher.name : xmlName,
                simasNip: matchedSimasTeacher ? (matchedSimasTeacher.nip || '') : '',
                foto: matchedSimasTeacher ? (matchedSimasTeacher.foto || '') : '',
                simasFoto: matchedSimasTeacher ? (matchedSimasTeacher.foto || '') : '',
                isMatched: !!matchedSimasTeacher
            });
        });

        // 5. Classes (Kelas)
        const classesMap = new Map();
        xmlDoc.querySelectorAll("classes > class").forEach(c => {
            classesMap.set(c.getAttribute("id"), {
                id: c.getAttribute("id"),
                name: c.getAttribute("name"),
                short: c.getAttribute("short")
            });
        });

        // 6. Lessons (Pelajaran)
        const lessonsMap = new Map();
        xmlDoc.querySelectorAll("lessons > lesson").forEach(l => {
            const classIds = (l.getAttribute("classids") || "").split(",").filter(Boolean);
            const teacherIds = (l.getAttribute("teacherids") || "").split(",").filter(Boolean);

            lessonsMap.set(l.getAttribute("id"), {
                id: l.getAttribute("id"),
                subjectId: l.getAttribute("subjectid"),
                classIds: classIds,
                teacherIds: teacherIds,
                periodsPerCard: l.getAttribute("periodspercard")
            });
        });

        // 7. Cards (Kartu Slot Jadwal)
        const dayMaskMap = {
            "10000": 1, // Senin
            "01000": 2, // Selasa
            "00100": 3, // Rabu
            "00010": 4, // Kamis
            "00001": 5  // Jumat
        };

        const scheduleMap = {};
        const teacherScheduleMap = {};

        xmlDoc.querySelectorAll("cards > card").forEach(card => {
            const lessonId = card.getAttribute("lessonid");
            const periodNum = parseInt(card.getAttribute("period"));
            const daysMask = card.getAttribute("days");
            const dayIndex = dayMaskMap[daysMask];

            if (!dayIndex || !periodNum) return;

            const lesson = lessonsMap.get(lessonId);
            if (!lesson) return;

            const subject = subjectsMap.get(lesson.subjectId);
            const subjectName = subject ? subject.name : '';

            // Ambil nama-nama kelas untuk lesson ini
            const lessonClassNames = lesson.classIds.map(classId => {
                const cls = classesMap.get(classId);
                return cls ? cls.name : '';
            }).filter(Boolean);

            // 1. Populasi scheduleMap (per Kelas)
            lesson.classIds.forEach(classId => {
                const cls = classesMap.get(classId);
                if (!cls) return;

                const className = cls.name; // Misal "X-1", "XI-5"
                if (!scheduleMap[className]) scheduleMap[className] = {};
                if (!scheduleMap[className][dayIndex]) scheduleMap[className][dayIndex] = {};

                // Ambil guru pertama
                const primaryTeacherId = lesson.teacherIds[0];
                const teacherObj = teachersMap.get(primaryTeacherId);

                scheduleMap[className][dayIndex][periodNum] = {
                    jp: periodNum,
                    mapel: subjectName,
                    guruNama: teacherObj ? teacherObj.simasName : '',
                    guruId: teacherObj ? teacherObj.simasId : '',
                    guruNip: teacherObj ? teacherObj.simasNip : '',
                    guruFoto: teacherObj ? (teacherObj.simasFoto || '') : '',
                    xmlGuruName: teacherObj ? teacherObj.name : '',
                    xmlGuruId: primaryTeacherId || '',
                    isMatched: teacherObj ? teacherObj.isMatched : false
                };
            });

            // 2. Populasi teacherScheduleMap (per Guru)
            lesson.teacherIds.forEach(tId => {
                const teacherObj = teachersMap.get(tId);
                if (!teacherObj) return;

                const validSimasId = (teacherObj.simasId && teacherObj.simasId.trim() !== '' && teacherObj.simasId.trim() !== '-') ? teacherObj.simasId.trim() : null;
                const validNip = (teacherObj.simasNip && teacherObj.simasNip.trim() !== '' && teacherObj.simasNip.trim() !== '-' && teacherObj.simasNip.trim() !== 'null' && teacherObj.simasNip.trim().length >= 5) ? teacherObj.simasNip.trim() : null;

                const keys = [tId];
                if (validSimasId) keys.push(validSimasId);
                if (validNip) keys.push(validNip);

                keys.forEach(tKey => {
                    if (!teacherScheduleMap[tKey]) teacherScheduleMap[tKey] = {};
                    if (!teacherScheduleMap[tKey][dayIndex]) teacherScheduleMap[tKey][dayIndex] = {};

                    teacherScheduleMap[tKey][dayIndex][periodNum] = {
                        jp: periodNum,
                        mapel: subjectName,
                        classNames: lessonClassNames,
                        className: lessonClassNames.join(', '),
                        teacherObj: teacherObj
                    };
                });
            });
        });

        parsedScheduleData = {
            periods,
            subjectsMap,
            teachersMap,
            classesMap,
            lessonsMap,
            unmatchedTeachersList,
            scheduleMap,
            teacherScheduleMap,
            totalLessons: lessonsMap.size,
            parsedAt: new Date().toISOString()
        };


        // Simpan cache XML text asli ke LocalStorage
        try {
            if (xmlText && typeof xmlText === 'string' && !xmlText.trim().startsWith('{')) {
                localStorage.setItem(XML_CACHE_KEY, xmlText);
            }
            localStorage.setItem(XML_CACHE_TS_KEY, Date.now().toString());
        } catch (e) {
            console.warn('[ScheduleParser] LocalStorage quota exceeded:', e);
        }


        console.log(`✅ [ScheduleParser] XML Jadwal berhasil diparse! (${lessonsMap.size} pelajaran, ${unmatchedTeachersList.length} guru unmatched)`);
        return parsedScheduleData;

    } catch (e) {
        console.error('[ScheduleParser] Gagal memparse Jadwal XML:', e);
        return null;
    } finally {
        parsePromise = null;
    }
  })();

  return parsePromise;
}

/**
 * Mengambil jadwal pelajaran spesifik untuk kelas & tanggal tertentu
 * @param {string} className - Nama kelas (misal "X-1", "XI-5")
 * @param {string} dateStr - Tanggal ISO "YYYY-MM-DD"
 */
export async function getScheduleForClassAndDate(className, dateStr) {
    if (!parsedScheduleData) {
        await parseASCSchedule();
    }

    if (!parsedScheduleData || !parsedScheduleData.scheduleMap) {
        return [];
    }

    const dateObj = dateStr ? new Date(dateStr) : new Date();
    const dayOfWeek = dateObj.getDay(); // 0=Minggu, 1=Senin, 2=Selasa, 3=Rabu, 4=Kamis, 5=Jumat, 6=Sabtu

    // Jika hari Sabtu / Minggu, kembalikan kosong
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return [];
    }

    const classSchedule = parsedScheduleData.scheduleMap[className];
    if (!classSchedule || !classSchedule[dayOfWeek]) {
        return [];
    }

    const daySchedule = classSchedule[dayOfWeek];
    const result = [];

    for (let jp = 1; jp <= 10; jp++) {
        if (daySchedule[jp]) {
            result.push(daySchedule[jp]);
        } else {
            result.push({
                jp: jp,
                mapel: '',
                guruNama: '',
                guruId: '',
                isMatched: false
            });
        }
    }

    return result;
}

/**
 * Mendapatkan daftar guru XML yang belum terhubung dengan akun SIMAS
 */
export async function getUnmatchedXMLTeachers() {
    if (!parsedScheduleData) {
        await parseASCSchedule();
    }
    return parsedScheduleData ? parsedScheduleData.unmatchedTeachersList : [];
}

/**
 * Mendapatkan semua guru dari XML beserta status matching SIMAS-nya
 */
export async function getAllXMLTeachersWithStatus() {
    if (!parsedScheduleData) {
        await parseASCSchedule();
    }
    if (!parsedScheduleData) return [];

    const list = [];
    parsedScheduleData.teachersMap.forEach(t => {
        list.push(t);
    });
    return list;
}

/**
 * Mendapatkan daftar seluruh Mata Pelajaran dari XML beserta pemetaan Guru Pengampu dan Rombel Kelas
 */
export async function getSubjectsWithLessonsFromXML() {
    if (!parsedScheduleData || !parsedScheduleData.subjectsMap || parsedScheduleData.subjectsMap.size === 0) {
        await parseASCSchedule();
    }
    if (!parsedScheduleData || !parsedScheduleData.subjectsMap) return [];


    const { subjectsMap, lessonsMap, teachersMap, classesMap } = parsedScheduleData;
    if (!subjectsMap || !lessonsMap) return [];

    const result = [];

    const subjectsArray = subjectsMap instanceof Map ? Array.from(subjectsMap.values()) : Object.values(subjectsMap);
    const lessonsArray = lessonsMap instanceof Map ? Array.from(lessonsMap.values()) : Object.values(lessonsMap);

    for (const subject of subjectsArray) {
        const mapelName = subject.name ? subject.name.trim() : '';
        if (!mapelName || mapelName.toUpperCase() === 'UPACARA') continue;

        const guruMap = new Map(); // simasId -> { uid, name, kelasSet: Set }

        lessonsArray.forEach(lesson => {
            if (lesson.subjectId === subject.id) {
                const classNames = (lesson.classIds || []).map(cId => {
                    const cObj = classesMap instanceof Map ? classesMap.get(cId) : (classesMap ? classesMap[cId] : null);
                    return cObj ? cObj.name : '';
                }).filter(Boolean);

                (lesson.teacherIds || []).forEach(tId => {
                    const teacher = teachersMap instanceof Map ? teachersMap.get(tId) : (teachersMap ? teachersMap[tId] : null);
                    if (teacher) {
                        const simasId = teacher.simasId || teacher.id;
                        const simasName = teacher.simasName || teacher.name;

                        if (!guruMap.has(simasId)) {
                            guruMap.set(simasId, {
                                uid: simasId,
                                name: simasName,
                                kelasSet: new Set()
                            });
                        }
                        const gEntry = guruMap.get(simasId);
                        classNames.forEach(cName => gEntry.kelasSet.add(cName));
                    }
                });
            }
        });

        const guruList = Array.from(guruMap.values()).map(g => ({
            uid: g.uid,
            name: g.name,
            kelas: Array.from(g.kelasSet).sort()
        }));

        result.push({
            id: subject.id,
            name: mapelName,
            short: subject.short || '',
            guruList: guruList
        });
    }

    return result.sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

// === CONFIG JAM PELAJARAN (JP) DEFAULT SMA NEGERI 1 ABANG ===
export const DEFAULT_JP_PERIODS = [
    { jp: 1, start: '07:30', end: '08:15', startMin: 450, endMin: 495 },
    { jp: 2, start: '08:15', end: '09:00', startMin: 495, endMin: 540 },
    { jp: 3, start: '09:00', end: '09:45', startMin: 540, endMin: 585 },
    { jp: 4, start: '10:00', end: '10:45', startMin: 600, endMin: 645 },
    { jp: 5, start: '10:45', end: '11:30', startMin: 645, endMin: 690 },
    { jp: 6, start: '11:30', end: '12:15', startMin: 690, endMin: 735 },
    { jp: 7, start: '12:30', end: '13:15', startMin: 750, endMin: 795 },
    { jp: 8, start: '13:15', end: '14:00', startMin: 795, endMin: 840 },
    { jp: 9, start: '14:00', end: '14:45', startMin: 840, endMin: 885 },
    { jp: 10, start: '14:45', end: '15:30', startMin: 885, endMin: 930 }
];

function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    const parts = timeStr.split(':').map(p => parseInt(p, 10));
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
    return parts[0] * 60 + parts[1];
}

/**
 * Menghitung Jam Pelajaran (JP) aktif dan status KBM berdasarkan waktu lokal saat ini
 * @param {Date} dateObj - Objek tanggal/waktu (default: new Date())
 * @returns {object} { jp, status, dayOfWeek, timeStr, isSchoolHours, currentPeriod, nextPeriod, message }
 */
export function getCurrentJPInfo(dateObj = new Date()) {
    const dayOfWeek = dateObj.getDay(); // 0=Minggu, 1=Senin, ..., 5=Jumat, 6=Sabtu
    const hours = dateObj.getHours();
    const minutes = dateObj.getMinutes();
    const currentMin = hours * 60 + minutes;
    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return {
            jp: null,
            status: 'weekend',
            dayOfWeek,
            timeStr,
            isSchoolHours: false,
            currentPeriod: null,
            nextPeriod: null,
            message: 'Hari Libur Akhir Pekan'
        };
    }

    let periods = DEFAULT_JP_PERIODS;
    if (parsedScheduleData && Array.isArray(parsedScheduleData.periods) && parsedScheduleData.periods.length > 0) {
        const dynamicPeriods = parsedScheduleData.periods.map(p => {
            const sMin = parseTimeToMinutes(p.start);
            const eMin = parseTimeToMinutes(p.end);
            const defP = DEFAULT_JP_PERIODS.find(d => d.jp === p.jp);
            return {
                jp: p.jp,
                start: p.start || defP?.start || '',
                end: p.end || defP?.end || '',
                startMin: sMin !== null ? sMin : (defP?.startMin || 0),
                endMin: eMin !== null ? eMin : (defP?.endMin || 0)
            };
        }).filter(p => p.startMin && p.endMin);

        if (dynamicPeriods.length > 0) {
            periods = dynamicPeriods;
        }
    }

    const firstPeriod = periods[0];
    const lastPeriod = periods[periods.length - 1];

    // Sebelum KBM (pagi hari)
    if (currentMin < firstPeriod.startMin) {
        return {
            jp: 1,
            status: 'before_school',
            dayOfWeek,
            timeStr,
            isSchoolHours: currentMin >= (firstPeriod.startMin - 60), // True jika masuk jam persiapan (06:30+)
            currentPeriod: null,
            nextPeriod: firstPeriod,
            message: `Sebelum KBM Dimulai (Menuju JP 1 pada ${firstPeriod.start})`
        };
    }

    // Setelah KBM selesai (sore/malam)
    if (currentMin > lastPeriod.endMin) {
        return {
            jp: null,
            status: 'after_school',
            dayOfWeek,
            timeStr,
            isSchoolHours: false,
            currentPeriod: null,
            nextPeriod: null,
            message: 'KBM Hari Ini Telah Selesai'
        };
    }

    // Sedang dalam rentang JP aktif
    for (let i = 0; i < periods.length; i++) {
        const p = periods[i];
        if (currentMin >= p.startMin && currentMin < p.endMin) {
            return {
                jp: p.jp,
                status: 'exact',
                dayOfWeek,
                timeStr,
                isSchoolHours: true,
                currentPeriod: p,
                nextPeriod: periods[i + 1] || null,
                message: `Sedang Berlangsung JP ${p.jp} (${p.start} - ${p.end})`
            };
        }
    }

    // Waktu istirahat (jeda antar JP)
    for (let i = 0; i < periods.length - 1; i++) {
        const curr = periods[i];
        const next = periods[i + 1];
        if (currentMin >= curr.endMin && currentMin < next.startMin) {
            return {
                jp: next.jp,
                status: 'break',
                dayOfWeek,
                timeStr,
                isSchoolHours: true,
                currentPeriod: null,
                nextPeriod: next,
                message: `Waktu Istirahat (Menuju JP ${next.jp} pada ${next.start})`
            };
        }
    }

    return {
        jp: 1,
        status: 'active',
        dayOfWeek,
        timeStr,
        isSchoolHours: true,
        currentPeriod: null,
        nextPeriod: null,
        message: 'Jam KBM'
    };
}

/**
 * Helper internal mencocokkan entri slot jadwal dengan profil guru
 */
function isSlotMatchedToTeacher(slot, user, userNip, candidateNames) {
    if (!slot) return false;
    const uidStr = (user?.uid || '').trim();
    const emailStr = (user?.email || '').trim().toLowerCase();
    const nipStr = (userNip || '').trim();

    if (uidStr && (slot.guruId === uidStr || slot.xmlGuruId === uidStr)) return true;
    if (nipStr && (slot.guruNip === nipStr || slot.guruId === nipStr || slot.xmlGuruId === nipStr)) return true;

    const names = Array.isArray(candidateNames) ? [...candidateNames] : (candidateNames ? [candidateNames] : []);
    if (user?.displayName) names.push(user.displayName);
    if (user?.name) names.push(user.name);

    const slotGuruNames = [slot.guruNama, slot.xmlGuruName].filter(Boolean);

    for (const slotName of slotGuruNames) {
        const normSlot = normalizeTeacherName(slotName);
        if (!normSlot) continue;

        for (const name of names) {
            if (!name) continue;
            const normCand = normalizeTeacherName(name);
            if (!normCand) continue;

            if (normSlot === normCand || normSlot.includes(normCand) || normCand.includes(normSlot)) {
                return true;
            }

            const candTokens = normCand.split(' ').filter(t => t.length > 2);
            if (candTokens.length > 0 && candTokens.every(t => normSlot.includes(t))) {
                return true;
            }
            const slotTokens = normSlot.split(' ').filter(t => t.length > 2);
            if (slotTokens.length > 0 && slotTokens.every(t => normCand.includes(t))) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Mencari jadwal mengajar guru untuk hari ini dan menentukan slot terbaik yang aktif
 * @param {object} user - Firebase Auth User
 * @param {string} userNip - NIP guru
 * @param {Array|string} candidateNames - Variasi nama guru
 * @param {Date} dateObj - Waktu lokal (default: new Date())
 * @returns {Promise<{ targetSlot: object|null, matchReason: string|null, todaySlots: Array, currentJPInfo: object }>}
 */
export async function getTeacherScheduleForToday(user, userNip, candidateNames, dateObj = new Date()) {
    if (!parsedScheduleData) {
        await parseASCSchedule();
    }

    const jpInfo = getCurrentJPInfo(dateObj);
    const dayOfWeek = jpInfo.dayOfWeek;

    if (dayOfWeek === 0 || dayOfWeek === 6 || !parsedScheduleData || !parsedScheduleData.scheduleMap) {
        return {
            targetSlot: null,
            matchReason: null,
            todaySlots: [],
            currentJPInfo: jpInfo
        };
    }

    const scheduleMap = parsedScheduleData.scheduleMap;
    const todaySlots = [];

    Object.keys(scheduleMap).forEach(className => {
        const classDaySchedule = scheduleMap[className]?.[dayOfWeek];
        if (!classDaySchedule) return;

        for (let jp = 1; jp <= 10; jp++) {
            const slot = classDaySchedule[jp];
            if (slot && isSlotMatchedToTeacher(slot, user, userNip, candidateNames)) {
                todaySlots.push({
                    className: className,
                    mapel: slot.mapel,
                    jp: jp,
                    guruNama: slot.guruNama || slot.xmlGuruName,
                    slot: slot
                });
            }
        }
    });

    todaySlots.sort((a, b) => a.jp - b.jp);

    let targetSlot = null;
    let matchReason = null;

    if (todaySlots.length > 0) {
        const currentJP = jpInfo.jp;

        if (currentJP !== null) {
            // Prioritas 1: Tepat pada JP yang sedang berjalan
            const exact = todaySlots.find(s => s.jp === currentJP);
            if (exact) {
                targetSlot = exact;
                matchReason = 'exact_current_jp';
            }

            // Prioritas 2: JP berikutnya yang akan datang pada hari ini
            if (!targetSlot) {
                const upcoming = todaySlots.find(s => s.jp > currentJP);
                if (upcoming) {
                    targetSlot = upcoming;
                    matchReason = 'upcoming_jp';
                }
            }

            // Prioritas 3: JP sebelumnya yang paling baru selesai hari ini
            if (!targetSlot) {
                const recent = [...todaySlots].reverse().find(s => s.jp < currentJP);
                if (recent) {
                    targetSlot = recent;
                    matchReason = 'recent_jp';
                }
            }
        }

        // Prioritas 4: Fallback slot pertama hari ini
        if (!targetSlot) {
            targetSlot = todaySlots[0];
            matchReason = 'today_first_slot';
        }
    }

    return {
        targetSlot,
        matchReason,
        todaySlots,
        currentJPInfo: jpInfo
    };
}

/**
 * Mengambil jadwal mingguan (Senin - Jumat) untuk satu kelas
 * @param {string} className - Nama kelas (misal "X-1", "XI-2")
 * @returns {object} { className, days: { 1: [JP1..10], 2: [...], 3: [...], 4: [...], 5: [...] }, periods: [] }
 */
export async function getWeeklyScheduleByClass(className) {
    if (!parsedScheduleData) {
        await parseASCSchedule();
    }
    if (!parsedScheduleData || !parsedScheduleData.scheduleMap) {
        return null;
    }

    const classSchedule = parsedScheduleData.scheduleMap[className] || {};
    const daysResult = {};

    for (let day = 1; day <= 5; day++) {
        const daySchedule = classSchedule[day] || {};
        daysResult[day] = [];
        for (let jp = 1; jp <= 10; jp++) {
            if (daySchedule[jp]) {
                daysResult[day].push(daySchedule[jp]);
            } else {
                daysResult[day].push({
                    jp: jp,
                    mapel: '',
                    guruNama: '',
                    guruId: '',
                    guruNip: '',
                    isMatched: false
                });
            }
        }
    }

    return {
        className,
        days: daysResult,
        periods: parsedScheduleData.periods || []
    };
}

/**
 * Mengambil jadwal mingguan (Senin - Jumat) untuk satu guru beserta total jam mengajar
 * @param {string} teacherKey - ID XML guru / NIP / simasId / Nama guru
 * @returns {object} { teacher: teacherObj, totalJP: number, mapelList: string[], classList: string[], days: { 1: [JP1..10], ... }, periods: [] }
 */
export async function getWeeklyScheduleByTeacher(teacherKey) {
    if (!parsedScheduleData) {
        await parseASCSchedule();
    }
    if (!parsedScheduleData || !parsedScheduleData.teacherScheduleMap) {
        return null;
    }

    // Cari teacherObj
    let teacherObj = null;
    let foundKey = teacherKey;

    // 1. Cek langsung di teachersMap
    if (parsedScheduleData.teachersMap.has(teacherKey)) {
        teacherObj = parsedScheduleData.teachersMap.get(teacherKey);
        foundKey = teacherKey;
    } else {
        // 2. Cari berdasarkan simasId, NIP, atau normalisasi nama
        const normSearch = normalizeTeacherName(teacherKey);
        for (const [id, t] of parsedScheduleData.teachersMap.entries()) {
            if (t.simasId === teacherKey || t.simasNip === teacherKey || t.id === teacherKey || (normSearch && (normalizeTeacherName(t.name) === normSearch || normalizeTeacherName(t.simasName) === normSearch))) {
                teacherObj = t;
                foundKey = id;
                break;
            }
        }
    }

    const teacherSchedule = (parsedScheduleData.teacherScheduleMap && parsedScheduleData.teacherScheduleMap[foundKey]) || {};
    const daysResult = {};
    let totalJP = 0;
    const mapelSet = new Set();
    const classSet = new Set();

    for (let day = 1; day <= 5; day++) {
        const daySchedule = teacherSchedule[day] || {};
        daysResult[day] = [];
        for (let jp = 1; jp <= 10; jp++) {
            if (daySchedule[jp]) {
                const item = daySchedule[jp];
                daysResult[day].push(item);
                if (item.mapel && item.mapel.toUpperCase() !== 'UPACARA' && item.mapel.toUpperCase() !== 'EKSTRAKURIKULER') {
                    totalJP++;
                    mapelSet.add(item.mapel);
                }
                (item.classNames || []).forEach(c => classSet.add(c));
            } else {
                daysResult[day].push({
                    jp: jp,
                    mapel: '',
                    className: '',
                    classNames: []
                });
            }
        }
    }

    return {
        teacher: teacherObj || { id: teacherKey, name: teacherKey, simasName: teacherKey, simasNip: '' },
        totalJP,
        mapelList: Array.from(mapelSet),
        classList: Array.from(classSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        days: daysResult,
        periods: parsedScheduleData.periods || []
    };
}

/**
 * Mengambil daftar seluruh kelas dari jadwal XML
 */
export async function getAllScheduleClasses() {
    if (!parsedScheduleData) {
        await parseASCSchedule();
    }
    if (!parsedScheduleData || !parsedScheduleData.classesMap) return [];
    const list = [];
    parsedScheduleData.classesMap.forEach(c => {
        if (c.name) list.push(c.name);
    });
    return list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Mengambil daftar seluruh guru dari jadwal XML beserta status SIMAS
 */
export async function getAllScheduleTeachers() {
    if (!parsedScheduleData) {
        await parseASCSchedule();
    }
    if (!parsedScheduleData || !parsedScheduleData.teachersMap) return [];
    const list = [];
    parsedScheduleData.teachersMap.forEach(t => {
        list.push({
            id: t.id,
            name: t.simasName || t.name,
            xmlName: t.name,
            short: t.short,
            simasId: t.simasId,
            simasNip: t.simasNip,
            foto: t.simasFoto || '',
            simasFoto: t.simasFoto || '',
            isMatched: t.isMatched
        });
    });
    return list.sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

/**
 * Mengambil daftar guru dan mata pelajaran yang mengajar di kelas tertentu berdasarkan Jadwal aSc Timetables
 * @param {string} className - Nama kelas (misal "XII-4", "X-1")
 * @returns {Promise<{className: string, teachers: Array, mapels: Array<string>, teacherMapelMap: Object}>}
 */
export async function getClassScheduleTeachersAndMapels(className) {
    if (!className) {
        return {
            className: '',
            teachers: [],
            mapels: [],
            teacherMapelMap: {}
        };
    }

    if (!parsedScheduleData) {
        await parseASCSchedule();
    }
    if (!parsedScheduleData) {
        return {
            className,
            teachers: [],
            mapels: [],
            teacherMapelMap: {}
        };
    }

    const normClassName = (name) => (name || '').toString().trim().replace(/[\.\s_]/g, '-').toUpperCase();
    const targetNorm = normClassName(className);

    let targetClassId = null;
    let matchedClassName = className;

    if (parsedScheduleData.classesMap) {
        for (const [id, cls] of parsedScheduleData.classesMap.entries()) {
            if (normClassName(cls.name) === targetNorm || normClassName(cls.short) === targetNorm) {
                targetClassId = id;
                matchedClassName = cls.name;
                break;
            }
        }
    }

    const teacherMap = new Map();
    const mapelSet = new Set();
    const teacherMapelMap = {};

    // 1. Ekstrak dari lessonsMap (mencakup semua alokasi KBM resmi kelas)
    if (targetClassId && parsedScheduleData.lessonsMap) {
        for (const [_, lesson] of parsedScheduleData.lessonsMap.entries()) {
            if (Array.isArray(lesson.classIds) && lesson.classIds.includes(targetClassId)) {
                const subject = parsedScheduleData.subjectsMap?.get(lesson.subjectId);
                const subjectName = subject?.name ? subject.name.trim() : '';
                if (subjectName && subjectName.toUpperCase() !== 'UPACARA') {
                    mapelSet.add(subjectName);
                }

                if (Array.isArray(lesson.teacherIds)) {
                    lesson.teacherIds.forEach(tId => {
                        const teacher = parsedScheduleData.teachersMap?.get(tId);
                        if (teacher) {
                            const tName = (teacher.simasName || teacher.name || '').trim();
                            if (tName && tName !== '-') {
                                if (!teacherMap.has(tName)) {
                                    teacherMap.set(tName, {
                                        id: teacher.id,
                                        name: tName,
                                        xmlName: teacher.name || '',
                                        simasId: teacher.simasId || '',
                                        nip: teacher.simasNip || '',
                                        mapels: new Set(),
                                        days: new Set(),
                                        slots: []
                                    });
                                }
                                const tEntry = teacherMap.get(tName);
                                if (subjectName && subjectName.toUpperCase() !== 'UPACARA') {
                                    tEntry.mapels.add(subjectName);
                                }
                            }
                        }
                    });
                }
            }
        }
    }

    // 2. Ekstrak dari scheduleMap (memetakan hari dan JP spesifik)
    const classSchedule = (parsedScheduleData.scheduleMap && (
        parsedScheduleData.scheduleMap[matchedClassName] ||
        parsedScheduleData.scheduleMap[className] ||
        Object.entries(parsedScheduleData.scheduleMap).find(([k]) => normClassName(k) === targetNorm)?.[1]
    )) || null;

    if (classSchedule) {
        for (let day = 1; day <= 5; day++) {
            const daySlots = classSchedule[day] || {};
            for (let jp = 1; jp <= 10; jp++) {
                const slot = daySlots[jp];
                if (slot && slot.mapel && slot.mapel.toUpperCase() !== 'UPACARA') {
                    const mapelName = slot.mapel.trim();
                    mapelSet.add(mapelName);

                    const tName = (slot.guruNama || slot.xmlGuruName || '').trim();
                    if (tName && tName !== '-') {
                        if (!teacherMap.has(tName)) {
                            teacherMap.set(tName, {
                                id: slot.xmlGuruId || slot.guruId || '',
                                name: tName,
                                xmlName: slot.xmlGuruName || '',
                                simasId: slot.guruId || '',
                                nip: slot.guruNip || '',
                                mapels: new Set(),
                                days: new Set(),
                                slots: []
                            });
                        }
                        const tEntry = teacherMap.get(tName);
                        tEntry.mapels.add(mapelName);
                        tEntry.days.add(day);
                        tEntry.slots.push({ day, jp, mapel: mapelName });
                    }
                }
            }
        }
    }

    const teachers = Array.from(teacherMap.values()).map(t => {
        const mapels = Array.from(t.mapels).sort((a, b) => a.localeCompare(b, 'id'));
        teacherMapelMap[t.name] = mapels;
        return {
            id: t.id,
            name: t.name,
            xmlName: t.xmlName,
            simasId: t.simasId,
            nip: t.nip,
            mapels: mapels,
            days: Array.from(t.days).sort((a, b) => a - b),
            slots: t.slots
        };
    }).sort((a, b) => a.name.localeCompare(b.name, 'id'));

    const mapels = Array.from(mapelSet).sort((a, b) => a.localeCompare(b, 'id'));

    return {
        className: matchedClassName || className,
        teachers,
        mapels,
        teacherMapelMap
    };
}
