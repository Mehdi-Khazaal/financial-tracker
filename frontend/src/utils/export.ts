export function escapeCsvCell(value: string | number): string {
  const raw = String(value ?? '');
  const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return (safe.includes(',') || safe.includes('"') || safe.includes('\n'))
    ? `"${safe.replace(/"/g, '""')}"`
    : safe;
}

export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const lines = [headers, ...rows].map(row => row.map(escapeCsvCell).join(','));
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function printPDF(title: string, headers: string[], rows: (string | number)[][]) {
  const esc = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tableRows = rows
    .map(row => `<tr>${row.map(cell => `<td>${esc(String(cell ?? ''))}</td>`).join('')}</tr>`)
    .join('');
  const html = `<!DOCTYPE html><html><head><title>${esc(title)}</title><style>
body{font-family:system-ui,sans-serif;font-size:12px;color:#111;padding:20px}
h2{margin-bottom:6px;font-size:15px}p{color:#6b7280;font-size:11px;margin-bottom:12px}
table{width:100%;border-collapse:collapse}
th{background:#f3f4f6;text-align:left;padding:7px 9px;border:1px solid #e5e7eb;font-size:11px;font-weight:600}
td{padding:5px 9px;border:1px solid #e5e7eb;font-size:11px}
tr:nth-child(even){background:#f9fafb}
@media print{body{padding:0}}
</style></head><body>
<h2>${esc(title)}</h2>
<p>Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
<table><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead>
<tbody>${tableRows}</tbody></table>
</body></html>`;
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 300);
}
