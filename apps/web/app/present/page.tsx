"use client";

import { useMemo, useState } from "react";
import { DISCLOSURE_FIELDS, type DisclosureField, type DisclosedFields } from "@univerify/verifier-core";
import { parseJson, downloadJson } from "@/lib/univerify/json";
import { readFileAsText } from "@/lib/univerify/file";
import type { PrivateDiplomaEnvelope } from "@/lib/univerify/types";
import { makeStateLogger } from "@/lib/univerify/logs";

const FIELD_LABELS: Record<DisclosureField, string> = {
  student: "Student (name, ID)",
  degree: "Degree (name, level)",
  issuedAt: "Issued date",
  diplomaNumber: "Diploma number",
};

export default function PresentPage() {
  const [fullEnvelope, setFullEnvelope] = useState<PrivateDiplomaEnvelope | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<DisclosureField>>(new Set(DISCLOSURE_FIELDS));
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const log = useMemo(() => makeStateLogger(setLogs), [setLogs]);

  function reset() { setError(""); setFullEnvelope(null); setSelectedFields(new Set(DISCLOSURE_FIELDS)); log.clear(); }

  async function loadFile(file: File) {
    reset();
    const text = await readFileAsText(file);
    loadEnvelope(text);
  }

  function loadEnvelope(text: string) {
    setError("");
    try {
      const parsed = parseJson(text);
      if (!parsed.ok) throw new Error(parsed.error);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- validation of arbitrary JSON input
      const obj = parsed.value as any;

      if (!obj || typeof obj !== "object" || !("commitments" in obj) || !("disclosed" in obj)) {
        throw new Error("This is not a private diploma envelope. Use a file exported in Private Mode from the Issuer page.");
      }

      const disclosed = obj.disclosed;
      const hasAllFields = DISCLOSURE_FIELDS.every((f) => f in disclosed && disclosed[f]?.value !== undefined && disclosed[f]?.salt);
      if (!hasAllFields) {
        throw new Error("This envelope does not contain all field values and salts. Only full private envelopes (from the Issuer) can be used here.");
      }

      setFullEnvelope(obj as PrivateDiplomaEnvelope);
      log.push("Private envelope loaded successfully");
      log.push(`Fields available: ${DISCLOSURE_FIELDS.join(", ")}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function toggleField(field: DisclosureField) {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  function exportPresentation() {
    if (!fullEnvelope) return;

    const disclosed: DisclosedFields = {};
    for (const field of DISCLOSURE_FIELDS) {
      if (selectedFields.has(field) && fullEnvelope.disclosed[field]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- building partial DisclosedFields dynamically
        (disclosed as any)[field] = fullEnvelope.disclosed[field];
      }
    }

    const presentation: PrivateDiplomaEnvelope = {
      commitments: fullEnvelope.commitments,
      disclosed,
      proof: fullEnvelope.proof,
    };

    const disclosedNames = DISCLOSURE_FIELDS.filter((f) => selectedFields.has(f));
    downloadJson(`presentation-${disclosedNames.join("-") || "none"}.json`, presentation);
    log.push(`Exported presentation with ${disclosedNames.length} disclosed field(s): ${disclosedNames.join(", ") || "none"}`);
  }

  return (
    <main className="uv-page">
      <h1 className="uv-title"><span className="uv-title-gradient">Present</span></h1>
      <p className="uv-subtitle">Choose which diploma fields to reveal, then export a presentation envelope for the verifier.</p>

      <div className="uv-card">
        <div className="uv-file-zone" style={{ marginBottom: 14 }}>
          <input type="file" accept="application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); }} />
        </div>
        <label className="uv-label">Or paste full private envelope JSON</label>
        <textarea
          className="uv-input"
          rows={6}
          placeholder='{ "commitments": { ... }, "disclosed": { ... }, "proof": { ... } }'
          style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
          onChange={(e) => loadEnvelope(e.target.value)}
        />
      </div>

      {error && <div className="uv-status-banner uv-status-fail"><b>Error:</b> {error}</div>}

      {fullEnvelope && (
        <div className="uv-card">
          <h2 className="uv-card-title">Select fields to disclose</h2>
          <p className="uv-hint" style={{ marginBottom: 12 }}>Uncheck fields you want to keep hidden from the verifier.</p>

          {DISCLOSURE_FIELDS.map((field) => {
            const entry = fullEnvelope.disclosed[field];
            const isSelected = selectedFields.has(field);
            return (
              <div key={field} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleField(field)}
                  style={{ marginTop: 3 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{FIELD_LABELS[field]}</div>
                  {entry && isSelected && (
                    <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
                      {typeof entry.value === "object"
                        ? Object.entries(entry.value).map(([k, v]) => `${k}: ${v}`).join(", ")
                        : String(entry.value)}
                    </div>
                  )}
                  {!isSelected && (
                    <div style={{ fontSize: 13, color: "var(--muted)", fontStyle: "italic", marginTop: 2 }}>
                      Will be hidden
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div className="uv-actions" style={{ marginTop: 16 }}>
            <button onClick={exportPresentation} className="uv-btn uv-btn-primary">
              Export presentation ({selectedFields.size} of {DISCLOSURE_FIELDS.length} fields)
            </button>
            <button onClick={reset} className="uv-btn">Clear</button>
          </div>
        </div>
      )}

      {fullEnvelope && (
        <div className="uv-card" style={{ marginTop: 12 }}>
          <h2 className="uv-card-title">Preview: what the verifier will see</h2>
          <div className="uv-kv">
            {DISCLOSURE_FIELDS.map((field) => {
              const entry = fullEnvelope.disclosed[field];
              const isSelected = selectedFields.has(field);
              if (field === "student" && entry && isSelected) {
                const v = entry.value as { firstName: string; lastName: string; studentId: string };
                return [
                  <b key={`${field}-name-l`}>Student</b>,
                  <span key={`${field}-name-v`}>{v.firstName} {v.lastName}</span>,
                  <b key={`${field}-id-l`}>Student ID</b>,
                  <span key={`${field}-id-v`}>{v.studentId}</span>,
                ];
              }
              if (field === "degree" && entry && isSelected) {
                const v = entry.value as { name: string; level: string };
                return [
                  <b key={`${field}-name-l`}>Degree</b>,
                  <span key={`${field}-name-v`}>{v.name}</span>,
                  <b key={`${field}-l-l`}>Level</b>,
                  <span key={`${field}-l-v`}>{v.level}</span>,
                ];
              }
              if (isSelected && entry) {
                return [
                  <b key={`${field}-l`}>{FIELD_LABELS[field]}</b>,
                  <span key={`${field}-v`}>{String(entry.value)}</span>,
                ];
              }
              return [
                <b key={`${field}-l`}>{FIELD_LABELS[field]}</b>,
                <span key={`${field}-v`} style={{ color: "var(--muted)", fontStyle: "italic" }}>[hidden]</span>,
              ];
            })}
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <div className="uv-card uv-logs" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Logs</h3>
            <button onClick={log.clear} className="uv-btn" style={{ padding: "4px 12px", fontSize: 12 }}>Clear</button>
          </div>
          <pre>
            {logs.map((line, idx) => <div key={idx}>{line}</div>)}
          </pre>
        </div>
      )}
    </main>
  );
}
