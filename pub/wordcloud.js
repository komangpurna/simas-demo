// ==================== FIREBASE SDK v9 (Modular via CDN) ====================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// 🔧 KONFIGURASI FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyDphzPKM2poA6U6RyXu798j7_ITgxN07nI",
    authDomain: "smagesa.firebaseapp.com",
    projectId: "smagesa",
    storageBucket: "simas-demo-5ead3.firebasestorage.app",
    messagingSenderId: "246723731558",
    appId: "1:246723731558:web:073b3b2005997f45730da7"
};

const app = initializeApp(firebaseConfig, 'wordcloud');
const db = getFirestore(app);
const auth = getAuth(app);

// ==================== STATE ====================
const currentYear = new Date().getFullYear().toString();
document.getElementById('displayYear').textContent = currentYear;
let wordsDataMap = new Map(); // Raw frequency map
let cachedLayoutWords = []; // Disimpan untuk transisi D3

// ==================== FILTERING (Stopwords & Profanity) ====================
const STOPWORDS = new Set([
    "dan", "yang", "di", "ke", "dari", "ini", "itu", "untuk", "dengan", "ada", 
    "bisa", "akan", "sudah", "tidak", "juga", "saya", "kamu", "kami", "mereka", 
    "pada", "oleh", "atau", "tetapi", "namun", "lalu", "serta", "seperti", 
    "karena", "agar", "supaya", "walau", "meski", "sangat", "lebih", "paling", 
    "hanya", "masih", "belum", "lagi", "jadi", "mau", "biar", "dong", "sih", 
    "nih", "ya", "deh", "lah", "kok", "kan", "kita", "nya", "aja", "buat", "aku"
]);

const PROFANITY = [
    "anjing", "babi", "monyet", "bangsat", "kontol", "memek", "jembut", "ngentot", 
    "asu", "bajingan", "kampret", "tolol", "goblok", "bego", "idiot", "pantek", 
    "peler", "pukimak", "sialan", "tai", "bgst", "anjg"
];

function isProfane(word) {
    return PROFANITY.some(p => word.includes(p));
}

// ==================== ALGORITMA LEVENSHTEIN (FUZZY MATCHING) ====================
// Menghitung seberapa jauh perbedaan dua kata (untuk deteksi typo)
function getLevenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    Math.min(
                        matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j] + 1  // deletion
                    )
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

// Menggabungkan typo ke kata yang paling dominan
function applyTypoCorrection(rawFrequencies) {
    // 1. Sortir kata dari yang paling sering muncul (dominant words)
    const sortedWords = Object.keys(rawFrequencies).sort((a, b) => rawFrequencies[b] - rawFrequencies[a]);
    const correctedFrequencies = {};
    const masterMapping = {}; // mapping kata typo -> kata master

    for (const word of sortedWords) {
        let isTypoOfMaster = false;
        
        // Skip kata terlalu pendek untuk dikoreksi (misal: "ser", "oke" biar tidak nyambung sembarangan)
        if (word.length >= 4) {
            // Cek apakah mirip dengan master word yang sudah ada (yang frekuensinya lebih tinggi)
            for (const master of Object.keys(correctedFrequencies)) {
                if (master.length >= 4) {
                    const distance = getLevenshteinDistance(word, master);
                    // Toleransi: panjang kata > 6 boleh beda 2 huruf, jika <= 6 cuma boleh beda 1 huruf
                    const maxDistance = master.length > 6 ? 2 : 1;
                    
                    if (distance <= maxDistance) {
                        // Ketemu typo, gabungkan ke master
                        correctedFrequencies[master] += rawFrequencies[word];
                        masterMapping[word] = master;
                        isTypoOfMaster = true;
                        break;
                    }
                }
            }
        }
        
        // Kalau bukan typo dari kata lain yang lebih populer, jadikan dia master baru
        if (!isTypoOfMaster) {
            correctedFrequencies[word] = rawFrequencies[word];
            masterMapping[word] = word;
        }
    }
    
    return correctedFrequencies;
}

// ==================== D3 FORCE PHYSICS ENGINE (100% Mentimeter Style) ====================
let svgArea, cloudGroup;
let isFirstRender = true;
let width = window.innerWidth;
let height = window.innerHeight;

let nodes = [];
let cloudScale = 1;
let textElements;

// Offscreen canvas untuk mengukur lebar teks secara presisi
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');

// Warna elegan (Skema Gold/Cream)
const colorScale = d3.scaleOrdinal()
    .range(["#d4a843", "#f5d17a", "#b8912e", "#e8e0d0", "#a09880", "#5ea9a0", "#c97b7b"]);

