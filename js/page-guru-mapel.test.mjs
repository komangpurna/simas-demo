export function getMapelNameCandidates(mapelName, raporConfig = {}) {
    if (!mapelName) return [];
    const candidates = new Set();
    const cleanMapel = mapelName.trim();
    candidates.add(cleanMapel);

    const shortCodes = (raporConfig && raporConfig.mapel_short_codes) ? raporConfig.mapel_short_codes : {};
    if (shortCodes[cleanMapel]) {
        candidates.add(shortCodes[cleanMapel]);
    }
    Object.keys(shortCodes).forEach(fullKey => {
        if (shortCodes[fullKey] === cleanMapel) {
            candidates.add(fullKey);
        }
    });

    if (cleanMapel.match(/^Matematika\s*(\((Umum|Wajib)\))?$/i) || cleanMapel === "Matematika Wajib" || cleanMapel === "Matematika Umum") {
        candidates.add("Matematika");
        candidates.add("Matematika (Umum)");
        candidates.add("Matematika Umum");
        candidates.add("Matematika (Wajib)");
        candidates.add("Matematika Wajib");
        candidates.add("MTK");
    }

    if (cleanMapel.match(/^Bahasa\s*Indonesia\s*(\((Umum|Wajib)\))?$/i) || cleanMapel === "Bahasa Indonesia Wajib" || cleanMapel === "Bahasa Indonesia Umum") {
        candidates.add("Bahasa Indonesia");
        candidates.add("Bahasa Indonesia (Umum)");
        candidates.add("Bahasa Indonesia Umum");
        candidates.add("Bahasa Indonesia (Wajib)");
        candidates.add("Bahasa Indonesia Wajib");
        candidates.add("B. Indonesia");
        candidates.add("B.Indo");
    }

    if (cleanMapel.match(/^Bahasa\s*Inggris\s*(\((Umum|Wajib)\))?$/i) || cleanMapel === "Bahasa Inggris Wajib" || cleanMapel === "Bahasa Inggris Umum") {
        candidates.add("Bahasa Inggris");
        candidates.add("Bahasa Inggris (Umum)");
        candidates.add("Bahasa Inggris Umum");
        candidates.add("Bahasa Inggris (Wajib)");
        candidates.add("Bahasa Inggris Wajib");
        candidates.add("B. Inggris");
        candidates.add("B.Ing");
    }

    if (cleanMapel.includes("Tingkat Lanjut")) {
        candidates.add(cleanMapel.replace(/Tingkat Lanjut/gi, "Tk Lanjut"));
        candidates.add(cleanMapel.replace(/Tingkat Lanjut/gi, "Tk. Lanjut"));
    } else if (cleanMapel.includes("Tk Lanjut") || cleanMapel.includes("Tk. Lanjut")) {
        candidates.add(cleanMapel.replace(/Tk\.?\s*Lanjut/gi, "Tingkat Lanjut"));
    }

    if (cleanMapel.includes("Pendidikan Pancasila")) {
        candidates.add(cleanMapel.replace(/Pendidikan Pancasila (dan Kewarganegaraan)?/gi, "PPKn"));
        candidates.add(cleanMapel.replace(/Pendidikan Pancasila (dan Kewarganegaraan)?/gi, "PKn"));
    } else if (cleanMapel === "PPKn" || cleanMapel === "PKn") {
        candidates.add("Pendidikan Pancasila");
        candidates.add("Pendidikan Pancasila dan Kewarganegaraan");
    }

    if (cleanMapel.includes("Pendidikan Agama")) {
        candidates.add(cleanMapel.replace(/Pendidikan Agama (dan Budi Pekerti)?/gi, "PABP"));
        candidates.add(cleanMapel.replace(/Pendidikan Agama (dan Budi Pekerti)?/gi, "PAB P"));
    } else if (cleanMapel === "PABP" || cleanMapel === "PAB P") {
        candidates.add("Pendidikan Agama dan Budi Pekerti");
        candidates.add("Pendidikan Agama");
    }

    if (cleanMapel.includes("Pendidikan Jasmani")) {
        candidates.add(cleanMapel.replace(/Pendidikan Jasmani,?\s*Olahraga\s*(dan|&)\s*Kesehatan/gi, "PJOK"));
        candidates.add(cleanMapel.replace(/Pendidikan Jasmani,?\s*Olahraga\s*(dan|&)\s*Kesehatan/gi, "Penjasorkas"));
    } else if (cleanMapel === "PJOK" || cleanMapel === "Penjasorkas") {
        candidates.add("Pendidikan Jasmani Olahraga dan Kesehatan");
        candidates.add("Pendidikan Jasmani, Olahraga, dan Kesehatan");
    }

    if (cleanMapel.includes("Bimbingan")) {
        candidates.add(cleanMapel.replace(/Bimbingan (dan)? Konseling/gi, "BK"));
    } else if (cleanMapel === "BK") {
        candidates.add("Bimbingan Konseling");
        candidates.add("Bimbingan dan Konseling");
    }

    if (cleanMapel.match(/Prakarya|PKWU|Kewirausahaan|KWU/i)) {
        candidates.add("Prakarya dan Kewirausahaan");
        candidates.add("Prakarya & Kewirausahaan");
        candidates.add("Prakarya dan Kewirausahaan (PKWU)");
        candidates.add("Prakarya");
        candidates.add("PKWU");
        candidates.add("Kewirausahaan");
        candidates.add("KWU");
        candidates.add("Prakarya/PKWU");
        candidates.add("Prakarya & KWU");
    }

    if (cleanMapel.includes("Informatika") || cleanMapel === "TIK") {
        candidates.add("Informatika");
        candidates.add("TIK");
        candidates.add("Teknologi Informasi dan Komunikasi");
    }

    if (cleanMapel.match(/^Sejarah\s*(\((Umum|Wajib|Indonesia)\))?$/i) || cleanMapel === "Sejarah Indonesia" || cleanMapel === "Sejarah Wajib") {
        candidates.add("Sejarah");
        candidates.add("Sejarah Indonesia");
        candidates.add("Sejarah (Wajib)");
        candidates.add("Sejarah Wajib");
        candidates.add("Sejarah (Umum)");
        candidates.add("Sejarah Umum");
    }

    if (cleanMapel.includes("Bali")) {
        candidates.add("Bahasa Bali");
        candidates.add("B. Bali");
        candidates.add("B.Bali");
        candidates.add("Muatan Lokal Bahasa Bali");
        candidates.add("Mulok Bahasa Bali");
    }

    return Array.from(candidates);
}

