#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script Pemformatan Tampilan Cetak Excel A4: Rekap_Absen_XI-9_S1.xlsx
Menyesuaikan layout cetak semua sheet agar siap cetak di kertas A4 rapi tanpa memotong kolom.
Output: Rekap_Absen_XI-9_S1_siap_cetak.xlsx
"""

import sys
import os
from openpyxl import load_workbook
from openpyxl.styles import Alignment, Border, Side, Font, PatternFill
from openpyxl.worksheet.properties import PageSetupProperties
from openpyxl.utils import get_column_letter

# Konstanta Style
TIPIS = Side(style="thin", color="000000")
BORDER = Border(left=TIPIS, right=TIPIS, top=TIPIS, bottom=TIPIS)
HEADER_FILL = PatternFill("solid", fgColor="D9E2F3")   # Biru muda pastel
FONT_FAMILY = "Calibri"

def apply_kop_judul(ws, sheet_title, last_col):
    """
    Format kop dinas resmi baris 1-4 dan judul baris 6
    Baris 1: PEMERINTAH PROVINSI BALI
    Baris 2: DINAS PENDIDIKAN, KEPEMUDAAN DAN OLAHRAGA
    Baris 3: SMA NEGERI 1 ABANG
    Baris 4: Alamat & Kontak
    Baris 6: Judul Sheet
    Baris 8-10: Metadata KBM Berkolom Rapi
    """
    col_letter = get_column_letter(last_col)
    
    # Kop Dinas
    ws.cell(row=1, column=1, value="PEMERINTAH PROVINSI BALI")
    ws.cell(row=1, column=1).font = Font(name=FONT_FAMILY, size=10, bold=True)
    ws.cell(row=1, column=1).alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 14
    
    ws.cell(row=2, column=1, value="DINAS PENDIDIKAN, KEPEMUDAAN DAN OLAHRAGA")
    ws.cell(row=2, column=1).font = Font(name=FONT_FAMILY, size=10, bold=True)
    ws.cell(row=2, column=1).alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[2].height = 14
    
    ws.cell(row=3, column=1, value="SMA NEGERI 1 ABANG")
    ws.cell(row=3, column=1).font = Font(name=FONT_FAMILY, size=13, bold=True)
    ws.cell(row=3, column=1).alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[3].height = 18
    
    ws.cell(row=4, column=1, value="Jl. Ida Ketut Jelantik, Desa Tista, Kec. Abang, Kab. Karangasem, Bali 80852 | Website: smanegeri1abang.sch.id")
    ws.cell(row=4, column=1).font = Font(name=FONT_FAMILY, size=8, italic=True)
    ws.cell(row=4, column=1).alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[4].height = 13
    
    # Border garis batas kop di baris 4
    GARIS_MEDIUM = Side(style="medium", color="000000")
    for c in range(1, last_col + 1):
        ws.cell(row=4, column=c).border = Border(bottom=GARIS_MEDIUM)
        
    ws.row_dimensions[5].height = 6
    
    # Judul Sheet di baris 6
    ws.cell(row=6, column=1, value=sheet_title)
    ws.cell(row=6, column=1).font = Font(name=FONT_FAMILY, size=12, bold=True)
    ws.cell(row=6, column=1).alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[6].height = 18
    
    ws.row_dimensions[7].height = 6
    
    # Metadata terstruktur di baris 8-10
    for r in (8, 9, 10):
        ws.row_dimensions[r].height = 15
        for c in range(1, last_col + 1):
            cell = ws.cell(row=r, column=c)
            if cell.value:
                cell.font = Font(name=FONT_FAMILY, size=10)
    ws.row_dimensions[11].height = 8

def apply_tanda_tangan(ws, start_row, last_col):
    """
    Menambahkan / memformat blok tanda tangan di bawah tabel
    Kiri: Kepala Sekolah
    Kanan: Guru Mata Pelajaran
    start_row: baris awal blok ttd (biasanya 2 baris setelah tabel terakhir)
    """
    # Kolom kiri: kolom 2 atau 3
    col_kiri = 2 if last_col > 6 else 1
    # Kolom kanan: kolom terakhir - 2 atau 3
    col_kanan = max(last_col - 3, col_kiri + 4)
    
    # Tanggal dan Jabatan
    ws.cell(row=start_row, column=col_kiri, value="Mengetahui,")
    ws.cell(row=start_row, column=col_kanan, value="Abang, 2 Oktober 2026")
    
    ws.cell(row=start_row + 1, column=col_kiri, value="Kepala SMA Negeri 1 Abang")
    ws.cell(row=start_row + 1, column=col_kanan, value="Guru Mata Pelajaran,")
    
    # 3 baris kosong (start_row + 2, + 3, + 4)
    
    # Nama dan NIP
    ws.cell(row=start_row + 5, column=col_kiri, value="I Putu Suweta, S.Pd., M.Pd.")
    ws.cell(row=start_row + 5, column=col_kanan, value="I Komang Purna, S.Pd., Gr.")
    
    ws.cell(row=start_row + 6, column=col_kiri, value="NIP. 197005211997021001")
    ws.cell(row=start_row + 6, column=col_kanan, value="NIP. 199511162024211010")
    
    # Styling TTD
    for r in range(start_row, start_row + 7):
        ws.row_dimensions[r].height = 16
        for c in (col_kiri, col_kanan):
            cell = ws.cell(row=r, column=c)
            is_bold = (r in (start_row + 1, start_row + 5))
            cell.font = Font(name=FONT_FAMILY, size=10, bold=is_bold, underline="single" if r == start_row + 5 else None)
            cell.alignment = Alignment(horizontal="left", vertical="center")
            
    return start_row + 6

def siap_cetak(ws, header_rows, first_data_row, last_data_row, last_col,
               orientation="landscape", title_rows=None,
               left_cols=None, widths=None, ttd_last_row=None,
               fit_to_height=0, sheet_title=None, add_ttd=False):
    """
    ws              : worksheet openpyxl
    header_rows     : (baris_awal, baris_akhir) header tabel
    first_data_row  : baris data pertama
    last_data_row   : baris data terakhir
    last_col        : jumlah kolom tabel (mis. 11 untuk A:K)
    orientation     : 'portrait' atau 'landscape'
    title_rows      : (awal, akhir) baris yang diulang di tiap halaman
    left_cols       : daftar nomor kolom yang rata kiri (mis. Nama)
    widths          : dict {nomor_kolom: lebar}
    ttd_last_row    : baris terakhir blok tanda tangan (jika ada)
    fit_to_height   : 0 = bebas / otomatis lanjut halaman, 1 = kunci pas 1 halaman
    """
    h0, h1 = header_rows

    # Kop Judul
    if sheet_title:
        apply_kop_judul(ws, sheet_title, last_col)

    # 1. Border + font + alignment tabel
    for row in ws.iter_rows(min_row=h0, max_row=last_data_row, min_col=1, max_col=last_col):
        for c in row:
            c.border = BORDER
            is_header = (c.row <= h1)
            c.font = Font(name=FONT_FAMILY, size=10, bold=is_header)
            if is_header:
                c.fill = HEADER_FILL
                c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            else:
                horiz = "left" if c.column in (left_cols or []) else "center"
                c.alignment = Alignment(horizontal=horiz, vertical="center", wrap_text=False)

    # 2. Lebar kolom & tinggi baris seragam
    for col, w in (widths or {}).items():
        ws.column_dimensions[get_column_letter(col)].width = w
        
    for r in range(h0, h1 + 1):
        ws.row_dimensions[r].height = 20
        
    for r in range(first_data_row, last_data_row + 1):
        # Jika sheet Rekap Siswa harus muat 1 halaman portrait, tinggi baris 15 cukup aman
        ws.row_dimensions[r].height = 15 if fit_to_height == 1 else 16

    # 3. Blok Tanda Tangan jika diminta
    akhir_baris = last_data_row
    if add_ttd:
        start_ttd = last_data_row + 2
        akhir_baris = apply_tanda_tangan(ws, start_ttd, last_col)
    elif ttd_last_row:
        akhir_baris = ttd_last_row

    # 4. Pengaturan halaman (A4, Margin, Fit, Orientasi)
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = orientation
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = fit_to_height
    
    # Margin dalam inci
    ws.page_margins.left = 0.5
    ws.page_margins.right = 0.5
    ws.page_margins.top = 0.6
    ws.page_margins.bottom = 0.7
    ws.page_margins.header = 0.3
    ws.page_margins.footer = 0.3
    
    ws.print_options.horizontalCentered = True
    ws.print_options.gridLines = False

    # 5. Area cetak, print titles, view options
    col_end_letter = get_column_letter(last_col)
    ws.print_area = f"A1:{col_end_letter}{akhir_baris}"
    
    if title_rows:
        ws.print_title_rows = f"{title_rows[0]}:{title_rows[1]}"
        
    ws.sheet_view.showGridLines = False

    # 6. Footer cetak
    ws.oddFooter.left.text = "SMA Negeri 1 Abang"
    ws.oddFooter.center.text = "Halaman &P dari &N"
    ws.oddFooter.right.text = "Dicetak: &D"
    for part in (ws.oddFooter.left, ws.oddFooter.center, ws.oddFooter.right):
        part.size = 9
        part.font = FONT_FAMILY

def proses_file_rekap(input_file, output_file):
    print(f"Membuka file: {input_file}...")
    wb = load_workbook(input_file)
    print(f"Sheet yang ditemukan: {wb.sheetnames}")

    # 1. SHEET: Data (Landscape, 17 pertemuan + nama lebar, ada TTD)
    if "Data" in wb.sheetnames:
        print("Memformat sheet: Data (Landscape)...")
        ws = wb["Data"]
        # Misal pertemuan 1-17 + No + NISN + Nama + Rekapitulasi (total ~25 kolom)
        last_col = ws.max_column or 25
        last_row = ws.max_row or 40
        siap_cetak(
            ws, header_rows=(6, 7), first_data_row=8, last_data_row=last_row,
            last_col=last_col, orientation="landscape", title_rows=(6, 7),
            left_cols=[3], fit_to_height=0, sheet_title="DATA KEHADIRAN SISWA",
            add_ttd=True
        )

    # 2. SHEET: Rekap Siswa (Portrait, muat 1 halaman penuh 34 siswa + TTD)
    if "Rekap Siswa" in wb.sheetnames:
        print("Memformat sheet: Rekap Siswa (Portrait 1 Halaman)...")
        ws = wb["Rekap Siswa"]
        siap_cetak(
            ws, header_rows=(6, 6), first_data_row=7, last_data_row=40, last_col=11,
            orientation="portrait", title_rows=(6, 6), left_cols=[3],
            widths={1: 5, 2: 14, 3: 28, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5, 9: 5, 10: 8, 11: 14},
            fit_to_height=1, sheet_title="REKAP KEHADIRAN SISWA",
            add_ttd=True
        )

    # 3. SHEET: Ringkasan (Portrait, 1 halaman, tanpa TTD)
    if "Ringkasan" in wb.sheetnames:
        print("Memformat sheet: Ringkasan (Portrait 1 Halaman)...")
        ws = wb["Ringkasan"]
        last_col = ws.max_column or 6
        last_row = ws.max_row or 20
        siap_cetak(
            ws, header_rows=(6, 6), first_data_row=7, last_data_row=last_row,
            last_col=last_col, orientation="portrait", title_rows=(6, 6),
            left_cols=[2], fit_to_height=1, sheet_title="RINGKASAN KEHADIRAN",
            add_ttd=False
        )

    # 4. SHEET: Rekap Pertemuan (Landscape, tabel dan grafik 1 halaman, tanpa TTD)
    if "Rekap Pertemuan" in wb.sheetnames:
        print("Memformat sheet: Rekap Pertemuan (Landscape 1 Halaman)...")
        ws = wb["Rekap Pertemuan"]
        last_col = ws.max_column or 12
        last_row = ws.max_row or 25
        siap_cetak(
            ws, header_rows=(6, 6), first_data_row=7, last_data_row=last_row,
            last_col=last_col, orientation="landscape", title_rows=(6, 6),
            left_cols=[2], fit_to_height=1, sheet_title="REKAP PERTEMUAN KBM",
            add_ttd=False
        )

    # 5. SHEET: Tindak Lanjut (Portrait, ada TTD)
    if "Tindak Lanjut" in wb.sheetnames:
        print("Memformat sheet: Tindak Lanjut (Portrait)...")
        ws = wb["Tindak Lanjut"]
        last_col = ws.max_column or 8
        last_row = ws.max_row or 25
        siap_cetak(
            ws, header_rows=(6, 6), first_data_row=7, last_data_row=last_row,
            last_col=last_col, orientation="portrait", title_rows=(6, 6),
            left_cols=[3, 7], fit_to_height=0, sheet_title="TINDAK LANJUT KEHADIRAN SISWA",
            add_ttd=True
        )

    wb.save(output_file)
    print(f"\nBerhasil disimpan ke: {output_file}")

if __name__ == "__main__":
    infile = sys.argv[1] if len(sys.argv) > 1 else "Rekap_Absen_XI-9_S1.xlsx"
    outfile = sys.argv[2] if len(sys.argv) > 2 else "Rekap_Absen_XI-9_S1_siap_cetak.xlsx"
    if not os.path.exists(infile):
        print(f"Error: File '{infile}' tidak ditemukan!")
        sys.exit(1)
    proses_file_rekap(infile, outfile)
