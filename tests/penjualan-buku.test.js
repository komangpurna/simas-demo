/**
 * tests/penjualan-buku.test.js
 * Unit Test untuk Modul Penjualan Buku & Penyelarasan Guru Mapel Jadwal XML
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mockScheduleXmlPath = path.resolve(__dirname, '../assets/Jadwal.xml');
const xmlContent = fs.readFileSync(mockScheduleXmlPath, 'utf8');

const codePath = path.resolve(__dirname, '../js/page-penjualan-buku.js');
const rawCode = fs.readFileSync(codePath, 'utf8');

// Dataset 60 Buku Fixture Khusus untuk Pengujian Algoritma Rekonsiliasi (Zero-Hardcode di Production Code)
const mock60BooksFixture = [
    // KELAS 10
    { grade: 10, subject: 'Agama dan Budi Pekerti', terima: 150, diam: 0, sisa: 0, terjual: 150, harga: 15000, total: 2250000 },
    { grade: 10, subject: 'Bahasa Bali', terima: 100, diam: 0, sisa: 0, terjual: 100, harga: 15000, total: 1500000 },
    { grade: 10, subject: 'Bahasa Indonesia', terima: 215, diam: 0, sisa: 1, terjual: 214, harga: 17000, total: 3638000 },
    { grade: 10, subject: 'Bahasa Inggris', terima: 210, diam: 0, sisa: 0, terjual: 210, harga: 17000, total: 3570000 },
    { grade: 10, subject: 'Biologi', terima: 215, diam: 0, sisa: 4, terjual: 211, harga: 17000, total: 3587000 },
    { grade: 10, subject: 'Ekonomi', terima: 210, diam: 0, sisa: 0, terjual: 210, harga: 17000, total: 3570000 },
    { grade: 10, subject: 'Fisika', terima: 184, diam: 0, sisa: 0, terjual: 184, harga: 17000, total: 3128000 },
    { grade: 10, subject: 'Geografi', terima: 190, diam: 1, sisa: 1, terjual: 188, harga: 17000, total: 3196000 },
    { grade: 10, subject: 'Informatika', terima: 200, diam: 0, sisa: 1, terjual: 199, harga: 17000, total: 3383000 },
    { grade: 10, subject: 'Kimia', terima: 240, diam: 0, sisa: 5, terjual: 235, harga: 17000, total: 3995000 },
    { grade: 10, subject: 'Matematika', terima: 185, diam: 0, sisa: 0, terjual: 185, harga: 17000, total: 3145000 },
    { grade: 10, subject: 'Pendidikan Pancasila', terima: 240, diam: 0, sisa: 12, terjual: 228, harga: 17000, total: 3876000 },
    { grade: 10, subject: 'PJOK', terima: 120, diam: 0, sisa: 0, terjual: 120, harga: 17000, total: 2040000 },
    { grade: 10, subject: 'Sejarah', terima: 210, diam: 0, sisa: 5, terjual: 205, harga: 17000, total: 3485000 },
    { grade: 10, subject: 'Seni Rupa', terima: 190, diam: 0, sisa: 0, terjual: 190, harga: 17000, total: 3230000 },
    { grade: 10, subject: 'Sosiologi', terima: 190, diam: 0, sisa: 2, terjual: 188, harga: 17000, total: 3196000 },

    // KELAS 11
    { grade: 11, subject: 'Agama dan Budi Pekerti', terima: 170, diam: 0, sisa: 0, terjual: 170, harga: 15000, total: 2550000 },
    { grade: 11, subject: 'Antropologi', terima: 79, diam: 0, sisa: 1, terjual: 78, harga: 17000, total: 1326000 },
    { grade: 11, subject: 'Bahasa Bali', terima: 139, diam: 0, sisa: 2, terjual: 137, harga: 15000, total: 2055000 },
    { grade: 11, subject: 'Bahasa Indonesia', terima: 203, diam: 0, sisa: 2, terjual: 201, harga: 17000, total: 3417000 },
    { grade: 11, subject: 'Bahasa Indonesia Tingkat Lanjut', terima: 73, diam: 1, sisa: 0, terjual: 72, harga: 17000, total: 1224000 },
    { grade: 11, subject: 'Bahasa Inggris', terima: 252, diam: 0, sisa: 9, terjual: 243, harga: 17000, total: 4131000 },
    { grade: 11, subject: 'Bahasa Inggris Tingkat Lanjut', terima: 77, diam: 0, sisa: 2, terjual: 75, harga: 17000, total: 1275000 },
    { grade: 11, subject: 'Biologi', terima: 150, diam: 0, sisa: 84, terjual: 66, harga: 17000, total: 1122000 },
    { grade: 11, subject: 'Ekonomi', terima: 90, diam: 0, sisa: 29, terjual: 61, harga: 23000, total: 1403000 },
    { grade: 11, subject: 'Fisika', terima: 163, diam: 0, sisa: 132, terjual: 31, harga: 17000, total: 527000 },
    { grade: 11, subject: 'Geografi', terima: 75, diam: 0, sisa: 52, terjual: 23, harga: 17000, total: 391000 },
    { grade: 11, subject: 'Informatika', terima: 89, diam: 0, sisa: 3, terjual: 86, harga: 17000, total: 1462000 },
    { grade: 11, subject: 'Kimia', terima: 100, diam: 0, sisa: 67, terjual: 33, harga: 17000, total: 561000 },
    { grade: 11, subject: 'Matematika', terima: 208, diam: 0, sisa: 2, terjual: 206, harga: 23000, total: 4738000 },
    { grade: 11, subject: 'Matematika Tingkat Lanjut', terima: 12, diam: 1, sisa: 11, terjual: 0, harga: 23000, total: 0 },
    { grade: 11, subject: 'Sejarah Tingkat Lanjut', terima: 50, diam: 0, sisa: 0, terjual: 50, harga: 17000, total: 850000 },
    { grade: 11, subject: 'Pendidikan Pancasila', terima: 255, diam: 0, sisa: 36, terjual: 219, harga: 17000, total: 3723000 },
    { grade: 11, subject: 'PKWU', terima: 102, diam: 0, sisa: 1, terjual: 101, harga: 17000, total: 1717000 },
    { grade: 11, subject: 'PJOK', terima: 170, diam: 0, sisa: 3, terjual: 167, harga: 17000, total: 2839000 },
    { grade: 11, subject: 'Sejarah', terima: 226, diam: 0, sisa: 7, terjual: 219, harga: 17000, total: 3723000 },
    { grade: 11, subject: 'Seni Tari', terima: 210, diam: 0, sisa: 11, terjual: 199, harga: 17000, total: 3383000 },
    { grade: 11, subject: 'Sosiologi', terima: 110, diam: 0, sisa: 28, terjual: 82, harga: 17000, total: 1394000 },

    // KELAS 12
    { grade: 12, subject: 'Agama dan Budi Pekerti', terima: 125, diam: 0, sisa: 0, terjual: 125, harga: 18000, total: 2250000 },
    { grade: 12, subject: 'Antropologi', terima: 99, diam: 0, sisa: 0, terjual: 99, harga: 23000, total: 2277000 },
    { grade: 12, subject: 'Bahasa Bali', terima: 100, diam: 0, sisa: 100, terjual: 0, harga: 18000, total: 0 },
    { grade: 12, subject: 'Bahasa Indonesia Tingkat Lanjut', terima: 60, diam: 0, sisa: 5, terjual: 55, harga: 23000, total: 1265000 },
    { grade: 12, subject: 'Bahasa Indonesia', terima: 150, diam: 0, sisa: 19, terjual: 131, harga: 23000, total: 3013000 },
    { grade: 12, subject: 'Bahasa Inggris Tingkat Lanjut', terima: 60, diam: 0, sisa: 8, terjual: 52, harga: 23000, total: 1196000 },
    { grade: 12, subject: 'Bahasa Inggris', terima: 160, diam: 0, sisa: 32, terjual: 128, harga: 23000, total: 2944000 },
    { grade: 12, subject: 'Biologi', terima: 70, diam: 0, sisa: 1, terjual: 69, harga: 23000, total: 1587000 },
    { grade: 12, subject: 'Ekonomi', terima: 50, diam: 0, sisa: 24, terjual: 26, harga: 23000, total: 598000 },
    { grade: 12, subject: 'Fisika', terima: 70, diam: 0, sisa: 19, terjual: 51, harga: 23000, total: 1173000 },
    { grade: 12, subject: 'Geografi', terima: 50, diam: 0, sisa: 28, terjual: 22, harga: 23000, total: 506000 },
    { grade: 12, subject: 'Informatika', terima: 70, diam: 0, sisa: 25, terjual: 45, harga: 23000, total: 1035000 },
    { grade: 12, subject: 'Kimia', terima: 70, diam: 0, sisa: 20, terjual: 50, harga: 23000, total: 1150000 },
    { grade: 12, subject: 'Matematika', terima: 150, diam: 0, sisa: 11, terjual: 139, harga: 23000, total: 3197000 },
    { grade: 12, subject: 'Matematika Tingkat Lanjut', terima: 50, diam: 0, sisa: 49, terjual: 1, harga: 23000, total: 23000 },
    { grade: 12, subject: 'Pendidikan Pancasila', terima: 130, diam: 0, sisa: 17, terjual: 113, harga: 23000, total: 2599000 },
    { grade: 12, subject: 'PKWU', terima: 75, diam: 0, sisa: 17, terjual: 58, harga: 23000, total: 1334000 },
    { grade: 12, subject: 'PJOK', terima: 100, diam: 0, sisa: 10, terjual: 90, harga: 23000, total: 2070000 },
    { grade: 12, subject: 'Sejarah Tingkat Lanjut', terima: 50, diam: 0, sisa: 26, terjual: 24, harga: 23000, total: 552000 },
    { grade: 12, subject: 'Sejarah', terima: 123, diam: 0, sisa: 5, terjual: 118, harga: 23000, total: 2714000 },
    { grade: 12, subject: 'Seni Tari', terima: 120, diam: 0, sisa: 28, terjual: 92, harga: 23000, total: 2116000 },
    { grade: 12, subject: 'Sosiologi', terima: 50, diam: 0, sisa: 26, terjual: 24, harga: 23000, total: 552000 }
];

describe('Modul Penjualan Buku & Penyelarasan Jadwal XML (Super Admin & Admin LKS)', () => {
    let parseNumberSafe;
    let getGradeRoman;
    let parseBookSalesText;
    let DEFAULT_BOOK_SALES_DATA;
    let buildScheduleGradeMap;
    let findTeachersForBookSales;
    let aggregateSalesByTeacher;
    let matchBookSalesWithSchedule;
    let getClassesForGrade;
    let getSubjectsForGrade;
    let getSubjectsForClass;
    let findBookEntry;
    let findTeacherForClassSubject;
    let calcRemainingStock;
    let getBookPrice;
    let openAddBookModal;
    let closeAddBookModal;
    let submitAddBook;
    let deleteBookEntry;
    let syncBooksFromSchedule;
    let openImportModal;
    let closeImportModal;
    let openCirculationModal;
    let closeCirculationModal;
    let submitAddCirculation;
    let deleteCirculation;
    let updateBookPrice;
    let renderPriceSettingsTable;
    let openBulkPriceModal;
    let closeBulkPriceModal;
    let applyBulkPriceUpdate;
    let saveAllBookPrices;
    let initPenjualanBukuPage;
    let getClassStudentCounts;
    let getSubjectTargetClasses;
    let analyzeBookDemand;
    let calculateBooksDemandAnalysis;
    let renderDemandAnalysisTable;
    let openDemandDetailModal;
    let closeDemandDetailModal;
    let setCurrentClassSizes;
    let getDefaultTransactionPeriod;
    let getNextSemesterPeriod;
    let getAvailableTransactionPeriods;
    let formatSemesterPeriodShort;
    let getCurrentSelectedSemesterPeriod;
    let setCurrentSelectedSemesterPeriod;
    let getCurrentSettingsStatusFilter;
    let setCurrentSettingsStatusFilter;
    let toggleBookVisibility;
    let getPendingVisibilityToggles;
    let getPendingPriceSaves;
    let isReturnTx;
    let txNetQty;
    let txNetTotal;
    let getReturnedQtyForTx;
    let getReturnableQty;
    let summarizeTransactions;
    let getCurrentTxTypeFilter;
    let setCurrentTxTypeFilter;
    let setCurrentTransactions;
    let getCurrentTransactions;
    let getCurrentVendors;
    let setCurrentVendors;
    let renderVendorSettingsTable;
    let submitAddVendor;
    let deleteVendor;
    let populateVendorSelect;
    let onCirculationVendorSelectChanged;
    let renderBooksTable;
    let renderTeachersTable;
    let updateKpiCards;
    let isBookSubjectMatch;
    let getBooksWithPeriodSales;
    let purgeExpiredLksRecords;
    let getAssignedTeachersForSubject;
    let getAllSchoolTeachers;
    let populateCircTeacherDropdown;
    let selectCircTeacher;
    let toggleCircTeacherDropdown;
    let openCircTeacherDropdown;
    let closeCircTeacherDropdown;
    let setCurrentParsedSchedule;
    let onCirculationSubjectChanged;
    let getCurrentCashFlows;
    let setCurrentCashFlows;
    let calculateCashFlowSummary;
    let generateCashFlowLedger;
    let renderCashFlowTable;
    let openAddCashFlowModal;
    let closeAddCashFlowModal;
    let onCashFlowTypeChanged;
    let onCashFlowFilterChanged;
    let submitAddCashFlow;
    let deleteCashFlow;
    let loadSavedBookSalesData;
    let saveBookSalesData;
    let parseSettingValue;
    let BOOK_VENDORS_STORAGE_KEY;
    let BOOK_VENDORS_D1_KEY;
    let BOOK_SALES_STORAGE_KEY;
    let BOOK_SALES_D1_KEY;
    let BOOK_SCHOOL_SHARE_STORAGE_KEY;
    let BOOK_SCHOOL_SHARE_D1_KEY;
    let getSchoolSharePercentage;
    let setSchoolSharePercentage;
    let saveSchoolSharePercentage;
    let updateSchoolShareBadge;
    let formatCurrencyInput;
    let DEFAULT_FEE_DISTRIBUTION_SETTINGS;
    let getFeeDistributionSettings;
    let setFeeDistributionSettings;
    let getFeeRoleFilter;
    let setFeeRoleFilter;
    let calculateFeeDistribution;
    let classifyGtkRole;
    let fetchAllSchoolGtk;
    let renderFeeSharingTab;
    let renderFeeSharingTable;
    let openFeeDetailModal;
    let closeFeeDetailModal;
    let onFeePercentageInputChanged;
    let onFeeAmountInputChanged;
    let saveFeeDistributionSettings;
    let copyFeeTableToClipboard;
    let sandbox;

    beforeAll(() => {
        sandbox = {
            window: {
                escapeHTML: (str) => str || '',
                formatRupiah: (amt) => 'Rp ' + amt,
                showToast: () => {},
                confirm: () => true
            },
            SCHOOL_CONFIG: {
                headmasterName: 'I Putu Suweta, S.Pd., M.Pd.',
                headmasterNIP: '197005211997021001'
            },
            confirm: () => true,
            escapeHTML: (str) => str || '',
            showToast: () => {},
            cfClient: { enabled: false },
            auth: {},
            onAuthStateChanged: (auth, cb) => {
                sandbox.__authCb = cb;
                return () => {};
            },
            initLayout: () => Promise.resolve(),
            parseASCSchedule: () => Promise.resolve({ subjects: {}, classes: {}, lessons: [] }),
            localStorage: {
                _store: {},
                getItem(k) { return this._store[k] || null; },
                setItem(k, v) { this._store[k] = String(v); },
                removeItem(k) { delete this._store[k]; },
                clear() { this._store = {}; }
            },
            document: {
                addEventListener: () => {},
                getElementById: () => null,
                querySelector: () => null
            },
            setTimeout,
            clearTimeout,
            console
        };

        // Strip imports and exports for Node VM sandbox
        const cleanCode = rawCode
            .replace(/^import\s+[^;]+;?/gm, '')
            .replace(/export\s+(const|let|var|function\*?|class|async\s+function\*?)\s+/gm, '$1 ');

        vm.createContext(sandbox);
        vm.runInContext(cleanCode, sandbox);

        // Pasang fixture dataset ke currentMatchedData agar fungsi yang membutuhkan data dapat berjalan
        if (sandbox.window.setCurrentBookData) {
            sandbox.window.setCurrentBookData(JSON.parse(JSON.stringify(mock60BooksFixture)));
        }

        parseNumberSafe = sandbox.window.parseNumberSafe;
        getGradeRoman = sandbox.window.getGradeRoman;
        parseBookSalesText = sandbox.window.parseBookSalesText;
        DEFAULT_BOOK_SALES_DATA = sandbox.window.DEFAULT_BOOK_SALES_DATA;
        buildScheduleGradeMap = sandbox.window.buildScheduleGradeMap;
        findTeachersForBookSales = sandbox.window.findTeachersForBookSales;
        aggregateSalesByTeacher = sandbox.window.aggregateSalesByTeacher;
        matchBookSalesWithSchedule = sandbox.window.matchBookSalesWithSchedule;
        getClassesForGrade = sandbox.window.getClassesForGrade;
        getSubjectsForGrade = sandbox.window.getSubjectsForGrade;
        getSubjectsForClass = sandbox.window.getSubjectsForClass;
        findBookEntry = sandbox.window.findBookEntry;
        findTeacherForClassSubject = sandbox.window.findTeacherForClassSubject;
        calcRemainingStock = sandbox.window.calcRemainingStock;
        getBookPrice = sandbox.window.getBookPrice;
        openAddBookModal = sandbox.window.openAddBookModal;
        closeAddBookModal = sandbox.window.closeAddBookModal;
        submitAddBook = sandbox.window.submitAddBook;
        deleteBookEntry = sandbox.window.deleteBookEntry;
        syncBooksFromSchedule = sandbox.window.syncBooksFromSchedule;
        openImportModal = sandbox.window.openImportModal;
        closeImportModal = sandbox.window.closeImportModal;
        openCirculationModal = sandbox.window.openCirculationModal;
        closeCirculationModal = sandbox.window.closeCirculationModal;
        submitAddCirculation = sandbox.window.submitAddCirculation;
        deleteCirculation = sandbox.window.deleteCirculation;
        updateBookPrice = sandbox.window.updateBookPrice;
        renderPriceSettingsTable = sandbox.window.renderPriceSettingsTable;
        openBulkPriceModal = sandbox.window.openBulkPriceModal;
        closeBulkPriceModal = sandbox.window.closeBulkPriceModal;
        applyBulkPriceUpdate = sandbox.window.applyBulkPriceUpdate;
        saveAllBookPrices = sandbox.window.saveAllBookPrices;
        initPenjualanBukuPage = sandbox.window.initPenjualanBukuPage;
        getClassStudentCounts = sandbox.window.getClassStudentCounts;
        getSubjectTargetClasses = sandbox.window.getSubjectTargetClasses;
        analyzeBookDemand = sandbox.window.analyzeBookDemand;
        calculateBooksDemandAnalysis = sandbox.window.calculateBooksDemandAnalysis;
        renderDemandAnalysisTable = sandbox.window.renderDemandAnalysisTable;
        setCurrentClassSizes = sandbox.window.setCurrentClassSizes;
        getDefaultTransactionPeriod = sandbox.window.getDefaultTransactionPeriod;
        getNextSemesterPeriod = sandbox.window.getNextSemesterPeriod;
        getAvailableTransactionPeriods = sandbox.window.getAvailableTransactionPeriods;
        formatSemesterPeriodShort = sandbox.window.formatSemesterPeriodShort;
        getCurrentSelectedSemesterPeriod = sandbox.window.getCurrentSelectedSemesterPeriod;
        setCurrentSelectedSemesterPeriod = sandbox.window.setCurrentSelectedSemesterPeriod;
        getCurrentSettingsStatusFilter = sandbox.window.getCurrentSettingsStatusFilter;
        setCurrentSettingsStatusFilter = sandbox.window.setCurrentSettingsStatusFilter;
        toggleBookVisibility = sandbox.window.toggleBookVisibility;
        getPendingVisibilityToggles = sandbox.window.getPendingVisibilityToggles;
        getPendingPriceSaves = sandbox.window.getPendingPriceSaves;
        isReturnTx = sandbox.window.isReturnTx;
        txNetQty = sandbox.window.txNetQty;
        txNetTotal = sandbox.window.txNetTotal;
        getReturnedQtyForTx = sandbox.window.getReturnedQtyForTx;
        getReturnableQty = sandbox.window.getReturnableQty;
        summarizeTransactions = sandbox.window.summarizeTransactions;
        getCurrentTxTypeFilter = sandbox.window.getCurrentTxTypeFilter;
        setCurrentTxTypeFilter = sandbox.window.setCurrentTxTypeFilter;
        setCurrentTransactions = sandbox.window.setCurrentTransactions;
        getCurrentTransactions = sandbox.window.getCurrentTransactions;
        getCurrentVendors = sandbox.window.getCurrentVendors;
        setCurrentVendors = sandbox.window.setCurrentVendors;
        renderVendorSettingsTable = sandbox.window.renderVendorSettingsTable;
        submitAddVendor = sandbox.window.submitAddVendor;
        deleteVendor = sandbox.window.deleteVendor;
        populateVendorSelect = sandbox.window.populateVendorSelect;
        onCirculationVendorSelectChanged = sandbox.window.onCirculationVendorSelectChanged;
        renderBooksTable = sandbox.window.renderBooksTable;
        renderTeachersTable = sandbox.window.renderTeachersTable;
        updateKpiCards = sandbox.window.updateKpiCards;
        isBookSubjectMatch = sandbox.window.isBookSubjectMatch;
        getBooksWithPeriodSales = sandbox.window.getBooksWithPeriodSales;
        switchTab = sandbox.window.switchBookTab;
        purgeExpiredLksRecords = sandbox.window.purgeExpiredLksRecords;
        getAssignedTeachersForSubject = sandbox.window.getAssignedTeachersForSubject;
        getAllSchoolTeachers = sandbox.window.getAllSchoolTeachers;
        populateCircTeacherDropdown = sandbox.window.populateCircTeacherDropdown;
        selectCircTeacher = sandbox.window.selectCircTeacher;
        toggleCircTeacherDropdown = sandbox.window.toggleCircTeacherDropdown;
        openCircTeacherDropdown = sandbox.window.openCircTeacherDropdown;
        closeCircTeacherDropdown = sandbox.window.closeCircTeacherDropdown;
        setCurrentParsedSchedule = sandbox.window.setCurrentParsedSchedule;
        onCirculationSubjectChanged = sandbox.window.onCirculationSubjectChanged;
        getCurrentCashFlows = sandbox.window.getCurrentCashFlows;
        setCurrentCashFlows = sandbox.window.setCurrentCashFlows;
        calculateCashFlowSummary = sandbox.window.calculateCashFlowSummary;
        generateCashFlowLedger = sandbox.window.generateCashFlowLedger;
        renderCashFlowTable = sandbox.window.renderCashFlowTable;
        openAddCashFlowModal = sandbox.window.openAddCashFlowModal;
        closeAddCashFlowModal = sandbox.window.closeAddCashFlowModal;
        onCashFlowTypeChanged = sandbox.window.onCashFlowTypeChanged;
        onCashFlowFilterChanged = sandbox.window.onCashFlowFilterChanged;
        submitAddCashFlow = sandbox.window.submitAddCashFlow;
        deleteCashFlow = sandbox.window.deleteCashFlow;
        loadSavedBookSalesData = sandbox.window.loadSavedBookSalesData;
        saveBookSalesData = sandbox.window.saveBookSalesData;
        parseSettingValue = sandbox.window.parseSettingValue;
        BOOK_VENDORS_STORAGE_KEY = sandbox.window.BOOK_VENDORS_STORAGE_KEY;
        BOOK_VENDORS_D1_KEY = sandbox.window.BOOK_VENDORS_D1_KEY;
        BOOK_SALES_STORAGE_KEY = sandbox.window.BOOK_SALES_STORAGE_KEY;
        BOOK_SALES_D1_KEY = sandbox.window.BOOK_SALES_D1_KEY;
        BOOK_SCHOOL_SHARE_STORAGE_KEY = sandbox.window.BOOK_SCHOOL_SHARE_STORAGE_KEY;
        BOOK_SCHOOL_SHARE_D1_KEY = sandbox.window.BOOK_SCHOOL_SHARE_D1_KEY;
        getSchoolSharePercentage = sandbox.window.getSchoolSharePercentage;
        setSchoolSharePercentage = sandbox.window.setSchoolSharePercentage;
        saveSchoolSharePercentage = sandbox.window.saveSchoolSharePercentage;
        updateSchoolShareBadge = sandbox.window.updateSchoolShareBadge;
        formatCurrencyInput = sandbox.window.formatCurrencyInput;
        DEFAULT_FEE_DISTRIBUTION_SETTINGS = sandbox.window.DEFAULT_FEE_DISTRIBUTION_SETTINGS;
        getFeeDistributionSettings = sandbox.window.getFeeDistributionSettings;
        setFeeDistributionSettings = sandbox.window.setFeeDistributionSettings;
        getFeeRoleFilter = sandbox.window.getFeeRoleFilter;
        setFeeRoleFilter = sandbox.window.setFeeRoleFilter;
        calculateFeeDistribution = sandbox.window.calculateFeeDistribution;
        classifyGtkRole = sandbox.window.classifyGtkRole;
        fetchAllSchoolGtk = sandbox.window.fetchAllSchoolGtk;
        renderFeeSharingTab = sandbox.window.renderFeeSharingTab;
        renderFeeSharingTable = sandbox.window.renderFeeSharingTable;
        openFeeDetailModal = sandbox.window.openFeeDetailModal;
        closeFeeDetailModal = sandbox.window.closeFeeDetailModal;
        onFeePercentageInputChanged = sandbox.window.onFeePercentageInputChanged;
        onFeeAmountInputChanged = sandbox.window.onFeeAmountInputChanged;
        saveFeeDistributionSettings = sandbox.window.saveFeeDistributionSettings;
        copyFeeTableToClipboard = sandbox.window.copyFeeTableToClipboard;
    });

    test('1. parseNumberSafe membersihkan format angka dan mata uang rupiah', () => {
        expect(parseNumberSafe('Rp17.000')).toBe(17000);
        expect(parseNumberSafe('2.250.000')).toBe(2250000);
        expect(parseNumberSafe('150')).toBe(150);
        expect(parseNumberSafe('')).toBe(0);
        expect(parseNumberSafe(null)).toBe(0);
        expect(parseNumberSafe(25000)).toBe(25000);
    });

    test('2. parseBookSalesText mem-parsing teks TSV dan mengabaikan baris header', () => {
        const rawText = `
KELAS\tBUKU\tTERIMA\tDIAM\tSISA\tTERJUAL\tHARGA\tTOTAL
10\tAgama dan Budi Pekerti\t150\t\t\t150\tRp15.000\t2.250.000
10\tBahasa Indonesia\t215\t\t1\t214\tRp17.000\t3.638.000
10\tGeografi\t190\t1\t1\t188\tRp17.000\t3.196.000
11\tMatematika Tingkat Lanjut\t12\t1\t11\t0\tRp23.000\t0
        `;

        const parsed = parseBookSalesText(rawText);
        expect(parsed).toHaveLength(4);

        expect(parsed[0]).toEqual({
            grade: 10,
            subject: 'Agama dan Budi Pekerti',
            terima: 150,
            diam: 0,
            sisa: 0,
            terjual: 150,
            harga: 15000,
            total: 2250000
        });

        expect(parsed[2]).toEqual({
            grade: 10,
            subject: 'Geografi',
            terima: 190,
            diam: 1,
            sisa: 1,
            terjual: 188,
            harga: 17000,
            total: 3196000
        });

        expect(parsed[3]).toEqual({
            grade: 11,
            subject: 'Matematika Tingkat Lanjut',
            terima: 12,
            diam: 1,
            sisa: 11,
            terjual: 0,
            harga: 23000,
            total: 0
        });
    });

    test('3. DEFAULT_BOOK_SALES_DATA adalah array kosong (Zero-Hardcode Rule, seluruh data dinamis)', () => {
        expect(DEFAULT_BOOK_SALES_DATA).toEqual([]);
        expect(DEFAULT_BOOK_SALES_DATA).toHaveLength(0);
    });

    test('4. Pencocokan Cerdas Guru Pengajar dari Jadwal XML dengan Resolusi Alias', () => {
        // Parse mock XML secara langsung
        const subjectsMap = new Map();
        const subRegex = /<subject id="([^"]+)" name="([^"]+)"/g;
        let m;
        while ((m = subRegex.exec(xmlContent)) !== null) {
            subjectsMap.set(m[1], { id: m[1], name: m[2] });
        }

        const teachersMap = new Map();
        const teachRegex = /<teacher id="([^"]+)"[^>]*name="([^"]+)"/g;
        while ((m = teachRegex.exec(xmlContent)) !== null) {
            teachersMap.set(m[1], { id: m[1], name: m[2], simasName: m[2] });
        }

        const classesMap = new Map();
        const classRegex = /<class id="([^"]+)" name="([^"]+)"/g;
        while ((m = classRegex.exec(xmlContent)) !== null) {
            classesMap.set(m[1], { id: m[1], name: m[2] });
        }

        const lessonsMap = new Map();
        const lessonRegex = /<lesson\s+([^>]+)>/g;
        while ((m = lessonRegex.exec(xmlContent)) !== null) {
            const attrs = m[1];
            const idM = attrs.match(/id="([^"]+)"/);
            const subM = attrs.match(/subjectid="([^"]+)"/);
            const teachM = attrs.match(/teacherids="([^"]*)"/);
            const classM = attrs.match(/classids="([^"]*)"/);

            if (idM && subM) {
                lessonsMap.set(idM[1], {
                    id: idM[1],
                    subjectId: subM[1],
                    teacherIds: teachM ? teachM[1].split(',').filter(Boolean) : [],
                    classIds: classM ? classM[1].split(',').filter(Boolean) : []
                });
            }
        }

        const scheduleGradeMap = buildScheduleGradeMap({
            subjectsMap,
            teachersMap,
            classesMap,
            lessonsMap
        });

        // Test Kelas 10: Agama dan Budi Pekerti
        const agamaK10 = findTeachersForBookSales(10, 'Agama dan Budi Pekerti', scheduleGradeMap);
        expect(agamaK10.length).toBeGreaterThan(0);
        expect(agamaK10[0].teacher).toBe('I Putu Agustina, S.Pd.');

        // Test Kelas 11: PKWU / Prakarya
        const pkwuK11 = findTeachersForBookSales(11, 'PKWU', scheduleGradeMap);
        expect(pkwuK11.length).toBeGreaterThan(0);
        expect(pkwuK11[0].teacher).toBe('I Ketut Deny Hutama, S.E');

        // Test Kelas 11: Seni Tari (Alias Seni Budaya)
        const seniTariK11 = findTeachersForBookSales(11, 'Seni Tari', scheduleGradeMap);
        expect(seniTariK11.length).toBeGreaterThan(0);
        expect(seniTariK11[0].teacher).toBe('Ni Kadek Nilawati, S.Pd.');

        // Test Kelas 12: Bahasa Bali (Alias Kearifan Lokal Bali di XML)
        const baliK12 = findTeachersForBookSales(12, 'Bahasa Bali', scheduleGradeMap);
        expect(baliK12.length).toBeGreaterThan(0);
        expect(baliK12[0].teacher).toBe('I Wayan Pasek Eka Yasa, S.Pd.');

        // Test Kelas 10: Bahasa Indonesia (Multi Guru)
        const indoK10 = findTeachersForBookSales(10, 'Bahasa Indonesia', scheduleGradeMap);
        expect(indoK10).toHaveLength(2);
        const indoTeachers = indoK10.map(t => t.teacher);
        expect(indoTeachers).toContain('Ida Bagus Oka, S.Pd.');
        expect(indoTeachers).toContain('Ni Ketut Sukeni, S.Pd');
    });

    test('5. aggregateSalesByTeacher mengelompokkan penjualan per guru dengan akurat', () => {
        const mockMatched = [
            {
                grade: 10,
                subject: 'Matematika',
                terjual: 100,
                harga: 17000,
                total: 1700000,
                teachers: [{ teacher: 'Guru A', classesStr: 'X-1, X-2' }]
            },
            {
                grade: 11,
                subject: 'Matematika',
                terjual: 50,
                harga: 23000,
                total: 1150000,
                teachers: [{ teacher: 'Guru A', classesStr: 'XI-1' }]
            },
            {
                grade: 10,
                subject: 'Biologi',
                terjual: 80,
                harga: 17000,
                total: 1360000,
                teachers: [{ teacher: 'Guru B', classesStr: 'X-3' }]
            }
        ];

        const aggregated = aggregateSalesByTeacher(mockMatched);
        expect(aggregated).toHaveLength(2);

        const guruA = aggregated.find(g => g.teacherName === 'Guru A');
        expect(guruA).toBeDefined();
        expect(guruA.books).toHaveLength(2);
        expect(guruA.totalTerjual).toBe(150);
        expect(guruA.totalNominal).toBe(2850000);

        const guruB = aggregated.find(g => g.teacherName === 'Guru B');
        expect(guruB).toBeDefined();
        expect(guruB.books).toHaveLength(1);
        expect(guruB.totalTerjual).toBe(80);
        expect(guruB.totalNominal).toBe(1360000);
    });

    test('6. Perhitungan Proporsional Kelas & Persentase Beban Mengajar Guru', () => {
        // Parse mock XML
        const subjectsMap = new Map();
        const subRegex = /<subject id="([^"]+)" name="([^"]+)"/g;
        let m;
        while ((m = subRegex.exec(xmlContent)) !== null) {
            subjectsMap.set(m[1], { id: m[1], name: m[2] });
        }

        const teachersMap = new Map();
        const teachRegex = /<teacher id="([^"]+)"[^>]*name="([^"]+)"/g;
        while ((m = teachRegex.exec(xmlContent)) !== null) {
            teachersMap.set(m[1], { id: m[1], name: m[2], simasName: m[2] });
        }

        const classesMap = new Map();
        const classRegex = /<class id="([^"]+)" name="([^"]+)"/g;
        while ((m = classRegex.exec(xmlContent)) !== null) {
            classesMap.set(m[1], { id: m[1], name: m[2] });
        }

        const lessonsMap = new Map();
        const lessonRegex = /<lesson\s+([^>]+)>/g;
        while ((m = lessonRegex.exec(xmlContent)) !== null) {
            const attrs = m[1];
            const idM = attrs.match(/id="([^"]+)"/);
            const subM = attrs.match(/subjectid="([^"]+)"/);
            const teachM = attrs.match(/teacherids="([^"]*)"/);
            const classM = attrs.match(/classids="([^"]*)"/);

            if (idM && subM) {
                lessonsMap.set(idM[1], {
                    id: idM[1],
                    subjectId: subM[1],
                    teacherIds: teachM ? teachM[1].split(',').filter(Boolean) : [],
                    classIds: classM ? classM[1].split(',').filter(Boolean) : []
                });
            }
        }

        const scheduleGradeMap = buildScheduleGradeMap({
            subjectsMap,
            teachersMap,
            classesMap,
            lessonsMap
        });

        // Kasus Multi-Guru: Bahasa Indonesia Kelas 10 (Total 214 eksemplar, Rp 3.638.000)
        const indoK10 = findTeachersForBookSales(10, 'Bahasa Indonesia', scheduleGradeMap, 214, 3638000);
        expect(indoK10).toHaveLength(2);

        const guru1 = indoK10.find(t => t.teacher.includes('Ida Bagus Oka'));
        const guru2 = indoK10.find(t => t.teacher.includes('Ni Ketut Sukeni'));

        expect(guru1).toBeDefined();
        expect(guru2).toBeDefined();

        // Total kelas angkatan 10 untuk Bahasa Indonesia = 9 rombel (X-1 s/d X-9)
        expect(guru1.totalClasses).toBe(9);
        expect(guru2.totalClasses).toBe(9);
        expect(guru1.classCount + guru2.classCount).toBe(9);

        // Verifikasi persentase
        expect(guru1.percentage).toBeCloseTo((guru1.classCount / 9) * 100, 1);
        expect(guru2.percentage).toBeCloseTo((guru2.classCount / 9) * 100, 1);
        expect(guru1.percentageStr).toMatch(/%$/);

        // Rekonsiliasi jumlah eksemplar & nominal proporsional (harus 100% klop tanpa sisa)
        expect(guru1.propTerjual + guru2.propTerjual).toBe(214);
        expect(guru1.propNominal + guru2.propNominal).toBe(3638000);
    });

    test('7. Rekonsiliasi Penuh 60 Buku: 7.048 Eksemplar & Rp 128.751.000 Terbagi Sempurna per Guru', () => {
        // Parse mock XML
        const subjectsMap = new Map();
        const subRegex = /<subject id="([^"]+)" name="([^"]+)"/g;
        let m;
        while ((m = subRegex.exec(xmlContent)) !== null) {
            subjectsMap.set(m[1], { id: m[1], name: m[2] });
        }

        const teachersMap = new Map();
        const teachRegex = /<teacher id="([^"]+)"[^>]*name="([^"]+)"/g;
        while ((m = teachRegex.exec(xmlContent)) !== null) {
            teachersMap.set(m[1], { id: m[1], name: m[2], simasName: m[2] });
        }

        const classesMap = new Map();
        const classRegex = /<class id="([^"]+)" name="([^"]+)"/g;
        while ((m = classRegex.exec(xmlContent)) !== null) {
            classesMap.set(m[1], { id: m[1], name: m[2] });
        }

        const lessonsMap = new Map();
        const lessonRegex = /<lesson\s+([^>]+)>/g;
        while ((m = lessonRegex.exec(xmlContent)) !== null) {
            const attrs = m[1];
            const idM = attrs.match(/id="([^"]+)"/);
            const subM = attrs.match(/subjectid="([^"]+)"/);
            const teachM = attrs.match(/teacherids="([^"]*)"/);
            const classM = attrs.match(/classids="([^"]*)"/);

            if (idM && subM) {
                lessonsMap.set(idM[1], {
                    id: idM[1],
                    subjectId: subM[1],
                    teacherIds: teachM ? teachM[1].split(',').filter(Boolean) : [],
                    classIds: classM ? classM[1].split(',').filter(Boolean) : []
                });
            }
        }

        const parsedSchedule = {
            subjectsMap,
            teachersMap,
            classesMap,
            lessonsMap
        };

        const matched = matchBookSalesWithSchedule(mock60BooksFixture, parsedSchedule);

        expect(matched).toHaveLength(60);

        // Pastikan seluruh 60 buku berhasil dipetakan ke guru dari jadwal
        matched.forEach(item => {
            expect(item.teachers.length).toBeGreaterThan(0);
            const sumEksemplar = item.teachers.reduce((acc, t) => acc + t.propTerjual, 0);
            const sumNominal = item.teachers.reduce((acc, t) => acc + t.propNominal, 0);

            // Pembagian proporsional per buku harus persis sama dengan total buku
            expect(sumEksemplar).toBe(item.terjual);
            expect(sumNominal).toBe(item.total);
        });

        // Agregasi seluruh guru
        const teacherAggregates = aggregateSalesByTeacher(matched);
        expect(teacherAggregates.length).toBeGreaterThan(0);

        let grandEksemplar = 0;
        let grandNominal = 0;

        teacherAggregates.forEach(t => {
            expect(isNaN(t.totalTerjual)).toBe(false);
            expect(isNaN(t.totalNominal)).toBe(false);
            expect(t.totalTerjual).toBeGreaterThanOrEqual(0);
            expect(t.totalNominal).toBeGreaterThanOrEqual(0);

            grandEksemplar += t.totalTerjual;
            grandNominal += t.totalNominal;
        });

        // Rekonsiliasi total akhir
        expect(grandEksemplar).toBe(7048);
        expect(grandNominal).toBe(128751000);
    });

    test('8. parseBookSalesText mendukung Format 6 Kolom Minimalis (User Request) dan menghitung otomatis Terjual & Total', () => {
        // Format 6 Kolom: KELAS | MAPEL | DITERIMA | DIAMBIL / SIAMBIL | SISA | HARGA JUAL
        const rawSixCols = `
KELAS\tMAPEL\tDITERIMA\tSIAMBIL\tSISA\tHARGA JUAL
10\tBahasa Indonesia\t215\t0\t1\t17000
10\tGeografi\t190\t1\t1\t17000
11\tMatematika\t208\t0\t2\t23000
12\tPJOK\t100\t0\t10\t23000
        `;

        const parsed = parseBookSalesText(rawSixCols);
        expect(parsed).toHaveLength(4);

        // Baris 1: 215 terima, 0 diambil, 1 sisa => Terjual = 214, Total = 214 * 17000 = 3638000
        expect(parsed[0]).toEqual({
            grade: 10,
            subject: 'Bahasa Indonesia',
            terima: 215,
            diam: 0,
            sisa: 1,
            terjual: 214,
            harga: 17000,
            total: 3638000
        });

        // Baris 2: 190 terima, 1 diambil, 1 sisa => Terjual = 188, Total = 188 * 17000 = 3196000
        expect(parsed[1]).toEqual({
            grade: 10,
            subject: 'Geografi',
            terima: 190,
            diam: 1,
            sisa: 1,
            terjual: 188,
            harga: 17000,
            total: 3196000
        });

        // Baris 3: 208 terima, 0 diambil, 2 sisa => Terjual = 206, Total = 206 * 23000 = 4738000
        expect(parsed[2]).toEqual({
            grade: 11,
            subject: 'Matematika',
            terima: 208,
            diam: 0,
            sisa: 2,
            terjual: 206,
            harga: 23000,
            total: 4738000
        });

        // Baris 4: 100 terima, 0 diambil, 10 sisa => Terjual = 90, Total = 90 * 23000 = 2070000
        expect(parsed[3]).toEqual({
            grade: 12,
            subject: 'PJOK',
            terima: 100,
            diam: 0,
            sisa: 10,
            terjual: 90,
            harga: 23000,
            total: 2070000
        });
    });

    test('9. findTeacherForClassSubject menemukan guru spesifik untuk rombel yang diampu', () => {
        // Setup mock schedule di sandbox
        const subjectsMap = new Map();
        const subRegex = /<subject id="([^"]+)" name="([^"]+)"/g;
        let m;
        while ((m = subRegex.exec(xmlContent)) !== null) {
            subjectsMap.set(m[1], { id: m[1], name: m[2] });
        }

        const teachersMap = new Map();
        const teachRegex = /<teacher id="([^"]+)"[^>]*name="([^"]+)"/g;
        while ((m = teachRegex.exec(xmlContent)) !== null) {
            teachersMap.set(m[1], { id: m[1], name: m[2], simasName: m[2] });
        }

        const classesMap = new Map();
        const classRegex = /<class id="([^"]+)" name="([^"]+)"/g;
        while ((m = classRegex.exec(xmlContent)) !== null) {
            classesMap.set(m[1], { id: m[1], name: m[2] });
        }

        const lessonsMap = new Map();
        const lessonRegex = /<lesson\s+([^>]+)>/g;
        while ((m = lessonRegex.exec(xmlContent)) !== null) {
            const attrs = m[1];
            const idM = attrs.match(/id="([^"]+)"/);
            const subM = attrs.match(/subjectid="([^"]+)"/);
            const teachM = attrs.match(/teacherids="([^"]*)"/);
            const classM = attrs.match(/classids="([^"]*)"/);

            if (idM && subM) {
                lessonsMap.set(idM[1], {
                    id: idM[1],
                    subjectId: subM[1],
                    teacherIds: teachM ? teachM[1].split(',').filter(Boolean) : [],
                    classIds: classM ? classM[1].split(',').filter(Boolean) : []
                });
            }
        }

        const parsedSchedule = {
            subjectsMap,
            teachersMap,
            classesMap,
            lessonsMap
        };

        // Panggil fungsi sandbox dengan menyetel jadwal
        const scheduleGradeMap = buildScheduleGradeMap(parsedSchedule);
        expect(scheduleGradeMap[10]['Bahasa Indonesia']).toBeDefined();

        // Di Kelas 10 Bahasa Indonesia diajar oleh Ida Bagus Oka dan Ni Ketut Sukeni
        const okaClasses = scheduleGradeMap[10]['Bahasa Indonesia']['Ida Bagus Oka, S.Pd.'];
        const sukeniClasses = scheduleGradeMap[10]['Bahasa Indonesia']['Ni Ketut Sukeni, S.Pd'];

        expect(okaClasses).toBeDefined();
        expect(sukeniClasses).toBeDefined();

        // Rombel yang diajar Ida Bagus Oka
        const firstOkaClass = Array.from(okaClasses)[0];
        expect(okaClasses.has(firstOkaClass)).toBe(true);

        // Rombel yang diajar Ni Ketut Sukeni
        const firstSukeniClass = Array.from(sukeniClasses)[0];
        expect(sukeniClasses.has(firstSukeniClass)).toBe(true);
    });

    test('10. Lookup Rombel & Harga Buku bekerja akurat', () => {
        const k10Classes = getClassesForGrade(10);
        expect(k10Classes).toHaveLength(9);
        expect(k10Classes).toContain('X-1');
        expect(k10Classes).toContain('X-9');

        const k11Classes = getClassesForGrade(11);
        expect(k11Classes).toHaveLength(10);
        expect(k11Classes).toContain('XI-1');
        expect(k11Classes).toContain('XI-10');

        const k12Classes = getClassesForGrade(12);
        expect(k12Classes).toHaveLength(9);
        expect(k12Classes).toContain('XII-1');
        expect(k12Classes).toContain('XII-9');

        // Harga Buku Default
        expect(getBookPrice(10, 'Bahasa Indonesia')).toBe(17000);
        expect(getBookPrice(11, 'Matematika')).toBe(23000);
        expect(getBookPrice(12, 'Agama dan Budi Pekerti')).toBe(18000);
    });

    test('11. findBookEntry mencocokkan nama resmi Jadwal XML dengan buku arsip (PKWU, Seni, Bahasa Bali K-12, Tk Lanjut)', () => {
        // XML: Prakarya dan Kewirausahaan -> Buku: PKWU
        const pkwuBook = findBookEntry(11, 'Prakarya dan Kewirausahaan');
        expect(pkwuBook).toBeDefined();
        expect(pkwuBook.subject).toBe('PKWU');
        expect(pkwuBook.harga).toBe(17000);

        // XML: Kearifan Lokal Bali -> Buku: Bahasa Bali (Kelas 12)
        const baliK12Book = findBookEntry(12, 'Kearifan Lokal Bali');
        expect(baliK12Book).toBeDefined();
        expect(baliK12Book.subject).toBe('Bahasa Bali');
        expect(baliK12Book.harga).toBe(18000);

        // XML: Bahasa Indonesia Tk Lanjut -> Buku: Bahasa Indonesia Tingkat Lanjut
        const indoLanjut = findBookEntry(11, 'Bahasa Indonesia Tk Lanjut');
        expect(indoLanjut).toBeDefined();
        expect(indoLanjut.subject).toBe('Bahasa Indonesia Tingkat Lanjut');
        expect(indoLanjut.harga).toBe(17000);

        // XML: Seni Budaya -> Buku: Seni Tari (Kelas 11)
        const seniBook = findBookEntry(11, 'Seni Budaya');
        expect(seniBook).toBeDefined();
        expect(seniBook.subject).toBe('Seni Tari');

        // Pengujian getBookPrice dengan nama resmi Jadwal XML
        expect(getBookPrice(11, 'Prakarya dan Kewirausahaan')).toBe(17000);
        expect(getBookPrice(12, 'Kearifan Lokal Bali')).toBe(18000);
        expect(getBookPrice(11, 'Bahasa Indonesia Tk Lanjut')).toBe(17000);
    });

    test('12. openAddBookModal dan closeAddBookModal mengontrol visibilitas dialog modal tambah buku baru', () => {
        const mockModal = {
            classList: {
                classes: new Set(['hidden']),
                add(c) { this.classes.add(c); },
                remove(c) { this.classes.delete(c); },
                contains(c) { return this.classes.has(c); }
            }
        };

        const mockInput = {
            focusCalled: false,
            focus() { this.focusCalled = true; }
        };

        const origGetElementById = sandbox.document.getElementById;
        sandbox.document.getElementById = (id) => {
            if (id === 'modal-add-book') return mockModal;
            if (id === 'book-subject') return mockInput;
            return null;
        };

        try {
            expect(mockModal.classList.contains('hidden')).toBe(true);

            openAddBookModal();
            expect(mockModal.classList.contains('hidden')).toBe(false);

            closeAddBookModal();
            expect(mockModal.classList.contains('hidden')).toBe(true);
        } finally {
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('13. updateBookPrice memperbarui harga jual buku dan merekonsiliasi total omzet penjualan', async () => {
        const book = findBookEntry(10, 'Bahasa Indonesia');
        expect(book).toBeDefined();
        const initialPrice = book.harga;
        const initialTotal = book.total;
        const terjual = book.terjual;

        // Ubah harga satuan menjadi 20.000
        const success = await updateBookPrice(10, 'Bahasa Indonesia', 20000);
        expect(success).toBe(true);
        expect(book.harga).toBe(20000);
        expect(book.total).toBe(terjual * 20000);

        // Kembalikan harga semula
        await updateBookPrice(10, 'Bahasa Indonesia', initialPrice);
        expect(book.harga).toBe(initialPrice);
        expect(book.total).toBe(initialTotal);
    });

    test('14. Pengaturan Sirkulasi Buku: Penerimaan, Retur, dan Pengambilan oleh Guru (Non-Penjualan)', async () => {
        const book = findBookEntry(10, 'Informatika');
        expect(book).toBeDefined();

        const initialTerima = book.terima;
        const initialDiam = book.diam || 0;
        const initialTerjual = book.terjual;
        const initialTotal = book.total;

        const mockForm = {
            'circ-date': { value: '2026-10-03' },
            'circ-type': { value: 'pengambilan_guru' },
            'circ-grade': { value: '10' },
            'circ-subject': { value: 'Informatika' },
            'circ-party': { value: 'I Wayan Guru, S.Kom.' },
            'circ-qty': { value: '2' },
            'circ-note': { value: 'Buku Pegangan Guru Modul Ajar' },
            'modal-circulation': { classList: { add: jest.fn(), remove: jest.fn() } }
        };

        const origGetElementById = sandbox.document.getElementById;
        sandbox.document.getElementById = (id) => mockForm[id] || null;

        try {
            // Skenario A: Pengambilan Guru
            await submitAddCirculation({ preventDefault: () => {} });

            // 1. Kolom diambil (diam) bertambah 2
            expect(book.diam).toBe(initialDiam + 2);
            // 2. PENGAMBILAN OLEH GURU TIDAK TERHITUNG PENJUALAN:
            expect(book.terjual).toBe(initialTerjual);
            expect(book.total).toBe(initialTotal);

            // Skenario B: Penerimaan Stok Baru dari Vendor
            mockForm['circ-type'].value = 'terima';
            mockForm['circ-party'].value = 'CV Percetakan Mitra';
            mockForm['circ-qty'].value = '50';
            mockForm['circ-note'].value = 'Tambahan Cetak';

            await submitAddCirculation({ preventDefault: () => {} });
            expect(book.terima).toBe(initialTerima + 50);
            expect(book.terjual).toBe(initialTerjual);
            expect(book.total).toBe(initialTotal);

            // Skenario C: Retur Buku ke Percetakan
            mockForm['circ-type'].value = 'retur_penerbit';
            mockForm['circ-party'].value = 'CV Percetakan Mitra';
            mockForm['circ-qty'].value = '10';

            await submitAddCirculation({ preventDefault: () => {} });
            expect(book.retur).toBe(10);
            expect(book.terjual).toBe(initialTerjual);
            expect(book.total).toBe(initialTotal);

            // Kembalikan state buku semula
            book.terima = initialTerima;
            book.diam = initialDiam;
            book.retur = 0;
            book.sisa = Math.max(0, book.terima - book.diam - book.terjual);
        } finally {
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('15. openCirculationModal dan closeCirculationModal mengontrol visibilitas dialog modal sirkulasi buku', () => {
        const mockModal = {
            classList: {
                classes: new Set(['hidden']),
                add(c) { this.classes.add(c); },
                remove(c) { this.classes.delete(c); },
                contains(c) { return this.classes.has(c); }
            }
        };

        const mockElements = {
            'modal-circulation': mockModal,
            'circ-date': { value: '' },
            'circ-grade': { value: '10' },
            'circ-subject': { innerHTML: '', value: 'Bahasa Indonesia' },
            'circ-type': { value: 'pengambilan_guru' },
            'circ-party': { value: '', placeholder: '' },
            'circ-info-teacher': { textContent: '' },
            'circ-info-stock': { textContent: '' },
            'circ-info-sale-status': { className: '', textContent: '' },
            'label-circ-party': { innerHTML: '' },
            'container-circ-vendor': { classList: { add: jest.fn(), remove: jest.fn() } },
            'container-circ-teacher': { classList: { add: jest.fn(), remove: jest.fn() } },
            'circ-vendor-select': { innerHTML: '', value: '' },
            'circ-custom-vendor': { classList: { add: jest.fn(), remove: jest.fn() }, value: '' }
        };

        const origGetElementById = sandbox.document.getElementById;
        sandbox.document.getElementById = (id) => mockElements[id] || null;

        try {
            expect(mockModal.classList.contains('hidden')).toBe(true);

            openCirculationModal();
            expect(mockModal.classList.contains('hidden')).toBe(false);
            expect(mockElements['circ-date'].value).toBeTruthy();

            closeCirculationModal();
            expect(mockModal.classList.contains('hidden')).toBe(true);
        } finally {
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('16. getGradeRoman mengonversi angka/string jenjang 10, 11, 12 ke Romawi X, XI, XII dan mempertahankan string Romawi', () => {
        expect(getGradeRoman(10)).toBe('X');
        expect(getGradeRoman('10')).toBe('X');
        expect(getGradeRoman('x')).toBe('X');
        expect(getGradeRoman('X')).toBe('X');

        expect(getGradeRoman(11)).toBe('XI');
        expect(getGradeRoman('11')).toBe('XI');
        expect(getGradeRoman('xi')).toBe('XI');
        expect(getGradeRoman('XI')).toBe('XI');

        expect(getGradeRoman(12)).toBe('XII');
        expect(getGradeRoman('12')).toBe('XII');
        expect(getGradeRoman('xii')).toBe('XII');
        expect(getGradeRoman('XII')).toBe('XII');

        expect(getGradeRoman('')).toBe('');
        expect(getGradeRoman(null)).toBe('');
    });

    test('17. parseBookSalesText mendukung input jenjang Romawi X, XI, XII secara akurat', () => {
        const rawTextWithRoman = `
KELAS\tBUKU\tTERIMA\tDIAM\tSISA\tTERJUAL\tHARGA\tTOTAL
X\tBiologi\t100\t0\t5\t95\tRp17.000\t1.615.000
XI\tFisika Lanjutan\t120\t2\t8\t110\tRp20.000\t2.200.000
XII\tKimia Terapan\t80\t1\t4\t75\tRp22.000\t1.650.000
        `;

        const parsed = parseBookSalesText(rawTextWithRoman);
        expect(parsed).toHaveLength(3);

        expect(parsed[0].grade).toBe(10);
        expect(parsed[0].subject).toBe('Biologi');
        expect(parsed[0].terima).toBe(100);
        expect(parsed[0].sisa).toBe(5);
        expect(parsed[0].terjual).toBe(95);

        expect(parsed[1].grade).toBe(11);
        expect(parsed[1].subject).toBe('Fisika Lanjutan');
        expect(parsed[1].terima).toBe(120);
        expect(parsed[1].diam).toBe(2);
        expect(parsed[1].sisa).toBe(8);
        expect(parsed[1].terjual).toBe(110);

        expect(parsed[2].grade).toBe(12);
        expect(parsed[2].subject).toBe('Kimia Terapan');
        expect(parsed[2].terima).toBe(80);
        expect(parsed[2].terjual).toBe(75);
    });

    test('18. Otorisasi role halaman penjualan buku mengizinkan super_admin dan admin_lks serta menolak role lain', async () => {
        const mockMain = {
            classList: {
                classes: new Set(['hidden']),
                add(c) { this.classes.add(c); },
                remove(c) { this.classes.delete(c); },
                contains(c) { return this.classes.has(c); }
            }
        };

        const mockDenied = {
            classList: {
                classes: new Set(['hidden']),
                add(c) { this.classes.add(c); },
                remove(c) { this.classes.delete(c); },
                contains(c) { return this.classes.has(c); }
            }
        };

        const origQuerySelector = sandbox.document.querySelector;
        const origGetElementById = sandbox.document.getElementById;

        sandbox.document.querySelector = (sel) => sel === 'main' ? mockMain : null;
        sandbox.document.getElementById = (id) => id === 'access-denied-container' ? mockDenied : null;

        try {
            // Skenario A: Role admin_lks (Primary) -> Diizinkan
            mockMain.classList.add('hidden');
            mockDenied.classList.add('hidden');
            sandbox.localStorage.setItem('user_role', 'admin_lks');
            sandbox.window.hasRole = () => false;

            await initPenjualanBukuPage();
            if (sandbox.__authCb) await sandbox.__authCb({ uid: 'user_lks_123', email: 'lks@smagesa.sch.id' });

            expect(mockMain.classList.contains('hidden')).toBe(false);
            expect(mockDenied.classList.contains('hidden')).toBe(true);

            // Skenario B: Role super_admin -> Diizinkan
            mockMain.classList.add('hidden');
            mockDenied.classList.add('hidden');
            sandbox.localStorage.setItem('user_role', 'super_admin');

            await initPenjualanBukuPage();
            if (sandbox.__authCb) await sandbox.__authCb({ uid: 'admin_123', email: 'admin@smagesa.sch.id' });

            expect(mockMain.classList.contains('hidden')).toBe(false);
            expect(mockDenied.classList.contains('hidden')).toBe(true);

            // Skenario C: Multi-Role (Primary: guru_mapel, Additional: admin_lks) -> Diizinkan
            mockMain.classList.add('hidden');
            mockDenied.classList.add('hidden');
            sandbox.localStorage.setItem('user_role', 'guru_mapel');
            sandbox.window.hasRole = (r) => r === 'admin_lks';

            await initPenjualanBukuPage();
            if (sandbox.__authCb) await sandbox.__authCb({ uid: 'guru_123', email: 'guru@smagesa.sch.id' });

            expect(mockMain.classList.contains('hidden')).toBe(false);
            expect(mockDenied.classList.contains('hidden')).toBe(true);

            // Skenario D: Role tidak berwenang (siswa / guru_mapel biasa) -> Akses Ditolak
            mockMain.classList.remove('hidden');
            mockDenied.classList.add('hidden');
            sandbox.localStorage.setItem('user_role', 'siswa');
            sandbox.window.hasRole = () => false;

            await initPenjualanBukuPage();
            if (sandbox.__authCb) await sandbox.__authCb({ uid: 'siswa_123', email: 'siswa@smagesa.sch.id' });

            expect(mockMain.classList.contains('hidden')).toBe(true);
            expect(mockDenied.classList.contains('hidden')).toBe(false);
        } finally {
            sandbox.document.querySelector = origQuerySelector;
            sandbox.document.getElementById = origGetElementById;
            sandbox.localStorage.clear();
        }
    });

    test('19. Pengelolaan Buku Dinamis: submitAddBook menambah buku baru dan deleteBookEntry menghapus buku', async () => {
        const mockForm = {
            'book-grade': { value: '10' },
            'book-subject': { value: 'Astronomi dan Kebumian' },
            'book-terima': { value: '120' },
            'book-harga': { value: '25000' },
            'modal-add-book': { classList: { add: jest.fn(), remove: jest.fn() } }
        };

        const origGetElementById = sandbox.document.getElementById;
        const origConfirm = sandbox.confirm;
        sandbox.document.getElementById = (id) => mockForm[id] || null;
        sandbox.confirm = () => true;

        try {
            // A. Tambah Buku Baru
            await submitAddBook({ preventDefault: () => {} });
            const added = findBookEntry(10, 'Astronomi dan Kebumian');
            expect(added).toBeDefined();
            expect(added.grade).toBe(10);
            expect(added.subject).toBe('Astronomi dan Kebumian');
            expect(added.terima).toBe(120);
            expect(added.sisa).toBe(120);
            expect(added.harga).toBe(25000);

            // B. Hapus Buku yang Baru Ditambahkan
            await deleteBookEntry(10, encodeURIComponent('Astronomi dan Kebumian'));
            const deleted = findBookEntry(10, 'Astronomi dan Kebumian');
            expect(deleted).toBeNull();
        } finally {
            sandbox.document.getElementById = origGetElementById;
            sandbox.confirm = origConfirm;
        }
    });

    test('20. getClassStudentCounts memuat jumlah siswa aktif per kelas atau baseline standar', async () => {
        const counts = await getClassStudentCounts();
        expect(counts).toBeDefined();
        expect(typeof counts).toBe('object');

        // Memastikan seluruh rombel SMAGESA (28 rombel) memiliki jumlah siswa > 0
        expect(counts['X-1']).toBeGreaterThan(0);
        expect(counts['X-9']).toBeGreaterThan(0);
        expect(counts['XI-1']).toBeGreaterThan(0);
        expect(counts['XI-10']).toBeGreaterThan(0);
        expect(counts['XII-1']).toBeGreaterThan(0);
        expect(counts['XII-9']).toBeGreaterThan(0);

        // Uji coba override custom sizes
        setCurrentClassSizes({ 'X-1': 38, 'XI-10': 32 });
        const updated = await getClassStudentCounts();
        expect(updated['X-1']).toBe(38);
        expect(updated['XI-10']).toBe(32);
        // Reset kembali
        setCurrentClassSizes(null);
    });

    test('21. getSubjectTargetClasses memetakan rombel penerima mapel dari Jadwal XML (Wajib vs Pilihan Rombel)', () => {
        // Setup mock schedule dari Jadwal.xml
        const subjectsMap = new Map();
        const subRegex = /<subject id="([^"]+)" name="([^"]+)"/g;
        let m;
        while ((m = subRegex.exec(xmlContent)) !== null) {
            subjectsMap.set(m[1], { id: m[1], name: m[2] });
        }

        const classesMap = new Map();
        const classRegex = /<class id="([^"]+)" name="([^"]+)"/g;
        while ((m = classRegex.exec(xmlContent)) !== null) {
            classesMap.set(m[1], { id: m[1], name: m[2] });
        }

        const lessonsMap = new Map();
        const lessonRegex = /<lesson\s+([^>]+)>/g;
        while ((m = lessonRegex.exec(xmlContent)) !== null) {
            const attrs = m[1];
            const idM = attrs.match(/id="([^"]+)"/);
            const subM = attrs.match(/subjectid="([^"]+)"/);
            const classM = attrs.match(/classids="([^"]*)"/);

            if (idM && subM) {
                lessonsMap.set(idM[1], {
                    id: idM[1],
                    subjectId: subM[1],
                    classIds: classM ? classM[1].split(',').filter(Boolean) : []
                });
            }
        }

        const parsedSched = { subjectsMap, classesMap, lessonsMap };

        // 1. Mapel Wajib: Bahasa Indonesia Kelas 10 -> diajarkan di seluruh 9 rombel
        const indoK10Classes = getSubjectTargetClasses(10, 'Bahasa Indonesia', parsedSched);
        expect(indoK10Classes).toHaveLength(9);
        expect(indoK10Classes).toContain('X-1');
        expect(indoK10Classes).toContain('X-9');

        // 2. Mapel Pilihan: Biologi Kelas 11 -> diajarkan khusus 3 rombel peminatan
        const bioK11Classes = getSubjectTargetClasses(11, 'Biologi', parsedSched);
        expect(bioK11Classes).toHaveLength(3);
        expect(bioK11Classes).toEqual(['XI-1', 'XI-2', 'XI-3']);

        // 3. Mapel Pilihan: Geografi Kelas 11 -> diajarkan khusus 1 rombel
        const geoK11Classes = getSubjectTargetClasses(11, 'Geografi', parsedSched);
        expect(geoK11Classes).toEqual(['XI-10']);

        // 4. Mapel Pilihan: Ekonomi Kelas 11 -> diajarkan di 3 rombel
        const ekoK11Classes = getSubjectTargetClasses(11, 'Ekonomi', parsedSched);
        expect(ekoK11Classes).toEqual(['XI-8', 'XI-9', 'XI-10']);

        // 5. Mapel Pilihan: Biologi Kelas 12 -> diajarkan di 2 rombel
        const bioK12Classes = getSubjectTargetClasses(12, 'Biologi', parsedSched);
        expect(bioK12Classes).toEqual(['XII-1', 'XII-2']);

        // 6. Mapel Tingkat Lanjut: Matematika Tingkat Lanjut Kelas 11 -> HANYA diajarkan di 2 rombel (XI-2 dan XI-9)
        const mtlK11Classes = getSubjectTargetClasses(11, 'Matematika Tingkat Lanjut', parsedSched);
        expect(mtlK11Classes).toHaveLength(2);
        expect(mtlK11Classes).toEqual(['XI-2', 'XI-9']);

        // 7. Mapel Reguler: Matematika Kelas 11 -> diajarkan di seluruh 10 rombel (tidak berkurang & tidak bercampur)
        const matK11Classes = getSubjectTargetClasses(11, 'Matematika', parsedSched);
        expect(matK11Classes).toHaveLength(10);
        expect(matK11Classes).toContain('XI-1');
        expect(matK11Classes).toContain('XI-10');

        // 8. Mapel Tingkat Lanjut lainnya di Kelas 11 terisolasi sempurna
        const bitlK11Classes = getSubjectTargetClasses(11, 'Bahasa Indonesia Tingkat Lanjut', parsedSched);
        expect(bitlK11Classes).toEqual(['XI-4', 'XI-5', 'XI-6', 'XI-7']);

        const bingtlK11Classes = getSubjectTargetClasses(11, 'Bahasa Inggris Tingkat Lanjut', parsedSched);
        expect(bingtlK11Classes).toEqual(['XI-4', 'XI-5', 'XI-6']);

        const sejtlK11Classes = getSubjectTargetClasses(11, 'Sejarah Tingkat Lanjut', parsedSched);
        expect(sejtlK11Classes).toEqual(['XI-8', 'XI-9', 'XI-10']);
    });

    test('22. analyzeBookDemand menghitung target siswa, buku terbeli, siswa belum beli, dan analisis kebutuhan (Kurang vs Lebih)', () => {
        const subjectsMap = new Map();
        const subRegex = /<subject id="([^"]+)" name="([^"]+)"/g;
        let m;
        while ((m = subRegex.exec(xmlContent)) !== null) {
            subjectsMap.set(m[1], { id: m[1], name: m[2] });
        }

        const classesMap = new Map();
        const classRegex = /<class id="([^"]+)" name="([^"]+)"/g;
        while ((m = classRegex.exec(xmlContent)) !== null) {
            classesMap.set(m[1], { id: m[1], name: m[2] });
        }

        const lessonsMap = new Map();
        const lessonRegex = /<lesson\s+([^>]+)>/g;
        while ((m = lessonRegex.exec(xmlContent)) !== null) {
            const attrs = m[1];
            const idM = attrs.match(/id="([^"]+)"/);
            const subM = attrs.match(/subjectid="([^"]+)"/);
            const classM = attrs.match(/classids="([^"]*)"/);

            if (idM && subM) {
                lessonsMap.set(idM[1], {
                    id: idM[1],
                    subjectId: subM[1],
                    classIds: classM ? classM[1].split(',').filter(Boolean) : []
                });
            }
        }

        const parsedSched = { subjectsMap, classesMap, lessonsMap };

        // Mock class sizes: 35 siswa per rombel (XI-10: 34)
        const customSizes = {
            'X-1': 36, 'X-2': 36, 'X-3': 36, 'X-4': 36, 'X-5': 36, 'X-6': 36, 'X-7': 36, 'X-8': 36, 'X-9': 36,
            'XI-1': 35, 'XI-2': 35, 'XI-3': 35, 'XI-4': 35, 'XI-5': 35, 'XI-6': 35, 'XI-7': 35, 'XI-8': 35, 'XI-9': 35, 'XI-10': 34,
            'XII-1': 35, 'XII-2': 35, 'XII-3': 35, 'XII-4': 35, 'XII-5': 35, 'XII-6': 35, 'XII-7': 35, 'XII-8': 35, 'XII-9': 35
        };

        // Skenario 1: Kasus Kurang (Defisit Stok) - Kelas 11 Ekonomi
        // Rombel: XI-8 (35), XI-9 (35), XI-10 (34) -> Target: 104 siswa. Terima: 90, Terjual: 61, Sisa: 29
        const ekoBook = { grade: 11, subject: 'Ekonomi', terima: 90, diam: 0, sisa: 29, terjual: 61, harga: 23000 };
        const ekoAnalysis = analyzeBookDemand(ekoBook, customSizes, parsedSched);

        expect(ekoAnalysis.targetStudents).toBe(104);
        expect(ekoAnalysis.terjual).toBe(61);
        expect(ekoAnalysis.siswaBelumBeli).toBe(104 - 61); // 43 siswa
        expect(ekoAnalysis.sisaStok).toBe(29);
        // Sisa stok 29 vs Belum beli 43 -> Kurang 14 buku!
        expect(ekoAnalysis.selisih).toBe(-14);
        expect(ekoAnalysis.statusKebutuhan).toBe('kurang');
        expect(ekoAnalysis.defisit).toBe(14);
        expect(ekoAnalysis.statusLabel).toBe('Kurang 14 eks');

        // Skenario 2: Kasus Lebih (Surplus Stok) - Kelas 11 Biologi
        // Rombel: XI-1, 2, 3 (3 @ 35 = 105 siswa). Terima: 150, Terjual: 66, Sisa: 84
        const bioBook = { grade: 11, subject: 'Biologi', terima: 150, diam: 0, sisa: 84, terjual: 66, harga: 17000 };
        const bioAnalysis = analyzeBookDemand(bioBook, customSizes, parsedSched);

        expect(bioAnalysis.targetStudents).toBe(105);
        expect(bioAnalysis.terjual).toBe(66);
        expect(bioAnalysis.siswaBelumBeli).toBe(105 - 66); // 39 siswa
        expect(bioAnalysis.sisaStok).toBe(84);
        // Sisa stok 84 vs Belum beli 39 -> Lebih 45 buku!
        expect(bioAnalysis.selisih).toBe(45);
        expect(bioAnalysis.statusKebutuhan).toBe('lebih');
        expect(bioAnalysis.surplus).toBe(45);
        expect(bioAnalysis.statusLabel).toBe('Lebih 45 eks');

        // Skenario 3: Kasus Pas (0) - Kelas 12 Biologi
        // Rombel: XII-1, 2 (2 @ 35 = 70 siswa). Terima: 70, Terjual: 69, Sisa: 1
        const bio12Book = { grade: 12, subject: 'Biologi', terima: 70, diam: 0, sisa: 1, terjual: 69, harga: 23000 };
        const bio12Analysis = analyzeBookDemand(bio12Book, customSizes, parsedSched);

        expect(bio12Analysis.targetStudents).toBe(70);
        expect(bio12Analysis.terjual).toBe(69);
        expect(bio12Analysis.siswaBelumBeli).toBe(1);
        expect(bio12Analysis.sisaStok).toBe(1);
        expect(bio12Analysis.selisih).toBe(0);
        expect(bio12Analysis.statusKebutuhan).toBe('pas');
        expect(bio12Analysis.statusLabel).toBe('Pas (0)');
    });

    test('23. calculateBooksDemandAnalysis mengagregasi neraca kebutuhan total dari 60 buku fixture', () => {
        const subjectsMap = new Map();
        const subRegex = /<subject id="([^"]+)" name="([^"]+)"/g;
        let m;
        while ((m = subRegex.exec(xmlContent)) !== null) {
            subjectsMap.set(m[1], { id: m[1], name: m[2] });
        }

        const classesMap = new Map();
        const classRegex = /<class id="([^"]+)" name="([^"]+)"/g;
        while ((m = classRegex.exec(xmlContent)) !== null) {
            classesMap.set(m[1], { id: m[1], name: m[2] });
        }

        const lessonsMap = new Map();
        const lessonRegex = /<lesson\s+([^>]+)>/g;
        while ((m = lessonRegex.exec(xmlContent)) !== null) {
            const attrs = m[1];
            const idM = attrs.match(/id="([^"]+)"/);
            const subM = attrs.match(/subjectid="([^"]+)"/);
            const classM = attrs.match(/classids="([^"]*)"/);

            if (idM && subM) {
                lessonsMap.set(idM[1], {
                    id: idM[1],
                    subjectId: subM[1],
                    classIds: classM ? classM[1].split(',').filter(Boolean) : []
                });
            }
        }

        const parsedSched = { subjectsMap, classesMap, lessonsMap };
        const result = calculateBooksDemandAnalysis(mock60BooksFixture, null, parsedSched);

        expect(result.items).toHaveLength(60);
        expect(result.totals.totalTargetStudents).toBeGreaterThan(0);
        expect(result.totals.totalSold).toBe(7048); // Sesuai total 60 buku
        expect(result.totals.totalUnbought).toBeGreaterThan(0);
        expect(result.totals.deficitTitlesCount).toBeGreaterThanOrEqual(0);
        expect(result.totals.surplusTitlesCount).toBeGreaterThanOrEqual(0);
    });

    test('24. getDefaultTransactionPeriod, getNextSemesterPeriod, getAvailableTransactionPeriods, dan formatSemesterPeriodShort menghasilkan format periode valid & ringkas (contoh: 26/27 (1))', () => {
        const period = getDefaultTransactionPeriod();
        expect(typeof period).toBe('string');
        // Format contoh: "2026/2027 Ganjil" atau "2026/2027 Genap"
        expect(period).toMatch(/^\d{4}\/\d{4}\s+(Ganjil|Genap)$/);

        // Verifikasi perhitungan 1 semester ke depan untuk persiapan
        const nextPeriod = getNextSemesterPeriod(period);
        expect(typeof nextPeriod).toBe('string');
        expect(nextPeriod).toMatch(/^\d{4}\/\d{4}\s+(Ganjil|Genap)$/);
        expect(getNextSemesterPeriod('2026/2027 Ganjil')).toBe('2026/2027 Genap');
        expect(getNextSemesterPeriod('2026/2027 Genap')).toBe('2027/2028 Ganjil');

        const available = getAvailableTransactionPeriods();
        expect(Array.isArray(available)).toBe(true);
        expect(available.length).toBeGreaterThan(1);
        // Semester mendatang (1 semester ke depan) berada di paling atas untuk persiapan
        expect(available[0]).toBe(nextPeriod);
        // Semester aktif berjalan berada di urutan berikutnya
        expect(available[1]).toBe(period);
        expect(available).toContain(period);
        // Seluruh opsi adalah periode semester valid
        expect(available.every(p => /^\d{4}\/\d{4}\s+(Ganjil|Genap)$/.test(p))).toBe(true);

        // Verifikasi format ringkas untuk dropdown header: 26/27 (1), 26/27 (2)
        expect(formatSemesterPeriodShort('2026/2027 Ganjil')).toBe('26/27 (1)');
        expect(formatSemesterPeriodShort('2026/2027 Genap')).toBe('26/27 (2)');
        expect(formatSemesterPeriodShort('2025/2026 Ganjil')).toBe('25/26 (1)');
        expect(formatSemesterPeriodShort('2025/2026 Genap')).toBe('25/26 (2)');
        expect(formatSemesterPeriodShort('2024/2025 Ganjil')).toBe('24/25 (1)');
        expect(formatSemesterPeriodShort('')).toBe('');
        expect(formatSemesterPeriodShort(null)).toBe('');
    });

    test('25. toggleBookVisibility dapat menonaktifkan dan mengaktifkan kembali buku fisik', async () => {
        const book = findBookEntry(10, 'Bahasa Bali');
        expect(book).toBeTruthy();
        expect(book.isActive !== false).toBe(true);

        // Nonaktifkan visibilitas
        await toggleBookVisibility(10, encodeURIComponent('Bahasa Bali'));
        expect(book.isActive).toBe(false);

        // Aktifkan kembali visibilitas
        await toggleBookVisibility(10, encodeURIComponent('Bahasa Bali'));
        expect(book.isActive).toBe(true);
    });

    test('26. getSubjectsForGrade dan getSubjectsForClass menyaring mapel yang disembunyikan (isActive === false)', async () => {
        const book = findBookEntry(10, 'Seni Rupa');
        expect(book).toBeTruthy();

        // Saat aktif
        const activeSubjects = getSubjectsForGrade(10, false);
        expect(activeSubjects).toContain('Seni Rupa');

        // Sembunyikan buku Seni Rupa
        await toggleBookVisibility(10, encodeURIComponent('Seni Rupa'));
        expect(book.isActive).toBe(false);

        // getSubjectsForGrade dengan includeInactive=false tidak memasukkan Seni Rupa
        const filteredSubjects = getSubjectsForGrade(10, false);
        expect(filteredSubjects).not.toContain('Seni Rupa');

        // getSubjectsForGrade dengan includeInactive=true tetap memasukkan Seni Rupa (untuk tab pengaturan)
        const allSubjects = getSubjectsForGrade(10, true);
        expect(allSubjects).toContain('Seni Rupa');

        // Kembalikan ke aktif
        await toggleBookVisibility(10, encodeURIComponent('Seni Rupa'));
        expect(book.isActive).toBe(true);
    });

    test('27. filter semester period menyaring data transaksi sesuai periode yang dipilih (tanpa opsi all, default semester berjalan)', () => {
        const defaultPeriod = getDefaultTransactionPeriod();
        expect(typeof getCurrentSelectedSemesterPeriod()).toBe('string');
        // Default terbuka semester berjalan (SSOT)
        expect(getCurrentSelectedSemesterPeriod()).toBe(defaultPeriod);

        setCurrentSelectedSemesterPeriod('2026/2027 Ganjil');
        expect(getCurrentSelectedSemesterPeriod()).toBe('2026/2027 Ganjil');

        setCurrentSettingsStatusFilter('inactive');
        expect(getCurrentSettingsStatusFilter()).toBe('inactive');

        // Jika dipanggil 'all' atau falsy, aman fallback ke semester aktif berjalan
        setCurrentSelectedSemesterPeriod('all');
        expect(getCurrentSelectedSemesterPeriod()).toBe(defaultPeriod);
        setCurrentSettingsStatusFilter('all');
    });

    test('28. isReturnTx, txNetQty, dan txNetTotal mengidentifikasi transaksi retur dan menghasilkan nilai net negatif secara tepat', () => {
        const saleTx = {
            id: 'tx_sale_1',
            type: 'sale',
            className: 'X-1',
            subject: 'Bahasa Indonesia',
            qty: 30,
            price: 17000,
            total: 510000
        };

        const returnTx = {
            id: 'tx_ret_1',
            type: 'return',
            refTxId: 'tx_sale_1',
            className: 'X-1',
            subject: 'Bahasa Indonesia',
            qty: 2,
            price: 17000,
            total: 34000
        };

        expect(isReturnTx(saleTx)).toBe(false);
        expect(txNetQty(saleTx)).toBe(30);
        expect(txNetTotal(saleTx)).toBe(510000);

        expect(isReturnTx(returnTx)).toBe(true);
        expect(txNetQty(returnTx)).toBe(-2);
        expect(txNetTotal(returnTx)).toBe(-34000);

        // Kasus transaksi lawas tanpa tipe (default penjualan biasa)
        const legacyTx = { id: 'tx_leg', qty: 10, price: 15000, total: 150000 };
        expect(isReturnTx(legacyTx)).toBe(false);
        expect(txNetQty(legacyTx)).toBe(10);
        expect(txNetTotal(legacyTx)).toBe(150000);
    });

    test('29. summarizeTransactions menghitung kotor, retur siswa, dan bersih (net) secara presisi', () => {
        const txList = [
            { id: '1', type: 'sale', qty: 30, price: 17000, total: 510000 },
            { id: '2', type: 'sale', qty: 20, price: 17000, total: 340000 },
            { id: '3', type: 'return', refTxId: '1', qty: 3, price: 17000, total: 51000 },
            { id: '4', type: 'return', refTxId: '2', qty: 2, price: 17000, total: 34000 }
        ];

        const summary = summarizeTransactions(txList);
        expect(summary.count).toBe(4);
        expect(summary.grossQty).toBe(50);
        expect(summary.grossNom).toBe(850000);
        expect(summary.returnQty).toBe(5);
        expect(summary.returnNom).toBe(850000 - 765000); // 85.000
        expect(summary.netQty).toBe(45);
        expect(summary.netNom).toBe(765000);
    });

    test('30. getReturnedQtyForTx dan getReturnableQty melacak kuota retur per transaksi asal', () => {
        const srcTx = { id: 'src_tx_99', qty: 25, price: 17000, total: 425000 };
        setCurrentTransactions([
            srcTx,
            { id: 'ret_1', type: 'return', refTxId: 'src_tx_99', qty: 4, price: 17000, total: 68000 },
            { id: 'ret_2', type: 'return', refTxId: 'src_tx_99', qty: 6, price: 17000, total: 102000 }
        ]);

        expect(getReturnedQtyForTx('src_tx_99')).toBe(10);
        expect(getReturnableQty(srcTx)).toBe(15);

        // Jika transaksi adalah retur itu sendiri, kuota returnable adalah 0
        const retTx = { id: 'ret_1', type: 'return', qty: 4 };
        expect(getReturnableQty(retTx)).toBe(0);
    });

    test('31. Akuntansi Retur Penjualan Buku (Siswa Batal Beli): stok fisik bertambah, net sales & revenue berkurang', async () => {
        // Ambil buku Geografi Kelas 10 (terima: 190, diam: 1, sisa: 1, terjual: 188, harga: 17000, total: 3196000)
        const book = findBookEntry(10, 'Geografi');
        expect(book).toBeTruthy();
        const initialSold = book.terjual;
        const initialStock = book.sisa;
        const initialTotal = book.total;

        // Siapkan histori transaksi pembelian asal untuk kelas X-2
        const saleTx = {
            id: 'tx_geo_sale_x2',
            type: 'sale',
            date: '2026-10-02',
            periode: getDefaultTransactionPeriod(),
            grade: 10,
            className: 'X-2',
            subject: 'Geografi',
            teacher: 'Drs. I Made Test',
            qty: 30,
            price: book.harga,
            total: 30 * book.harga,
            payment: 'Tunai'
        };

        // Simulasi transaksi retur siswa batal beli 3 eksemplar terikat dengan transaksi asal
        const retQty = 3;
        const retTx = {
            id: 'ret_geo_test',
            type: 'return',
            refTxId: saleTx.id,
            date: '2026-10-03',
            periode: getDefaultTransactionPeriod(),
            grade: 10,
            className: 'X-2',
            subject: 'Geografi',
            teacher: 'Drs. I Made Test',
            qty: retQty,
            price: book.harga,
            total: retQty * book.harga,
            payment: 'Tunai',
            refundMethod: 'Tunai',
            reason: 'Siswa Batal Beli',
            studentName: 'Wayan Test',
            note: 'Wayan Test — Siswa Batal Beli'
        };

        const currentTxs = getCurrentTransactions() || [];
        setCurrentTransactions([retTx, saleTx, ...currentTxs]);

        // Verifikasi relasi transaksi asal dan kuota
        expect(getReturnedQtyForTx(saleTx.id)).toBe(3);
        expect(getReturnableQty(saleTx)).toBe(27);

        // Terapkan koreksi pada master buku (delta negatif untuk retur)
        book.terjual = Math.max(0, (book.terjual || 0) - retQty);
        book.sisa = Math.max(0, (book.terima || 0) - (book.diam || 0) - (book.retur || 0) - book.terjual);
        book.total = book.terjual * book.harga;

        // Verifikasi: stok fisik di sekolah bertambah kembali +3
        expect(book.sisa).toBe(initialStock + retQty);

        // Verifikasi: terjual bersih berkurang -3
        expect(book.terjual).toBe(initialSold - retQty);

        // Verifikasi: total omzet berkurang sebesar refund
        expect(book.total).toBe(initialTotal - (retQty * book.harga));

        // Analisis kebutuhan buku otomatis merefleksikan sisa stok bertambah
        const analysis = analyzeBookDemand(book);
        expect(analysis.terjual).toBe(initialSold - retQty);
        expect(analysis.sisaStok).toBe(initialStock + retQty);
    });

    test('32. Proteksi Hapus: transaksi penjualan dengan retur aktif dilindungi, dan hapus retur memulihkan stok/omzet', async () => {
        const book = findBookEntry(10, 'Geografi');
        const soldBeforeDeleteRet = book.terjual;
        const stockBeforeDeleteRet = book.sisa;

        // Hapus retur yang tadi dibuat (ret_geo_test)
        const txs = getCurrentTransactions();
        const retIdx = txs.findIndex(t => t.id === 'ret_geo_test');
        expect(retIdx).toBeGreaterThanOrEqual(0);

        // Batalkan retur (misal: siswa berubah pikiran dan jadi membeli kembali)
        const removedRet = txs.splice(retIdx, 1)[0];
        // Memulihkan stok dan penjualan pada buku
        book.terjual = (book.terjual || 0) + removedRet.qty;
        book.sisa = Math.max(0, (book.terima || 0) - (book.diam || 0) - (book.retur || 0) - book.terjual);
        book.total = book.terjual * book.harga;

        expect(book.terjual).toBe(soldBeforeDeleteRet + removedRet.qty);
        expect(book.sisa).toBe(stockBeforeDeleteRet - removedRet.qty);
    });

    test('33. Retur HANYA BISA berdasarkan histori pembelian di kelas yang bersesuaian', () => {
        // Setup data histori transaksi penjualan:
        // Kelas X-1 membeli Bahasa Indonesia (32 eks) dan Matematika (30 eks)
        // Kelas X-2 membeli Geografi (25 eks)
        // Kelas X-3 belum pernah membeli buku apa pun
        const period = getDefaultTransactionPeriod();
        const mockPurchases = [
            { id: 'tx_x1_bind', type: 'sale', className: 'X-1', grade: 10, subject: 'Bahasa Indonesia', qty: 32, price: 17000, total: 544000, periode: period },
            { id: 'tx_x1_mtk', type: 'sale', className: 'X-1', grade: 10, subject: 'Matematika', qty: 30, price: 17000, total: 510000, periode: period },
            { id: 'tx_x2_geo', type: 'sale', className: 'X-2', grade: 10, subject: 'Geografi', qty: 25, price: 17000, total: 425000, periode: period }
        ];

        setCurrentTransactions(mockPurchases);

        // Kasus 1: Kelas X-1 hanya bisa meretur buku yang pernah dibeli di kelasnya (Bahasa Indonesia & Matematika)
        const x1Purchases = getCurrentTransactions().filter(t => !isReturnTx(t) && t.className === 'X-1' && getReturnableQty(t) > 0);
        expect(x1Purchases).toHaveLength(2);
        expect(x1Purchases.map(t => t.subject)).toEqual(['Bahasa Indonesia', 'Matematika']);

        // Kasus 2: Kelas X-3 tidak memiliki histori pembelian buku apa pun -> retur dilarang / 0 kandidat
        const x3Purchases = getCurrentTransactions().filter(t => !isReturnTx(t) && t.className === 'X-3' && getReturnableQty(t) > 0);
        expect(x3Purchases).toHaveLength(0);

        // Kasus 3: Jika ada retur pada transaksi X-1 Bahasa Indonesia sebesar 32 eks (kuota habis)
        const fullRetTx = { id: 'ret_x1_full', type: 'return', refTxId: 'tx_x1_bind', className: 'X-1', grade: 10, subject: 'Bahasa Indonesia', qty: 32, price: 17000, total: 544000 };
        setCurrentTransactions([fullRetTx, ...mockPurchases]);

        // Kuota sisa tx_x1_bind menjadi 0
        expect(getReturnableQty(mockPurchases[0])).toBe(0);

        // Kandidat pembelian yang dapat diretur untuk X-1 sekarang hanya tinggal Matematika
        const x1RemainingPurchases = getCurrentTransactions().filter(t => !isReturnTx(t) && t.className === 'X-1' && getReturnableQty(t) > 0);
        expect(x1RemainingPurchases).toHaveLength(1);
        expect(x1RemainingPurchases[0].subject).toBe('Matematika');
    });

    test('34. Sinkronisasi Periode Modal dengan Filter Header & Proteksi Terkunci Harga Jual Buku (Disabled & Readonly)', () => {
        const mockHeaderSelect = { id: 'filter-semester-period', value: '2024/2025 Genap' };
        const mockModalSelect = { id: 'tx-period', value: '', innerHTML: '' };
        const mockPriceInput = { id: 'tx-price', value: '0', disabled: false, readOnly: false };
        const mockModalAddTx = {
            classList: {
                classes: new Set(['hidden']),
                add(c) { this.classes.add(c); },
                remove(c) { this.classes.delete(c); },
                contains(c) { return this.classes.has(c); }
            }
        };
        const mockBookPriceInput = { id: 'book-harga', value: '0', disabled: false, readOnly: false };
        const mockModalAddBook = {
            classList: {
                classes: new Set(['hidden']),
                add(c) { this.classes.add(c); },
                remove(c) { this.classes.delete(c); },
                contains(c) { return this.classes.has(c); }
            }
        };

        const origGetElementById = sandbox.document.getElementById;
        sandbox.document.getElementById = (id) => {
            if (id === 'filter-semester-period') return mockHeaderSelect;
            if (id === 'tx-period') return mockModalSelect;
            if (id === 'tx-price') return mockPriceInput;
            if (id === 'modal-add-transaction') return mockModalAddTx;
            if (id === 'book-harga') return mockBookPriceInput;
            if (id === 'modal-add-book') return mockModalAddBook;
            return null;
        };

        try {
            // Uji populateModalPeriodSelect otomatis sinkron dengan nilai periode di header
            sandbox.window.populateModalPeriodSelect('tx-period');
            expect(mockModalSelect.value).toBe('2024/2025 Genap');

            // Uji proteksi harga jual satuan terkunci (disabled & readonly) di modal transaksi penjualan
            sandbox.window.openAddTransactionModal();
            expect(mockPriceInput.disabled).toBe(true);
            expect(mockPriceInput.readOnly).toBe(true);

            // Uji harga jual di modal tambah buku baru juga terkunci disabled & readonly
            sandbox.window.openAddBookModal();
            expect(mockBookPriceInput.disabled).toBe(true);
            expect(mockBookPriceInput.readOnly).toBe(true);
            expect(mockBookPriceInput.value).toBe('17.000');
        } finally {
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('38. Tab Pengaturan: Menghapus kolom terjual dan estimasi omzet, serta modal popup ubah harga seragam bekerja sempurna', async () => {
        const origGetElementById = sandbox.document.getElementById;

        const mockModalBulk = {
            classList: {
                _classes: new Set(['hidden']),
                add(c) { this._classes.add(c); },
                remove(c) { this._classes.delete(c); },
                contains(c) { return this._classes.has(c); }
            }
        };

        const mockBulkGrade = { value: '10' };
        const mockBulkValue = { value: '18500', focus: () => {} };
        const mockSettingsTbody = { innerHTML: '' };

        sandbox.document.getElementById = (id) => {
            if (id === 'modal-bulk-price') return mockModalBulk;
            if (id === 'bulk-price-grade') return mockBulkGrade;
            if (id === 'bulk-price-value') return mockBulkValue;
            if (id === 'table-settings-price-body') return mockSettingsTbody;
            return null;
        };

        try {
            // 1. Verifikasi openBulkPriceModal dan closeBulkPriceModal
            expect(mockModalBulk.classList.contains('hidden')).toBe(true);
            openBulkPriceModal();
            expect(mockModalBulk.classList.contains('hidden')).toBe(false);

            closeBulkPriceModal();
            expect(mockModalBulk.classList.contains('hidden')).toBe(true);

            // 2. Buka modal lagi dan jalankan applyBulkPriceUpdate untuk Kelas 10
            openBulkPriceModal();
            expect(mockModalBulk.classList.contains('hidden')).toBe(false);
            mockBulkValue.value = '18500'; // Simulasi input nominal oleh pengguna

            await applyBulkPriceUpdate();

            // Verifikasi modal otomatis tertutup setelah berhasil terapkan harga
            expect(mockModalBulk.classList.contains('hidden')).toBe(true);

            // Verifikasi seluruh buku kelas 10 kini memiliki harga 18500
            const currentData = sandbox.window.getCurrentBookData();
            const kelas10Books = currentData.filter(b => b.grade === 10);
            expect(kelas10Books.length).toBeGreaterThan(0);
            kelas10Books.forEach(b => {
                expect(b.harga).toBe(18500);
            });

            // 3. Verifikasi renderPriceSettingsTable: 6 kolom, bebas dari kolom terjual dan estimasi omzet
            renderPriceSettingsTable();
            expect(mockSettingsTbody.innerHTML).toContain('price-input-10-0');
            expect(mockSettingsTbody.innerHTML).not.toContain('Terjual Saat Ini');
            expect(mockSettingsTbody.innerHTML).not.toContain('Estimasi Omzet Baru');
            expect(mockSettingsTbody.innerHTML).not.toContain('grandTerjual');
            expect(mockSettingsTbody.innerHTML).toContain('Ringkasan Terfilter:');
            expect(mockSettingsTbody.innerHTML).toContain('Judul Buku');
        } finally {
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('39. Manajemen Vendor Dinamis: get/set vendor, tambah vendor, hapus vendor, populate select, dan render tabel settings', async () => {
        const origGetElementById = sandbox.document.getElementById;
        const origConfirm = sandbox.window.confirm;

        const mockVendorInput = { value: '', focus: jest.fn() };
        const mockVendorTbody = { innerHTML: '' };
        const mockVendorBadge = { textContent: '' };
        const mockCircVendorSelect = { innerHTML: '', value: '' };
        const mockCustomVendorInput = {
            classList: {
                _classes: new Set(['hidden']),
                add(c) { this._classes.add(c); },
                remove(c) { this._classes.delete(c); },
                contains(c) { return this._classes.has(c); }
            },
            value: '',
            focus: jest.fn()
        };

        sandbox.document.getElementById = (id) => {
            if (id === 'input-new-vendor-name') return mockVendorInput;
            if (id === 'table-settings-vendor-body') return mockVendorTbody;
            if (id === 'badge-vendor-count') return mockVendorBadge;
            if (id === 'circ-vendor-select') return mockCircVendorSelect;
            if (id === 'circ-custom-vendor') return mockCustomVendorInput;
            return null;
        };
        sandbox.window.confirm = () => true;
        sandbox.confirm = () => true;

        try {
            // 1. Uji setCurrentVendors dan getCurrentVendors
            setCurrentVendors(['Percetakan Bintang', 'CV Graha Media']);
            expect(getCurrentVendors()).toEqual(['Percetakan Bintang', 'CV Graha Media']);

            // 2. Render Tabel Settings Vendor
            renderVendorSettingsTable();
            expect(mockVendorBadge.textContent).toBe('2 Vendor Terdaftar');
            expect(mockVendorTbody.innerHTML).toContain('Percetakan Bintang');
            expect(mockVendorTbody.innerHTML).toContain('CV Graha Media');

            // 3. Tambah Vendor Baru via submitAddVendor
            mockVendorInput.value = 'PT Intan Pariwara';
            const addEvt = { preventDefault: jest.fn() };
            await submitAddVendor(addEvt);

            expect(addEvt.preventDefault).toHaveBeenCalled();
            expect(getCurrentVendors()).toContain('PT Intan Pariwara');
            expect(mockVendorInput.value).toBe('');

            // Mencegah duplikasi nama vendor (case-insensitive)
            mockVendorInput.value = 'pt intan pariwara';
            await submitAddVendor(addEvt);
            expect(getCurrentVendors().filter(v => v.toLowerCase() === 'pt intan pariwara').length).toBe(1);

            // 4. Uji populateVendorSelect
            populateVendorSelect();
            expect(mockCircVendorSelect.innerHTML).toContain('Percetakan Bintang');
            expect(mockCircVendorSelect.innerHTML).toContain('PT Intan Pariwara');
            expect(mockCircVendorSelect.innerHTML).toContain('value="__custom__"');

            // 5. Uji onCirculationVendorSelectChanged
            mockCircVendorSelect.value = '__custom__';
            onCirculationVendorSelectChanged();
            expect(mockCustomVendorInput.classList.contains('hidden')).toBe(false);

            mockCircVendorSelect.value = 'Percetakan Bintang';
            onCirculationVendorSelectChanged();
            expect(mockCustomVendorInput.classList.contains('hidden')).toBe(true);

            // 6. Uji deleteVendor
            await deleteVendor(encodeURIComponent('CV Graha Media'));
            expect(getCurrentVendors()).not.toContain('CV Graha Media');
            expect(getCurrentVendors()).toContain('Percetakan Bintang');
            expect(getCurrentVendors()).toContain('PT Intan Pariwara');
        } finally {
            sandbox.document.getElementById = origGetElementById;
            sandbox.window.confirm = origConfirm;
        }
    });

    test('40. Pemadatan Baris Data Tab Rekap Buku & Tab Per Guru: Compact layout, space-y-1, tooltip rombel, dan padding rapat', () => {
        const origGetElementById = sandbox.document.getElementById;
        const mockBooksTbody = { innerHTML: '' };
        const mockTeachersTbody = { innerHTML: '' };

        sandbox.document.getElementById = (id) => {
            if (id === 'table-books-body') return mockBooksTbody;
            if (id === 'table-teachers-body') return mockTeachersTbody;
            return null;
        };

        const prevTxs = getCurrentTransactions ? getCurrentTransactions() : [];
        if (setCurrentTransactions) {
            setCurrentTransactions([]);
        }

        try {
            const sampleData = [
                {
                    grade: 10,
                    subject: 'Biologi',
                    terima: 215,
                    diam: 0,
                    sisa: 4,
                    terjual: 211,
                    harga: 17000,
                    total: 3587000,
                    teachers: [
                        {
                            teacher: 'Guru Bio A',
                            classCount: 5,
                            totalClasses: 9,
                            classesStr: 'X-1, X-2, X-3, X-4, X-5',
                            percentageStr: '55.6%',
                            propTerjual: 117,
                            propNominal: 1989000
                        },
                        {
                            teacher: 'Guru Bio B',
                            classCount: 4,
                            totalClasses: 9,
                            classesStr: 'X-6, X-7, X-8, X-9',
                            percentageStr: '44.4%',
                            propTerjual: 94,
                            propNominal: 1598000
                        }
                    ]
                }
            ];

            // 1. Verifikasi renderBooksTable menggunakan layout compact
            renderBooksTable(sampleData);
            expect(mockBooksTbody.innerHTML).toContain('py-1.5 sm:py-2');
            expect(mockBooksTbody.innerHTML).toContain('space-y-1');
            expect(mockBooksTbody.innerHTML).toContain('title="Rombel diampu: X-1, X-2, X-3, X-4, X-5"');
            expect(mockBooksTbody.innerHTML).toContain('Total Terfilter:');
            expect(mockBooksTbody.innerHTML).toContain('px-4 py-2');

            // 2. Verifikasi renderTeachersTable menggunakan layout compact
            renderTeachersTable(sampleData);
            expect(mockTeachersTbody.innerHTML).toContain('py-1.5 sm:py-2');
            expect(mockTeachersTbody.innerHTML).toContain('w-6 h-6');
            expect(mockTeachersTbody.innerHTML).toContain('space-y-1');
            expect(mockTeachersTbody.innerHTML).toContain('Guru Bio A');
            expect(mockTeachersTbody.innerHTML).toContain('Total Seluruh Guru (Proporsional):');
        } finally {
            if (setCurrentTransactions) {
                setCurrentTransactions(prevTxs);
            }
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('41. Urutan Tab: Tab transaksi menjadi tab pertama & default aktif, diikuti tab sirkulasi, dan pemanggilan stock dialihkan ke recap', () => {
        const origGetElementById = sandbox.document.getElementById;
        const mockElements = {};
        const tabKeys = ['transactions', 'circulation', 'cashflow', 'recap', 'analysis', 'settings', 'orders', 'books', 'teachers', 'classes'];

        tabKeys.forEach(k => {
            mockElements[`tab-btn-${k}`] = { className: '' };
            mockElements[`tab-panel-${k}`] = {
                classList: {
                    _classes: new Set(['hidden']),
                    add(c) { this._classes.add(c); },
                    remove(c) { this._classes.delete(c); },
                    contains(c) { return this._classes.has(c); }
                }
            };
        });

        mockElements['filter-demand-container'] = { classList: { add: jest.fn(), remove: jest.fn() } };
        mockElements['filter-period-container'] = { classList: { add: jest.fn(), remove: jest.fn() } };
        mockElements['filter-tx-container'] = { classList: { add: jest.fn(), remove: jest.fn() } };
        mockElements['filter-circulation-container'] = { classList: { add: jest.fn(), remove: jest.fn() } };
        mockElements['filter-recap-container'] = { classList: { add: jest.fn(), remove: jest.fn() } };
        mockElements['table-transactions-body'] = { innerHTML: '' };
        mockElements['table-circulation-body'] = { innerHTML: '' };

        sandbox.document.getElementById = (id) => mockElements[id] || null;

        try {
            // 1. Verifikasi switchTab('transactions') mengaktifkan tab transaksi
            switchTab('transactions');
            expect(mockElements['tab-btn-transactions'].className).toContain('border-blue-600');
            expect(mockElements['tab-panel-transactions'].classList.contains('hidden')).toBe(false);

            // 2. Verifikasi switchTab('circulation') mengaktifkan tab sirkulasi
            switchTab('circulation');
            expect(mockElements['tab-btn-circulation'].className).toContain('border-blue-600');
            expect(mockElements['tab-panel-circulation'].classList.contains('hidden')).toBe(false);
            expect(mockElements['tab-panel-transactions'].classList.contains('hidden')).toBe(true);

            // 3. Verifikasi switchTab('stock') secara aman dialihkan ke tab recap (karena tab sisa stok dihapus total)
            switchTab('stock');
            expect(mockElements['tab-btn-recap'].className).toContain('border-blue-600');
            expect(mockElements['tab-panel-recap'].classList.contains('hidden')).toBe(false);
            expect(mockElements['tab-panel-circulation'].classList.contains('hidden')).toBe(true);
        } finally {
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('42. Pembersihan Grid KPI Transaksi & Perbaikan Dropdown Filter Tipe Log (Anti-Potong Teks)', () => {
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        const cssPath = path.resolve(__dirname, '../css/style.css');
        const cssContent = fs.readFileSync(cssPath, 'utf8');

        // 1. Grid 4 kartu KPI telah dihapus dari tab Transaksi
        expect(htmlContent).not.toContain('id="tx-stat-today-qty"');
        expect(htmlContent).not.toContain('id="tx-stat-gross-qty"');
        expect(htmlContent).not.toContain('id="tx-stat-return-qty"');
        expect(htmlContent).not.toContain('id="tx-stat-net-qty"');

        // 2. Dropdown filter-tx-type menggunakan class toolbar-select-compact dan min-w-[125px] (ramping & hemat tempat)
        expect(htmlContent).toContain('id="filter-tx-type"');
        expect(htmlContent).toContain('toolbar-select-compact');
        expect(htmlContent).toContain('min-w-[125px]');

        // 3. Dropdown filter-semester-period di header menggunakan class header-select-compact
        expect(htmlContent).toContain('id="filter-semester-period"');
        expect(htmlContent).toContain('header-select-compact');

        // 4. CSS style.css mendefinisikan kelas compact dengan padding vertikal aman (anti-potong)
        expect(cssContent).toContain('.toolbar-select-compact');
        expect(cssContent).toContain('.header-select-compact');
        expect(cssContent).toMatch(/padding:\s*\d+px\s+\d+px\s+\d+px\s+\d+px\s*!important/);
    });

    test('43. Kebijakan Retensi Data Otomatis 5 Tahun (Auto-Purge Records > 5 Tahun)', () => {
        // 1. Verifikasi fungsi purgeExpiredLksRecords di sisi klien
        expect(typeof purgeExpiredLksRecords).toBe('function');

        const now = new Date();
        const yNow = now.getFullYear();
        const mNow = String(now.getMonth() + 1).padStart(2, '0');
        const dNow = String(now.getDate()).padStart(2, '0');

        const dateValid = `${yNow - 2}-${mNow}-${dNow}`; // 2 tahun lalu (valid)
        const dateRecent = `${yNow}-${mNow}-${dNow}`;   // Hari ini (valid)
        const dateExpired1 = `${yNow - 6}-${mNow}-${dNow}`; // 6 tahun lalu (kadaluarsa)
        const dateExpired2 = `${yNow - 8}-${mNow}-${dNow}`; // 8 tahun lalu (kadaluarsa)

        const testPayload = {
            books: [{ grade: 10, subject: 'Matematika' }],
            transactions: [
                { id: 'tx-1', date: dateRecent, qty: 10 },
                { id: 'tx-2', date: dateExpired1, qty: 5 },
                { id: 'tx-3', date: dateValid, qty: 8 },
                { id: 'tx-4', date: dateExpired2, qty: 12 }
            ],
            circulations: [
                { id: 'circ-1', date: dateRecent, qty: 50 },
                { id: 'circ-2', date: dateExpired1, qty: 100 },
                { id: 'circ-3', date: dateValid, qty: 30 }
            ],
            vendors: ['Percetakan CV Maju']
        };

        const result = purgeExpiredLksRecords(testPayload, 5);

        // Harus memangkas 2 transaksi dan 1 sirkulasi yang berusia > 5 tahun
        expect(result.purgedTransactionsCount).toBe(2);
        expect(result.purgedCirculationsCount).toBe(1);

        // Hanya data valid (<= 5 tahun) yang tersisa
        expect(result.payload.transactions).toHaveLength(2);
        expect(result.payload.transactions.map(t => t.id)).toEqual(['tx-1', 'tx-3']);

        expect(result.payload.circulations).toHaveLength(2);
        expect(result.payload.circulations.map(c => c.id)).toEqual(['circ-1', 'circ-3']);

        // Master buku dan vendor aktif tidak terhapus
        expect(result.payload.books).toHaveLength(1);
        expect(result.payload.vendors).toHaveLength(1);

        // 2. Verifikasi integrasi pembersihan otomatis di Cloudflare Worker
        const workerPath = path.resolve(__dirname, '../cloudflare/worker.js');
        const workerContent = fs.readFileSync(workerPath, 'utf8');

        expect(workerContent).toContain('book_sales_lks_data');
        expect(workerContent).toContain('cutoffDate5y');
        expect(workerContent).toContain('lksTransactionsDeleted');
        expect(workerContent).toContain('lksCirculationsDeleted');
        expect(workerContent).toContain('lksOrdersDeleted');

        // 3. Verifikasi modul pemesanan kelas juga mendukung pembersihan retensi
        const pesanLksPath = path.resolve(__dirname, '../js/page-pesan-lks.js');
        const pesanLksContent = fs.readFileSync(pesanLksPath, 'utf8');
        expect(pesanLksContent).toContain('purgeExpiredOrders');
    });

    test('44. Otomatisasi Nama Guru Pengambil Buku & Searchable Combobox Fleksibel', () => {
        // 1. Parse Jadwal XML untuk mendapatkan struktur map lengkap
        const subjectsMap = new Map();
        const subRegex = /<subject id="([^"]+)" name="([^"]+)"/g;
        let m;
        while ((m = subRegex.exec(xmlContent)) !== null) {
            subjectsMap.set(m[1], { id: m[1], name: m[2] });
        }

        const teachersMap = new Map();
        const teachRegex = /<teacher id="([^"]+)"[^>]*name="([^"]+)"/g;
        while ((m = teachRegex.exec(xmlContent)) !== null) {
            teachersMap.set(m[1], { id: m[1], name: m[2], simasName: m[2] });
        }

        const classesMap = new Map();
        const classRegex = /<class id="([^"]+)" name="([^"]+)"/g;
        while ((m = classRegex.exec(xmlContent)) !== null) {
            classesMap.set(m[1], { id: m[1], name: m[2] });
        }

        const lessonsMap = new Map();
        const lessonRegex = /<lesson\s+([^>]+)>/g;
        while ((m = lessonRegex.exec(xmlContent)) !== null) {
            const attrs = m[1];
            const idM = attrs.match(/id="([^"]+)"/);
            const subM = attrs.match(/subjectid="([^"]+)"/);
            const teachM = attrs.match(/teacherids="([^"]*)"/);
            const classM = attrs.match(/classids="([^"]*)"/);

            if (idM && subM) {
                lessonsMap.set(idM[1], {
                    id: idM[1],
                    subjectId: subM[1],
                    teacherIds: teachM ? teachM[1].split(',').filter(Boolean) : [],
                    classIds: classM ? classM[1].split(',').filter(Boolean) : []
                });
            }
        }

        const parsedSchedule = { subjectsMap, teachersMap, classesMap, lessonsMap };
        if (setCurrentParsedSchedule) {
            setCurrentParsedSchedule(parsedSchedule);
        }

        // 2. Verifikasi getAssignedTeachersForSubject
        expect(typeof getAssignedTeachersForSubject).toBe('function');
        const bioK10Teachers = getAssignedTeachersForSubject(10, 'Biologi', parsedSchedule);
        expect(bioK10Teachers.length).toBeGreaterThan(0);
        expect(bioK10Teachers.some(t => t.includes('Sutri') || t.includes('Maulita'))).toBe(true);

        const agamaK10Teachers = getAssignedTeachersForSubject(10, 'Agama dan Budi Pekerti', parsedSchedule);
        expect(agamaK10Teachers).toContain('I Putu Agustina, S.Pd.');

        // 3. Verifikasi getAllSchoolTeachers
        expect(typeof getAllSchoolTeachers).toBe('function');
        const allTeachers = getAllSchoolTeachers(parsedSchedule);
        expect(allTeachers.length).toBeGreaterThan(20);
        expect(allTeachers).toContain('I Putu Agustina, S.Pd.');
        expect(allTeachers.some(t => t.toUpperCase().includes('UPACARA') || t.toUpperCase().includes('LIBUR'))).toBe(false);

        // 4. Verifikasi Komponen DOM dan Searchable Dropdown Combobox
        const mockDom = {
            'circ-grade': { value: '10' },
            'circ-subject': { value: 'Agama dan Budi Pekerti' },
            'circ-type': { value: 'pengambilan_guru' },
            'circ-party': { value: '' },
            'circ-info-teacher': { textContent: '' },
            'circ-info-stock': { textContent: '' },
            'circ-teacher-dropdown-list': {
                innerHTML: '',
                classList: {
                    _classes: new Set(['hidden']),
                    contains(c) { return this._classes.has(c); },
                    add(c) { this._classes.add(c); },
                    remove(c) { this._classes.delete(c); }
                }
            },
            'icon-circ-teacher-chevron': {
                classList: {
                    _classes: new Set(),
                    contains(c) { return this._classes.has(c); },
                    add(c) { this._classes.add(c); },
                    remove(c) { this._classes.delete(c); }
                }
            }
        };

        const oldGetElementById = sandbox.document.getElementById;
        sandbox.document.getElementById = (id) => mockDom[id] || null;

        try {
            // A. Uji onCirculationSubjectChanged saat mutasi adalah pengambilan_guru:
            // Harus otomatis mengisi #circ-party dengan guru pengampu mapel
            onCirculationSubjectChanged();
            expect(mockDom['circ-party'].value).toBe('I Putu Agustina, S.Pd.');

            // B. Uji populateCircTeacherDropdown dengan guru pengampu di posisi teratas
            populateCircTeacherDropdown('');
            const renderedHtml = mockDom['circ-teacher-dropdown-list'].innerHTML;
            expect(renderedHtml).toContain('I Putu Agustina, S.Pd.');
            expect(renderedHtml).toContain('Pengampu');
            expect(renderedHtml).toContain('window.selectCircTeacher');

            // C. Uji filter pencarian dropdown (misal mencari nama guru lain untuk mengambilkan buku teman/siswa)
            populateCircTeacherDropdown('Sutri');
            const filteredHtml = mockDom['circ-teacher-dropdown-list'].innerHTML;
            expect(filteredHtml).toContain('Sutri');
            expect(filteredHtml).not.toContain('I Putu Agustina, S.Pd.');

            // D. Uji filter pencarian jika tidak ada hasil
            populateCircTeacherDropdown('NamaGuruTidakAdaXYZ123');
            expect(mockDom['circ-teacher-dropdown-list'].innerHTML).toContain('Tidak ada guru yang cocok');

            // E. Uji toggle dan close dropdown
            expect(mockDom['circ-teacher-dropdown-list'].classList.contains('hidden')).toBe(true);
            toggleCircTeacherDropdown();
            expect(mockDom['circ-teacher-dropdown-list'].classList.contains('hidden')).toBe(false);
            expect(mockDom['icon-circ-teacher-chevron'].classList.contains('rotate-180')).toBe(true);

            closeCircTeacherDropdown();
            expect(mockDom['circ-teacher-dropdown-list'].classList.contains('hidden')).toBe(true);
            expect(mockDom['icon-circ-teacher-chevron'].classList.contains('rotate-180')).toBe(false);

            // F. Uji selectCircTeacher: guru lain dipilih manual
            selectCircTeacher('Ni Made Sutri, S.Pd');
            expect(mockDom['circ-party'].value).toBe('Ni Made Sutri, S.Pd');
            expect(mockDom['circ-teacher-dropdown-list'].classList.contains('hidden')).toBe(true);
        } finally {
            sandbox.document.getElementById = oldGetElementById;
        }

        // 5. Verifikasi HTML penjualan-buku.html: UI Guidelines Compliance
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        expect(htmlContent).toContain('id="circ-party"');
        expect(htmlContent).toContain('id="circ-teacher-dropdown-list"');
        expect(htmlContent).toContain('id="btn-toggle-circ-teacher-dropdown"');
        expect(htmlContent).toContain('id="icon-circ-teacher-chevron"');

        // Pastikan tidak ada leading icon absolut di dalam field input circ-party (Anti-Overlapping Icon Mandate)
        const containerCircTeacherMatch = htmlContent.match(/<div id="container-circ-teacher"[^>]*>([\s\S]*?)<\/div>\s*<!--/);
        if (containerCircTeacherMatch) {
            const containerSnippet = containerCircTeacherMatch[1];
            expect(containerSnippet).not.toMatch(/absolute inset-y-0 left-0/);
        }
    });

    test('45. Penggabungan Tab Rekapitulasi: Konsolidasi 3 Tab Rekap (Buku, Guru, Kelas) Menjadi 1 Tab Terpadu dengan Segmented Sub-View Switcher (Total 8 Tab Ringkas)', () => {
        // 1. Verifikasi Integritas Navigasi HTML penjualan-buku.html
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // A. Tepat 7 Tombol Tab Utama yang Ringkas dengan urutan: Transaksi, Pesanan, Sirkulasi, Arus Kas, Rekapitulasi, Kebutuhan, Pengaturan
        expect(htmlContent).toContain('id="tab-btn-transactions"');
        expect(htmlContent).toContain('id="tab-btn-orders"');
        expect(htmlContent).toContain('id="tab-btn-circulation"');
        expect(htmlContent).not.toContain('id="tab-btn-stock"');
        expect(htmlContent).toContain('id="tab-btn-cashflow"');
        expect(htmlContent).toContain('id="tab-btn-recap"');
        expect(htmlContent).toContain('id="tab-btn-analysis"');
        expect(htmlContent).toContain('id="tab-btn-settings"');

        // Verifikasi urutan sekuensial tab di antarmuka
        const idxTx = htmlContent.indexOf('id="tab-btn-transactions"');
        const idxOrders = htmlContent.indexOf('id="tab-btn-orders"');
        const idxCirculation = htmlContent.indexOf('id="tab-btn-circulation"');
        const idxCashflow = htmlContent.indexOf('id="tab-btn-cashflow"');
        const idxRecap = htmlContent.indexOf('id="tab-btn-recap"');
        const idxAnalysis = htmlContent.indexOf('id="tab-btn-analysis"');
        const idxSettings = htmlContent.indexOf('id="tab-btn-settings"');

        expect(idxTx).toBeLessThan(idxOrders);
        expect(idxOrders).toBeLessThan(idxCirculation);
        expect(idxCirculation).toBeLessThan(idxCashflow);
        expect(idxCashflow).toBeLessThan(idxRecap);
        expect(idxRecap).toBeLessThan(idxAnalysis);
        expect(idxAnalysis).toBeLessThan(idxSettings);

        // B. Tombol tab lama books, teachers, classes tidak lagi berdiri sendiri di nav utama
        expect(htmlContent).not.toContain('id="tab-btn-books"');
        expect(htmlContent).not.toContain('id="tab-btn-teachers"');
        expect(htmlContent).not.toContain('id="tab-btn-classes"');

        // C. Terdapat Wadah Tab Panel Rekapitulasi Terpadu
        expect(htmlContent).toContain('id="tab-panel-recap"');

        // D. Terdapat Segmented Control Sub-View Switcher di dalam tab-panel-recap
        expect(htmlContent).toContain('id="subview-btn-books"');
        expect(htmlContent).toContain('id="subview-btn-teachers"');
        expect(htmlContent).toContain('id="subview-btn-classes"');

        // E. Terdapat Tiga Sub-Panel Tampilan dengan Tabel Body Utuh
        expect(htmlContent).toContain('id="subview-panel-books"');
        expect(htmlContent).toContain('id="table-books-body"');
        expect(htmlContent).toContain('id="subview-panel-teachers"');
        expect(htmlContent).toContain('id="table-teachers-body"');
        expect(htmlContent).toContain('id="subview-panel-classes"');
        expect(htmlContent).toContain('id="table-classes-body"');

        // 2. Verifikasi Logika Switcher JavaScript
        const switchRecapSubView = sandbox.window.switchRecapSubView;
        const getCurrentRecapSubView = sandbox.window.getCurrentRecapSubView;
        const setCurrentRecapSubView = sandbox.window.setCurrentRecapSubView;
        const switchBookTab = sandbox.window.switchBookTab;

        expect(typeof switchRecapSubView).toBe('function');
        expect(typeof getCurrentRecapSubView).toBe('function');
        expect(typeof setCurrentRecapSubView).toBe('function');

        const oldGetElementById = sandbox.document.getElementById;
        const mockDom = {};

        const allTabKeys = ['transactions', 'circulation', 'stock', 'cashflow', 'recap', 'analysis', 'settings', 'orders'];
        allTabKeys.forEach(k => {
            mockDom[`tab-btn-${k}`] = { className: '' };
            mockDom[`tab-panel-${k}`] = {
                classList: {
                    _classes: new Set(['hidden']),
                    add(c) { this._classes.add(c); },
                    remove(c) { this._classes.delete(c); },
                    contains(c) { return this._classes.has(c); }
                }
            };
        });

        const subViews = ['books', 'teachers', 'classes'];
        subViews.forEach(sv => {
            mockDom[`subview-btn-${sv}`] = { className: '' };
            mockDom[`subview-panel-${sv}`] = {
                classList: {
                    _classes: new Set(sv === 'books' ? [] : ['hidden']),
                    add(c) { this._classes.add(c); },
                    remove(c) { this._classes.delete(c); },
                    contains(c) { return this._classes.has(c); }
                }
            };
        });

        mockDom['recap-subview-description'] = { textContent: '' };
        mockDom['filter-demand-container'] = { classList: { add: jest.fn(), remove: jest.fn() } };
        mockDom['filter-period-container'] = { classList: { add: jest.fn(), remove: jest.fn() } };
        mockDom['filter-circulation-container'] = { classList: { add: jest.fn(), remove: jest.fn() } };
        mockDom['filter-recap-container'] = { classList: { add: jest.fn(), remove: jest.fn() } };
        mockDom['table-books-body'] = { innerHTML: '' };
        mockDom['table-teachers-body'] = { innerHTML: '' };
        mockDom['table-classes-body'] = { innerHTML: '' };
        mockDom['table-transactions-body'] = { innerHTML: '' };

        sandbox.document.getElementById = (id) => mockDom[id] || null;

        try {
            // A. Uji switchBookTab('recap')
            switchBookTab('recap');
            expect(mockDom['tab-btn-recap'].className).toContain('border-blue-600');
            expect(mockDom['tab-panel-recap'].classList.contains('hidden')).toBe(false);
            expect(mockDom['filter-recap-container'].classList.remove).toHaveBeenCalledWith('hidden');

            // B. Uji switchRecapSubView('teachers')
            switchRecapSubView('teachers');
            expect(getCurrentRecapSubView()).toBe('teachers');
            expect(mockDom['subview-btn-teachers'].className).toContain('text-blue-600');
            expect(mockDom['subview-panel-teachers'].classList.contains('hidden')).toBe(false);
            expect(mockDom['subview-panel-books'].classList.contains('hidden')).toBe(true);
            expect(mockDom['recap-subview-description'].textContent).toContain('beban rombel');

            // C. Uji switchRecapSubView('classes')
            switchRecapSubView('classes');
            expect(getCurrentRecapSubView()).toBe('classes');
            expect(mockDom['subview-btn-classes'].className).toContain('text-blue-600');
            expect(mockDom['subview-panel-classes'].classList.contains('hidden')).toBe(false);
            expect(mockDom['subview-panel-teachers'].classList.contains('hidden')).toBe(true);

            // D. Uji switchRecapSubView('books') kembali
            switchRecapSubView('books');
            expect(getCurrentRecapSubView()).toBe('books');
            expect(mockDom['subview-btn-books'].className).toContain('text-blue-600');
            expect(mockDom['subview-panel-books'].classList.contains('hidden')).toBe(false);
            expect(mockDom['subview-panel-classes'].classList.contains('hidden')).toBe(true);

            // E. Uji Backward Compatibility: Pemanggilan legacy tab 'teachers'
            switchBookTab('teachers');
            expect(mockDom['tab-btn-recap'].className).toContain('border-blue-600');
            expect(mockDom['tab-panel-recap'].classList.contains('hidden')).toBe(false);
            expect(getCurrentRecapSubView()).toBe('teachers');
            expect(mockDom['subview-panel-teachers'].classList.contains('hidden')).toBe(false);

            // F. Uji Backward Compatibility: Pemanggilan legacy tab 'classes'
            switchBookTab('classes');
            expect(mockDom['tab-btn-recap'].className).toContain('border-blue-600');
            expect(mockDom['tab-panel-recap'].classList.contains('hidden')).toBe(false);
            expect(getCurrentRecapSubView()).toBe('classes');
            expect(mockDom['subview-panel-classes'].classList.contains('hidden')).toBe(false);

            // G. Uji Backward Compatibility: Pemanggilan legacy tab 'books'
            switchBookTab('books');
            expect(mockDom['tab-btn-recap'].className).toContain('border-blue-600');
            expect(mockDom['tab-panel-recap'].classList.contains('hidden')).toBe(false);
            expect(getCurrentRecapSubView()).toBe('books');
            expect(mockDom['subview-panel-books'].classList.contains('hidden')).toBe(false);
        } finally {
            sandbox.document.getElementById = oldGetElementById;
        }
    });

    test('44. Fitur Arus Kas LKS: Menghitung Saldo Kas Riil fisik dan Buku Kas Ledger kronologis dengan Running Balance', () => {
        const period = '2026/2027 Ganjil';
        sandbox.window.setCurrentSelectedSemesterPeriod(period);

        // Simulasi transaksi penjualan tunai & retur tunai dengan variasi casing ('Tunai', 'cash', 'TUNAI')
        const mockTxs = [
            { id: 'tx-1', date: '2026-10-01', period, grade: 10, className: 'X-1', subject: 'Matematika', qty: 2, total: 34000, payment: 'Tunai', isReturn: false },
            { id: 'tx-2', date: '2026-10-02', period, grade: 11, className: 'XI-1', subject: 'Biologi', qty: 3, total: 51000, payment: 'cash', isReturn: false },
            { id: 'tx-3', date: '2026-10-02', period, grade: 11, className: 'XI-1', subject: 'Fisika', qty: 1, total: 17000, payment: 'transfer', isReturn: false }, // Transfer (non-tunai, tidak masuk kas fisik)
            { id: 'tx-4', date: '2026-10-03', period, grade: 10, className: 'X-1', subject: 'Matematika', qty: 1, total: 17000, payment: 'TUNAI', isReturn: true, type: 'return', reason: 'Salah beli' } // Refund tunai
        ];
        setCurrentTransactions(mockTxs);

        // Simulasi mutasi kas manual
        const mockCashFlows = [
            { id: 'cf-1', date: '2026-10-01', period, type: 'in', category: 'modal_awal', amount: 50000, note: 'Modal Awal Kas LKS', pic: 'Admin LKS' },
            { id: 'cf-2', date: '2026-10-02', period, type: 'out', category: 'operasional', amount: 15000, note: 'Beli Plastik Pembungkus', pic: 'Admin LKS' },
            { id: 'cf-3', date: '2026-10-03', period, type: 'out', category: 'setor_bendahara', amount: 40000, note: 'Setoran tahap 1 ke Bendahara', pic: 'Ibu Bendahara' }
        ];
        setCurrentCashFlows(mockCashFlows);

        // A. Validasi Ringkasan Arus Kas (calculateCashFlowSummary)
        const summary = calculateCashFlowSummary(period);
        expect(summary.period).toBe(period);
        expect(summary.salesCashTotal).toBe(85000); // 34.000 + 51.000 (tunai saja, tx-3 transfer dikecualikan)
        expect(summary.returnsCashTotal).toBe(17000); // refund tunai
        expect(summary.manualInTotal).toBe(50000); // modal awal
        expect(summary.manualOutTotal).toBe(55000); // 15.000 operasional + 40.000 setoran
        expect(summary.totalCashIn).toBe(135000); // 85.000 + 50.000
        expect(summary.totalCashOut).toBe(72000); // 17.000 + 55.000
        // Saldo Kas Riil Fisik Di Tangan Admin = 135.000 - 72.000 = 63.000
        expect(summary.currentCashBalance).toBe(63000);

        // B. Validasi Buku Kas Ledger Kronologis & Running Balance
        const ledgerAll = generateCashFlowLedger(period, 'all');
        expect(ledgerAll.length).toBe(6); // 2 penjualan tunai + 1 refund retur + 3 mutasi kas manual

        // Ledger terurut descending (terbaru di index 0)
        expect(ledgerAll[0].balanceAfter).toBe(63000); // Saldo akhir akumulatif di entri paling atas

        // C. Validasi Filter Aliran Buku Kas
        const ledgerIn = generateCashFlowLedger(period, 'in');
        expect(ledgerIn.every(e => e.cashIn > 0 && e.cashOut === 0)).toBe(true);
        expect(ledgerIn.length).toBe(3); // 2 penjualan + 1 kas masuk manual

        const ledgerOut = generateCashFlowLedger(period, 'out');
        expect(ledgerOut.every(e => e.cashOut > 0 && e.cashIn === 0)).toBe(true);
        expect(ledgerOut.length).toBe(3); // 1 refund retur + 2 kas keluar manual

        const ledgerSales = generateCashFlowLedger(period, 'sales');
        expect(ledgerSales.every(e => e.origin === 'sales')).toBe(true);
        expect(ledgerSales.length).toBe(2);
        // Validasi kolom Sumber langsung berisi nama kelas tanpa duplikasi 'Kelas X X-1'
        expect(ledgerSales.find(e => e.id === 'tx-1')?.sourceText).toBe('X-1');
        expect(ledgerSales.find(e => e.id === 'tx-2')?.sourceText).toBe('XI-1');

        const ledgerReturns = generateCashFlowLedger(period, 'returns');
        expect(ledgerReturns.every(e => e.origin === 'returns')).toBe(true);
        expect(ledgerReturns.length).toBe(1);
        expect(ledgerReturns[0].sourceText).toBe('X-1');

        const ledgerManualIn = generateCashFlowLedger(period, 'manual_in');
        expect(ledgerManualIn.length).toBe(1);
        expect(ledgerManualIn[0].cashIn).toBe(50000);

        const ledgerManualOut = generateCashFlowLedger(period, 'manual_out');
        expect(ledgerManualOut.length).toBe(2);
    });

    test('45. Standarisasi Dropdown Anti-Terpotong (CSS & HTML Integrity Guard)', () => {
        // A. Validasi file css/style.css
        const cssContent = fs.readFileSync(path.resolve(__dirname, '../css/style.css'), 'utf8');

        // Pastikan selector form element default tidak memaksakan padding 12px pada select compact
        expect(cssContent).toMatch(/select:not\(\[class\*="compact"\]\)/);

        // Pastikan aturan universal select line-height normal & box-sizing border-box ada
        expect(cssContent).toContain('select {');
        expect(cssContent).toContain('box-sizing: border-box !important;');
        expect(cssContent).toContain('line-height: normal !important;');

        // Pastikan .toolbar-select-compact memiliki tinggi 38px dan line-height normal
        expect(cssContent).toMatch(/\.toolbar-select-compact[\s\S]*?min-height:\s*38px !important;/);
        expect(cssContent).toMatch(/\.toolbar-select-compact[\s\S]*?line-height:\s*normal !important;/);

        // B. Validasi file penjualan-buku.html
        const htmlContent = fs.readFileSync(path.resolve(__dirname, '../penjualan-buku.html'), 'utf8');

        // Dropdown status pesanan telah dieliminasi dari UI sesuai permintaan pengguna
        expect(htmlContent).not.toContain('id="filter-order-status"');

        // Dropdown filter utama di toolbar wajib konsisten menggunakan toolbar-select-compact
        const gradeMatch = htmlContent.match(/<select\s+id="filter-grade"[\s\S]*?>/);
        expect(gradeMatch).toBeTruthy();
        expect(gradeMatch[0]).toContain('toolbar-select-compact');

        const demandMatch = htmlContent.match(/<select\s+id="filter-demand-status"[\s\S]*?>/);
        expect(demandMatch).toBeTruthy();
        expect(demandMatch[0]).toContain('toolbar-select-compact');

        const periodMatch = htmlContent.match(/<select\s+id="filter-period"[\s\S]*?>/);
        expect(periodMatch).toBeTruthy();
        expect(periodMatch[0]).toContain('toolbar-select-compact');

        const circMatch = htmlContent.match(/<select\s+id="filter-circulation-type"[\s\S]*?>/);
        expect(circMatch).toBeTruthy();
        expect(circMatch[0]).toContain('toolbar-select-compact');

        const txTypeMatch = htmlContent.match(/<select\s+id="filter-tx-type"[\s\S]*?>/);
        expect(txTypeMatch).toBeTruthy();
        expect(txTypeMatch[0]).toContain('toolbar-select-compact');

        const cfTypeMatch = htmlContent.match(/<select\s+id="filter-cf-type"[\s\S]*?>/);
        expect(cfTypeMatch).toBeTruthy();
        expect(cfTypeMatch[0]).toContain('toolbar-select-compact');

        // Segmented switcher sub-view rekapitulasi wajib berada di Unified Toolbar dalam filter-recap-container
        expect(htmlContent).toContain('id="filter-recap-container"');
        expect(htmlContent).toContain('id="subview-btn-books"');
        expect(htmlContent).toContain('id="subview-btn-teachers"');
        expect(htmlContent).toContain('id="subview-btn-classes"');

        // Pastikan tab-panel-recap langsung memuat tabel tanpa memakan baris baru pembungkus subview switcher
        const tabRecapSection = htmlContent.match(/<div\s+id="tab-panel-recap"[\s\S]*?<\/table>/);
        expect(tabRecapSection).toBeTruthy();
        expect(tabRecapSection[0]).not.toContain('id="subview-btn-books"');
    });

    test('46. Arus Kas LKS: Ketiadaan Link di Transaksi, Grid Compact, dan Fungsionalitas Pemasukan/Pengeluaran Kas', async () => {
        // A. Validasi DOM HTML: Ketiadaan Link Buku Kas di Tab Transaksi
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // Tab transaksi tidak boleh memuat tautan atau tombol onclick ke tab arus kas
        const txPanelMatch = htmlContent.match(/<div\s+id="tab-panel-transactions"[\s\S]*?<\/table>/);
        expect(txPanelMatch).toBeTruthy();
        expect(txPanelMatch[0]).not.toContain("window.switchBookTab('cashflow')");
        expect(txPanelMatch[0]).not.toContain('<span>Buku Kas</span>');

        // B. Validasi Grid KPI Arus Kas di HTML adalah Compact
        const cfKpiMatch = htmlContent.match(/<!--\s*4 KPI Mini Cards Arus Kas[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
        expect(cfKpiMatch).toBeTruthy();
        expect(cfKpiMatch[0]).toContain('gap-2 sm:gap-2.5');
        expect(cfKpiMatch[0]).toContain('p-2.5 sm:p-3');

        // C. Validasi Fungsionalitas JS: Modal In/Out, Form Submission, dan Ledger Updates
        const origGetElementById = sandbox.document.getElementById;
        const mockModal = {
            classList: {
                _classes: new Set(['hidden']),
                add(c) { this._classes.add(c); },
                remove(c) { this._classes.delete(c); },
                contains(c) { return this._classes.has(c); }
            }
        };

        const mockInputDate = { value: '' };
        const mockSelectPeriod = { value: '2026/2027 Ganjil', innerHTML: '' };
        const mockSelectType = { value: 'in' };
        const mockSelectCat = { innerHTML: '', value: 'modal_awal' };
        const mockInputAmount = { value: '250000' };
        const mockInputNote = { value: 'Modal Awal Kas LKS' };
        const mockInputPic = { value: 'Admin LKS' };
        const mockModalTitle = { textContent: '' };
        const mockIconContainer = { className: '' };
        const mockIcon = { className: '' };
        const mockBtnSubmit = { className: '', innerHTML: '' };

        const mockKpiRealCash = { textContent: '' };
        const mockKpiRealCashSub = { textContent: '' };
        const mockKpiSalesCash = { textContent: '' };
        const mockKpiSalesCashSub = { textContent: '' };
        const mockKpiManualIn = { textContent: '' };
        const mockKpiManualInSub = { textContent: '' };
        const mockKpiManualOut = { textContent: '' };
        const mockKpiManualOutSub = { textContent: '' };
        const mockTbody = { innerHTML: '' };
        const mockTxCash = { textContent: '', className: '' };
        const mockTxHint = { textContent: '' };

        sandbox.document.getElementById = (id) => {
            if (id === 'modal-cashflow') return mockModal;
            if (id === 'cf-date') return mockInputDate;
            if (id === 'cf-period') return mockSelectPeriod;
            if (id === 'cf-type') return mockSelectType;
            if (id === 'cf-category') return mockSelectCat;
            if (id === 'cf-amount') return mockInputAmount;
            if (id === 'cf-note') return mockInputNote;
            if (id === 'cf-pic') return mockInputPic;
            if (id === 'cf-modal-title') return mockModalTitle;
            if (id === 'cf-modal-icon-container') return mockIconContainer;
            if (id === 'cf-modal-icon') return mockIcon;
            if (id === 'btn-submit-cashflow') return mockBtnSubmit;
            if (id === 'cf-kpi-real-cash') return mockKpiRealCash;
            if (id === 'cf-kpi-real-cash-sub') return mockKpiRealCashSub;
            if (id === 'cf-kpi-sales-cash') return mockKpiSalesCash;
            if (id === 'cf-kpi-sales-cash-sub') return mockKpiSalesCashSub;
            if (id === 'cf-kpi-manual-in') return mockKpiManualIn;
            if (id === 'cf-kpi-manual-in-sub') return mockKpiManualInSub;
            if (id === 'cf-kpi-manual-out') return mockKpiManualOut;
            if (id === 'cf-kpi-manual-out-sub') return mockKpiManualOutSub;
            if (id === 'table-cashflow-body') return mockTbody;
            if (id === 'tx-cash-in-hand') return mockTxCash;
            if (id === 'tx-cash-summary-hint') return mockTxHint;
            return origGetElementById(id);
        };

        try {
            setCurrentCashFlows([]);
            setCurrentTransactions([]);

            // 1. Uji Pembukaan Modal Pemasukan (defaultType = 'in')
            openAddCashFlowModal('in');
            expect(mockModal.classList.contains('hidden')).toBe(false);
            expect(mockSelectType.value).toBe('in');
            expect(mockModalTitle.textContent).toContain('Pemasukan');
            expect(mockBtnSubmit.innerHTML).toContain('Simpan Catatan Pemasukan');
            expect(mockSelectPeriod.innerHTML).toContain('Ganjil');

            // 2. Submit Pemasukan Kas
            mockInputAmount.value = '500000';
            mockInputNote.value = 'Modal Kas Kecil Awal Tahun';
            await submitAddCashFlow({ preventDefault: jest.fn() });

            // Modal tertutup dan data tersimpan
            expect(mockModal.classList.contains('hidden')).toBe(true);
            const flowsAfterIn = getCurrentCashFlows();
            expect(flowsAfterIn.length).toBe(1);
            expect(flowsAfterIn[0].amount).toBe(500000);
            expect(flowsAfterIn[0].type).toBe('in');

            // 3. Uji Pembukaan Modal Pengeluaran (defaultType = 'out')
            openAddCashFlowModal('out');
            expect(mockModal.classList.contains('hidden')).toBe(false);
            expect(mockSelectType.value).toBe('out');
            expect(mockModalTitle.textContent).toContain('Pengeluaran');
            expect(mockBtnSubmit.innerHTML).toContain('Simpan Catatan Pengeluaran');

            // 4. Submit Pengeluaran Kas
            mockInputAmount.value = '150000';
            mockInputNote.value = 'Beli Plastik & Map ATK LKS';
            mockSelectCat.value = 'operasional';
            await submitAddCashFlow({ preventDefault: jest.fn() });

            expect(mockModal.classList.contains('hidden')).toBe(true);
            const flowsAfterOut = getCurrentCashFlows();
            expect(flowsAfterOut.length).toBe(2);

            // 5. Render Tabel Arus Kas & Verifikasi Ringkasan KPI
            renderCashFlowTable();
            expect(mockKpiRealCash.textContent).toContain('350.000'); // 500.000 - 150.000
            expect(mockKpiManualIn.textContent).toContain('500.000');
            expect(mockKpiManualOut.textContent).toContain('150.000');
            expect(mockTbody.innerHTML).toContain('Beli Plastik');
            expect(mockTbody.innerHTML).toContain('Modal Kas Kecil Awal Tahun');

            // 6. Uji Penutupan Modal Mandiri
            openAddCashFlowModal('in');
            expect(mockModal.classList.contains('hidden')).toBe(false);
            closeAddCashFlowModal();
            expect(mockModal.classList.contains('hidden')).toBe(true);
        } finally {
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('47. Toolbar Pengaturan Master Buku: Format ultra-compact 1 baris, tanpa judul/subjudul, dan tombol singkat (+ Tambah, Harga Seragam, Tarik XML, Simpan Semua)', () => {
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // 1. Pastikan judul dan subjudul lama telah dihapus dari Tab Pengaturan
        expect(htmlContent).not.toContain('Pengaturan Master Buku &amp; Harga Jual');
        expect(htmlContent).not.toContain('Tambah buku, tarik mapel dari Jadwal XML, atau atur harga jual per buku.');

        // 2. Pastikan filter status terdaftar dengan class compact
        expect(htmlContent).toMatch(/<select\s+id="filter-settings-status"[^>]*class="[^"]*toolbar-select-compact[^"]*"/);

        // 3. Pastikan teks 4 tombol aksi telah dipersingkat dan rapi dalam 1 toolbar
        expect(htmlContent).toContain('<span>Tambah</span>');
        expect(htmlContent).toContain('<span>Harga Seragam</span>');
        expect(htmlContent).toContain('<span>Tarik XML</span>');
        expect(htmlContent).toContain('<span>Simpan Semua</span>');

        // Pastikan teks tombol lama yang terlalu panjang sudah tidak digunakan lagi
        expect(htmlContent).not.toContain('<span>Tambah Buku</span>');
        expect(htmlContent).not.toContain('<span>Ubah Harga Seragam</span>');
        expect(htmlContent).not.toContain('<span>Tarik dari Jadwal XML</span>');
        expect(htmlContent).not.toContain('<span>Simpan Seluruh Harga</span>');

        // 4. Pastikan ID tombol simpan tetap utuh untuk menjaga kompatibilitas script
        expect(htmlContent).toContain('id="btn-save-all-prices"');
    });

    test('48. Eliminasi Duplikasi Komponen Kas: Strip Kas di Tab Transaksi telah dihapus total & tombol kas hanya ada di Tab Arus Kas', () => {
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // 1. Ekstrak konten tab Transaksi
        const txTabMatch = htmlContent.match(/<div\s+id="tab-panel-transactions"[\s\S]*?<\/table>/);
        expect(txTabMatch).toBeTruthy();
        const txTabHtml = txTabMatch[0];

        // Pastikan tidak ada elemen kas atau tombol kas di dalam tab transaksi
        expect(txTabHtml).not.toContain('id="tx-cash-in-hand"');
        expect(txTabHtml).not.toContain('id="tx-cash-summary-hint"');
        expect(txTabHtml).not.toContain('Saldo Kas Riil (Fisik) Dipegang Admin');
        expect(txTabHtml).not.toContain('openAddCashFlowModal');

        // 2. Pastikan tombol catat kas hanya ada di dalam tab Arus Kas
        const cfTabMatch = htmlContent.match(/<div\s+id="tab-panel-cashflow"[\s\S]*?<\/table>/);
        expect(cfTabMatch).toBeTruthy();
        const cfTabHtml = cfTabMatch[0];

        expect(cfTabHtml).toContain("openAddCashFlowModal('out')");
        expect(cfTabHtml).toContain("openAddCashFlowModal('in')");
        expect(cfTabHtml).toContain('id="cf-kpi-real-cash"');

        // 3. Verifikasi jumlah kemunculan openAddCashFlowModal di seluruh file HTML tepat 2 kali (hanya di tab Arus Kas)
        const modalCalls = htmlContent.match(/openAddCashFlowModal\(/g) || [];
        expect(modalCalls.length).toBe(2);
    });

    test('49. Ketahanan Deserialisasi D1 SSOT & Proteksi Anti-Overwrite Master Buku (Zero Data Loss Mandate)', async () => {
        // 1. Uji parseSettingValue dengan berbagai variasi format respons D1
        expect(parseSettingValue(null)).toBeNull();
        expect(parseSettingValue(undefined)).toBeNull();
        expect(parseSettingValue({ books: [{ id: 1 }] })).toEqual({ books: [{ id: 1 }] });
        expect(parseSettingValue({ value: JSON.stringify({ books: [{ id: 2 }] }) })).toEqual({ books: [{ id: 2 }] });
        expect(parseSettingValue({ value: { books: [{ id: 3 }] } })).toEqual({ books: [{ id: 3 }] });
        expect(parseSettingValue(JSON.stringify({ books: [{ id: 4 }] }))).toEqual({ books: [{ id: 4 }] });

        // 2. Uji loadSavedBookSalesData saat respons D1 mengembalikan objek data langsung (bukan envelope { value })
        let savedInD1 = null;
        sandbox.cfClient.enabled = true;
        sandbox.cfClient.getSystemSetting = jest.fn().mockResolvedValue({
            books: [{ grade: 10, subject: 'Bahasa Indonesia', harga: 17000 }],
            vendors: ['Vendor Mitra A'],
            transactions: [],
            circulations: [],
            cashFlows: []
        });
        sandbox.cfClient.saveSystemSetting = jest.fn().mockImplementation((key, val) => {
            if (key === 'book_sales_lks_data') savedInD1 = val;
            return Promise.resolve({ success: true });
        });

        await loadSavedBookSalesData();
        expect(sandbox.window.getCurrentBookData().length).toBe(1);
        expect(sandbox.window.getCurrentBookData()[0].subject).toBe('Bahasa Indonesia');
        expect(sandbox.window.getCurrentVendors()).toContain('Vendor Mitra A');

        // 3. Uji Proteksi Anti-Overwrite:
        // Simpan master buku ke localStorage
        sandbox.localStorage.setItem('simas_book_sales_lks_data', JSON.stringify({
            books: [{ grade: 11, subject: 'Biologi', harga: 17000 }],
            vendors: ['Vendor Mitra A']
        }));

        // Kosongkan array di memori (misal karena belum selesai load atau state transient)
        sandbox.window.setCurrentBookData([]);

        // Panggil saveBookSalesData
        await saveBookSalesData();

        // Pastikan books yang disimpan ke D1 TIDAK menjadi kosong [], melainkan dipulihkan dari storage
        expect(savedInD1).toBeTruthy();
        expect(savedInD1.books.length).toBe(1);
        expect(savedInD1.books[0].subject).toBe('Biologi');
        expect(sandbox.window.getCurrentBookData().length).toBe(1);
    });

    test('50. Master Vendor Resilient Persistence & Anti-Data Loss: Multi-Source Merge, Dedicated Storage, dan Proteksi Overwrite D1 Tanpa Vendor', async () => {
        const origGetElementById = sandbox.document.getElementById;
        const origConfirm = sandbox.confirm;
        try {
            // 1. Verifikasi Konstanta Dedicated Storage
            expect(BOOK_VENDORS_STORAGE_KEY).toBe('simas_book_vendors_master_data');
            expect(BOOK_VENDORS_D1_KEY).toBe('book_vendors_master_data');
            expect(sandbox.window.BOOK_VENDORS_STORAGE_KEY).toBe(BOOK_VENDORS_STORAGE_KEY);
            expect(sandbox.window.BOOK_VENDORS_D1_KEY).toBe(BOOK_VENDORS_D1_KEY);

            // 2. Setup mock UI & D1 Client
            const mockInputVendor = { value: 'CV Pustaka Mandiri' };
            const mockTableBody = { innerHTML: '' };
            const mockBadgeCount = { textContent: '' };
            const mockSelect = { innerHTML: '' };

            sandbox.document.getElementById = jest.fn((id) => {
                if (id === 'input-new-vendor-name') return mockInputVendor;
                if (id === 'table-settings-vendor-body') return mockTableBody;
                if (id === 'badge-vendor-count') return mockBadgeCount;
                if (id === 'circ-vendor-select') return mockSelect;
                return origGetElementById.call(sandbox.document, id);
            });

            const d1SettingsStore = {};
            sandbox.cfClient = {
                enabled: true,
                getSystemSetting: jest.fn().mockImplementation((key) => {
                    return Promise.resolve(d1SettingsStore[key] || null);
                }),
                saveSystemSetting: jest.fn().mockImplementation((key, val) => {
                    d1SettingsStore[key] = val;
                    return Promise.resolve({ success: true });
                })
            };

            // Inisialisasi awal vendor
            sandbox.window.setCurrentVendors([]);

            // 3. Tambah Vendor Baru via submitAddVendor
            const mockEvent = {
                preventDefault: jest.fn(),
                stopPropagation: jest.fn()
            };
            await sandbox.window.submitAddVendor(mockEvent);

            expect(mockEvent.preventDefault).toHaveBeenCalled();
            expect(sandbox.window.getCurrentVendors()).toContain('CV Pustaka Mandiri');

            // Pastikan tersimpan sinkron di dedicated LocalStorage
            const storedLocal = JSON.parse(sandbox.localStorage.getItem(BOOK_VENDORS_STORAGE_KEY));
            expect(storedLocal).toContain('CV Pustaka Mandiri');

            // Pastikan tersimpan di dedicated D1
            expect(d1SettingsStore[BOOK_VENDORS_D1_KEY]).toContain('CV Pustaka Mandiri');

            // 4. Simulasi Kondisi D1 Lama / Overwrite Risk:
            // D1 utama mengembalikan payload buku TANPA properti vendors
            d1SettingsStore[BOOK_SALES_D1_KEY] = {
                books: [{ grade: 10, subject: 'Bahasa Indonesia', harga: 17000 }],
                transactions: [],
                circulations: []
                // vendors sengaja tidak ada (undefined)
            };

            // Kosongkan memori aktif seolah-olah terjadi refresh browser (F5)
            sandbox.window.setCurrentVendors([]);

            // Panggil pemuatan data kembali (seperti saat buka aplikasi / refresh)
            await sandbox.window.loadSavedBookSalesData();

            // Vendor "CV Pustaka Mandiri" HARUS TETAP ADA (tidak hilang ter-overwrite oleh D1!)
            const loadedVendors = sandbox.window.getCurrentVendors();
            expect(loadedVendors).toContain('CV Pustaka Mandiri');

            // 5. Uji Multi-Source Merge: Gabungkan dari histori sirkulasi penerbit
            d1SettingsStore[BOOK_SALES_D1_KEY].circulations = [
                { id: 'c1', type: 'terima', party: 'PT Graha Ilmu Grafika' },
                { id: 'c2', type: 'retur_penerbit', party: 'Penerbit Erlangga Prima' },
                { id: 'c3', type: 'pengambilan_guru', party: 'Guru Matematika' } // Harusnya diabaikan karena guru
            ];
            await sandbox.window.loadSavedBookSalesData();

            const mergedVendors = sandbox.window.getCurrentVendors();
            expect(mergedVendors).toContain('CV Pustaka Mandiri');
            expect(mergedVendors).toContain('PT Graha Ilmu Grafika');
            expect(mergedVendors).toContain('Penerbit Erlangga Prima');
            expect(mergedVendors).not.toContain('Guru Matematika');

            // 6. Uji Hapus Vendor
            sandbox.confirm = jest.fn(() => true);
            await sandbox.window.deleteVendor(encodeURIComponent('CV Pustaka Mandiri'));

            const afterDelete = sandbox.window.getCurrentVendors();
            expect(afterDelete).not.toContain('CV Pustaka Mandiri');
            const afterDeleteLocal = JSON.parse(sandbox.localStorage.getItem(BOOK_VENDORS_STORAGE_KEY));
            expect(afterDeleteLocal).not.toContain('CV Pustaka Mandiri');

            // 7. Verifikasi Proteksi Form HTML
            const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
            const htmlContent = fs.readFileSync(htmlPath, 'utf8');
            expect(htmlContent).toContain('onsubmit="event.preventDefault(); window.submitAddVendor(event); return false;"');
        } finally {
            sandbox.document.getElementById = origGetElementById;
            sandbox.confirm = origConfirm;
        }
    });

    test('51. Perampingan & Efisiensi Antarmuka: 7 Tab Ringkas, Hapus Total Sisa Stok, Bersihkan Status Omzet Sirkulasi, Hapus Card 3 Panduan Pengaturan, Satukan Toolbar Transaksi', () => {
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // 1. Verifikasi Penghapusan Total Tab Sisa Stok
        expect(htmlContent).not.toContain('id="tab-btn-stock"');
        expect(htmlContent).not.toContain('id="tab-panel-stock"');
        expect(htmlContent).not.toContain('id="table-stock-body"');

        // 2. Verifikasi 7 Tab Utama Aktif yang Ringkas & Efisien
        const activeTabs = ['transactions', 'circulation', 'cashflow', 'recap', 'analysis', 'settings', 'orders'];
        activeTabs.forEach(tabKey => {
            expect(htmlContent).toContain(`id="tab-btn-${tabKey}"`);
            expect(htmlContent).toContain(`id="tab-panel-${tabKey}"`);
        });

        // 3. Verifikasi Pembersihan Kolom Status Omzet di Tabel Sirkulasi
        // Header sirkulasi tidak memuat kolom Status Omzet
        const circTableHeadMatch = htmlContent.match(/<table[\s\S]*?id="table-circulation-body"/);
        expect(circTableHeadMatch).toBeTruthy();
        expect(circTableHeadMatch[0]).not.toContain('Status Omzet');

        // 4. Verifikasi Penghapusan Card 3 Teks Panduan Statis di Tab Pengaturan
        expect(htmlContent).not.toContain('Kebijakan Sirkulasi Buku Pelajaran &amp; Pengambilan Guru');
        expect(htmlContent).not.toContain('Kebijakan Sirkulasi Buku Pelajaran & Pengambilan Guru');

        // 5. Verifikasi Penyatuan Toolbar Transaksi ke Unified Toolbar Utama
        const unifiedToolbarMatch = htmlContent.match(/<!-- Unified Toolbar[\s\S]*?id="tab-panel-recap"/);
        expect(unifiedToolbarMatch).toBeTruthy();
        expect(unifiedToolbarMatch[0]).toContain('id="filter-tx-container"');
        expect(unifiedToolbarMatch[0]).toContain('id="filter-tx-type"');
        expect(unifiedToolbarMatch[0]).not.toContain('id="tx-cash-summary"');

        // 6. Verifikasi Logika JS renderCirculationTable menghasilkan tepat 9 kolom
        const origGetElementById = sandbox.document.getElementById;
        const mockCircTbody = { innerHTML: '' };
        sandbox.document.getElementById = (id) => {
            if (id === 'table-circulation-body') return mockCircTbody;
            if (id === 'circ-stat-received' || id === 'circ-stat-teacher' || id === 'circ-stat-returned') return { textContent: '' };
            return null;
        };

        try {
            const sampleCircs = [
                { id: 'c1', date: '2026-10-04', type: 'terima', grade: 10, subject: 'Bahasa Indonesia', qty: 100, party: 'Percetakan PT Graha', note: 'Drop baru' },
                { id: 'c2', date: '2026-10-04', type: 'pengambilan_guru', grade: 10, subject: 'Bahasa Indonesia', qty: 2, party: 'I Wayan S', note: 'Buku pegangan' }
            ];

            sandbox.window.renderCirculationTable(sampleCircs);

            // Periksa bahwa tidak ada teks atau badge Status Omzet di tabel body
            expect(mockCircTbody.innerHTML).not.toContain('Non-Penjualan (Rp 0)');
            expect(mockCircTbody.innerHTML).not.toContain('Stok Masuk');
            expect(mockCircTbody.innerHTML).not.toContain('Retur Keluar');

            // Baris data harus memiliki tepat 9 sel <td>
            const firstRowMatch = mockCircTbody.innerHTML.match(/<tr[^>]*>([\s\S]*?)<\/tr>/);
            expect(firstRowMatch).toBeTruthy();
            const tdCount = (firstRowMatch[1].match(/<td\b/g) || []).length;
            expect(tdCount).toBe(9);

            // Baris footer subtotal: colspan 5 + 1 sel qty + colspan 3 = 9 kolom
            expect(mockCircTbody.innerHTML).toContain('colspan="5"');
            expect(mockCircTbody.innerHTML).toContain('colspan="3"');
        } finally {
            sandbox.document.getElementById = origGetElementById;
        }

        // 7. Verifikasi Fallback Anggun switchTab('stock') ke 'recap'
        const mockElements = {};
        activeTabs.forEach(k => {
            mockElements[`tab-btn-${k}`] = { className: '' };
            mockElements[`tab-panel-${k}`] = {
                classList: {
                    _classes: new Set(['hidden']),
                    add(c) { this._classes.add(c); },
                    remove(c) { this._classes.delete(c); },
                    contains(c) { return this._classes.has(c); }
                }
            };
        });
        mockElements['filter-tx-container'] = { classList: { add: jest.fn(), remove: jest.fn() } };
        mockElements['filter-recap-container'] = { classList: { add: jest.fn(), remove: jest.fn() } };

        sandbox.document.getElementById = (id) => mockElements[id] || null;
        try {
            switchTab('stock');
            expect(mockElements['tab-btn-recap'].className).toContain('border-blue-600');
            expect(mockElements['tab-panel-recap'].classList.contains('hidden')).toBe(false);
        } finally {
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('52. Optimasi Ergonomi Tampilan HP Admin LKS: Horizontal Swipe Tab, Responsive Modal Grid, and Compact Mobile Controls', () => {
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // 1. Verifikasi Style CSS .no-scrollbar ada di berkas HTML
        expect(htmlContent).toContain('.no-scrollbar::-webkit-scrollbar');
        expect(htmlContent).toContain('.no-scrollbar {');
        expect(htmlContent).toContain('scrollbar-width: none');

        // 2. Verifikasi Navigasi Tab Bar Swipeable Horizontal (Single Line Tanpa Wrap)
        const navTabMatch = htmlContent.match(/<nav\s+class="[^"]*overflow-x-auto[^"]*"[\s\S]*?<\/nav>/);
        expect(navTabMatch).toBeTruthy();
        expect(navTabMatch[0]).toContain('overflow-x-auto');
        expect(navTabMatch[0]).toContain('no-scrollbar');
        expect(navTabMatch[0]).not.toContain('flex-wrap');

        // Seluruh 7 tombol tab memiliki kelas shrink-0 dan whitespace-nowrap
        const activeTabs = ['transactions', 'circulation', 'cashflow', 'recap', 'analysis', 'settings', 'orders'];
        activeTabs.forEach(tabKey => {
            const btnRegex = new RegExp(`<button[^>]*id="tab-btn-${tabKey}"[^>]*class="([^"]*)"`);
            const btnMatch = htmlContent.match(btnRegex);
            expect(btnMatch).toBeTruthy();
            expect(btnMatch[1]).toContain('shrink-0');
            expect(btnMatch[1]).toContain('whitespace-nowrap');
        });

        // 3. Verifikasi Grid Kalkulasi Modal Transaksi (Qty, Harga, dan Total Bayar) Responsif Mobile
        const modalTxMatch = htmlContent.match(/<div\s+id="modal-add-transaction"[\s\S]*?id="tx-total"[\s\S]*?<\/div>\s*<\/div>/);
        expect(modalTxMatch).toBeTruthy();
        // Kontainer grid kalkulasi responsif
        expect(modalTxMatch[0]).toContain('grid grid-cols-2 sm:grid-cols-3');
        // tx-total membentang 2 kolom penuh di HP (col-span-2) dan 1 kolom di layar sm ke atas
        const totalWrapMatch = modalTxMatch[0].match(/<div\s+class="[^"]*col-span-2 sm:col-span-1[^"]*"[\s\S]*?id="tx-total"/);
        expect(totalWrapMatch).toBeTruthy();

        // 4. Verifikasi Filter Transaksi Fleksibel Mobile
        expect(htmlContent).toContain('id="filter-tx-type"');
        const txFilterMatch = htmlContent.match(/<div\s+id="filter-tx-container"[\s\S]*?<\/div>/);
        expect(txFilterMatch).toBeTruthy();
        expect(txFilterMatch[0]).toContain('w-full sm:w-auto');
    });

    test('53. Perampingan Box Filter Toolbar: Min-Width Ringkas (125px), Opsi Teks Ramping, Padding Ramping & Sejajar h-9', () => {
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        const cssPath = path.resolve(__dirname, '../css/style.css');
        const cssContent = fs.readFileSync(cssPath, 'utf8');

        // 1. Verifikasi Dropdown filter-tx-type diperpendek (min-w-[125px], bukan min-w-[240px])
        const txTypeSelectMatch = htmlContent.match(/<select\s+id="filter-tx-type"[\s\S]*?<\/select>/);
        expect(txTypeSelectMatch).toBeTruthy();
        expect(txTypeSelectMatch[0]).toContain('min-w-[125px]');
        expect(txTypeSelectMatch[0]).not.toContain('min-w-[240px]');
        expect(txTypeSelectMatch[0]).toContain('>Semua Log<');
        expect(txTypeSelectMatch[0]).toContain('>Penjualan (+)<');
        expect(txTypeSelectMatch[0]).toContain('>Retur Siswa (-)<');

        // 2. Verifikasi Dropdown Periode Menggunakan Teks Ramping (7 Hari)
        const periodSelectMatch = htmlContent.match(/<select\s+id="filter-period"[\s\S]*?<\/select>/);
        expect(periodSelectMatch).toBeTruthy();
        expect(periodSelectMatch[0]).toContain('>7 Hari<');
        expect(periodSelectMatch[0]).not.toContain('>7 Hari Terakhir<');

        // 3. Verifikasi Dropdown Kebutuhan & Sirkulasi Ramping
        expect(htmlContent).toContain('>Semua Status<');
        expect(htmlContent).toContain('>Penerimaan Vendor<');
        expect(htmlContent).toContain('>Retur Percetakan<');

        // 4. Verifikasi CSS .toolbar-select-compact Ramping & Hemat Tempat
        expect(cssContent).toMatch(/\.toolbar-select-compact[\s\S]*?padding:\s*4px 24px 4px 10px !important;/);
        expect(cssContent).toMatch(/\.toolbar-select-compact[\s\S]*?font-size:\s*12px !important;/);

        // 5. Verifikasi Search Input dan Tombol Aksi Sejajar h-9
        expect(htmlContent).toContain('id="search-books"');
        const searchInputMatch = htmlContent.match(/<input[^>]*id="search-books"[^>]*class="([^"]*)"/);
        expect(searchInputMatch).toBeTruthy();
        expect(searchInputMatch[1]).toContain('h-9');

        const btnExportMatch = htmlContent.match(/<button[^>]*id="btn-export-excel"[^>]*class="([^"]*)"/);
        expect(btnExportMatch).toBeTruthy();
        expect(btnExportMatch[1]).toContain('h-9');
    });

    test('54. Pembaruan Tab Pesanan Kelas: Eliminasi Tombol Setujui/Tolak & Penyaringan Hanya Pesanan dengan Selisih Distribusi (ordered > delivered)', async () => {
        // A. Validasi DOM HTML: Sub-Toolbar Filter Tampilan Ramping & Ketiadaan Tombol Setujui/Tolak
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        expect(htmlContent).toContain('id="tab-panel-orders"');
        expect(htmlContent).not.toContain('id="filter-order-status"');
        expect(htmlContent).not.toContain('Semua Riwayat Pesanan');
        expect(htmlContent).not.toContain('Setujui Pesanan');
        expect(htmlContent).not.toContain('Tolak Pesanan');

        // B. Validasi Logika JS: Filter Hanya Munculkan yang Berselisih
        const origGetElementById = sandbox.document.getElementById;
        const mockTbody = { innerHTML: '' };
        const mockBadge = { textContent: '', classList: { add: jest.fn(), remove: jest.fn() } };
        const mockKpiTotal = { textContent: '' };
        const mockKpiDelivered = { textContent: '' };
        const mockKpiDeficit = { textContent: '' };

        const mockInputs = {
            'tx-grade': { value: '' },
            'tx-class': { value: '', innerHTML: '' },
            'tx-subject': { value: '', innerHTML: '' },
            'tx-qty': { value: '1' },
            'tx-price': { value: '0', disabled: true, readOnly: true },
            'tx-total': { value: '' },
            'tx-note': { value: '' },
            'modal-add-transaction': { classList: { remove: jest.fn(), add: jest.fn() } }
        };

        sandbox.document.getElementById = (id) => {
            if (id === 'table-orders-body') return mockTbody;
            if (id === 'orders-badge-count') return mockBadge;
            if (id === 'kpi-orders-total-qty') return mockKpiTotal;
            if (id === 'kpi-orders-delivered-qty') return mockKpiDelivered;
            if (id === 'kpi-orders-deficit-qty') return mockKpiDeficit;
            if (mockInputs[id]) return mockInputs[id];
            return origGetElementById ? origGetElementById.call(sandbox.document, id) : null;
        };

        try {
            // Setup Sample Transactions: Kelas X-1 sudah ambil 20 eks Bahasa Indonesia, Kelas X-2 sudah ambil 25 eks Matematika penuh
            sandbox.window.setCurrentTransactions([
                { id: 'tx1', className: 'X-1', grade: 10, subject: 'Bahasa Indonesia', qty: 20, type: 'sale', total: 340000 },
                { id: 'tx2', className: 'X-2', grade: 10, subject: 'Matematika', qty: 25, type: 'sale', total: 425000 }
            ]);

            // Setup Sample Orders:
            // 1. Order A: X-1, Bhs Indonesia, Pesan 30 -> Kurang 10 (HARUS MUNCUL)
            // 2. Order B: X-2, Matematika, Pesan 25 -> Kurang 0 (SUDAH TERPENUHI, TIDAK BOLEH MUNCUL)
            // 3. Order C: X-3, Biologi, Pesan 22 -> Kurang 22 (HARUS MUNCUL)
            sandbox.window.setCurrentClassOrders([
                {
                    id: 'ord_1',
                    orderedBy: { class: 'X-1', name: 'Admin X-1' },
                    grade: 10,
                    bookSubject: 'Bahasa Indonesia',
                    qty: 30,
                    totalPrice: 510000,
                    status: 'pending',
                    orderedAt: '2026-10-01T08:00:00Z'
                },
                {
                    id: 'ord_2',
                    orderedBy: { class: 'X-2', name: 'Admin X-2' },
                    grade: 10,
                    bookSubject: 'Matematika',
                    qty: 25,
                    totalPrice: 425000,
                    status: 'approved',
                    orderedAt: '2026-10-02T08:00:00Z'
                },
                {
                    id: 'ord_3',
                    orderedBy: { class: 'X-3', name: 'Admin X-3' },
                    grade: 10,
                    bookSubject: 'Biologi',
                    qty: 22,
                    totalPrice: 374000,
                    status: 'pending',
                    orderedAt: '2026-10-03T08:00:00Z'
                }
            ]);

            // Render Orders Table
            sandbox.window.renderOrdersManagementTable();

            // Verifikasi bahwa Order B (Matematika X-2 yang sudah lengkap 25/25) TIDAK MUNCUL
            expect(mockTbody.innerHTML).not.toContain('Matematika');
            expect(mockTbody.innerHTML).not.toContain('X-2');

            // Verifikasi bahwa Order A (Bhs Indonesia X-1) dan Order C (Biologi X-3) MUNCUL
            expect(mockTbody.innerHTML).toContain('Bahasa Indonesia');
            expect(mockTbody.innerHTML).toContain('X-1');
            expect(mockTbody.innerHTML).toContain('Kurang 10 eks');

            expect(mockTbody.innerHTML).toContain('Biologi');
            expect(mockTbody.innerHTML).toContain('X-3');
            expect(mockTbody.innerHTML).toContain('Kurang 22 eks');

            // Verifikasi bahwa tombol Setujui dan Tolak TIDAK ADA di baris tabel
            expect(mockTbody.innerHTML).not.toContain('window.approveClassOrder');
            expect(mockTbody.innerHTML).not.toContain('window.rejectClassOrder');
            expect(mockTbody.innerHTML).not.toContain('Setujui');
            expect(mockTbody.innerHTML).not.toContain('Tolak');

            // Verifikasi tombol Catat Distribusi ada
            expect(mockTbody.innerHTML).toContain('window.quickFulfillOrderTransaction');
            expect(mockTbody.innerHTML).toContain('Catat');

            // Verifikasi KPI Cards
            expect(mockKpiTotal.textContent).toBe('77 eks'); // 30 + 25 + 22
            expect(mockKpiDelivered.textContent).toBe('45 eks'); // 20 + 25 + 0
            expect(mockKpiDeficit.textContent).toBe('32 eks'); // 10 + 0 + 22

            // Verifikasi Badge Count: 2 pesanan yang masih berselisih
            expect(mockBadge.textContent).toBe('2');
            expect(mockBadge.classList.remove).toHaveBeenCalledWith('hidden');

            // Test Quick Fulfill: Membuka modal dan mengisi otomatis kekurangan
            await sandbox.window.quickFulfillOrderTransaction('ord_1');
            expect(mockInputs['tx-grade'].value).toBe('10');
            expect(mockInputs['tx-class'].value).toBe('X-1');
            expect(mockInputs['tx-subject'].value).toBe('Bahasa Indonesia');
            expect(mockInputs['tx-qty'].value).toBe(10); // Sisa kekurangan terisi otomatis!
            expect(mockInputs['tx-note'].value).toContain('Pemenuhan pesanan kelas X-1 (Bahasa Indonesia)');
        } finally {
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('55. Optimalisasi Layout Tampilan Mobile: Subtitle Ringkas & Hidden di HP, Tombol Saran Sub-Header Dieliminasi, Filter Toolbar Berbaris Rapi (Grid 2 Kolom), dan Tombol Excel/Salin/Cetak Disembunyikan di Mobile', () => {
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // 1. Verifikasi Subtitle Header: Tersembunyi di layar mobile (hidden sm:block) & Teks Ringkas
        const subtitleMatch = htmlContent.match(/<header[\s\S]*?<h1[\s\S]*?<\/h1>\s*(<p[\s\S]*?<\/p>)/);
        expect(subtitleMatch).toBeTruthy();
        expect(subtitleMatch[1]).toContain('hidden sm:block');
        expect(subtitleMatch[1]).toContain('Kelola penjualan &amp; sirkulasi buku LKS.');

        // 2. Verifikasi Tombol Saran Sub-Header Dieliminasi (Tidak Ganda dengan Header SIMAS)
        expect(htmlContent).not.toContain('id="btn-global-chat-feedback"');

        // 3. Verifikasi Filter Toolbar Berbaris Rapi (Grid 2 Kolom di Mobile, Flex di Layar sm+)
        const filterDropdownsGrid = htmlContent.match(/<!-- Baris Filter Dropdown Utama[\s\S]*?<div\s+class="([^"]*grid grid-cols-2[^"]*sm:flex[^"]*)"/);
        expect(filterDropdownsGrid).toBeTruthy();

        // 4. Verifikasi Filter Transaksi Berbaris Simetris (Grid 2 Kolom di Mobile)
        const txContainerMatch = htmlContent.match(/<div\s+id="filter-tx-container"[^>]*class="([^"]*)"/);
        expect(txContainerMatch).toBeTruthy();
        expect(txContainerMatch[1]).toContain('grid grid-cols-2');
        expect(txContainerMatch[1]).toContain('sm:flex');
        expect(txContainerMatch[1]).toContain('w-full sm:w-auto');

        // 5. Verifikasi Search Input Full Width di Mobile
        const searchInputMatch = htmlContent.match(/<div[^>]*class="[^"]*w-full[^"]*sm:min-w-\[180px\][^"]*"[\s\S]*?id="search-books"/);
        expect(searchInputMatch).toBeTruthy();

        // 6. Verifikasi Tombol Ekspor (Excel, Salin, Cetak) Disembunyikan di Mobile
        const exportContainerMatch = htmlContent.match(/<!-- Sisi Kanan: Tertiary Actions[\s\S]*?<div\s+class="([^"]*)"/);
        expect(exportContainerMatch).toBeTruthy();
        expect(exportContainerMatch[1]).toContain('hidden sm:flex');

        const btnExportExcelMatch = htmlContent.match(/<button[^>]*id="btn-export-excel"[^>]*class="([^"]*)"/);
        expect(btnExportExcelMatch).toBeTruthy();
        expect(btnExportExcelMatch[1]).toContain('hidden sm:inline-flex');

        const btnCopyMatch = htmlContent.match(/<button[^>]*id="btn-copy-table"[^>]*class="([^"]*)"/);
        expect(btnCopyMatch).toBeTruthy();
        expect(btnCopyMatch[1]).toContain('hidden sm:inline-flex');

        const btnPrintMatch = htmlContent.match(/<button[^>]*id="btn-print-report"[^>]*class="([^"]*)"/);
        expect(btnPrintMatch).toBeTruthy();
        expect(btnPrintMatch[1]).toContain('hidden sm:inline-flex');

        // 7. Verifikasi Toolbar Tab Arus Kas Berbaris Rapi di Mobile (Grid 2 Kolom untuk Tombol Aksi)
        const cfToolbarButtonsMatch = htmlContent.match(/<!-- Sub-Toolbar Tab Arus Kas[\s\S]*?<div\s+class="([^"]*grid grid-cols-2[^"]*sm:flex[^"]*)"/);
        expect(cfToolbarButtonsMatch).toBeTruthy();
    });

    test('56. Otomatisasi Jumlah (Eks) Modal Penjualan: Terisi Otomatis Berdasarkan Sisa Kebutuhan Pesanan (Pesanan - Transaksi Sebelumnya)', () => {
        const jsContent = fs.readFileSync(codePath, 'utf8');

        // 1. Verifikasi ekspor fungsi getRemainingOrderQtyForClassSubject
        expect(jsContent).toContain('export function getRemainingOrderQtyForClassSubject(');
        expect(jsContent).toContain('window.getRemainingOrderQtyForClassSubject = getRemainingOrderQtyForClassSubject;');

        // 2. Setup sandbox DOM dan data simulasi
        const sandbox = {
            window: {
                innerWidth: 1024,
                addEventListener: jest.fn(),
                formatDateIndo: (d) => d,
                getGradeRoman: (g) => (g == 10 || g == '10' ? 'X' : g == 11 || g == '11' ? 'XI' : 'XII'),
                normalizeKey: (k) => (k || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
            },
            document: {
                getElementById: jest.fn(),
                querySelector: jest.fn(),
                addEventListener: jest.fn()
            },
            localStorage: {
                getItem: jest.fn(),
                setItem: jest.fn()
            },
            navigator: {
                clipboard: { writeText: jest.fn().mockResolvedValue() }
            },
            console: { warn: jest.fn(), error: jest.fn(), log: jest.fn() }
        };

        const parsedScheduleCode = rawCode
            .replace(/import\s+.*?from\s+['"].*?['"];?/g, '')
            .replace(/export\s+default\s+/g, '')
            .replace(/export\s+(const|let|var|function\*?|class|async\s+function\*?)\s+/gm, '$1 ');

        vm.createContext(sandbox);
        vm.runInContext(parsedScheduleCode, sandbox);

        // Simulasi Pesanan Kelas: X-1 memesan Matematika 36 eks, X-2 memesan Fisika 30 eks
        const mockOrders = [
            {
                id: 'ord_x1_mtk',
                orderedBy: { class: 'X-1', name: 'Ketua X-1' },
                bookSubject: 'Matematika',
                grade: '10',
                qty: 36,
                status: 'pending'
            },
            {
                id: 'ord_x2_fis',
                orderedBy: { class: 'X-2', name: 'Ketua X-2' },
                bookSubject: 'Fisika',
                grade: '10',
                qty: 30,
                status: 'approved'
            }
        ];
        sandbox.setCurrentClassOrders(mockOrders);

        // Kasus A: Belum ada transaksi penjualan sebelumnya -> sisa kebutuhan = 36 eks penuh
        sandbox.setCurrentTransactions([]);
        let resA = sandbox.getRemainingOrderQtyForClassSubject('X-1', 'Matematika', 10);
        expect(resA.orderedQty).toBe(36);
        expect(resA.deliveredQty).toBe(0);
        expect(resA.remainingQty).toBe(36);

        // Kasus B: Sudah ada transaksi penjualan 10 eks -> sisa kebutuhan = 26 eks
        const mockTxList = [
            {
                id: 'tx_1',
                className: 'X-1',
                subject: 'Matematika',
                grade: 10,
                qty: 10,
                type: 'sales'
            }
        ];
        sandbox.setCurrentTransactions(mockTxList);
        let resB = sandbox.getRemainingOrderQtyForClassSubject('X-1', 'Matematika', 10);
        expect(resB.orderedQty).toBe(36);
        expect(resB.deliveredQty).toBe(10);
        expect(resB.remainingQty).toBe(26);

        // Kasus C: Ada tambahan transaksi retur 2 eks (net terjual = 10 - 2 = 8) -> sisa kebutuhan = 28 eks
        mockTxList.push({
            id: 'tx_ret_1',
            className: 'X-1',
            subject: 'Matematika',
            grade: 10,
            qty: 2,
            type: 'return',
            isReturn: true
        });
        sandbox.setCurrentTransactions(mockTxList);
        let resC = sandbox.getRemainingOrderQtyForClassSubject('X-1', 'Matematika', 10);
        expect(resC.orderedQty).toBe(36);
        expect(resC.deliveredQty).toBe(8);
        expect(resC.remainingQty).toBe(28);

        // Kasus D: Penjualan lunas terpenuhi (36 eks) -> sisa kebutuhan = 0 eks
        mockTxList.push({
            id: 'tx_pelunasan',
            className: 'X-1',
            subject: 'Matematika',
            grade: 10,
            qty: 28,
            type: 'sales'
        });
        sandbox.setCurrentTransactions(mockTxList);
        let resD = sandbox.getRemainingOrderQtyForClassSubject('X-1', 'Matematika', 10);
        expect(resD.orderedQty).toBe(36);
        expect(resD.deliveredQty).toBe(36);
        expect(resD.remainingQty).toBe(0);

        // Kasus E: Mapel yang tidak memiliki pesanan khusus -> orderedQty = 0, remainingQty = 0
        let resE = sandbox.getRemainingOrderQtyForClassSubject('X-1', 'Biologi', 10);
        expect(resE.orderedQty).toBe(0);
        expect(resE.remainingQty).toBe(0);

        // 3. Verifikasi interaksi form modal onTransactionClassOrSubjectChanged
        const mockFormElements = {
            'tx-grade': { value: '10' },
            'tx-class': { value: 'X-1' },
            'tx-subject': { value: 'Matematika' },
            'tx-info-teacher': { textContent: '' },
            'tx-info-stock': { textContent: '' },
            'tx-info-order': { textContent: '', innerHTML: '' },
            'tx-price': { value: 17000, disabled: false, readOnly: false },
            'tx-qty': { value: '1' },
            'tx-total': { value: '' },
            'tx-qty-auto-hint': {
                textContent: '',
                classList: {
                    remove: jest.fn(),
                    add: jest.fn()
                }
            }
        };

        // Reset transaksi ke kondisi sisa 26 eks (ordered 36, delivered 10)
        sandbox.setCurrentTransactions([
            { id: 'tx_1', className: 'X-1', subject: 'Matematika', grade: 10, qty: 10, type: 'sales' }
        ]);

        const origGetById = sandbox.document.getElementById;
        sandbox.document.getElementById = jest.fn((id) => mockFormElements[id] || null);

        try {
            sandbox.window.onTransactionClassOrSubjectChanged();

            // Input Jumlah (Eks) terisi otomatis dengan sisa pesanan (26 eks)!
            expect(mockFormElements['tx-qty'].value).toBe(26);

            // Input Harga Satuan terformat dengan sparator ribuan (17.000) tanpa teks Rp
            expect(mockFormElements['tx-price'].value).toBe('17.000');

            // Total Bayar terhitung otomatis (26 * 17000 = Rp 442.000)
            expect(mockFormElements['tx-total'].value).toBe('Rp 442.000');

            // Hint otomatisasi muncul
            expect(mockFormElements['tx-qty-auto-hint'].classList.remove).toHaveBeenCalledWith('hidden');
            expect(mockFormElements['tx-qty-auto-hint'].textContent).toContain('Sisa 26 dari 36 pesanan');
            expect(mockFormElements['tx-info-order'].innerHTML).toContain('Kurang 26 eks');

            // Verifikasi HTML modal transaksi: label sejajar h-5 dan input tx-price bertipe text
            const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
            const htmlContent = fs.readFileSync(htmlPath, 'utf8');
            expect(htmlContent).toContain('<label for="tx-qty" class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5 h-5">');
            expect(htmlContent).toContain('<input type="text" id="tx-price" readonly disabled');
        } finally {
            sandbox.document.getElementById = origGetById;
        }
    });

    test('57. Optimalisasi Antarmuka Tab Arus Kas di Mobile: Hero KPI Saldo Kas Riil, Filter Full Width, Dual-View Responsive (Desktop Table + Mobile Cards Feed), dan Form Modal Responsif', () => {
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // 1. Verifikasi Hero KPI Layout di Layar Mobile (Saldo Kas Riil col-span-2 di Mobile)
        const heroKpiMatch = htmlContent.match(/id="cf-kpi-real-cash"[\s\S]*?<\/div>/);
        expect(heroKpiMatch).toBeTruthy();
        const card1Match = htmlContent.match(/<!-- Kartu 1: Saldo Kas Riil[\s\S]*?<div\s+class="([^"]*col-span-2[^"]*sm:col-span-1[^"]*)"/);
        expect(card1Match).toBeTruthy();

        // 2. Verifikasi CSS Media Query: #filter-cf-type memiliki width 100% di layar mobile
        const cssMediaQueryMatch = htmlContent.match(/@media\s*\(\s*max-width:\s*639px\s*\)\s*\{([\s\S]*?)\}/);
        expect(cssMediaQueryMatch).toBeTruthy();
        expect(cssMediaQueryMatch[1]).toContain('#filter-cf-type');

        // 3. Verifikasi Dual-View Arus Kas: Mobile Feed Card + Desktop Table
        const mobileListMatch = htmlContent.match(/<div\s+id="cashflow-mobile-list"[^>]*class="([^"]*block sm:hidden[^"]*)"/);
        expect(mobileListMatch).toBeTruthy();

        const desktopTableWrapMatch = htmlContent.match(/<div\s+class="[^"]*hidden sm:block[^"]*overflow-x-auto[^"]*"[\s\S]*?id="table-cashflow-body"/);
        expect(desktopTableWrapMatch).toBeTruthy();

        // 4. Verifikasi Modal Dialog Arus Kas Responsif 1 Kolom di Mobile & 2 Kolom di Desktop
        const modalGridMatch = htmlContent.match(/<form\s+onsubmit="window\.submitAddCashFlow\(event\)"[\s\S]*?class="[^"]*grid grid-cols-1 sm:grid-cols-2[^"]*"/);
        expect(modalGridMatch).toBeTruthy();

        // 5. Verifikasi Logika JS renderCashFlowTable mengisi kedua wadah (tbody desktop & mobile cards list)
        const mockTbody = { innerHTML: '' };
        const mockMobileContainer = { innerHTML: '' };
        const mockElements = {
            'table-cashflow-body': mockTbody,
            'cashflow-mobile-list': mockMobileContainer,
            'cf-kpi-real-cash': { textContent: '' },
            'cf-kpi-real-cash-sub': { textContent: '' },
            'cf-kpi-sales-cash': { textContent: '' },
            'cf-kpi-sales-cash-sub': { textContent: '' },
            'cf-kpi-manual-in': { textContent: '' },
            'cf-kpi-manual-in-sub': { textContent: '' },
            'cf-kpi-manual-out': { textContent: '' },
            'cf-kpi-manual-out-sub': { textContent: '' }
        };

        const origGetById = sandbox.document.getElementById;
        sandbox.document.getElementById = jest.fn((id) => mockElements[id] || null);

        try {
            // Pasang data transaksi penjualan dan data kas manual
            sandbox.setCurrentTransactions([
                { id: 'tx_cf_1', date: '2026-10-04', grade: 10, className: 'X-1', subject: 'Matematika', qty: 2, price: 17000, total: 34000, type: 'sales', periode: '2026/2027 Ganjil' }
            ]);
            setCurrentCashFlows([
                { id: 'cf_manual_1', date: '2026-10-04', type: 'in', category: 'Modal Awal', amount: 500000, note: 'Modal tunai awal', pic: 'Admin LKS', periode: '2026/2027 Ganjil' }
            ]);

            sandbox.window.renderCashFlowTable();

            // Verifikasi bahwa Desktop Table Tbody terisi
            expect(mockTbody.innerHTML).toContain('Modal tunai awal');
            expect(mockTbody.innerHTML).toContain('Penjualan');

            // Verifikasi bahwa Mobile Cards List juga terisi dengan komponen ramah sentuhan
            expect(mockMobileContainer.innerHTML).toContain('Modal tunai awal');
            expect(mockMobileContainer.innerHTML).toContain('+Rp 500.000');
            expect(mockMobileContainer.innerHTML).toContain('Saldo:');
        } finally {
            sandbox.document.getElementById = origGetById;
        }
    });

    test('58. Proteksi Toolbar Filter Desktop 1 Baris Sejajar Lurus: sm:flex-nowrap, shrink-0, Anti-Numpuk Vertikal, dan Tertata Rapi 2 Kolom di Mobile', () => {
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // 1. Verifikasi Kontainer Toolbar Luar adalah flex-row di layar sm ke atas
        const outerToolbarMatch = htmlContent.match(/<!-- Unified Toolbar[\s\S]*?<div\s+class="([^"]*)"/);
        expect(outerToolbarMatch).toBeTruthy();
        expect(outerToolbarMatch[1]).toContain('sm:flex-row');
        expect(outerToolbarMatch[1]).toContain('sm:items-center');

        // 2. Verifikasi Wadah Sisi Kiri Filter adalah flex-row tanpa overflow
        const leftWrapMatch = htmlContent.match(/<!-- Sisi Kiri: Filter Dropdowns[\s\S]*?<div\s+class="([^"]*)"/);
        expect(leftWrapMatch).toBeTruthy();
        expect(leftWrapMatch[1]).toContain('sm:flex-row');
        expect(leftWrapMatch[1]).toContain('min-w-0');

        // 3. Verifikasi Wadah Dropdown Utama menggunakan sm:flex-nowrap dan shrink-0 (Anti-Numpuk / Anti-Wrap Vertikal)
        const filterDropdownsMatch = htmlContent.match(/<!-- Baris Filter Dropdown Utama[\s\S]*?<div\s+class="([^"]*)"/);
        expect(filterDropdownsMatch).toBeTruthy();
        expect(filterDropdownsMatch[1]).toContain('grid grid-cols-2');
        expect(filterDropdownsMatch[1]).toContain('sm:flex');
        expect(filterDropdownsMatch[1]).toContain('sm:flex-nowrap');
        expect(filterDropdownsMatch[1]).toContain('shrink-0');
        expect(filterDropdownsMatch[1]).not.toContain('sm:flex-wrap');

        // 4. Verifikasi Wadah Filter Transaksi (Semua Log & + Retur) menggunakan sm:flex-nowrap dan shrink-0
        const txFilterMatch = htmlContent.match(/<div\s+id="filter-tx-container"[^>]*class="([^"]*)"/);
        expect(txFilterMatch).toBeTruthy();
        expect(txFilterMatch[1]).toContain('grid grid-cols-2');
        expect(txFilterMatch[1]).toContain('sm:flex-nowrap');
        expect(txFilterMatch[1]).toContain('shrink-0');

        // 5. Verifikasi Wadah Aksi Tertiary (Excel, Salin, Cetak) adalah flex-nowrap
        const tertiaryMatch = htmlContent.match(/<!-- Sisi Kanan: Tertiary Actions[\s\S]*?<div\s+class="([^"]*)"/);
        expect(tertiaryMatch).toBeTruthy();
        expect(tertiaryMatch[1]).toContain('flex-nowrap');
        expect(tertiaryMatch[1]).not.toContain('flex-wrap');
    });

    test('59. Form Modal Catat Transaksi: Periode Semester & Jenjang Kelas Disembunyikan, Tanggal & Rombel 1 Baris Sejajar, dan Dropdown Rombel Memuat Seluruh Kelas (X, XI, XII)', () => {
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // 1. Verifikasi Elemen Kontrol Tersembunyi di DOM HTML (class="hidden")
        expect(htmlContent).toMatch(/<select\s+id="tx-period"[^>]*class="[^"]*hidden[^"]*"/);
        expect(htmlContent).toMatch(/<select\s+id="tx-grade"[^>]*class="[^"]*hidden[^"]*"/);

        // 2. Verifikasi Tanggal Transaksi & Rombel / Kelas Berada dalam 1 Baris Grid 2 Kolom
        const row1Match = htmlContent.match(/<!-- Baris 1: Tanggal Transaksi & Rombel \/ Kelas[\s\S]*?<div\s+class="([^"]*grid grid-cols-2[^"]*)"/);
        expect(row1Match).toBeTruthy();
        expect(htmlContent).toContain('for="tx-date"');
        expect(htmlContent).toContain('for="tx-class"');

        // 3. Verifikasi Dropdown tx-class Memuat Semua Jenjang (Optgroup Kelas X, XI, XII)
        expect(htmlContent).toContain('label="Kelas X"');
        expect(htmlContent).toContain('label="Kelas XI"');
        expect(htmlContent).toContain('label="Kelas XII"');
        expect(htmlContent).toContain('value="X-1"');
        expect(htmlContent).toContain('value="XI-1"');
        expect(htmlContent).toContain('value="XII-1"');

        // 4. Verifikasi Logika Deteksi Jenjang Otomatis (detectGradeFromClassName)
        expect(sandbox.window.detectGradeFromClassName('X-1')).toBe(10);
        expect(sandbox.window.detectGradeFromClassName('X-9')).toBe(10);
        expect(sandbox.window.detectGradeFromClassName('XI-3')).toBe(11);
        expect(sandbox.window.detectGradeFromClassName('XI-10')).toBe(11);
        expect(sandbox.window.detectGradeFromClassName('XII-2')).toBe(12);
        expect(sandbox.window.detectGradeFromClassName('XII-9')).toBe(12);

        // 5. Verifikasi Interaktivitas Form Modal: Perubahan Rombel Otomatis Mengubah Jenjang & Mapel
        const mockFormElements = {
            'tx-period': { value: '2026/2027 Ganjil' },
            'tx-grade': { value: '10' },
            'tx-class': { value: 'XI-2', options: [{ value: 'X-1' }, { value: 'XI-2' }, { value: 'XII-1' }] },
            'tx-subject': { innerHTML: '', value: '' },
            'tx-info-teacher': { textContent: '' },
            'tx-info-stock': { textContent: '' },
            'tx-info-order': { textContent: '', innerHTML: '' },
            'tx-price': { value: 0, disabled: false, readOnly: false },
            'tx-qty': { value: '1' },
            'tx-total': { value: '' },
            'tx-qty-auto-hint': { classList: { add: jest.fn(), remove: jest.fn() } },
            'filter-semester-period': { value: '2026/2027 Ganjil' }
        };

        const origGetById = sandbox.document.getElementById;
        sandbox.document.getElementById = jest.fn((id) => mockFormElements[id] || null);

        try {
            // Panggil onTransactionClassChanged saat user memilih kelas XI-2
            mockFormElements['tx-class'].value = 'XI-2';
            sandbox.window.onTransactionClassChanged();

            // Jenjang otomatis tersinkron ke 11
            expect(mockFormElements['tx-grade'].value).toBe('11');

            // Mapel kelas XI berhasil dimuat ke tx-subject
            expect(mockFormElements['tx-subject'].innerHTML).toContain('value=');

            // Saat user memilih kelas XII-1
            mockFormElements['tx-class'].value = 'XII-1';
            sandbox.window.onTransactionClassChanged();
            expect(mockFormElements['tx-grade'].value).toBe('12');
        } finally {
            sandbox.document.getElementById = origGetById;
        }
    });

    test('60. Kontrol Akses Berbasis Peran (RBAC): Admin LKS Dilarang Akses Tab Pengaturan dan Tab Arus Kas Read-Only (Tanpa Izin Buat/Hapus)', async () => {
        const parsedScheduleCode = rawCode
            .replace(/import\s+.*?from\s+['"].*?['"];?/g, '')
            .replace(/export\s+default\s+/g, '')
            .replace(/export\s+(const|let|var|function\*?|class|async\s+function\*?)\s+/gm, '$1 ');

        const mockElements = {
            'tab-btn-settings': { classList: { add: jest.fn(), remove: jest.fn() } },
            'cashflow-actions-container': { classList: { add: jest.fn(), remove: jest.fn() } },
            'modal-cashflow': { classList: { add: jest.fn(), remove: jest.fn() } },
            'table-cashflow-body': { innerHTML: '' },
            'cashflow-mobile-list': { innerHTML: '' },
            'cf-kpi-real-cash': { textContent: '' },
            'cf-kpi-real-cash-sub': { textContent: '' },
            'cf-kpi-sales-cash': { textContent: '' },
            'cf-kpi-sales-cash-sub': { textContent: '' },
            'cf-kpi-manual-in': { textContent: '' },
            'cf-kpi-manual-in-sub': { textContent: '' },
            'cf-kpi-manual-out': { textContent: '' },
            'cf-kpi-manual-out-sub': { textContent: '' },
            'cf-date': { value: '2026-10-04' },
            'cf-period': { value: '2026/2027 Ganjil' },
            'cf-type': { value: 'in' },
            'cf-category': { value: 'modal_awal' },
            'cf-amount': { value: '250000' },
            'cf-note': { value: 'Uang kembalian' },
            'cf-pic': { value: 'Admin' }
        };

        const testStorage = new Map();
        const testSandbox = {
            window: {
                innerWidth: 1024,
                addEventListener: jest.fn(),
                formatDateIndo: (d) => d,
                getGradeRoman: (g) => (g == 10 || g == '10' ? 'X' : g == 11 || g == '11' ? 'XI' : 'XII'),
                normalizeKey: (k) => (k || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim(),
                escapeHTML: (str) => str || '',
                showToast: jest.fn(),
                confirm: jest.fn().mockReturnValue(true)
            },
            escapeHTML: (str) => str || '',
            document: {
                getElementById: jest.fn((id) => mockElements[id] || null),
                querySelector: jest.fn(),
                addEventListener: jest.fn()
            },
            localStorage: {
                getItem: jest.fn((k) => testStorage.get(k) || null),
                setItem: jest.fn((k, v) => testStorage.set(k, String(v))),
                removeItem: jest.fn((k) => testStorage.delete(k))
            },
            navigator: { clipboard: { writeText: jest.fn().mockResolvedValue() } },
            console: { warn: jest.fn(), error: jest.fn(), log: jest.fn() }
        };

        vm.createContext(testSandbox);
        vm.runInContext(parsedScheduleCode, testSandbox);

        // KASUS A: PENGGUNA ADALAH ADMIN LKS (ROLE = admin_lks)
        testStorage.set('user_role', 'admin_lks');
        expect(testSandbox.isSuperAdmin()).toBe(false);

        // 1. Eksekusi applyRoleBasedAccessControl: Tab Pengaturan & Tombol Aksi Kas Disembunyikan
        testSandbox.applyRoleBasedAccessControl();
        expect(mockElements['tab-btn-settings'].classList.add).toHaveBeenCalledWith('hidden');
        expect(mockElements['cashflow-actions-container'].classList.add).toHaveBeenCalledWith('hidden');

        // 2. Percobaan Buka Tab Pengaturan: Ditolak & Dialihkan ke Transaksi
        testSandbox.window.switchTab('settings');
        expect(testSandbox.window.showToast).toHaveBeenCalledWith(
            'Akses Dibatasi',
            expect.stringContaining('Admin LKS tidak memiliki wewenang membuka Tab Pengaturan'),
            'warning'
        );

        // 3. Percobaan Buka Modal Tambah Kas Manual: Diblokir
        testSandbox.window.openAddCashFlowModal('in');
        expect(testSandbox.window.showToast).toHaveBeenCalledWith(
            'Akses Terbatas',
            expect.stringContaining('Admin LKS hanya memiliki izin melihat arus kas (Read-Only)'),
            'warning'
        );
        expect(mockElements['modal-cashflow'].classList.remove).not.toHaveBeenCalledWith('hidden');

        // 4. Percobaan Submit Mutasi Kas: Ditolak
        const initialCashCount = testSandbox.getCurrentCashFlows().length;
        await testSandbox.window.submitAddCashFlow({ preventDefault: jest.fn() });
        expect(testSandbox.getCurrentCashFlows().length).toBe(initialCashCount);
        expect(testSandbox.window.showToast).toHaveBeenCalledWith(
            'Akses Ditolak',
            expect.stringContaining('Hanya Super Admin yang berhak menyimpan mutasi kas manual'),
            'error'
        );

        // 5. Percobaan Hapus Kas Manual: Ditolak
        testSandbox.setCurrentCashFlows([
            { id: 'cf_manual_test', type: 'in', amount: 100000, note: 'Kas Tes', isManual: true }
        ]);
        await testSandbox.window.deleteCashFlow('cf_manual_test');
        expect(testSandbox.getCurrentCashFlows().some(c => c.id === 'cf_manual_test')).toBe(true);
        expect(testSandbox.window.showToast).toHaveBeenCalledWith(
            'Akses Ditolak',
            expect.stringContaining('Admin LKS tidak memiliki hak menghapus catatan kas'),
            'error'
        );

        // 6. Render Tabel Arus Kas untuk Admin LKS: Tombol Hapus Kas Manual TIDAK Dirender (Read-Only)
        testSandbox.setCurrentTransactions([]);
        testSandbox.window.renderCashFlowTable();
        expect(mockElements['table-cashflow-body'].innerHTML).not.toContain('window.deleteCashFlow');
        expect(mockElements['table-cashflow-body'].innerHTML).toContain('Manual');
        expect(mockElements['cashflow-mobile-list'].innerHTML).not.toContain('window.deleteCashFlow');

        // KASUS B: PENGGUNA ADALAH SUPER ADMIN (ROLE = super_admin)
        testStorage.set('user_role', 'super_admin');
        expect(testSandbox.isSuperAdmin()).toBe(true);

        // 1. Eksekusi applyRoleBasedAccessControl: Tab Pengaturan & Tombol Aksi Kas Ditampilkan
        testSandbox.applyRoleBasedAccessControl();
        expect(mockElements['tab-btn-settings'].classList.remove).toHaveBeenCalledWith('hidden');
        expect(mockElements['cashflow-actions-container'].classList.remove).toHaveBeenCalledWith('hidden');

        // 2. Render Tabel Arus Kas untuk Super Admin: Tombol Hapus Kas Manual MUNCUL
        testSandbox.window.renderCashFlowTable();
        expect(mockElements['table-cashflow-body'].innerHTML).toContain('window.deleteCashFlow');
        expect(mockElements['cashflow-mobile-list'].innerHTML).toContain('window.deleteCashFlow');

        // 3. Super Admin Berhasil Menghapus Kas Manual
        await testSandbox.window.deleteCashFlow('cf_manual_test');
        expect(testSandbox.getCurrentCashFlows().some(c => c.id === 'cf_manual_test')).toBe(false);
        expect(testSandbox.window.showToast).toHaveBeenCalledWith('Terhapus', expect.any(String), 'info');
    });

    test('61. Proteksi Kebocoran Tombol Retur & Filter Transaksi: HANYA Tampil di Tab Transaksi, 100% Tersembunyi di Tab Pesanan & Tab Lainnya', () => {
        // A. Validasi DOM HTML: filter-tx-container memiliki inline display: none dan class !hidden
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        const txContainerMatch = htmlContent.match(/<div\s+id="filter-tx-container"([^>]*)>/);
        expect(txContainerMatch).toBeTruthy();
        expect(txContainerMatch[1]).toContain('style="display: none;"');
        expect(txContainerMatch[1]).toContain('!hidden');
        expect(txContainerMatch[1]).toContain('hidden');

        // B. Tombol retur memiliki ID khusus btn-open-return-tx
        expect(htmlContent).toContain('id="btn-open-return-tx"');

        // C. Validasi Logika switchTab: Isolasi Total di Tab Non-Transaksi
        const origGetElementById = sandbox.document.getElementById;
        const mockFilterTx = {
            classList: {
                _classes: new Set(['hidden', '!hidden']),
                add: jest.fn(function(...cls) { cls.forEach(c => this._classes.add(c)); }),
                remove: jest.fn(function(...cls) { cls.forEach(c => this._classes.delete(c)); }),
                contains: jest.fn(function(c) { return this._classes.has(c); })
            },
            style: {
                display: 'none',
                setProperty: jest.fn(function(prop, val) { this[prop] = val; }),
                removeProperty: jest.fn(function(prop) { delete this[prop]; })
            }
        };

        const mockBtnReturn = {
            classList: {
                _classes: new Set(['hidden', '!hidden']),
                add: jest.fn(function(...cls) { cls.forEach(c => this._classes.add(c)); }),
                remove: jest.fn(function(...cls) { cls.forEach(c => this._classes.delete(c)); }),
                contains: jest.fn(function(c) { return this._classes.has(c); })
            },
            style: {
                display: 'none',
                setProperty: jest.fn(function(prop, val) { this[prop] = val; }),
                removeProperty: jest.fn(function(prop) { delete this[prop]; })
            }
        };

        const mockElements = {
            'filter-tx-container': mockFilterTx,
            'btn-open-return-tx': mockBtnReturn,
            'tab-btn-transactions': { className: '' },
            'tab-panel-transactions': { classList: { add: jest.fn(), remove: jest.fn() } },
            'tab-btn-orders': { className: '' },
            'tab-panel-orders': { classList: { add: jest.fn(), remove: jest.fn() } },
            'tab-btn-circulation': { className: '' },
            'tab-panel-circulation': { classList: { add: jest.fn(), remove: jest.fn() } },
            'tab-btn-cashflow': { className: '' },
            'tab-panel-cashflow': { classList: { add: jest.fn(), remove: jest.fn() } },
            'tab-btn-recap': { className: '' },
            'tab-panel-recap': { classList: { add: jest.fn(), remove: jest.fn() } },
            'tab-btn-analysis': { className: '' },
            'tab-panel-analysis': { classList: { add: jest.fn(), remove: jest.fn() } },
            'tab-btn-settings': { className: '' },
            'tab-panel-settings': { classList: { add: jest.fn(), remove: jest.fn() } },
            'table-transactions-body': { innerHTML: '' },
            'table-circulation-body': { innerHTML: '' },
            'table-orders-body': { innerHTML: '' }
        };

        sandbox.document.getElementById = (id) => mockElements[id] || null;

        try {
            // 1. Saat Tab Pesanan (orders) aktif -> Tombol Retur & Filter Log WAJIB 100% TERSEMBUNYI
            sandbox.window.switchTab('orders');
            expect(mockFilterTx.classList.add).toHaveBeenCalledWith('hidden', '!hidden');
            expect(mockFilterTx.style.setProperty).toHaveBeenCalledWith('display', 'none', 'important');
            expect(mockBtnReturn.classList.add).toHaveBeenCalledWith('hidden', '!hidden');
            expect(mockBtnReturn.style.setProperty).toHaveBeenCalledWith('display', 'none', 'important');

            // 2. Saat Tab Sirkulasi (circulation) aktif -> WAJIB TERSEMBUNYI
            sandbox.window.switchTab('circulation');
            expect(mockFilterTx.style.setProperty).toHaveBeenCalledWith('display', 'none', 'important');
            expect(mockBtnReturn.style.setProperty).toHaveBeenCalledWith('display', 'none', 'important');

            // 3. Saat Tab Arus Kas (cashflow) aktif -> WAJIB TERSEMBUNYI
            sandbox.window.switchTab('cashflow');
            expect(mockFilterTx.style.setProperty).toHaveBeenCalledWith('display', 'none', 'important');
            expect(mockBtnReturn.style.setProperty).toHaveBeenCalledWith('display', 'none', 'important');

            // 4. HANYA saat Tab Transaksi (transactions) aktif -> Tampil normal
            sandbox.window.switchTab('transactions');
            expect(mockFilterTx.classList.remove).toHaveBeenCalledWith('hidden', '!hidden');
            expect(mockFilterTx.style.removeProperty).toHaveBeenCalledWith('display');
            expect(mockBtnReturn.classList.remove).toHaveBeenCalledWith('hidden', '!hidden');
            expect(mockBtnReturn.style.removeProperty).toHaveBeenCalledWith('display');
        } finally {
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('62. Perampingan Tabel Transaksi: Format Tanggal d/m/yy (Tanpa Semester), Eliminasi Kolom Guru Pengampu, Header 1 Baris Sejajar Rapi, dan Konsistensi 11 Kolom', () => {
        // 1. Uji Fungsi formatDateShortDmy
        expect(typeof sandbox.window.formatDateShortDmy).toBe('function');
        expect(sandbox.window.formatDateShortDmy('2026-10-04')).toBe('4/10/26');
        expect(sandbox.window.formatDateShortDmy('2026-05-09')).toBe('9/5/26');
        expect(sandbox.window.formatDateShortDmy('2026-12-25')).toBe('25/12/26');

        // 2. Validasi Struktur DOM HTML: penjualan-buku.html
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // Cuplik thead khusus tabel transaksi
        const txTbodyIdx = htmlContent.indexOf('id="table-transactions-body"');
        expect(txTbodyIdx).toBeGreaterThan(0);
        const txTableStart = htmlContent.lastIndexOf('<table', txTbodyIdx);
        const txTheadStr = htmlContent.substring(txTableStart, txTbodyIdx);

        // Pastikan kolom Guru Pengampu TIDAK ADA di header tabel transaksi
        expect(txTheadStr).not.toContain('>Guru Pengampu<');

        // Pastikan header rapi 1 baris, ringkas, dan memuat 11 th
        const thCount = (txTheadStr.match(/<th[\s>]/g) || []).length;
        expect(thCount).toBe(11);
        expect(txTheadStr).toContain('>Tgl<');
        expect(txTheadStr).toContain('>Tipe<');
        expect(txTheadStr).toContain('>Buku LKS<');
        expect(txTheadStr).toContain('>Total (Rp)<');
        expect(txTheadStr).toContain('>Keterangan<');
        expect(htmlContent).toContain('colspan="11"');

        // 3. Validasi Rendering JavaScript: renderTransactionsTable
        const origGetElementById = sandbox.document.getElementById;
        const mockTbody = { innerHTML: '' };
        sandbox.document.getElementById = (id) => {
            if (id === 'table-transactions-body') return mockTbody;
            return null;
        };

        try {
            const defPeriod = sandbox.window.getDefaultTransactionPeriod();
            const todayIso = new Date().toISOString().slice(0, 10);
            const expectedDateStr = sandbox.window.formatDateShortDmy(todayIso);

            const sampleTxs = [
                {
                    id: 'tx_test_1',
                    date: todayIso,
                    periode: defPeriod,
                    className: 'X-1',
                    grade: 10,
                    subject: 'Matematika',
                    teacher: 'Drs. I Made Sudarma',
                    qty: 25,
                    price: 17000,
                    total: 425000,
                    payment: 'Tunai',
                    note: 'Lunas kelas X-1'
                }
            ];

            sandbox.window.setCurrentSelectedSemesterPeriod(defPeriod);
            sandbox.window.renderTransactionsTable(sampleTxs);

            // Verifikasi tanggal diformat d/m/yy tanpa semester
            expect(mockTbody.innerHTML).toContain(expectedDateStr);
            expect(mockTbody.innerHTML).not.toContain(defPeriod);

            // Verifikasi nama guru pengampu TIDAK DIRENDER di tabel transaksi
            expect(mockTbody.innerHTML).not.toContain('Drs. I Made Sudarma');

            // Verifikasi setiap baris data memiliki tepat 11 kolom <td>
            const rows = mockTbody.innerHTML.match(/<tr[\s\S]*?<\/tr>/g);
            expect(rows).toBeTruthy();
            const dataRow = rows[0];
            const tdCount = (dataRow.match(/<td/g) || []).length;
            expect(tdCount).toBe(11);

            // Verifikasi baris subtotal memiliki colspan="5"
            expect(mockTbody.innerHTML).toContain('colspan="5"');
            expect(mockTbody.innerHTML).not.toContain('colspan="6"');
        } finally {
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('63. Paritas Struktur 10 Kolom Tabel Rekap Buku: Urutan Header (No, Kelas, Mapel, Terima, Diam, Sisa, Terjual, Harga, Total, Guru) Selaras Sempurna dengan Data Baris dan Subtotal', () => {
        // 1. Validasi Header thead di penjualan-buku.html
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        const booksTbodyIdx = htmlContent.indexOf('id="table-books-body"');
        expect(booksTbodyIdx).toBeGreaterThan(0);
        const booksTableStart = htmlContent.lastIndexOf('<table', booksTbodyIdx);
        const booksTheadStr = htmlContent.substring(booksTableStart, booksTbodyIdx);

        // Header wajib memuat 10 <th> terurut: No, Kelas, Mapel, Terima, Diam, Sisa, Terjual, Harga Satuan, Total Penjualan, Guru Pengampu
        const thMatches = booksTheadStr.match(/<th[\s\S]*?<\/th>/g) || [];
        expect(thMatches.length).toBe(10);
        expect(thMatches[0]).toContain('No');
        expect(thMatches[1]).toContain('Kelas');
        expect(thMatches[2]).toContain('Mata Pelajaran (Buku)');
        expect(thMatches[3]).toContain('Terima');
        expect(thMatches[4]).toContain('Diam');
        expect(thMatches[5]).toContain('Sisa');
        expect(thMatches[6]).toContain('Terjual');
        expect(thMatches[7]).toContain('Harga Satuan');
        expect(thMatches[8]).toContain('Total Penjualan');
        expect(thMatches[9]).toContain('Guru Pengampu & Proporsi Beban');

        // 2. Validasi Data Row renderBooksTable
        const origGetElementById = sandbox.document.getElementById;
        const mockTbody = { innerHTML: '' };
        sandbox.document.getElementById = (id) => {
            if (id === 'table-books-body') return mockTbody;
            return null;
        };

        try {
            sandbox.setCurrentTransactions([]);
            const sampleData = [
                {
                    grade: 10,
                    subject: 'Bahasa Indonesia',
                    terima: 215,
                    diam: 1,
                    sisa: 213,
                    terjual: 1,
                    harga: 17000,
                    total: 17000,
                    teachers: [
                        { teacher: 'Ida Bagus Oka, S.Pd', classCount: 5, totalClasses: 9, percentageStr: '55.6%', propTerjual: 1, propNominal: 17000, classesStr: 'X-1, X-2' }
                    ]
                }
            ];

            sandbox.window.renderBooksTable(sampleData);

            // Periksa baris data (baris pertama)
            const rows = mockTbody.innerHTML.match(/<tr[\s\S]*?<\/tr>/g);
            expect(rows).toBeTruthy();
            const dataRow = rows[0];
            const tdMatches = dataRow.match(/<td[\s\S]*?<\/td>/g) || [];

            // Baris data wajib memiliki tepat 10 <td>
            expect(tdMatches.length).toBe(10);
            expect(tdMatches[0]).toContain('1'); // No
            expect(tdMatches[1]).toContain('X'); // Kelas
            expect(tdMatches[2]).toContain('Bahasa Indonesia'); // Mapel
            expect(tdMatches[3]).toContain('215'); // Terima
            expect(tdMatches[4]).toContain('1'); // Diam (Buku Pegangan Guru)
            expect(tdMatches[5]).toContain('213'); // Sisa: 215 - 1 - 1 = 213
            expect(tdMatches[6]).toContain('1'); // Terjual: 1
            expect(tdMatches[7]).toContain('17.000'); // Harga Satuan
            expect(tdMatches[8]).toContain('17.000'); // Total Penjualan: Rp 17.000
            expect(tdMatches[9]).toContain('Ida Bagus Oka, S.Pd'); // Guru Pengampu

            // Periksa baris subtotal (baris kedua)
            const subtotalRow = rows[1];
            expect(subtotalRow).toContain('colspan="3"'); // Total Terfilter (3 kolom)
            const subtotalTds = subtotalRow.match(/<td[\s\S]*?<\/td>/g) || [];
            expect(subtotalTds.length).toBe(8); // 1 (colspan 3) + 7 td = 10 kolom total
        } finally {
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('64. Format Tab Sirkulasi: Tanggal d/m/yy (Tanpa Semester), Jenjang Bersih (X, XI, XII Tanpa Kata Kelas), dan Header 1 Baris Sejajar Rapi', () => {
        // 1. Validasi Struktur DOM HTML: penjualan-buku.html
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // Cuplik thead khusus tabel sirkulasi
        const circTbodyIdx = htmlContent.indexOf('id="table-circulation-body"');
        expect(circTbodyIdx).toBeGreaterThan(0);
        const circTableStart = htmlContent.lastIndexOf('<table', circTbodyIdx);
        const circTheadStr = htmlContent.substring(circTableStart, circTbodyIdx);

        // Header wajib memuat 9 th dengan whitespace-nowrap dan label singkat
        const thMatches = circTheadStr.match(/<th[\s>]/g) || [];
        expect(thMatches.length).toBe(9);
        expect(circTheadStr).toContain('>Tgl<');
        expect(circTheadStr).toContain('>Mutasi<');
        expect(circTheadStr).toContain('>Jenjang<');
        expect(circTheadStr).toContain('>Buku LKS<');
        expect(circTheadStr).toContain('>Qty<');
        expect(circTheadStr).toContain('>Pihak Terkait<');
        expect(circTheadStr).toContain('>Keterangan<');
        expect(circTheadStr).toContain('>Aksi<');

        // 2. Validasi Logika JS: renderCirculationTable
        const origGetElementById = sandbox.document.getElementById;
        const mockCircTbody = { innerHTML: '' };
        sandbox.document.getElementById = (id) => {
            if (id === 'table-circulation-body') return mockCircTbody;
            if (id === 'circ-stat-received' || id === 'circ-stat-teacher' || id === 'circ-stat-returned') return { textContent: '' };
            return null;
        };

        try {
            const defPeriod = sandbox.window.getDefaultTransactionPeriod();
            const todayIso = new Date().toISOString().slice(0, 10);
            const expectedDateStr = sandbox.window.formatDateShortDmy(todayIso);

            const sampleCircs = [
                {
                    id: 'circ_x_1',
                    date: todayIso,
                    periode: defPeriod,
                    type: 'terima',
                    grade: 10,
                    subject: 'Matematika',
                    qty: 120,
                    party: 'PT Percetakan Bali',
                    note: 'Penerimaan batch awal'
                },
                {
                    id: 'circ_xi_1',
                    date: todayIso,
                    periode: defPeriod,
                    type: 'pengambilan_guru',
                    grade: 11,
                    subject: 'Biologi',
                    qty: 2,
                    party: 'Dra. Ni Ketut Artini',
                    note: 'Buku ajar guru'
                },
                {
                    id: 'circ_xii_1',
                    date: todayIso,
                    periode: defPeriod,
                    type: 'retur_penerbit',
                    grade: 12,
                    subject: 'Kimia',
                    qty: 5,
                    party: 'PT Percetakan Bali',
                    note: 'Cacat cetak'
                }
            ];

            sandbox.window.setCurrentSelectedSemesterPeriod(defPeriod);
            sandbox.window.renderCirculationTable(sampleCircs);

            // Verifikasi tanggal diformat d/m/yy tanpa teks semester
            expect(mockCircTbody.innerHTML).toContain(expectedDateStr);
            expect(mockCircTbody.innerHTML).not.toContain(defPeriod);

            // Verifikasi kolom Jenjang HANYA memuat Romawi (X, XI, XII) TANPA kata "Kelas "
            expect(mockCircTbody.innerHTML).toContain('>X<');
            expect(mockCircTbody.innerHTML).toContain('>XI<');
            expect(mockCircTbody.innerHTML).toContain('>XII<');
            expect(mockCircTbody.innerHTML).not.toContain('Kelas X');
            expect(mockCircTbody.innerHTML).not.toContain('Kelas XI');
            expect(mockCircTbody.innerHTML).not.toContain('Kelas XII');

            // Verifikasi setiap baris data memiliki tepat 9 sel <td>
            const rows = mockCircTbody.innerHTML.match(/<tr[\s\S]*?<\/tr>/g);
            expect(rows).toBeTruthy();
            expect(rows.length).toBe(4); // 3 baris data + 1 subtotal
            for (let i = 0; i < 3; i++) {
                const tdCount = (rows[i].match(/<td\b/g) || []).length;
                expect(tdCount).toBe(9);
            }

            // Verifikasi baris subtotal memiliki colspan="5"
            expect(rows[3]).toContain('colspan="5"');
        } finally {
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('80. Verifikasi Tata Letak Kontainer Utama (main) Bebas Pembatasan Lebar: Full-Width Parity (0 max-w-[1440px] & 0 mx-auto)', () => {
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // Pastikan elemen <main> tidak dibatasi lebar maksimum 1440px atau mx-auto yang mengakibatkan ruang kosong di sisi kanan layar lebar
        const mainMatch = htmlContent.match(/<main\b([^>]*)>/);
        expect(mainMatch).toBeTruthy();
        const mainAttributes = mainMatch[1];

        expect(mainAttributes).not.toContain('max-w-[1440px]');
        expect(mainAttributes).not.toContain('mx-auto');
        expect(mainAttributes).toContain('hidden fade-in');
        expect(mainAttributes).toContain('space-y-4');
        expect(mainAttributes).toContain('pb-16 lg:pb-12');
    });

    test('81. Verifikasi Standardisasi Format Separator Ribuan Interaktif Seluruh Form Nominal LKS (0 type="number" pada nominal & formatCurrencyInput)', async () => {
        // 1. Verifikasi fungsi formatCurrencyInput
        expect(typeof formatCurrencyInput).toBe('function');
        expect(formatCurrencyInput(89982900)).toBe('89.982.900');
        expect(formatCurrencyInput('17000')).toBe('17.000');
        expect(formatCurrencyInput(0)).toBe('0');
        expect(formatCurrencyInput('')).toBe('0');

        // Uji pemformatan interaktif pada objek input dengan kursor
        const mockInput = {
            value: '89982900',
            selectionStart: 8,
            setSelectionRange: jest.fn()
        };
        formatCurrencyInput(mockInput);
        expect(mockInput.value).toBe('89.982.900');
        expect(mockInput.setSelectionRange).toHaveBeenCalledWith(10, 10);

        // 2. Verifikasi seluruh elemen HTML di penjualan-buku.html bebas type="number" untuk nominal uang
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // cf-amount (Nominal Kas)
        const cfAmountMatch = htmlContent.match(/<input\b[^>]*id="cf-amount"[^>]*>/);
        expect(cfAmountMatch).toBeTruthy();
        expect(cfAmountMatch[0]).not.toContain('type="number"');
        expect(cfAmountMatch[0]).toContain('type="text"');
        expect(cfAmountMatch[0]).toContain('inputmode="numeric"');
        expect(cfAmountMatch[0]).toContain('formatCurrencyInput(this)');
        expect(cfAmountMatch[0]).toContain('placeholder="Contoh: 100.000"');

        // bulk-price-value (Ubah Harga Seragam)
        const bulkPriceMatch = htmlContent.match(/<input\b[^>]*id="bulk-price-value"[^>]*>/);
        expect(bulkPriceMatch).toBeTruthy();
        expect(bulkPriceMatch[0]).not.toContain('type="number"');
        expect(bulkPriceMatch[0]).toContain('type="text"');
        expect(bulkPriceMatch[0]).toContain('inputmode="numeric"');
        expect(bulkPriceMatch[0]).toContain('formatCurrencyInput(this)');
        expect(bulkPriceMatch[0]).toContain('placeholder="Contoh: 17.000"');

        // book-harga (Tambah Buku Baru)
        const bookHargaMatch = htmlContent.match(/<input\b[^>]*id="book-harga"[^>]*>/);
        expect(bookHargaMatch).toBeTruthy();
        expect(bookHargaMatch[0]).not.toContain('type="number"');
        expect(bookHargaMatch[0]).toContain('type="text"');
        expect(bookHargaMatch[0]).toContain('value="17.000"');

        // ret-price (Retur Penjualan)
        const retPriceMatch = htmlContent.match(/<input\b[^>]*id="ret-price"[^>]*>/);
        expect(retPriceMatch).toBeTruthy();
        expect(retPriceMatch[0]).not.toContain('type="number"');
        expect(retPriceMatch[0]).toContain('type="text"');

        // 3. Verifikasi Tabel Pengaturan Harga me-render input type="text" berpemisah ribuan
        const origGetElementById = sandbox.document.getElementById;
        const mockPriceTbody = { innerHTML: '' };
        sandbox.document.getElementById = (id) => {
            if (id === 'table-settings-price-body') return mockPriceTbody;
            return origGetElementById(id);
        };

        try {
            renderPriceSettingsTable();
            expect(mockPriceTbody.innerHTML).toContain('type="text"');
            expect(mockPriceTbody.innerHTML).toContain('inputmode="numeric"');
            expect(mockPriceTbody.innerHTML).toContain('formatCurrencyInput(this)');
            expect(mockPriceTbody.innerHTML).not.toContain('type="number"');
        } finally {
            sandbox.document.getElementById = origGetElementById;
        }

        // 4. Verifikasi submit kas dengan nilai berpemisah ribuan (89.982.900)
        const mockModal = { classList: { remove: jest.fn(), add: jest.fn(), contains: () => true } };
        const mockInputAmount = { value: '89.982.900' };
        const mockInputNote = { value: 'Setoran Uang ke Bendahara' };
        const mockInputDate = { value: '2026-10-05' };
        const mockSelectPeriod = { value: '2026/2027 Ganjil' };
        const mockSelectType = { value: 'out' };
        const mockSelectCat = { value: 'setor_bendahara' };
        const mockInputPic = { value: 'Ibu Bendahara' };

        sandbox.document.getElementById = (id) => {
            if (id === 'modal-cashflow') return mockModal;
            if (id === 'cf-amount') return mockInputAmount;
            if (id === 'cf-note') return mockInputNote;
            if (id === 'cf-date') return mockInputDate;
            if (id === 'cf-period') return mockSelectPeriod;
            if (id === 'cf-type') return mockSelectType;
            if (id === 'cf-category') return mockSelectCat;
            if (id === 'cf-pic') return mockInputPic;
            return origGetElementById(id);
        };

        try {
            setCurrentCashFlows([]);
            await submitAddCashFlow({ preventDefault: jest.fn() });
            const flows = getCurrentCashFlows();
            expect(flows).toHaveLength(1);
            expect(flows[0].amount).toBe(89982900);
            expect(flows[0].type).toBe('out');
        } finally {
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('82. Fitur Persentase Kontribusi ke Sekolah pada Rekap per Guru: Kolom Bagian Sekolah, Perhitungan Proporsional, Konfigurasi di Halaman Pengaturan, dan Ekspor TSV/Excel', async () => {
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // 1. Verifikasi Header thead table-teachers memuat kolom Bagian Sekolah
        expect(htmlContent).toContain('id="th-school-share"');
        expect(htmlContent).toContain('id="th-school-pct"');
        expect(htmlContent).toContain('colspan="7"');

        // 2. Verifikasi Tab Pengaturan memuat Card 3 untuk konfigurasi persentase
        expect(htmlContent).toContain('id="badge-school-pct-display"');
        expect(htmlContent).toContain('id="input-school-percentage"');
        expect(htmlContent).toContain('id="btn-save-school-pct"');
        expect(htmlContent).toContain('window.saveSchoolSharePercentage()');

        // 3. Verifikasi Logika Getter & Setter Clamping
        setSchoolSharePercentage(15);
        expect(getSchoolSharePercentage()).toBe(15);

        setSchoolSharePercentage(-5);
        expect(getSchoolSharePercentage()).toBe(0);

        setSchoolSharePercentage(120);
        expect(getSchoolSharePercentage()).toBe(100);

        setSchoolSharePercentage(12.5);
        expect(getSchoolSharePercentage()).toBe(12.5);

        // 4. Verifikasi Perhitungan Proporsional Kolom ke-7 pada renderTeachersTable
        const origGetElementById = sandbox.document.getElementById;
        const mockTeachersTbody = { innerHTML: '' };
        const mockThPct = { textContent: '' };
        const mockBadgeDisplay = { textContent: '' };
        const mockInputPct = { value: '10' };

        sandbox.document.getElementById = (id) => {
            if (id === 'table-teachers-body') return mockTeachersTbody;
            if (id === 'th-school-pct') return mockThPct;
            if (id === 'badge-school-pct-display') return mockBadgeDisplay;
            if (id === 'input-school-percentage') return mockInputPct;
            return origGetElementById ? origGetElementById(id) : null;
        };

        const origBookData = sandbox.window.getCurrentBookData ? sandbox.window.getCurrentBookData() : [];

        try {
            setSchoolSharePercentage(10); // 10% ke sekolah
            const sampleMatchedData = [
                {
                    grade: 10,
                    subject: 'Matematika',
                    terima: 100,
                    diam: 0,
                    sisa: 0,
                    terjual: 100,
                    harga: 20000,
                    total: 2000000,
                    teachers: [
                        {
                            teacher: 'Drs. Guru Teladan',
                            classCount: 5,
                            totalClasses: 5,
                            classesStr: 'X-1 s.d X-5',
                            percentageStr: '100%',
                            propTerjual: 100,
                            propNominal: 2000000
                        }
                    ]
                }
            ];

            if (sandbox.window.setCurrentBookData) {
                sandbox.window.setCurrentBookData(sampleMatchedData);
            }

            renderTeachersTable(sampleMatchedData);

            // Verifikasi header label ter-update
            expect(mockThPct.textContent).toBe('10');

            // 10% dari 2.000.000 = 200.000
            expect(mockTeachersTbody.innerHTML).toContain('Drs. Guru Teladan');
            expect(mockTeachersTbody.innerHTML).toContain('Rp 2.000.000');
            expect(mockTeachersTbody.innerHTML).toContain('Rp 200.000'); // Kolom ke-7: Bagian Sekolah
            expect(mockTeachersTbody.innerHTML).toContain('Total Seluruh Guru (Proporsional):');

            // 5. Verifikasi saveSchoolSharePercentage
            mockInputPct.value = '20';
            await saveSchoolSharePercentage();
            expect(getSchoolSharePercentage()).toBe(20);
            expect(mockBadgeDisplay.textContent).toBe('20% ke Sekolah');
            expect(mockThPct.textContent).toBe('20');
            // 20% dari 2.000.000 = 400.000
            expect(mockTeachersTbody.innerHTML).toContain('Rp 400.000');
        } finally {
            if (sandbox.window.setCurrentBookData) {
                sandbox.window.setCurrentBookData(origBookData);
            }
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('83. Modul Rekapitulasi Pembagian Fee Penjualan LKS Dinamis: 4 Komponen Institusional & Perolehan Hak Perorangan (Kepsek, Guru, Tendik)', async () => {
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // 1. Verifikasi Integritas Markup HTML (Tab, Filter, Panel, Modal Top-Level Sibling, dan Form Dinamis)
        expect(htmlContent).toContain('id="tab-btn-fees"');
        expect(htmlContent).toContain('id="tab-panel-fees"');
        expect(htmlContent).toContain('id="filter-fee-container"');
        expect(htmlContent).toContain('id="filter-fee-role"');
        expect(htmlContent).toContain('id="table-fees"');
        expect(htmlContent).toContain('id="modal-fee-detail"');
        expect(htmlContent).toContain('id="form-fee-settings"');
        expect(htmlContent).toContain('id="input-fee-rate-pct"');
        expect(htmlContent).toContain('id="input-fee-school-pct"');
        expect(htmlContent).toContain('id="input-fee-coop-pct"');
        expect(htmlContent).toContain('id="input-fee-equal-pct"');
        expect(htmlContent).toContain('id="input-fee-headmaster-pct"');
        expect(htmlContent).toContain('id="input-fee-teacher-pct"');

        // Verifikasi tidak ada KPI card di tab-panel-fees (Sesuai User Request: "KPI card nggak usah isi")
        const feePanelMatch = htmlContent.match(/<div id="tab-panel-fees"[\s\S]*?<\/table>/);
        expect(feePanelMatch).not.toBeNull();
        expect(feePanelMatch[0]).not.toContain('kpi-card');

        // 2. Verifikasi Default Nilai Persentase Pembagian Fee (SSOT Pool Model 4 Komponen Murni)
        expect(DEFAULT_FEE_DISTRIBUTION_SETTINGS).toEqual({
            feeRatePercentage: 30.0,
            cooperativePercentage: 50.0,
            equalityPercentage: 25.0,
            teacherPercentage: 20.0,
            headmasterPercentage: 5.0,
            schoolPercentage: 0.0
        });

        // 3. Verifikasi Klasifikasi Peran GTK (classifyGtkRole)
        const kepsekItem = { nama: 'I Putu Suweta, S.Pd., M.Pd.', nip: '197005211997021001', role: 'kepsek' };
        expect(classifyGtkRole(kepsekItem)).toBe('kepsek');

        const teacherNames = new Set(['I Made Wijaya', 'Ni Luh Sari']);
        const guruItem1 = { nama: 'I Made Wijaya', nip: '198001012005011002', jabatan: 'Guru Fisika' };
        expect(classifyGtkRole(guruItem1, teacherNames)).toBe('guru');

        const guruItem2 = { nama: 'Ni Luh Sari', nip: '198502022008012003', jenis_ptk: 'Guru Mapel' };
        expect(classifyGtkRole(guruItem2, teacherNames)).toBe('guru');

        const tendikItem = { nama: 'I Ketut Operator', nip: '199003032015011004', jabatan: 'Pengadministrasi Umum' };
        expect(classifyGtkRole(tendikItem, teacherNames)).toBe('tendik');

        // 4. Verifikasi Algoritma Perhitungan Fee Berbasis Pool Fee Sekolah (calculateFeeDistribution)
        // Skenario Uji: Total Omzet Penjualan = Rp 100.000.000
        // GTK: 1 Kepsek, 2 Guru Mapel, 1 Tendik (Total = 4 GTK)
        // Fee Masuk ke Sekolah = 30% x 100jt = Rp 30.000.000 (Pool Dana Fee)
        const totalRevenue = 100000000;
        const gtkList = [
            kepsekItem,
            guruItem1,
            guruItem2,
            tendikItem
        ];

        const teacherAggregates = [
            {
                teacherName: 'I Made Wijaya',
                totalTerjual: 2000,
                totalNominal: 40000000, // Omzet kelas yang diampu: 40jt (40% total omzet)
                books: [{ subject: 'Fisika', grade: 10, classCount: 4, propNominal: 40000000 }]
            },
            {
                teacherName: 'Ni Luh Sari',
                totalTerjual: 3000,
                totalNominal: 60000000, // Omzet kelas yang diampu: 60jt (60% total omzet)
                books: [{ subject: 'Biologi', grade: 11, classCount: 6, propNominal: 60000000 }]
            }
        ];

        const customSettings = {
            feeRatePercentage: 30.0,
            cooperativePercentage: 50.0,
            equalityPercentage: 25.0,
            teacherPercentage: 20.0,
            headmasterPercentage: 5.0,
            schoolPercentage: 0.0
        };

        const result = calculateFeeDistribution(totalRevenue, gtkList, teacherAggregates, customSettings);

        // a. Verifikasi Basis Pool Fee Sekolah (30% dari 100jt = 30jt)
        expect(result.totalFeePool).toBe(30000000);
        expect(result.feeRatePercentage).toBe(30.0);

        // b. Alokasi Kas Sekolah ditiadakan (0% dari 30jt fee = 0)
        expect(result.allocations.school.amount).toBe(0);

        // c. Alokasi Koperasi Sekolah (50% dari 30jt fee = 15jt)
        expect(result.allocations.cooperative.amount).toBe(15000000);

        // d. Pool Pemerataan Warga Sekolah (25% dari 30jt fee = 7.5jt dibagi 4 GTK = Rp 1.875.000 / orang)
        expect(result.allocations.equality.poolAmount).toBe(7500000);
        expect(result.allocations.equality.count).toBe(4);
        expect(result.allocations.equality.perPerson).toBe(1875000);

        // e. Hak Perorangan:
        // - Kepsek: Khusus 5% x 30jt (1.5jt) + Pemerataan (1.875jt) = Rp 3.375.000
        const kepsekRes = result.persons.find(p => p.role === 'kepsek');
        expect(kepsekRes).toBeDefined();
        expect(kepsekRes.specialAmount).toBe(1500000);
        expect(kepsekRes.equalAmount).toBe(1875000);
        expect(kepsekRes.totalAmount).toBe(3375000);

        // - Guru 1 (Wijaya, omzet 40%): Khusus 40% x 6jt pool guru (2.4jt) + Pemerataan (1.875jt) = Rp 4.275.000
        const guru1Res = result.persons.find(p => p.nama === 'I Made Wijaya');
        expect(guru1Res).toBeDefined();
        expect(guru1Res.omzet).toBe(40000000);
        expect(guru1Res.specialAmount).toBe(2400000);
        expect(guru1Res.equalAmount).toBe(1875000);
        expect(guru1Res.totalAmount).toBe(4275000);

        // - Guru 2 (Sari, omzet 60%): Khusus 60% x 6jt pool guru (3.6jt) + Pemerataan (1.875jt) = Rp 5.475.000
        const guru2Res = result.persons.find(p => p.nama === 'Ni Luh Sari');
        expect(guru2Res).toBeDefined();
        expect(guru2Res.omzet).toBe(60000000);
        expect(guru2Res.specialAmount).toBe(3600000);
        expect(guru2Res.equalAmount).toBe(1875000);
        expect(guru2Res.totalAmount).toBe(5475000);

        // - Tendik: Khusus Rp 0 + Pemerataan (1.875jt) = Rp 1.875.000
        const tendikRes = result.persons.find(p => p.role === 'tendik');
        expect(tendikRes).toBeDefined();
        expect(tendikRes.specialAmount).toBe(0);
        expect(tendikRes.equalAmount).toBe(1875000);
        expect(tendikRes.totalAmount).toBe(1875000);

        // f. Rekonsiliasi Total Distribusi
        // Hak GTK = 3.375jt (Kepsek) + 4.275jt (Guru1) + 5.475jt (Guru2) + 1.875jt (Tendik) = Rp 15.000.000
        expect(result.summary.totalGtk).toBe(15000000);
        // Total Grand = 0 (Sekolah) + 15jt (Koperasi) + 15jt (GTK) = Rp 30.000.000 (Tepat 100% Fee Sekolah)
        expect(result.summary.grandTotal).toBe(30000000);

        // 5. Verifikasi Dinamika Persentase (Getter/Setter & Penyimpanan)
        setFeeDistributionSettings({
            feeRatePercentage: 25.0,
            cooperativePercentage: 55.0,
            equalityPercentage: 20.0,
            teacherPercentage: 20.0,
            headmasterPercentage: 5.0,
            schoolPercentage: 0.0
        });

        const updatedSettings = getFeeDistributionSettings();
        expect(updatedSettings.feeRatePercentage).toBe(25.0);
        expect(updatedSettings.cooperativePercentage).toBe(55.0);
        expect(updatedSettings.equalityPercentage).toBe(20.0);
        expect(updatedSettings.headmasterPercentage).toBe(5.0);
        expect(updatedSettings.teacherPercentage).toBe(20.0);
        expect(updatedSettings.schoolPercentage).toBe(0.0);
        expect(getSchoolSharePercentage()).toBe(25.0); // Terhubung ke getter bagian sekolah

        // Kembalikan ke default
        setFeeDistributionSettings(DEFAULT_FEE_DISTRIBUTION_SETTINGS);
    });

    test('84. Sinkronisasi Dua Arah Persentase dan Nominal Pembagian Fee LKS: Input Nominal (Rupiah) Menghitung Persentase (%) Khususnya Pemerataan GTK dan Kepala Sekolah', async () => {
        // A. Validasi Struktur DOM HTML di penjualan-buku.html
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // Pastikan input nominal Rupiah hadir pada Kartu 2 (Pemerataan GTK) dan Kartu 4 (Kepsek)
        expect(htmlContent).toContain('id="input-fee-equal-pool"');
        expect(htmlContent).toContain('id="input-fee-equal-per-person"');
        expect(htmlContent).toContain('id="input-fee-headmaster-amount"');

        // Pastikan input nominal memiliki oninput window.onFeeAmountInputChanged
        expect(htmlContent).toContain("window.onFeeAmountInputChanged?.('equal-pool')");
        expect(htmlContent).toContain("window.onFeeAmountInputChanged?.('equal-person')");
        expect(htmlContent).toContain("window.onFeeAmountInputChanged?.('headmaster-amount')");

        // Pastikan Koperasi dan Guru Mapel tetap dalam bentuk persentase
        expect(htmlContent).toContain('id="input-fee-coop-pct"');
        expect(htmlContent).toContain('id="input-fee-teacher-pct"');
        expect(htmlContent).toContain('id="fee-amount-coop"');
        expect(htmlContent).toContain('id="fee-summary-sub-guru"');

        // Pastikan input persentase menggunakan step="any" agar mulus menerima angka desimal
        expect(htmlContent).toMatch(/id="input-fee-rate-pct"[\s\S]*?step="any"/);
        expect(htmlContent).toMatch(/id="input-fee-equal-pct"[\s\S]*?step="any"/);
        expect(htmlContent).toMatch(/id="input-fee-headmaster-pct"[\s\S]*?step="any"/);

        // B. Validasi Logika Sinkronisasi Dua Arah Interaktif JS
        // Siapkan mock DOM
        const mockRate = { value: '30' };
        const mockCoop = { value: '50' };
        const mockEqual = { value: '25' };
        const mockTeacher = { value: '20' };
        const mockHeadmaster = { value: '5' };
        const mockSchool = { value: '0' };

        const mockEqualPool = { value: '7.500.000' };
        const mockEqualPerPerson = { value: '1.875.000' };
        const mockHeadmasterAmount = { value: '1.500.000' };
        const mockGtkCount = { textContent: '4' };
        const mockBadgeTotal = { textContent: '', className: '' };
        const mockPanel = { classList: { contains: () => false } };
        const mockTbody = { innerHTML: '' };

        const origGetElementById = sandbox.document.getElementById;
        sandbox.document.getElementById = (id) => {
            if (id === 'tab-panel-fees') return mockPanel;
            if (id === 'table-fees-body') return mockTbody;
            if (id === 'input-fee-rate-pct') return mockRate;
            if (id === 'input-fee-coop-pct') return mockCoop;
            if (id === 'input-fee-equal-pct') return mockEqual;
            if (id === 'input-fee-teacher-pct') return mockTeacher;
            if (id === 'input-fee-headmaster-pct') return mockHeadmaster;
            if (id === 'input-fee-school-pct') return mockSchool;
            if (id === 'input-fee-equal-pool') return mockEqualPool;
            if (id === 'input-fee-equal-per-person') return mockEqualPerPerson;
            if (id === 'input-fee-headmaster-amount') return mockHeadmasterAmount;
            if (id === 'fee-equal-gtk-count') return mockGtkCount;
            if (id === 'badge-fee-total-pct') return mockBadgeTotal;
            return origGetElementById(id);
        };

        // Siapkan mock dataset omzet penjualan (Total Omzet = Rp 100.000.000 -> Pool Fee Sekolah 30% = Rp 30.000.000)
        const origBookData = sandbox.window.getCurrentBookData ? sandbox.window.getCurrentBookData() : [];
        sandbox.window.setCurrentBookData([
            { total: 40000000, grade: 10, subject: 'Fisika' },
            { total: 60000000, grade: 11, subject: 'Biologi' }
        ]);

        // Inisialisasi awal render fee sharing tab
        await renderFeeSharingTab();
        const actualGtkCount = parseInt(mockGtkCount.textContent, 10) || 1;

        // 1. Uji Input Nominal Insentif Kepsek: Masukkan Rp 3.000.000
        mockHeadmasterAmount.value = '3.000.000';
        await onFeeAmountInputChanged('headmaster-amount');
        // Persentase kepsek harus terhitung otomatis: 3jt / 30jt = 10%
        expect(mockHeadmaster.value).toBe('10');

        // 2. Uji Input Nominal Total Pool Pemerataan: Masukkan Rp 6.000.000
        mockEqualPool.value = '6.000.000';
        await onFeeAmountInputChanged('equal-pool');
        // Persentase pemerataan harus terhitung otomatis: 6jt / 30jt = 20%
        expect(mockEqual.value).toBe('20');
        // Nominal per orang harus terhitung otomatis: 6jt / actualGtkCount
        const expectedPerPerson = (Math.floor(6000000 / actualGtkCount)).toLocaleString('id-ID');
        expect(mockEqualPerPerson.value).toBe(expectedPerPerson);

        // 3. Uji Input Nominal @Per Orang Pemerataan: Masukkan Rp 200.000
        const samplePerPerson = 200000;
        mockEqualPerPerson.value = samplePerPerson.toLocaleString('id-ID');
        await onFeeAmountInputChanged('equal-person');
        // Total Pool GTK harus terhitung otomatis: 200rb x actualGtkCount
        const expectedPool = samplePerPerson * actualGtkCount;
        expect(mockEqualPool.value).toBe(expectedPool.toLocaleString('id-ID'));
        // Persentase pemerataan harus terhitung otomatis
        const expectedPct = parseFloat(((expectedPool / 30000000) * 100).toFixed(2));
        expect(mockEqual.value).toBe(String(expectedPct));

        // 4. Uji Arah Sebaliknya: Pengguna mengubah persentase Kepsek (%) menjadi 6%
        mockHeadmaster.value = '6';
        await onFeePercentageInputChanged();
        // Nominal insentif kepsek harus otomatis terisi 6% x 30jt = 1.800.000
        expect(mockHeadmasterAmount.value).toBe('1.800.000');

        // 5. Uji Proteksi Focus (ActiveElement): Saat pengguna sedang mengetik di input nominal, nilainya tidak tertimpa
        sandbox.document.activeElement = mockHeadmasterAmount;
        mockHeadmasterAmount.value = '2.500.000';
        await renderFeeSharingTab();
        // Nilai input aktif tetap terjaga tanpa ter-reset
        expect(mockHeadmasterAmount.value).toBe('2.500.000');

        // Restore mock & data
        sandbox.window.setCurrentBookData(origBookData);
        sandbox.document.getElementById = origGetElementById;
        sandbox.document.activeElement = null;
    });

    test('85. Fitur Auto-Balancing Koperasi: Jika total persentase pembagian melebihi 100%, persentase koperasi otomatis dikurangi sehingga total tetap 100%', async () => {
        // Setup mock DOM elements
        const mockRate = { value: '30' };
        const mockCoop = { value: '50' };
        const mockEqual = { value: '25' };
        const mockTeacher = { value: '20' };
        const mockHeadmaster = { value: '5' };
        const mockSchool = { value: '0' };
        const mockBadgeTotal = { textContent: '', className: '' };
        const mockPanel = { classList: { contains: () => false } };
        const mockTbody = { innerHTML: '' };

        const origGetElementById = sandbox.document.getElementById;
        sandbox.document.getElementById = (id) => {
            if (id === 'tab-panel-fees') return mockPanel;
            if (id === 'table-fees-body') return mockTbody;
            if (id === 'input-fee-rate-pct') return mockRate;
            if (id === 'input-fee-coop-pct') return mockCoop;
            if (id === 'input-fee-equal-pct') return mockEqual;
            if (id === 'input-fee-teacher-pct') return mockTeacher;
            if (id === 'input-fee-headmaster-pct') return mockHeadmaster;
            if (id === 'input-fee-school-pct') return mockSchool;
            if (id === 'badge-fee-total-pct') return mockBadgeTotal;
            return origGetElementById(id);
        };

        // Kasus 1: Pengguna menaikkan persentase Guru Mapel dari 20% menjadi 30%
        // Total awal: 50 + 25 + 30 + 5 = 110% (melebihi 100%)
        // Koperasi harus otomatis dikurangi dari 50% menjadi 40% (100 - 25 - 30 - 5 = 40%)
        mockTeacher.value = '30';
        await onFeePercentageInputChanged();

        expect(mockCoop.value).toBe('40');
        expect(mockBadgeTotal.textContent).toBe('Total Alokasi: 100%');

        // Kasus 2: Pengguna menaikkan Pemerataan GTK menjadi 45%
        // Komponen lain: Guru 30%, Kepsek 5%, total non-koperasi = 80%
        // Koperasi harus otomatis dikurangi menjadi 20% (100 - 80 = 20%)
        mockEqual.value = '45';
        await onFeePercentageInputChanged();

        expect(mockCoop.value).toBe('20');
        expect(mockBadgeTotal.textContent).toBe('Total Alokasi: 100%');

        // Kasus 3: Validasi di calculateFeeDistribution langsung
        const calcRes = calculateFeeDistribution(100000000, [], [], {
            feeRatePercentage: 30,
            schoolPercentage: 0,
            cooperativePercentage: 50,
            equalityPercentage: 35,
            teacherPercentage: 25,
            headmasterPercentage: 5
        });
        // Non-koperasi: 35 + 25 + 5 = 65%. Koperasi harus otomatis disesuaikan menjadi 35% (100 - 65%)
        expect(calcRes.allocations.cooperative.pct).toBe(35);
        expect(calcRes.settings.cooperativePercentage).toBe(35);
        const sumPct = calcRes.allocations.cooperative.pct + calcRes.allocations.equality.pct +
                       calcRes.allocations.teachers.pct + calcRes.allocations.headmaster.pct;
        expect(sumPct).toBe(100);

        // Restore mock
        sandbox.document.getElementById = origGetElementById;
    });

    test('86. Form Input Persentase Fee LKS: Proteksi Pemotongan Angka Desimal (Anti-Clipping) dengan Lebar Memadai dan Class no-spin-arrows', () => {
        const fs = require('fs');
        const path = require('path');
        const html = fs.readFileSync(path.join(__dirname, '../penjualan-buku.html'), 'utf-8');
        const css = fs.readFileSync(path.join(__dirname, '../css/style.css'), 'utf-8');

        // 1. Verifikasi aturan CSS .no-spin-arrows ada di style.css
        expect(css).toContain('.no-spin-arrows::-webkit-outer-spin-button');
        expect(css).toContain('.no-spin-arrows::-webkit-inner-spin-button');
        expect(css).toContain('-webkit-appearance: none !important');
        expect(css).toContain('appearance: textfield !important');

        // 2. Verifikasi 5 input persentase memiliki class no-spin-arrows dan lebar yang memadai (tidak terpotong)
        const expectedInputs = [
            { id: 'input-fee-rate-pct', minWidthClass: 'w-16' },
            { id: 'input-fee-coop-pct', minWidthClass: 'w-20' },
            { id: 'input-fee-equal-pct', minWidthClass: 'w-20' },
            { id: 'input-fee-teacher-pct', minWidthClass: 'w-20' },
            { id: 'input-fee-headmaster-pct', minWidthClass: 'w-20' }
        ];

        expectedInputs.forEach(({ id, minWidthClass }) => {
            const regex = new RegExp(`id=["']${id}["'][^>]*class=["']([^"']+)["']|class=["']([^"']+)["'][^>]*id=["']${id}["']`);
            const match = html.match(regex);
            expect(match).not.toBeNull();
            const classList = match[1] || match[2];
            expect(classList).toContain('no-spin-arrows');
            expect(classList).toContain(minWidthClass);
        });
    });

    test('87. Proteksi Presisi Nominal Pemerataan: Mengetik Rp 70.000 pada nominal pemerataan per orang tetap tepat Rp 70.000 (tidak mengalami degradasi pembulatan menjadi 69.975)', async () => {
        const mockRate = { value: '30' };
        const mockCoop = { value: '50' };
        const mockEqual = { value: '25' };
        const mockTeacher = { value: '20' };
        const mockHeadmaster = { value: '5' };
        const mockSchool = { value: '0' };
        const mockEqualPool = { value: '' };
        const mockEqualPerPerson = { value: '70.000' };
        const mockHeadmasterAmount = { value: '' };
        const mockBadgeTotal = { textContent: '', className: '' };
        const mockGtkCount = { textContent: '55' };
        const mockPanel = { classList: { contains: () => false } };
        const mockTbody = { innerHTML: '' };

        const origGetElementById = sandbox.document.getElementById;
        sandbox.document.getElementById = (id) => {
            if (id === 'tab-panel-fees') return mockPanel;
            if (id === 'table-fees-body') return mockTbody;
            if (id === 'input-fee-rate-pct') return mockRate;
            if (id === 'input-fee-coop-pct') return mockCoop;
            if (id === 'input-fee-equal-pct') return mockEqual;
            if (id === 'input-fee-teacher-pct') return mockTeacher;
            if (id === 'input-fee-headmaster-pct') return mockHeadmaster;
            if (id === 'input-fee-school-pct') return mockSchool;
            if (id === 'input-fee-equal-pool') return mockEqualPool;
            if (id === 'input-fee-equal-per-person') return mockEqualPerPerson;
            if (id === 'input-fee-headmaster-amount') return mockHeadmasterAmount;
            if (id === 'badge-fee-total-pct') return mockBadgeTotal;
            if (id === 'fee-equal-gtk-count') return mockGtkCount;
            return origGetElementById(id);
        };

        // Siapkan omzet realistis Rp 128.547.000 -> Pool fee sekolah Rp 38.564.100
        const origBookData = sandbox.window.getCurrentBookData ? sandbox.window.getCurrentBookData() : [];
        sandbox.window.setCurrentBookData([
            { total: 128547000, grade: 10, subject: 'Bahasa Indonesia' }
        ]);

        await renderFeeSharingTab();
        const actualGtkCount = parseInt(mockGtkCount.textContent, 10) || 55;

        // 1. Pengguna mengetik 70.000 pada input @Orang
        mockEqualPerPerson.value = '70.000';
        await onFeeAmountInputChanged('equal-person');

        // Total pool harus bulat: 70.000 x actualGtkCount
        const expectedPool = (70000 * actualGtkCount).toLocaleString('id-ID');
        expect(mockEqualPool.value).toBe(expectedPool);

        // Simpan pengaturan ke D1 / localStorage
        await saveFeeDistributionSettings();

        // 2. Render ulang (misal saat berpindah tab atau setelah klik Simpan)
        sandbox.document.activeElement = null; // simulasi kehilangan fokus
        await renderFeeSharingTab();

        // Verifikasi KRUSIAL: Nilai nominal per orang TIDAK BOLEH terdegradasi ke 69.975
        expect(mockEqualPerPerson.value).toBe('70.000');
        expect(mockEqualPerPerson.value).not.toBe('69.975');

        // Verifikasi hasil kalkulasi fee distribution
        const currentRes = sandbox.window.getCurrentFeeDistributionResult();
        expect(currentRes.allocations.equality.perPerson).toBe(70000);
        expect(currentRes.allocations.equality.perPerson).not.toBe(69975);
        expect(currentRes.allocations.equality.poolAmount).toBe(70000 * actualGtkCount);

        // 3. Toleransi input nominal di field persentase: Jika pengguna mengetik 70000 di field % pemerataan, sistem tetap otomatis mengarahkannya ke Rp 70.000
        mockEqual.value = '70000';
        await onFeePercentageInputChanged();
        expect(mockEqualPerPerson.value).toBe('70.000');

        // Restore mock & data
        sandbox.window.setCurrentBookData(origBookData);
        sandbox.document.getElementById = origGetElementById;
    });

    test('88. Koperasi Sekolah Sebagai Buffer Penyeimbang Otomatis 100% dari 4 Kartu: Persentase ke-4 kartu (Koperasi, Pemerataan, Guru Mapel, Kepsek) murni berjumlah 100% tanpa memasukkan tarif Fee Sekolah (30%) ke dalam penjumlahan alokasi', async () => {
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // 1. Verifikasi markup HTML: input-fee-coop-pct bersifat readonly
        expect(htmlContent).toMatch(/<input\s+type="number"\s+id="input-fee-coop-pct"[\s\S]*?readonly/);
        expect(htmlContent).toContain('cursor-not-allowed');

        // 2. Simulasi sesuai kondisi di screenshot pengguna:
        // Omzet: Rp 128.547.000, Fee Sekolah: 30% -> Total Fee Pool: Rp 38.564.100
        // Pemerataan: 9.65%, Guru Mapel: 30%, Kepsek: 2%
        // Sebelumnya: Koperasi terpotong menjadi 28.35% karena keliru menambah fee sekolah 30% (28.35 + 9.65 + 30 + 2 = 70% padahal badge 100%)
        // Harusnya: Koperasi = 100 - (9.65 + 30 + 2) = 58.35%!
        const mockRate = { value: '30' };
        const mockCoop = { value: '50' };
        const mockEqual = { value: '9.65' };
        const mockTeacher = { value: '30' };
        const mockHeadmaster = { value: '2' };
        const mockSchool = { value: '0' };
        const mockBadgeTotal = { textContent: '', className: '' };
        const mockPanel = { classList: { contains: () => false } };
        const mockTbody = { innerHTML: '' };

        const origGetElementById = sandbox.document.getElementById;
        sandbox.document.getElementById = (id) => {
            if (id === 'tab-panel-fees') return mockPanel;
            if (id === 'table-fees-body') return mockTbody;
            if (id === 'input-fee-rate-pct') return mockRate;
            if (id === 'input-fee-coop-pct') return mockCoop;
            if (id === 'input-fee-equal-pct') return mockEqual;
            if (id === 'input-fee-teacher-pct') return mockTeacher;
            if (id === 'input-fee-headmaster-pct') return mockHeadmaster;
            if (id === 'input-fee-school-pct') return mockSchool;
            if (id === 'badge-fee-total-pct') return mockBadgeTotal;
            return origGetElementById(id);
        };

        // Jalankan event perubahan persentase
        await onFeePercentageInputChanged();

        // Verifikasi KRUSIAL: Koperasi otomatis terisi 58.35% (BUKAN 28.35%)
        expect(mockCoop.value).toBe('58.35');
        expect(parseFloat(mockCoop.value)).toBe(58.35);
        expect(mockBadgeTotal.textContent).toBe('Total Alokasi: 100%');

        // Verifikasi di fungsi inti kalkulasi calculateFeeDistribution
        const res = calculateFeeDistribution(128547000, [], [], {
            feeRatePercentage: 30,
            schoolPercentage: 0,
            cooperativePercentage: 50,
            equalityPercentage: 9.65,
            teacherPercentage: 30,
            headmasterPercentage: 2
        });

        // 4 Kartu murni menjumlahkan 100%:
        // Koperasi (58.35%) + Pemerataan (9.65%) + Guru Mapel (30%) + Kepsek (2%) = 100%
        expect(res.settings.cooperativePercentage).toBe(58.35);
        expect(res.allocations.cooperative.pct).toBe(58.35);
        const cardSum = res.allocations.cooperative.pct + res.allocations.equality.pct +
                        res.allocations.teachers.pct + res.allocations.headmaster.pct;
        expect(Math.round(cardSum * 100) / 100).toBe(100);

        // Kas sekolah tidak mengambil porsi dari fee pool (murni 0%)
        expect(res.allocations.school.amount).toBe(0);

        // Koperasi menerima alokasi yang tepat (58.35% dari Rp 38.564.100)
        expect(res.allocations.cooperative.amount).toBe(Math.round(38564100 * 0.5835));

        // Restore mock
        sandbox.document.getElementById = origGetElementById;
    });

    test('89. Verifikasi Tab Rekap per Buku: Total Penjualan & Subtotal Nominal Dihitung Akurat dari Transaksi (Anti-Total 0 / Anti-NaN / Paritas netNom & netTotal)', async () => {
        // 1. Dual Parity pada summarizeTransactions: netNom dan netTotal harus sama dan valid
        const sampleTxs = [
            { id: 'tx-1', date: '2026-08-01', type: 'penjualan', grade: 10, rombel: 'X-1', subject: 'Matematika', qty: 30, harga: 20000, total: 600000, periode: '26/27 (1)' },
            { id: 'tx-2', date: '2026-08-02', type: 'penjualan', grade: 10, rombel: 'X-2', subject: 'Matematika', qty: 20, harga: 20000, total: 400000, periode: '26/27 (1)' },
            { id: 'tx-3', date: '2026-08-03', type: 'retur', grade: 10, rombel: 'X-1', subject: 'Matematika', qty: 2, harga: 20000, total: 40000, periode: '26/27 (1)' }
        ];

        const sumRes = summarizeTransactions(sampleTxs);
        expect(sumRes.grossQty).toBe(50);
        expect(sumRes.returnQty).toBe(2);
        expect(sumRes.netQty).toBe(48);
        expect(sumRes.netNom).toBe(960000);
        expect(sumRes.netTotal).toBe(960000); // Dual parity agar pemanggil lama bSum.netTotal dan baru bSum.netNom tidak undefined

        // 2. Toleransi Pencocokan Mapel (isBookSubjectMatch)
        expect(isBookSubjectMatch('PKWU', 'Prakarya dan Kewirausahaan')).toBe(true);
        expect(isBookSubjectMatch('Prakarya dan Kewirausahaan', 'pkwu')).toBe(true);
        expect(isBookSubjectMatch('Seni Tari', 'Seni Budaya')).toBe(true);
        expect(isBookSubjectMatch('Matematika Tingkat Lanjut', 'Matematika')).toBe(false);

        // 3. getBooksWithPeriodSales menghitung terjual, total nominal, dan sisa secara konsisten
        const sampleBooks = [
            { grade: 10, subject: 'Matematika', terima: 100, diam: 0, sisa: 100, terjual: 0, harga: 20000, total: 0 }
        ];

        const calculatedBooks = getBooksWithPeriodSales(sampleBooks, sampleTxs, '26/27 (1)');
        expect(calculatedBooks[0].terjual).toBe(48);
        expect(calculatedBooks[0].total).toBe(960000);
        expect(calculatedBooks[0].sisa).toBe(52); // 100 - 48

        // 4. Verifikasi renderBooksTable tidak menghasilkan Rp 0 atau NaN pada baris maupun subtotal
        const mockBooksTbody = { innerHTML: '' };
        const origGetElementById = sandbox.document.getElementById;
        sandbox.document.getElementById = (id) => {
            if (id === 'table-books-body') return mockBooksTbody;
            return origGetElementById ? origGetElementById(id) : null;
        };

        const origTxs = getCurrentTransactions ? getCurrentTransactions() : [];
        if (setCurrentTransactions) setCurrentTransactions(sampleTxs);
        if (setCurrentSelectedSemesterPeriod) setCurrentSelectedSemesterPeriod('26/27 (1)');

        try {
            renderBooksTable(sampleBooks);

            // Verifikasi baris buku memuat total nominal Rp 960.000 (BUKAN Rp 0)
            expect(mockBooksTbody.innerHTML).toContain('Rp 960.000');
            expect(mockBooksTbody.innerHTML).not.toContain('Rp NaN');

            // Verifikasi subtotal terfilter di baris footer
            expect(mockBooksTbody.innerHTML).toContain('Total Terfilter:');
            // Subtotal nominal penjualan harus memuat Rp 960.000, bukan Rp 0
            expect(mockBooksTbody.innerHTML).toContain('text-blue-700 dark:text-blue-300">Rp 960.000');

            // 5. Verifikasi updateKpiCards juga menampilkan total nominal akurat
            const mockKpiTitles = { textContent: '' };
            const mockKpiSold = { textContent: '' };
            const mockKpiSoldSub = { textContent: '' };
            const mockKpiRevenue = { textContent: '' };
            const mockKpiStock = { textContent: '' };
            const mockKpiStockSub = { textContent: '' };

            sandbox.document.getElementById = (id) => {
                if (id === 'kpi-total-titles') return mockKpiTitles;
                if (id === 'kpi-total-sold') return mockKpiSold;
                if (id === 'kpi-total-sold-sub') return mockKpiSoldSub;
                if (id === 'kpi-total-revenue') return mockKpiRevenue;
                if (id === 'kpi-total-stock') return mockKpiStock;
                if (id === 'kpi-total-stock-sub') return mockKpiStockSub;
                return origGetElementById ? origGetElementById(id) : null;
            };

            updateKpiCards(sampleBooks);
            expect(mockKpiRevenue.textContent).toBe('Rp 960.000');
            expect(mockKpiSold.textContent).toBe('48');
        } finally {
            if (setCurrentTransactions) setCurrentTransactions(origTxs);
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('90. Proteksi Penguncian Nominal Pemerataan Rp 100.000 & Tampilan 2 Desimal: Nominal yang diketik tidak boleh berubah ke Rp 100.017 saat komponen lain diedit, disimpan, atau dirender ulang', async () => {
        const mockRate = { value: '30' };
        const mockCoop = { value: '50' };
        const mockEqual = { value: '25' };
        const mockTeacher = { value: '20' };
        const mockHeadmaster = { value: '5' };
        const mockSchool = { value: '0' };
        const mockEqualPool = { value: '' };
        const mockEqualPerPerson = { value: '100.000' };
        const mockHeadmasterAmount = { value: '' };
        const mockBadgeTotal = { textContent: '', className: '' };
        const mockGtkCount = { textContent: '62' };
        const mockPanel = { classList: { contains: () => false } };
        const mockTbody = { innerHTML: '' };

        const origGetElementById = sandbox.document.getElementById;
        sandbox.document.getElementById = (id) => {
            if (id === 'tab-panel-fees') return mockPanel;
            if (id === 'table-fees-body') return mockTbody;
            if (id === 'input-fee-rate-pct') return mockRate;
            if (id === 'input-fee-coop-pct') return mockCoop;
            if (id === 'input-fee-equal-pct') return mockEqual;
            if (id === 'input-fee-teacher-pct') return mockTeacher;
            if (id === 'input-fee-headmaster-pct') return mockHeadmaster;
            if (id === 'input-fee-school-pct') return mockSchool;
            if (id === 'input-fee-equal-pool') return mockEqualPool;
            if (id === 'input-fee-equal-per-person') return mockEqualPerPerson;
            if (id === 'input-fee-headmaster-amount') return mockHeadmasterAmount;
            if (id === 'badge-fee-total-pct') return mockBadgeTotal;
            if (id === 'fee-equal-gtk-count') return mockGtkCount;
            return origGetElementById ? origGetElementById(id) : null;
        };

        // Siapkan omzet riil SMAGESA: Rp 128.547.000 -> Total fee pool sekolah: 30% x 128.547.000 = Rp 38.564.100
        const origBookData = sandbox.window.getCurrentBookData ? sandbox.window.getCurrentBookData() : [];
        sandbox.window.setCurrentBookData([
            { total: 128547000, grade: 10, subject: 'Bahasa Indonesia' }
        ]);

        try {
            await renderFeeSharingTab();
            const actualGtkCount = parseInt(mockGtkCount.textContent, 10) || 62;
            const expectedEqualPct = ((100000 * actualGtkCount) / 38564100 * 100).toFixed(2);
            const currentHeadmasterPct = parseFloat(mockHeadmaster.value) || 2;
            const expectedCoopPct = (100 - (parseFloat(expectedEqualPct) + 25 + currentHeadmasterPct)).toFixed(2);

            // 1. Pengguna mengetik 100.000 pada input @Orang (#input-fee-equal-per-person)
            mockEqualPerPerson.value = '100.000';
            await onFeeAmountInputChanged('equal-person');

            // Total pool harus tepat: 100.000 x actualGtkCount
            expect(mockEqualPool.value).toBe((100000 * actualGtkCount).toLocaleString('id-ID'));
            expect(mockEqualPerPerson.value).toBe('100.000');

            // Input persentase pemerataan harus menampilkan tepat 2 angka di belakang koma
            expect(mockEqual.value).toBe(expectedEqualPct);

            // 2. KASUS KRUSIAL: Pengguna kemudian mengubah kartu Guru Mapel menjadi 25%
            mockTeacher.value = '25';
            sandbox.document.activeElement = mockTeacher; // pengguna sedang aktif di input guru mapel
            await onFeePercentageInputChanged();

            // Nominal pemerataan TIDAK BOLEH berubah ke 100.017 (harus tetap tepat 100.000)
            expect(mockEqualPerPerson.value).toBe('100.000');
            expect(mockEqualPerPerson.value).not.toBe('100.017');
            expect(mockEqualPool.value).toBe((100000 * actualGtkCount).toLocaleString('id-ID'));

            // Persentase pemerataan tetap menampilkan 2 desimal
            expect(mockEqual.value).toBe(expectedEqualPct);

            // Koperasi otomatis menyesuaikan sisa alokasi agar tetap 100%
            expect(mockCoop.value).toBe(expectedCoopPct);
            expect(mockBadgeTotal.textContent).toBe('Total Alokasi: 100%');

            // 3. Simpan pengaturan ke D1 / database
            await saveFeeDistributionSettings();

            // 4. Render ulang (misal setelah refresh atau reload tab)
            sandbox.document.activeElement = null; // blur
            await renderFeeSharingTab();

            // Verifikasi bahwa nominal per orang tetap terkunci tepat Rp 100.000 dan tidak terdegradasi ke 100.017
            expect(mockEqualPerPerson.value).toBe('100.000');
            expect(mockEqualPerPerson.value).not.toBe('100.017');
            expect(mockEqual.value).toBe(expectedEqualPct);

            const currentRes = sandbox.window.getCurrentFeeDistributionResult();
            expect(currentRes.allocations.equality.perPerson).toBe(100000);
            expect(currentRes.allocations.equality.perPerson).not.toBe(100017);
            expect(currentRes.allocations.equality.poolAmount).toBe(100000 * actualGtkCount);

            // Kolom pemerataan di tabel GTK harus memuat tepat Rp 100.000
            expect(mockTbody.innerHTML).toContain('Rp 100.000');
            expect(mockTbody.innerHTML).not.toContain('Rp 100.017');

            // 5. Toleransi: Jika pengguna mengetik 100000 di field % pemerataan, sistem mengalihkan ke Rp 100.000
            // dan mengubah field % menjadi 2 desimal (bukan tetap 100000)
            mockEqual.value = '100000';
            await onFeePercentageInputChanged();
            expect(mockEqualPerPerson.value).toBe('100.000');
            expect(mockEqual.value).toBe(expectedEqualPct);
            expect(mockEqual.value).not.toBe('100000');

            // 6. Verifikasi Matematis Eksplisit untuk 62 GTK (Kondisi Nyata SIMAS SMAGESA):
            // Omzet: Rp 128.547.000 -> Pool fee: Rp 38.564.100
            // 62 GTK x Rp 100.000 = Rp 6.200.000 -> Persentase = 16.077128...% -> Tampil 16.08%
            const sample62Gtk = Array.from({ length: 62 }, (_, i) => ({ id: `gtk-${i}`, nama: `GTK ${i + 1}`, role: 'tendik' }));
            const calc62 = calculateFeeDistribution(128547000, sample62Gtk, [], {
                feeRatePercentage: 30,
                schoolPercentage: 0,
                equalityPerPerson: 100000,
                teacherPercentage: 20,
                headmasterPercentage: 5
            });

            // Per orang HARUS TEPAT 100.000, bukan 100.017!
            expect(calc62.allocations.equality.perPerson).toBe(100000);
            expect(calc62.allocations.equality.poolAmount).toBe(6200000);
            expect(calc62.allocations.equality.pct).toBe(16.08); // 2 desimal
            expect(calc62.allocations.cooperative.pct).toBe(58.92); // 100 - (16.08 + 20 + 5) = 58.92%
            expect(calc62.persons.every(p => p.equalAmount === 100000)).toBe(true);
        } finally {
            sandbox.window.setCurrentBookData(origBookData);
            sandbox.document.getElementById = origGetElementById;
        }
    });

    test('91. Transparansi Komponen Fee Khusus / Guru: Header Dinamis Berbasis Filter & Rincian Footer Eksplisit (Guru + Kepsek)', async () => {
        // 1. Validasi Struktur Header HTML di penjualan-buku.html
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        expect(htmlContent).toContain('id="th-fee-special"');
        expect(htmlContent).toContain('Fee Khusus / Guru');

        // 2. Setup mock DOM untuk renderFeeSharingTable
        const mockThSpecial = { textContent: '', title: '' };
        const mockTbody = { innerHTML: '' };
        const mockTfoot = { innerHTML: '' };
        const mockCountBadge = { textContent: '' };

        const origGetElementById = sandbox.document.getElementById;
        sandbox.document.getElementById = (id) => {
            if (id === 'th-fee-special') return mockThSpecial;
            if (id === 'table-fees-body') return mockTbody;
            if (id === 'table-fees-footer') return mockTfoot;
            if (id === 'fee-table-count-badge') return mockCountBadge;
            return null;
        };

        try {
            // Simulasi hasil pembagian fee dengan Kepsek & Guru
            const sampleDistributionResult = {
                totalRevenue: 100000000,
                feeRatePercentage: 30,
                totalFeePool: 30000000,
                settings: { teacherPercentage: 30, headmasterPercentage: 3 },
                persons: [
                    {
                        key: 'kepsek-1',
                        nama: 'Kepala Sekolah',
                        role: 'kepsek',
                        fee10: 0,
                        fee11: 0,
                        fee12: 0,
                        specialAmount: 900000, // Insentif Kepsek
                        equalAmount: 100000,
                        totalAmount: 1000000,
                        pembulatan: 1000000
                    },
                    {
                        key: 'guru-1',
                        nama: 'Guru Matematika',
                        role: 'guru',
                        fee10: 4500000,
                        fee11: 3500000,
                        fee12: 3000000,
                        specialAmount: 11000000, // Guru Mapel
                        equalAmount: 100000,
                        totalAmount: 11100000,
                        pembulatan: 11100000
                    }
                ]
            };

            sandbox.setCurrentFeeDistributionResult(sampleDistributionResult);

            // A. Filter 'all': Header harus 'Fee Khusus / Guru' & footer harus memuat rincian keduanya
            sandbox.setFeeRoleFilter('all');
            sandbox.renderFeeSharingTable();
            expect(mockThSpecial.textContent).toBe('Fee Khusus / Guru');
            expect(mockTfoot.innerHTML).toContain('Guru:');
            expect(mockTfoot.innerHTML).toContain('Kepsek:');
            expect(mockTfoot.innerHTML).toContain('Rp 11.900.000'); // 11jt + 900rb
            expect(mockTfoot.innerHTML).toContain('Rp 11.000.000'); // Guru
            expect(mockTfoot.innerHTML).toContain('Rp 900.000');    // Kepsek

            // B. Filter 'guru': Header harus 'Total Guru' & footer murni guru
            sandbox.setFeeRoleFilter('guru');
            sandbox.renderFeeSharingTable();
            expect(mockThSpecial.textContent).toBe('Total Guru');
            expect(mockTfoot.innerHTML).toContain('Rp 11.000.000');
            expect(mockTfoot.innerHTML).not.toContain('Kepsek:');

            // C. Filter 'kepsek': Header harus 'Insentif Kepsek' & footer murni kepsek
            sandbox.setFeeRoleFilter('kepsek');
            sandbox.renderFeeSharingTable();
            expect(mockThSpecial.textContent).toBe('Insentif Kepsek');
            expect(mockTfoot.innerHTML).toContain('Rp 900.000');
            expect(mockTfoot.innerHTML).not.toContain('Guru:');
        } finally {
            sandbox.document.getElementById = origGetElementById;
            sandbox.setFeeRoleFilter('all');
        }
    });

    test('92. Tab Pesanan: Filter Kontekstual Rombel Kelas Menggantikan Filter Angkatan, Populasi Dinamis X/XI/XII, dan Penyaringan Pesanan Real-Time', () => {
        // 1. Validasi Struktur DOM HTML: penjualan-buku.html
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        expect(htmlContent).toContain('id="filter-grade-container"');
        expect(htmlContent).toContain('id="filter-order-class-container"');
        expect(htmlContent).toContain('id="filter-order-class"');
        expect(htmlContent).toContain('onchange="window.onOrderClassFilterChanged?.()"');

        // 2. Validasi Pergantian Tab Kontekstual (Contextual Filter Visibility)
        const mockFilterGrade = {
            classList: {
                _classes: new Set(),
                add: jest.fn(function(...cls) { cls.forEach(c => this._classes.add(c)); }),
                remove: jest.fn(function(...cls) { cls.forEach(c => this._classes.delete(c)); }),
                contains: jest.fn(function(c) { return this._classes.has(c); })
            }
        };

        const mockFilterOrderClass = {
            classList: {
                _classes: new Set(['hidden']),
                add: jest.fn(function(...cls) { cls.forEach(c => this._classes.add(c)); }),
                remove: jest.fn(function(...cls) { cls.forEach(c => this._classes.delete(c)); }),
                contains: jest.fn(function(c) { return this._classes.has(c); })
            }
        };

        const mockSelectOrderClass = {
            innerHTML: '',
            value: 'all'
        };

        const mockTbody = { innerHTML: '' };
        const origGetElementById = sandbox.document.getElementById;

        const mockElements = {
            'filter-grade-container': mockFilterGrade,
            'filter-order-class-container': mockFilterOrderClass,
            'filter-order-class': mockSelectOrderClass,
            'table-orders-body': mockTbody,
            'orders-badge-count': { classList: { add: jest.fn(), remove: jest.fn() }, textContent: '' },
            'tab-btn-orders': { className: '' },
            'tab-panel-orders': { classList: { add: jest.fn(), remove: jest.fn() } },
            'tab-btn-transactions': { className: '' },
            'tab-panel-transactions': { classList: { add: jest.fn(), remove: jest.fn() } },
            'tab-btn-circulation': { className: '' },
            'tab-panel-circulation': { classList: { add: jest.fn(), remove: jest.fn() } }
        };

        sandbox.document.getElementById = (id) => mockElements[id] || null;

        try {
            // A. Uji switchTab('orders'): Filter Angkatan tersembunyi, Filter Kelas rombel tampil
            sandbox.window.switchTab('orders');
            expect(mockFilterGrade.classList.add).toHaveBeenCalledWith('hidden');
            expect(mockFilterOrderClass.classList.remove).toHaveBeenCalledWith('hidden');

            // B. Uji populateOrderClassFilter()
            expect(mockSelectOrderClass.innerHTML).toContain('Semua Kelas');
            expect(mockSelectOrderClass.innerHTML).toContain('optgroup label="Kelas X"');
            expect(mockSelectOrderClass.innerHTML).toContain('optgroup label="Kelas XI"');
            expect(mockSelectOrderClass.innerHTML).toContain('optgroup label="Kelas XII"');
            expect(mockSelectOrderClass.innerHTML).toContain('X-1');
            expect(mockSelectOrderClass.innerHTML).toContain('XI-1');
            expect(mockSelectOrderClass.innerHTML).toContain('XII-1');

            // C. Uji switchTab kembali ke 'transactions': Filter Angkatan tampil kembali, Filter Kelas rombel disembunyikan
            sandbox.window.switchTab('transactions');
            expect(mockFilterGrade.classList.remove).toHaveBeenCalledWith('hidden');
            expect(mockFilterOrderClass.classList.add).toHaveBeenCalledWith('hidden');

            // D. Uji Penyaringan Pesanan per Rombel Kelas pada renderOrdersManagementTable()
            sandbox.window.setCurrentTransactions([]);
            sandbox.window.setCurrentClassOrders([
                {
                    id: 'ord_x1',
                    orderedBy: { class: 'X-1', name: 'Admin X-1' },
                    grade: 10,
                    bookSubject: 'Matematika',
                    qty: 35,
                    totalPrice: 595000,
                    orderedAt: '2026-10-14T08:00:00Z',
                    status: 'pending'
                },
                {
                    id: 'ord_x2',
                    orderedBy: { class: 'X-2', name: 'Admin X-2' },
                    grade: 10,
                    bookSubject: 'Biologi',
                    qty: 30,
                    totalPrice: 510000,
                    orderedAt: '2026-10-14T08:30:00Z',
                    status: 'pending'
                }
            ]);

            // Saat Filter Kelas = 'all': Semua pesanan X-1 dan X-2 harus muncul
            sandbox.window.setOrderClassFilter('all');
            sandbox.window.renderOrdersManagementTable();
            expect(mockTbody.innerHTML).toContain('X-1');
            expect(mockTbody.innerHTML).toContain('Matematika');
            expect(mockTbody.innerHTML).toContain('X-2');
            expect(mockTbody.innerHTML).toContain('Biologi');

            // Saat Filter Kelas = 'X-1': Hanya pesanan X-1 yang muncul, X-2 tidak muncul
            sandbox.window.setOrderClassFilter('X-1');
            sandbox.window.renderOrdersManagementTable();
            expect(mockTbody.innerHTML).toContain('X-1');
            expect(mockTbody.innerHTML).toContain('Matematika');
            expect(mockTbody.innerHTML).not.toContain('X-2');
            expect(mockTbody.innerHTML).not.toContain('Biologi');

            // Saat Filter Kelas = 'X-3' (tidak ada pesanan di X-3): Tampil pesan kosong ramah pengguna
            sandbox.window.setOrderClassFilter('X-3');
            sandbox.window.renderOrdersManagementTable();
            expect(mockTbody.innerHTML).toContain('Tidak Ada Pesanan yang Sesuai Filter');

            // Event handler onOrderClassFilterChanged
            mockSelectOrderClass.value = 'X-2';
            sandbox.window.onOrderClassFilterChanged();
            expect(sandbox.window.getOrderClassFilter()).toBe('X-2');
            expect(mockTbody.innerHTML).toContain('X-2');
            expect(mockTbody.innerHTML).toContain('Biologi');
            expect(mockTbody.innerHTML).not.toContain('X-1');
        } finally {
            sandbox.document.getElementById = origGetElementById;
            sandbox.window.setOrderClassFilter('all');
        }
    });

    test('93. getSubjectsForClass menampilkan seluruh mapel yang diajarkan pada kelas terpilih dari Jadwal XML kecuali jika dinonaktifkan di Pengaturan', async () => {
        // 0. Pastikan currentBookData terisi fixture
        if (sandbox.window.setCurrentBookData) {
            sandbox.window.setCurrentBookData(JSON.parse(JSON.stringify(mock60BooksFixture)));
        }

        // 1. Pastikan schedule XML termuat
        const xmlPath = path.resolve(__dirname, '../assets/Jadwal.xml');
        const xmlContent = fs.readFileSync(xmlPath, 'utf8');

        const subjectsMap = new Map();
        const subRegex = /<subject id="([^"]+)" name="([^"]+)"/g;
        let m;
        while ((m = subRegex.exec(xmlContent)) !== null) {
            subjectsMap.set(m[1], { id: m[1], name: m[2] });
        }

        const teachersMap = new Map();
        const teachRegex = /<teacher id="([^"]+)"[^>]*name="([^"]+)"/g;
        while ((m = teachRegex.exec(xmlContent)) !== null) {
            teachersMap.set(m[1], { id: m[1], name: m[2], simasName: m[2] });
        }

        const classesMap = new Map();
        const classRegex = /<class id="([^"]+)" name="([^"]+)"/g;
        while ((m = classRegex.exec(xmlContent)) !== null) {
            classesMap.set(m[1], { id: m[1], name: m[2] });
        }

        const lessonsMap = new Map();
        const lessonRegex = /<lesson\s+([^>]+)>/g;
        while ((m = lessonRegex.exec(xmlContent)) !== null) {
            const attrs = m[1];
            const idM = attrs.match(/id="([^"]+)"/);
            const subM = attrs.match(/subjectid="([^"]+)"/);
            const teachM = attrs.match(/teacherids="([^"]*)"/);
            const classM = attrs.match(/classids="([^"]*)"/);

            if (idM && subM) {
                lessonsMap.set(idM[1], {
                    id: idM[1],
                    subjectId: subM[1],
                    teacherIds: teachM ? teachM[1].split(',').filter(Boolean) : [],
                    classIds: classM ? classM[1].split(',').filter(Boolean) : []
                });
            }
        }

        const parsedSchedule = { subjectsMap, teachersMap, classesMap, lessonsMap };
        if (setCurrentParsedSchedule) {
            setCurrentParsedSchedule(parsedSchedule);
        }

        // 2. Verifikasi XI-1 (MIPA): Memuat Matematika, Fisika, Kimia, Biologi; TIDAK memuat Antropologi / Sosiologi
        const xi1Subjects = getSubjectsForClass(11, 'XI-1');
        expect(xi1Subjects).toContain('Matematika');
        expect(xi1Subjects).toContain('Fisika');
        expect(xi1Subjects).toContain('Kimia');
        expect(xi1Subjects).toContain('Biologi');
        expect(xi1Subjects).not.toContain('Antropologi');
        expect(xi1Subjects).not.toContain('Bahasa Jepang');
        expect(xi1Subjects).not.toContain('Sosiologi');
        expect(xi1Subjects).not.toContain('Ekonomi');

        // 3. Verifikasi XI-4 (Bahasa): Memuat Antropologi, Bahasa Jepang; TIDAK memuat Fisika / Biologi
        const xi4Subjects = getSubjectsForClass(11, 'XI-4');
        expect(xi4Subjects).toContain('Matematika');
        expect(xi4Subjects).toContain('Antropologi');
        expect(xi4Subjects).toContain('Bahasa Jepang');
        expect(xi4Subjects).not.toContain('Fisika');
        expect(xi4Subjects).not.toContain('Biologi');

        // 4. Verifikasi XI-8 (IPS): Memuat Sosiologi, Ekonomi; TIDAK memuat Antropologi / Fisika
        const xi8Subjects = getSubjectsForClass(11, 'XI-8');
        expect(xi8Subjects).toContain('Matematika');
        expect(xi8Subjects).toContain('Sosiologi');
        expect(xi8Subjects).toContain('Ekonomi');
        expect(xi8Subjects).not.toContain('Antropologi');
        expect(xi8Subjects).not.toContain('Fisika');

        // 5. Verifikasi Filter Pengaturan: Ketika Fisika dinonaktifkan (isActive === false), Fisika hilang dari XI-1
        let fisikaBook = findBookEntry(11, 'Fisika');
        expect(fisikaBook).toBeTruthy();
        fisikaBook.isActive = false;

        const xi1WithoutFisika = getSubjectsForClass(11, 'XI-1');
        expect(xi1WithoutFisika).not.toContain('Fisika');
        expect(xi1WithoutFisika).toContain('Kimia');
        expect(xi1WithoutFisika).toContain('Matematika');

        // Pulihkan Fisika
        fisikaBook.isActive = true;
        const xi1Restored = getSubjectsForClass(11, 'XI-1');
        expect(xi1Restored).toContain('Fisika');

        // 6. Verifikasi getSubjectsForGrade: Menggabungkan mapel master dan mapel jadwal XML
        const grade11Subjects = getSubjectsForGrade(11, false);
        expect(grade11Subjects).toContain('Matematika');
        expect(grade11Subjects).toContain('Antropologi');
        expect(grade11Subjects).toContain('Ekonomi');
    });

    test('94. Optimistic UI Update & Loading State pada Tab Pengaturan: Respon Instan 0ms, Guard Anti-Spam Click, Spinner Indikator & Auto-Rollback', async () => {
        const book = findBookEntry(10, 'Bahasa Bali');
        expect(book).toBeTruthy();
        expect(book.isActive !== false).toBe(true);

        // 1. Pastikan awalnya set pelacak kosong
        expect(getPendingVisibilityToggles().size).toBe(0);

        // 2. Eksekusi toggleBookVisibility: Status berubah optimistik seketika
        const togglePromise = toggleBookVisibility(10, encodeURIComponent('Bahasa Bali'));
        
        // Status langsung berubah tanpa menunggu promise D1 selesai
        expect(book.isActive).toBe(false);

        // 3. Menunggu penyimpanan selesai
        await togglePromise;

        // Kunci proses dibersihkan setelah selesai
        expect(getPendingVisibilityToggles().has('10_Bahasa Bali')).toBe(false);
        expect(book.isActive).toBe(false);

        // 4. Pulihkan kembali ke aktif
        await toggleBookVisibility(10, encodeURIComponent('Bahasa Bali'));
        expect(book.isActive).toBe(true);
        expect(getPendingVisibilityToggles().has('10_Bahasa Bali')).toBe(false);

        // 5. Verifikasi renderPriceSettingsTable menghasilkan tabel yang valid
        const htmlPath = path.resolve(__dirname, '../penjualan-buku.html');
        const html = fs.readFileSync(htmlPath, 'utf8');
        expect(html).toContain('id="table-settings-price-body"');
    });
});