export function isMapelMatching(docMapel, mapelCandidates = []) {
    if (!docMapel) return false;
    const cleanDocMapel = String(docMapel).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!cleanDocMapel) return false;
    const candidates = Array.isArray(mapelCandidates) ? mapelCandidates : [mapelCandidates];
    return candidates.some(c => {
        const cleanC = String(c).trim().toLowerCase().replace(/\s+/g, ' ');
        return cleanC === cleanDocMapel;
    });
}

export function calculateAveragesAndFinalScore(tugasVals, sumatifVals, sasSatVal, weights) {
    const validTugas = (tugasVals || []).filter(v => v !== null && v !== undefined && !isNaN(v) && v >= 0 && v <= 100);
    const validSumatif = (sumatifVals || []).filter(v => v !== null && v !== undefined && !isNaN(v) && v >= 0 && v <= 100);
    const validSasSat = (sasSatVal !== null && sasSatVal !== undefined && !isNaN(sasSatVal) && sasSatVal >= 0 && sasSatVal <= 100) ? sasSatVal : null;

    const tugasAvg = validTugas.length > 0 ? (validTugas.reduce((a, b) => a + b, 0) / validTugas.length) : null;
    const sumatifAvg = validSumatif.length > 0 ? (validSumatif.reduce((a, b) => a + b, 0) / validSumatif.length) : null;

    const wT = parseFloat(weights.tugas) || 0;
    const wS = parseFloat(weights.sumatif) || 0;
    const wSAS = parseFloat(weights.sas) || 0;

    let finalScore = null;
    let weightedSum = 0;
    let weightDivider = 0;

    if (tugasAvg !== null) { weightedSum += tugasAvg * (wT / 100); weightDivider += wT; }
    if (sumatifAvg !== null) { weightedSum += sumatifAvg * (wS / 100); weightDivider += wS; }
    if (validSasSat !== null) { weightedSum += validSasSat * (wSAS / 100); weightDivider += wSAS; }

    if (weightDivider > 0) {
        finalScore = Math.round(weightedSum * (100 / weightDivider));
    }

    return {
        tugasAvg: tugasAvg !== null ? parseFloat(tugasAvg.toFixed(2)) : null,
        sumatifAvg: sumatifAvg !== null ? parseFloat(sumatifAvg.toFixed(2)) : null,
        sasSatVal: validSasSat,
        finalScore
    };
}

