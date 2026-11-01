-- ====================================================================
-- SIMAS SMAGESA - MIGRATION: SINKRONISASI SKEMA AGENDA PEGAWAI
-- Migration File: 202609090001_sync_employee_activities_and_assignments.sql
-- ====================================================================

-- 1. Penambahan Kolom Relasi & Indeks Cepat pada employee_activities
ALTER TABLE employee_activities ADD COLUMN gtk_id TEXT;
ALTER TABLE employee_activities ADD COLUMN group_id TEXT;
ALTER TABLE employee_activities ADD COLUMN is_outside_duty INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_emp_act_gtk_tgl ON employee_activities(gtk_id, tanggal);
CREATE INDEX IF NOT EXISTS idx_emp_act_user_tgl ON employee_activities(user_uid, tanggal);

-- 2. Sinkronisasi gtk_id pada employee_assignments dari Master GTK
UPDATE employee_assignments
SET gtk_id = (
    SELECT g.id FROM gtk g
    WHERE (employee_assignments.employee_nip IS NOT NULL AND employee_assignments.employee_nip = g.nip)
       OR (employee_assignments.employee_nip IS NULL AND employee_assignments.employee_name = g.name)
    LIMIT 1
)
WHERE gtk_id IS NULL;