// ==================== ALGORITMA ARCHIMEDEAN SPIRAL ====================
// Mendeteksi apakah dua kotak saling tumpang tindih
function checkCollision(rect1, rect2, paddingX = 8, paddingY = 4) {
    return !(
        rect1.tx + rect1.width / 2 + paddingX < rect2.tx - rect2.width / 2 - paddingX ||
        rect1.tx - rect1.width / 2 - paddingX > rect2.tx + rect2.width / 2 + paddingX ||
        rect1.ty + rect1.height / 2 + paddingY < rect2.ty - rect2.height / 2 - paddingY ||
        rect1.ty - rect1.height / 2 - paddingY > rect2.ty + rect2.height / 2 + paddingY
    );
}

// Menghitung posisi statis bebas tabrakan untuk setiap kata menggunakan spiral
function calculateSpiralLayout(wordsArray) {
    const placedWords = [];
    
    // Jika kata banyak, renggangkan lintasan spiral agar lebih menyebar
    const a = 1; 
    const b = wordsArray.length > 30 ? 4 : 2.5; 
    
    // Hitung batas layout untuk auto-fit
    let minX = 0, maxX = 0, minY = 0, maxY = 0;

    wordsArray.forEach((word, index) => {
        if (index === 0) {
            word.tx = 0;
            word.ty = 0;
            placedWords.push(word);
            return;
        }

        let angle = 0;
        let placed = false;
        
        while (!placed) {
            const radius = a + b * angle;
            // Agar menyebar lebih ke samping mengikuti layar widescreen
            const aspectRatio = width / height > 1 ? width / height : 1;
            
            const tx = (radius * aspectRatio) * Math.cos(angle);
            const ty = radius * Math.sin(angle);
            
            word.tx = tx;
            word.ty = ty;
            
            // Jarak aman antar kata (padding)
            let hasCollision = false;
            for (let i = 0; i < placedWords.length; i++) {
                if (checkCollision(word, placedWords[i], 12, 6)) { // Padding agak dibesarkan
                    hasCollision = true;
                    break;
                }
            }
            
            if (!hasCollision) {
                placed = true;
                placedWords.push(word);
                
                // Update Bounding Box keseluruhan awan kata
                minX = Math.min(minX, tx - word.width / 2);
                maxX = Math.max(maxX, tx + word.width / 2);
                minY = Math.min(minY, ty - word.height / 2);
                maxY = Math.max(maxY, ty + word.height / 2);
            } else {
                angle += 0.1; 
            }
        }
    });

    // Kalkulasi rasio skala agar area Word Cloud optimal di tengah layar
    const cloudWidth = maxX - minX;
    const cloudHeight = maxY - minY;
    
    // Biarkan selebar 85% dari lebar window, dan 80% dari tinggi window
    const scaleX = (width * 0.85) / (cloudWidth || 1);
    const scaleY = (height * 0.80) / (cloudHeight || 1);
    
    cloudScale = Math.min(scaleX, scaleY);
    
    // Batasi maksimum zoom dan minimum zoom
    if (cloudScale > 2.5) cloudScale = 2.5;
    if (cloudScale < 0.2) cloudScale = 0.2;
}

// Inisialisasi SVG tanpa Physics Engine
function initSVG() {
    d3.select("#wordcloud-container").selectAll("svg").remove();
    
    width = window.innerWidth;
    height = window.innerHeight;

    svgArea = d3.select("#wordcloud-container").append("svg")
        .attr("width", width)
        .attr("height", height);
        
    cloudGroup = svgArea.append("g")
        .attr("transform", `translate(${width / 2}, ${height / 2})`);
}