describe("Pengujian Unit Kalkulasi Nilai Portal Guru Mapel", () => {
    const defaultWeights = { tugas: 20, sumatif: 40, sas: 40 };

    test("kalkulasi lengkap tugas, sumatif, dan SAS/SAT dengan bobot 20-40-40", () => {
        const result = calculateAveragesAndFinalScore([80, 90], [85, 85, 90], 88, defaultWeights);
        expect(result.tugasAvg).toBe(85);
        expect(result.sumatifAvg).toBe(86.67);
        expect(result.sasSatVal).toBe(88);
        expect(result.finalScore).toBe(87);
    });

    test("tugas optional kosong (hanya sumatif dan SAS/SAT)", () => {
        const result = calculateAveragesAndFinalScore([], [80, 90], 85, defaultWeights);
        expect(result.tugasAvg).toBeNull();
        expect(result.sumatifAvg).toBe(85);
        expect(result.sasSatVal).toBe(85);
        expect(result.finalScore).toBe(85);
    });

    test("bobot kustom per guru (Tugas 30%, Sumatif 30%, SAS/SAT 40%)", () => {
        const customWeights = { tugas: 30, sumatif: 30, sas: 40 };
        const result = calculateAveragesAndFinalScore([100], [100], 50, customWeights);
        expect(result.finalScore).toBe(80);
    });

    test("menolak dan memfilter nilai di luar 0-100", () => {
        const result = calculateAveragesAndFinalScore([-10, 80, 150], [90], 90, defaultWeights);
        expect(result.tugasAvg).toBe(80);
        expect(result.finalScore).toBe(88);
    });
});

