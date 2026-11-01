param(
    [string]$InputPath = "Rekap_Absen_XI-9_S1.xlsx",
    [string]$OutputPath = "Rekap_Absen_XI-9_S1_siap_cetak.xlsx",
    [string]$PdfPath = ""
)

if (-not (Test-Path $InputPath)) {
    Write-Error "File input tidak ditemukan: $InputPath"
    exit 1
}

$inputFull = (Resolve-Path $InputPath).Path
$outputFull = [System.IO.Path]::GetFullPath($OutputPath)

Write-Host "Membuka Excel Application..."
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
    Write-Host "Membuka file: $inputFull"
    $wb = $excel.Workbooks.Open($inputFull)

    # Konstanta Excel
    $xlA4 = 9
    $xlPortrait = 1
    $xlLandscape = 2
    $xlThin = 2
    $xlContinuous = 1
    $xlCenter = -4108
    $xlLeft = -4131

    foreach ($ws in $wb.Sheets) {
        $name = $ws.Name
        Write-Host "Memproses Sheet: $name"

        # Tentukan konfigurasi per sheet
        $orient = $xlPortrait
        $fitHeight = 0
        $addTtd = $false

        switch ($name) {
            "Data" {
                $orient = $xlLandscape
                $fitHeight = 0
                $addTtd = $true
            }
            "Rekap Siswa" {
                $orient = $xlPortrait
                $fitHeight = 1
                $addTtd = $true
            }
            "Ringkasan" {
                $orient = $xlPortrait
                $fitHeight = 1
                $addTtd = $false
            }
            "Rekap Pertemuan" {
                $orient = $xlLandscape
                $fitHeight = 1
                $addTtd = $false
            }
            "Tindak Lanjut" {
                $orient = $xlPortrait
                $fitHeight = 0
                $addTtd = $true
            }
        }

        # 1. Page Setup
        $ps = $ws.PageSetup
        $ps.PaperSize = $xlA4
        $ps.Orientation = $orient
        $ps.Zoom = $false
        $ps.FitToPagesWide = 1
        if ($fitHeight -gt 0) {
            $ps.FitToPagesTall = $fitHeight
        } else {
            $ps.FitToPagesTall = $false
        }

        # Margin dalam poin (1 inci = 72 poin)
        $ps.LeftMargin = 0.5 * 72
        $ps.RightMargin = 0.5 * 72
        $ps.TopMargin = 0.6 * 72
        $ps.BottomMargin = 0.7 * 72
        $ps.HeaderMargin = 0.3 * 72
        $ps.FooterMargin = 0.3 * 72

        $ps.CenterHorizontally = $true
        $ps.PrintGridlines = $false

        # Footer
        $ps.LeftFooter = "&""Calibri""&9SMA Negeri 1 Abang"
        $ps.CenterFooter = "&""Calibri""&9Halaman &P dari &N"
        $ps.RightFooter = "&""Calibri""&9Dicetak: &D"
    }

    Write-Host "Menyimpan ke: $outputFull"
    # xlOpenXMLWorkbook = 51
    $wb.SaveCopyAs($outputFull)

    if ($PdfPath -ne "") {
        $pdfFull = [System.IO.Path]::GetFullPath($PdfPath)
        Write-Host "Mengekspor ke PDF: $pdfFull"
        # 0 = xlTypePDF
        $wb.ExportAsFixedFormat(0, $pdfFull)
    }

    $wb.Close($false)
    Write-Host "Selesai memproses file!"
} catch {
    Write-Error "Terjadi kesalahan: $_"
} finally {
    $excel.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}
