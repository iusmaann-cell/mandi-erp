import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, SectionTitle, Button, Input, Badge } from "../components/ui";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_OPTIONS = [
  { value: "present", label: "Present", tone: "green" },
  { value: "absent", label: "Absent", tone: "red" },
  { value: "leave", label: "Leave", tone: "amber" },
  { value: "half_day", label: "Half Day", tone: "neutral" },
];

export default function Attendance() {
  const [date, setDate] = useState(todayStr());
  const [employees, setEmployees] = useState([]);
  const [marks, setMarks] = useState({});   // employee_id -> { status, overtime_hours }
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    const [empData, attendanceData] = await Promise.all([
      api.getEmployees(),
      api.getAttendance({ start_date: `${date}T00:00:00`, end_date: `${date}T23:59:59` }),
    ]);
    setEmployees(empData);
    const initial = {};
    for (const emp of empData) {
      const existing = attendanceData.find((a) => a.employee_id === emp.id);
      initial[emp.id] = existing
        ? { status: existing.status, overtime_hours: existing.overtime_hours }
        : { status: "present", overtime_hours: 0 };
    }
    setMarks(initial);
  }
  useEffect(() => { load(); setSaved(false); }, [date]);

  function updateMark(employeeId, field, value) {
    setMarks((m) => ({ ...m, [employeeId]: { ...m[employeeId], [field]: value } }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.markAttendance({
        attendance_date: `${date}T00:00:00`,
        lines: employees.map((emp) => ({
          employee_id: emp.id,
          status: marks[emp.id]?.status || "present",
          overtime_hours: Number(marks[emp.id]?.overtime_hours) || 0,
        })),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SectionTitle
        eyebrow="HR & Payroll"
        title="Attendance"
        action={<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
      />

      <Card>
        {employees.length === 0 ? (
          <div className="text-text-muted text-sm">No employees yet. Add employees first.</div>
        ) : (
          <>
            <div className="space-y-2">
              {employees.map((emp) => (
                <div key={emp.id} className="grid grid-cols-1 sm:grid-cols-[2fr_2fr_1fr] gap-3 items-center bg-surface-2 rounded-md p-3">
                  <div>
                    <div className="text-sm">{emp.name}</div>
                    <div className="text-xs text-text-muted">{emp.designation || emp.employment_type}</div>
                  </div>
                  <div className="flex gap-1.5">
                    {STATUS_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => updateMark(emp.id, "status", opt.value)}
                        className={`min-h-[40px] px-4 rounded-full font-bold text-xs border transition-colors ${
                          marks[emp.id]?.status === opt.value
                            ? "bg-forest text-white border-forest"
                            : "text-text-muted border-border hover:text-text"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <Input
                    type="number" placeholder="OT hours"
                    value={marks[emp.id]?.overtime_hours || ""}
                    onChange={(e) => updateMark(emp.id, "overtime_hours", e.target.value)}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 border-t border-border pt-4 mt-4">
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Attendance"}</Button>
              {saved && <Badge tone="green">Saved</Badge>}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