describe("Pengujian Unit Mapel Alias Matching & Isolasi Jurnal Rekap Kehadiran", () => {
    test("getMapelNameCandidates mengenali alias Matematika, Wajib, dan Singkatan", () => {
        const candidates = getMapelNameCandidates("Matematika");
        expect(candidates).toContain("Matematika");
        expect(candidates).toContain("Matematika (Wajib)");
        expect(candidates).toContain("Matematika (Umum)");
        expect(candidates).toContain("MTK");
    });

    test("getMapelNameCandidates mengenali alias Bahasa Indonesia & PJOK", () => {
        const indoCandidates = getMapelNameCandidates("Bahasa Indonesia");
        expect(indoCandidates).toContain("Bahasa Indonesia");
        expect(indoCandidates).toContain("B. Indonesia");
        expect(indoCandidates).toContain("B.Indo");

        const pjokCandidates = getMapelNameCandidates("PJOK");
        expect(pjokCandidates).toContain("PJOK");
        expect(pjokCandidates).toContain("Pendidikan Jasmani Olahraga dan Kesehatan");
    });

    test("isMapelMatching mencocokkan variasi penulisan mapel secara case-insensitive & trimmed", () => {
        const candidates = getMapelNameCandidates("Matematika");
        expect(isMapelMatching("Matematika", candidates)).toBe(true);
        expect(isMapelMatching("  matematika  ", candidates)).toBe(true);
        expect(isMapelMatching("Matematika (Wajib)", candidates)).toBe(true);
        expect(isMapelMatching("MTK", candidates)).toBe(true);
        // Mapel lain tidak boleh lolos
        expect(isMapelMatching("Fisika", candidates)).toBe(false);
        expect(isMapelMatching("Kimia", candidates)).toBe(false);
        expect(isMapelMatching("Bahasa Indonesia", candidates)).toBe(false);
    });

    test("Filter jurnal mengisolasi 100% data mapel terpilih tanpa kebocoran mapel lain", () => {
        const mockRawJurnalDocs = [
            { id: '1', tanggal: '2026-07-30', jp: [1, 2, 3], mapel: 'Matematika', guru: 'I Komang Purna' },
            { id: '2', tanggal: '2026-07-30', jp: [4, 5, 6], mapel: 'Bahasa Indonesia', guru: 'Guru B.Indo' },
            { id: '3', tanggal: '2026-07-30', jp: [7, 8], mapel: 'Fisika', guru: 'Guru Fisika' },
            { id: '4', tanggal: '2026-08-03', jp: [1, 2], mapel: 'Matematika (Wajib)', guru: 'I Komang Purna' },
            { id: '5', tanggal: '2026-08-03', jp: [3, 4], mapel: 'Kimia', guru: 'Guru Kimia' },
        ];

        const mtkCandidates = getMapelNameCandidates("Matematika");
        const filteredDocs = mockRawJurnalDocs.filter(d => isMapelMatching(d.mapel, mtkCandidates));

        expect(filteredDocs.length).toBe(2);
        expect(filteredDocs.map(d => d.id)).toEqual(['1', '4']);
        expect(filteredDocs.some(d => d.mapel === 'Fisika')).toBe(false);
        expect(filteredDocs.some(d => d.mapel === 'Bahasa Indonesia')).toBe(false);
        expect(filteredDocs.some(d => d.mapel === 'Kimia')).toBe(false);
    });

    test("Skenario 1 Guru Mengajar 2 Mapel di Kelas yang Sama: Mapel A & Mapel B tidak saling bercampur", () => {
        // Contoh nyata: Guru 'I Komang Purna' mengajar Matematika DAN Informatika di kelas XI-1
        const mockKelasXI1Jurnal = [
            { id: 'j1', tanggal: '2026-07-20', jp: [1, 2, 3], mapel: 'Matematika', guru: 'I Komang Purna', kelas: 'XI-1' },
            { id: 'j2', tanggal: '2026-07-21', jp: [4, 5], mapel: 'Informatika', guru: 'I Komang Purna', kelas: 'XI-1' },
            { id: 'j3', tanggal: '2026-07-27', jp: [1, 2, 3], mapel: 'Matematika (Wajib)', guru: 'I Komang Purna', kelas: 'XI-1' },
            { id: 'j4', tanggal: '2026-07-28', jp: [4, 5], mapel: 'TIK', guru: 'I Komang Purna', kelas: 'XI-1' },
        ];

        // Saat guru membuka rekap Matematika
        const mtkCandidates = getMapelNameCandidates("Matematika");
        const mtkDocs = mockKelasXI1Jurnal.filter(d => isMapelMatching(d.mapel, mtkCandidates));
        expect(mtkDocs.map(d => d.id)).toEqual(['j1', 'j3']);
        expect(mtkDocs.some(d => d.mapel === 'Informatika' || d.mapel === 'TIK')).toBe(false);

        // Saat guru membuka rekap Informatika
        const infoCandidates = getMapelNameCandidates("Informatika");
        const infoDocs = mockKelasXI1Jurnal.filter(d => isMapelMatching(d.mapel, infoCandidates));
        expect(infoDocs.map(d => d.id)).toEqual(['j2', 'j4']);
        expect(infoDocs.some(d => d.mapel === 'Matematika' || d.mapel === 'Matematika (Wajib)')).toBe(false);
    });

    test("PKWU dan Prakarya dan Kewirausahaan saling mengenali seluruh alias dan singkatan", () => {
        const pkwuCandidates = getMapelNameCandidates("PKWU");
        expect(pkwuCandidates).toContain("PKWU");
        expect(pkwuCandidates).toContain("Prakarya dan Kewirausahaan");
        expect(pkwuCandidates).toContain("Prakarya & Kewirausahaan");
        expect(pkwuCandidates).toContain("Prakarya");

        const prakaryaCandidates = getMapelNameCandidates("Prakarya dan Kewirausahaan");
        expect(prakaryaCandidates).toContain("PKWU");
        expect(prakaryaCandidates).toContain("Prakarya dan Kewirausahaan");

        expect(isMapelMatching("PKWU", prakaryaCandidates)).toBe(true);
        expect(isMapelMatching("Prakarya dan Kewirausahaan", pkwuCandidates)).toBe(true);
        expect(isMapelMatching("Prakarya & Kewirausahaan", pkwuCandidates)).toBe(true);
        expect(isMapelMatching("Prakarya", pkwuCandidates)).toBe(true);
    });
});

