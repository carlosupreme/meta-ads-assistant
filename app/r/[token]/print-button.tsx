"use client";

import { Download } from "lucide-react";

/** Uses the browser's print dialog, where "Save as PDF" produces the file with the print styles. */
export function PrintButton() {
  return (
    <button type="button" className="primary-button report-print" onClick={() => window.print()}>
      <Download size={16} /> Descargar PDF
    </button>
  );
}