// Memproses ulang node data saat ada input Firebase baru
function renderWordCloud(wordDataArray) {
    if (wordDataArray.length === 0) return;

    if (isFirstRender) {
        document.getElementById('loadingText').style.display = 'none';
        initSVG();
        isFirstRender = false;
    }

    // Batasi maksimum kata
    const topWords = wordDataArray.slice(0, 100);

    const maxFreq = d3.max(topWords, d => d.count);
    const minFreq = d3.min(topWords, d => d.count);
    
    // Scale font size: sangat dinamis (kata populer sangat membesar)
    const fontSizeScale = d3.scalePow().exponent(1.5)
        .domain([minFreq || 1, maxFreq || 10])
        .range([18, 120]); 

    // Amankan node yang sedang aktif agar transisi mulus
    const nodeMap = new Map(nodes.map(n => [n.text, n]));
    
    nodes = topWords.map((w, i) => {
        let existing = nodeMap.get(w.text);
        let targetFontSize = fontSizeScale(w.count);
        
        ctx.font = `700 ${targetFontSize}px 'Inter', sans-serif`;
        let textWidth = ctx.measureText(w.text).width;
        
        let nodeWidth = textWidth;
        let nodeHeight = targetFontSize * 0.85;
        let isTopWord = (i === 0);

        if (existing) {
            existing.targetFontSize = targetFontSize;
            existing.count = w.count;
            existing.width = nodeWidth;
            existing.height = nodeHeight;
            existing.isTopWord = isTopWord;
            existing.colorIndex = i; 
            return existing;
        } else {
            // Node Baru: Posisi awal sebelum transisi di luar layar/pusat
            return {
                text: w.text,
                count: w.count,
                targetFontSize: targetFontSize,
                width: nodeWidth,
                height: nodeHeight,
                isTopWord: isTopWord,
                x: 0, // Posisi start x (nanti diupdate ke tx saat transisi)
                y: 0, // Posisi start y (nanti diupdate ke ty saat transisi)
                tx: 0, // Target x
                ty: 0, // Target y
                colorIndex: i
            };
        }
    });

    // Kalkulasi target (tx, ty) statis untuk semua node tanpa overlap
    calculateSpiralLayout(nodes);

    // === DATA BINDING (Enter / Update / Exit) ===
    textElements = cloudGroup.selectAll("text").data(nodes, d => d.text);

    // EXIT (Hapus kata dengan transisi memudar dan mengecil)
    textElements.exit()
        .transition().duration(800).ease(d3.easeCubicIn)
        .style("font-size", "0px")
        .style("opacity", 0)
        .remove();

    // ENTER (Munculkan elemen teks baru)
    const textEnter = textElements.enter().append("text")
        .text(d => d.text)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .style("font-weight", "700")
        .style("font-size", "0px") // Mulai dari kecil
        .style("opacity", 0)
        .style("fill", d => colorScale(d.colorIndex))
        .attr("x", d => d.x) 
        .attr("y", d => d.y);

    // UPDATE + MERGE
    const tooltip = document.getElementById('tooltip');
    
    textElements = textEnter.merge(textElements)
        .on("mouseenter", function(event, d) {
            tooltip.style.opacity = 1;
            tooltip.textContent = d.count;
        })
        .on("mousemove", function(event) {
            tooltip.style.left = event.pageX + 'px';
            tooltip.style.top = event.pageY + 'px';
        })
        .on("mouseleave", function() {
            tooltip.style.opacity = 0;
        });

    // Transisi meluncur mulus layaknya Mentimeter
    textElements.transition().duration(1200).ease(d3.easeCubicOut)
        .style("font-size", d => `${d.targetFontSize}px`)
        .style("opacity", 1)
        .style("fill", d => colorScale(d.colorIndex))
        .attr("x", d => {
            d.x = d.tx; // Update internal state
            return d.tx;
        })
        .attr("y", d => {
            d.y = d.ty; // Update internal state
            return d.ty;
        });

    // Sesuaikan zoom level layar secara otomatis agar word cloud pas di tengah layar
    cloudGroup.transition().duration(1200).ease(d3.easeCubicOut)
        .attr("transform", `translate(${width / 2}, ${height / 2}) scale(${cloudScale})`);
}


// ==================== FIREBASE REALTIME LISTENER ====================
let rawDataMain = {};
let lastUpdateTime = Date.now();

function processAndRender() {
    lastUpdateTime = Date.now();
    
    // Terapkan Auto-Typo Correction
    const correctedCounts = applyTypoCorrection(rawDataMain);

    // Ubah jadi array untuk D3
    const finalWordArray = Object.keys(correctedCounts).map(key => {
        return { text: key, count: correctedCounts[key] };
    });

    // Urutkan dari yang terbesar (penting untuk mapping layout yang stabil)
    finalWordArray.sort((a, b) => b.count - a.count);

    // Gambar Word Cloud
    if (finalWordArray.length > 0) {
        renderWordCloud(finalWordArray);
    } else {
        document.getElementById('loadingText').textContent = 'Belum ada data masuk...';
    }
}

function processSnapshot(snapshot, targetObj) {
    // Clear existing data for this source to avoid duplication on updates
    for(let key in targetObj) delete targetObj[key];
    
    snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.tigaKata) {
            // Bersihkan: lowercase, ganti newline/koma dengan spasi, buang karakter spesial
            const cleanText = data.tigaKata.toLowerCase().replace(/[\n,]/g, ' ').replace(/[^\w\s-]/g, '');
            const words = cleanText.split(/\s+/).filter(w => {
                return w.length > 1 && !STOPWORDS.has(w) && !isProfane(w);
            });
            
            words.forEach(word => {
                targetObj[word] = (targetObj[word] || 0) + 1;
            });
        }
    });
}