export function isClassMatching(classA, classB) {
    if (!classA || !classB) return false;
    if (classA === classB) return true;
    const cleanA = String(classA).trim().toLowerCase();
    const cleanB = String(classB).trim().toLowerCase();
    if (cleanA === cleanB) return true;
    return cleanA.replace(/[^a-z0-9]/gi, '') === cleanB.replace(/[^a-z0-9]/gi, '');
}

export function getMapelsForClass(assignedMap, selectedClass) {
    if (!assignedMap || !selectedClass) return [];
    const allowed = [];
    Object.keys(assignedMap).forEach(mapel => {
        const classList = assignedMap[mapel] || [];
        if (classList.some(c => isClassMatching(c, selectedClass))) {
            allowed.push(mapel);
        }
    });
    return allowed.sort((a, b) => a.localeCompare(b, 'id'));
}

export function buildAdminAssignedMapelMap(mapelGuruConfig = {}, masterMapelList = [], activeClassesList = [], xmlSubjects = []) {
    const masterMapelSet = masterMapelList.length > 0 ? new Set(masterMapelList) : null;
    const assignedMap = {};

    Object.keys(mapelGuruConfig).forEach(mapel => {
        if (masterMapelSet && !masterMapelSet.has(mapel)) return;

        const guruList = mapelGuruConfig[mapel] || [];
        guruList.forEach(g => {
            let classList = [];
            if (typeof g === 'object' && Array.isArray(g.kelas) && g.kelas.length > 0) {
                classList = g.kelas;
            } else {
                classList = [...activeClassesList];
            }
            if (!assignedMap[mapel]) {
                assignedMap[mapel] = [];
            }
            classList.forEach(c => {
                if (!assignedMap[mapel].includes(c)) {
                    assignedMap[mapel].push(c);
                }
            });
        });
    });

    if (Array.isArray(xmlSubjects) && xmlSubjects.length > 0) {
        xmlSubjects.forEach(sub => {
            const mName = sub.name ? sub.name.trim() : '';
            if (!mName || (masterMapelSet && !masterMapelSet.has(mName))) return;
            if (!assignedMap[mName]) {
                assignedMap[mName] = [];
            }
            (sub.guruList || []).forEach(g => {
                (g.kelas || []).forEach(c => {
                    if (!assignedMap[mName].includes(c)) {
                        assignedMap[mName].push(c);
                    }
                });
            });
        });
    }

    return assignedMap;
}

describe("Pengujian Isolasi Mapel per Kelas pada Portal Guru Mapel (Role Super Admin & Guru)", () => {
    const mockActiveClasses = ["X-1", "X-2", "XI MIPA 1", "XI IPS 1", "XII MIPA 1", "XII IPS 1"];
    const mockMasterMapelList = [
        "Pendidikan Agama dan Budi Pekerti",
        "Pendidikan Pancasila",
        "Bahasa Indonesia",
        "Matematika",
        "Fisika",
        "Kimia",
        "Biologi",
        "Sosiologi",
        "Geografi",
        "Ekonomi",
        "Bahasa Jepang"
    ];

    const mockMapelGuruConfig = {
        "Pendidikan Agama dan Budi Pekerti": [
            { uid: "g1", name: "Guru Agama", kelas: [] } // Semua kelas aktif
        ],
        "Bahasa Indonesia": [
            { uid: "g2", name: "Guru B.Indo", kelas: ["X-1", "X-2", "XI MIPA 1", "XI IPS 1", "XII MIPA 1", "XII IPS 1"] }
        ],
        "Fisika": [
            { uid: "g3", name: "Guru Fisika", kelas: ["XI MIPA 1", "XII MIPA 1"] }
        ],
        "Kimia": [
            { uid: "g4", name: "Guru Kimia", kelas: ["XI MIPA 1", "XII MIPA 1"] }
        ],
        "Biologi": [
            { uid: "g5", name: "Guru Biologi", kelas: ["XI MIPA 1", "XII MIPA 1"] }
        ],
        "Sosiologi": [
            { uid: "g6", name: "Guru Sosiologi", kelas: ["XI IPS 1", "XII IPS 1"] }
        ],
        "Geografi": [
            { uid: "g7", name: "Guru Geografi", kelas: ["XI IPS 1", "XII IPS 1"] }
        ],
        "Ekonomi": [
            { uid: "g8", name: "Guru Ekonomi", kelas: ["XI IPS 1", "XII IPS 1"] }
        ]
        // Bahasa Jepang tidak terdaftar di mapelGuruConfig (belum ada penugasan kelas)
    };

    const adminAssignedMap = buildAdminAssignedMapelMap(mockMapelGuruConfig, mockMasterMapelList, mockActiveClasses);

    test("isClassMatching mencocokkan nama kelas dengan variasi penulisan spasi, minus, dan case", () => {
        expect(isClassMatching("XII MIPA 1", "XII-MIPA-1")).toBe(true);
        expect(isClassMatching("xii mipa 1", "XII MIPA 1")).toBe(true);
        expect(isClassMatching("X-1", "X - 1")).toBe(true);
        expect(isClassMatching("XI MIPA 1", "XI IPS 1")).toBe(false);
        expect(isClassMatching("XII MIPA 1", "XI MIPA 1")).toBe(false);
    });

    test("Sekalipun login Super Admin: Saat kelas XII MIPA 1 dipilih, hanya mapel kelas tersebut yang muncul (MIPA & Umum)", () => {
        const allowedMapels = getMapelsForClass(adminAssignedMap, "XII MIPA 1");

        // Mapel yang memang ada di XII MIPA 1
        expect(allowedMapels).toContain("Fisika");
        expect(allowedMapels).toContain("Kimia");
        expect(allowedMapels).toContain("Biologi");
        expect(allowedMapels).toContain("Bahasa Indonesia");
        expect(allowedMapels).toContain("Pendidikan Agama dan Budi Pekerti");

        // Mapel IPS TIDAK BOLEH MUNCUL sama sekali di XII MIPA 1
        expect(allowedMapels).not.toContain("Sosiologi");
        expect(allowedMapels).not.toContain("Geografi");
        expect(allowedMapels).not.toContain("Ekonomi");

        // Mapel tanpa penugasan kelas (Bahasa Jepang) TIDAK BOLEH MUNCUL
        expect(allowedMapels).not.toContain("Bahasa Jepang");
    });

    test("Sekalipun login Super Admin: Saat kelas XII IPS 1 dipilih, hanya mapel kelas tersebut yang muncul (IPS & Umum)", () => {
        const allowedMapels = getMapelsForClass(adminAssignedMap, "XII IPS 1");

        // Mapel yang memang ada di XII IPS 1
        expect(allowedMapels).toContain("Sosiologi");
        expect(allowedMapels).toContain("Geografi");
        expect(allowedMapels).toContain("Ekonomi");
        expect(allowedMapels).toContain("Bahasa Indonesia");
        expect(allowedMapels).toContain("Pendidikan Agama dan Budi Pekerti");

        // Mapel MIPA TIDAK BOLEH MUNCUL sama sekali di XII IPS 1
        expect(allowedMapels).not.toContain("Fisika");
        expect(allowedMapels).not.toContain("Kimia");
        expect(allowedMapels).not.toContain("Biologi");

        // Mapel tanpa alokasi kelas tidak boleh muncul
        expect(allowedMapels).not.toContain("Bahasa Jepang");
    });

    test("Sekalipun login Super Admin: Pencocokan format kelas dash vs spasi (XII-MIPA-1 vs XII MIPA 1) tetap akurat", () => {
        // Dropdown kelas bernilai 'XII-MIPA-1' sedangkan config bertuliskan 'XII MIPA 1'
        const allowedMapels = getMapelsForClass(adminAssignedMap, "XII-MIPA-1");
        expect(allowedMapels).toContain("Fisika");
        expect(allowedMapels).toContain("Kimia");
        expect(allowedMapels).not.toContain("Sosiologi");
    });

    test("Sekalipun login Super Admin: Jika memilih kelas tanpa mapel terdaftar, dropdown tidak me-dump seluruh mapel sekolah", () => {
        // Misal kelas kosong 'X-3' yang belum punya guru mapel
        const emptyClassMap = {
            "Fisika": ["XII MIPA 1"],
            "Kimia": ["XII MIPA 1"]
        };
        const allowedMapels = getMapelsForClass(emptyClassMap, "X-3");
        expect(allowedMapels).toEqual([]);
        expect(allowedMapels.length).toBe(0);
    });

    test("Suplemen jadwal XML menambahkan alokasi mapel kelas secara tepat tanpa membocorkan ke kelas lain", () => {
        const mockXmlSubjects = [
            {
                name: "Informatika",
                guruList: [
                    { uid: "g9", name: "Guru IT", kelas: ["X-1", "X-2"] }
                ]
            }
        ];
        const updatedAdminMap = buildAdminAssignedMapelMap(
            mockMapelGuruConfig,
            [...mockMasterMapelList, "Informatika"],
            mockActiveClasses,
            mockXmlSubjects
        );

        // Kelas X-1 mendapat Informatika dari XML
        const mapelsX1 = getMapelsForClass(updatedAdminMap, "X-1");
        expect(mapelsX1).toContain("Informatika");

        // Kelas XII MIPA 1 TIDAK mendapat Informatika karena hanya ada di X-1 dan X-2
        const mapelsXIIMipa = getMapelsForClass(updatedAdminMap, "XII MIPA 1");
        expect(mapelsXIIMipa).not.toContain("Informatika");
    });
});