async function startListening() {
    initSVG();

    const entriesRef = collection(db, 'kapsul_waktu', currentYear, 'public_words');

    // Subscribe ke data wordcloud SSOT
    onSnapshot(entriesRef, (snapshot) => {
        const total = snapshot.docs.length;
        document.getElementById('participantCount').textContent = `${total} Partisipan`;
        processSnapshot(snapshot, rawDataMain);
        processAndRender();
    }, (error) => {
        console.error("Gagal mendengarkan data wordcloud:", error);
    });
}

// ==================== INISIALISASI ====================
// Login anonim dulu, tapi Firestore listener baru aktif setelah intro selesai (hemat kuota read)
signInAnonymously(auth).then(() => {
    // Cek apakah intro sudah selesai (misal user refresh setelah intro)
    if (document.body.classList.contains('wordcloud-ready')) {
        startListening();
    } else {
        window.addEventListener('introComplete', () => {
            startListening();
        }, { once: true });
    }
}).catch((err) => {
    console.error("Gagal Login Anonim: ", err);
    document.getElementById('loadingText').textContent = 'Gagal mengakses data (Otorisasi).';
});

// Update jika window di-resize
window.addEventListener('resize', () => {
    clearTimeout(window.resizeTimer);
    window.resizeTimer = setTimeout(() => {
        if (!svgArea) return;
        width = window.innerWidth;
        height = window.innerHeight;
        
        svgArea.attr("width", width).attr("height", height);
        cloudGroup.attr("transform", `translate(${width / 2}, ${height / 2})`);
        
        // Render ulang spiral dan animasi ke posisi baru karena ukuran layar berubah
        if (nodes.length > 0) {
            calculateSpiralLayout(nodes);
            if (textElements) {
                textElements.transition().duration(800).ease(d3.easeCubicOut)
                    .attr("x", d => { d.x = d.tx; return d.tx; })
                    .attr("y", d => { d.y = d.ty; return d.ty; });
            }
        }
    }, 300);
});

// ==================== FULLSCREEN SHORTCUT ====================
document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => console.error(err));
        } else {
            document.exitFullscreen();
        }
    }
});

// Recalculate layout saat masuk/keluar fullscreen
function recalculateLayout() {
    if (!svgArea) return;
    width = window.innerWidth;
    height = window.innerHeight;
    
    svgArea.attr("width", width).attr("height", height);
    
    if (nodes.length > 0) {
        calculateSpiralLayout(nodes);
        cloudGroup.transition().duration(800).ease(d3.easeCubicOut)
            .attr("transform", `translate(${width / 2}, ${height / 2}) scale(${cloudScale})`);
        if (textElements) {
            textElements.transition().duration(800).ease(d3.easeCubicOut)
                .attr("x", d => { d.x = d.tx; return d.tx; })
                .attr("y", d => { d.y = d.ty; return d.ty; });
        }
    } else {
        cloudGroup.attr("transform", `translate(${width / 2}, ${height / 2})`);
    }
}

document.addEventListener('fullscreenchange', () => {
    // Delay kecil agar browser selesai resize dulu
    setTimeout(recalculateLayout, 200);
});

// ==================== SCREENSHOT / EXPORT ====================
document.getElementById('btnExport').addEventListener('click', async () => {
    try {
        const canvas = await html2canvas(document.body, { 
            backgroundColor: '#0a1628',
            scale: 2 // High resolution untuk hasil tajam
        });
        const link = document.createElement('a');
        link.download = `WordCloud-SMANTARA-${Date.now()}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    } catch (error) {
        console.error("Gagal export screenshot", error);
        window.showAlertModal('Error', 'Terjadi kesalahan saat memproses gambar.', 'error');
    }
});

// ==================== IDLE ANIMATION (Breathing Effect) ====================
setInterval(() => {
    // Jika tidak ada data baru selama lebih dari 8 detik dan SVG sudah ter-render
    if (Date.now() - lastUpdateTime > 8000 && textElements) {
        textElements.transition()
            .duration(4000)
            .ease(d3.easeSinInOut)
            .attr("x", d => d.tx + (Math.random() * 10 - 5)) // Gerakan acak ±5px
            .attr("y", d => d.ty + (Math.random() * 10 - 5));
    }
}, 5000);