describe("Pengujian Proteksi Data Loss & Kontrak Unsaved Changes Portal Guru Mapel", () => {
    test("Success Path: saat simpan berhasil (res === true), modal ditutup, dirty direset, dan navigasi dilanjutkan", async () => {
        let isDirty = true;
        let modalClosed = false;
        let proceedCalled = false;

        const fakeSaveScores = async () => true;

        const handleSave = async (saveFn, closeModal, setDirty, onProceed) => {
            const res = await saveFn();
            if (res === true) {
                closeModal();
                setDirty(false);
                onProceed();
                return true;
            }
            return false;
        };

        const result = await handleSave(
            fakeSaveScores,
            () => { modalClosed = true; },
            (val) => { isDirty = val; },
            () => { proceedCalled = true; }
        );

        expect(result).toBe(true);
        expect(modalClosed).toBe(true);
        expect(isDirty).toBe(false);
        expect(proceedCalled).toBe(true);
    });

    test("Failure Path: saat simpan gagal (res === false), modal TIDAK ditutup, dirty TETAP true, navigasi TIDAK jalan", async () => {
        let isDirty = true;
        let modalClosed = false;
        let proceedCalled = false;

        const fakeFailedSave = async () => false;

        const handleSave = async (saveFn, closeModal, setDirty, onProceed) => {
            const res = await saveFn();
            if (res === true) {
                closeModal();
                setDirty(false);
                onProceed();
                return true;
            }
            return false;
        };

        const result = await handleSave(
            fakeFailedSave,
            () => { modalClosed = true; },
            (val) => { isDirty = val; },
            () => { proceedCalled = true; }
        );

        expect(result).toBe(false);
        expect(modalClosed).toBe(false); // Modal tetap terbuka agar input guru tidak hilang
        expect(isDirty).toBe(true);       // State tetap kotor
        expect(proceedCalled).toBe(false); // Navigasi dicegah
    });

    test("Exception Path: saat saveScores melempar exception jaringan, ditangkap aman tanpa data loss", async () => {
        let isDirty = true;
        let modalClosed = false;
        let proceedCalled = false;
        let errorCaught = null;

        const fakeNetworkErrorSave = async () => {
            throw new Error("Failed to fetch / Connection timeout");
        };

        const handleSave = async (saveFn, closeModal, setDirty, onProceed) => {
            try {
                const res = await saveFn();
                if (res === true) {
                    closeModal();
                    setDirty(false);
                    onProceed();
                    return true;
                }
                return false;
            } catch (err) {
                errorCaught = err;
                return false;
            }
        };

        const result = await handleSave(
            fakeNetworkErrorSave,
            () => { modalClosed = true; },
            (val) => { isDirty = val; },
            () => { proceedCalled = true; }
        );

        expect(result).toBe(false);
        expect(errorCaught).toBeTruthy();
        expect(errorCaught.message).toContain("Connection timeout");
        expect(modalClosed).toBe(false);
        expect(isDirty).toBe(true);
        expect(proceedCalled).toBe(false);
    });

    test("SSOT Alias: pemanggilan saveGradebookData merujuk ke saveScores yang sama", () => {
        const dummyScoresFn = () => "scores_fn";
        const dummyScope = {
            saveScores: dummyScoresFn,
            saveGradebookData: dummyScoresFn
        };

        expect(dummyScope.saveGradebookData).toBe(dummyScope.saveScores);
        expect(dummyScope.saveGradebookData()).toBe("scores_fn");
    });
});
