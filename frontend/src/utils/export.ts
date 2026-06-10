export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? '');
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...rows].map(row => row.map(escape).join(','));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

export function printPDF(title: string, headers: string[], rows: (string | number)[][]) {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tableRows = rows
    .map(row => `<tr>${row.map(c => `<td>${esc(String(c ?? ''))}</td>`).join('')}</tr>`)
    .join('');
  const html = `<!DOCTYPE html><html><head><title>${esc(title)}</title><style>
body{font-family:system-ui,sans-serif;font-size:12px;color:#111;padding:20px}
h2{margin-bottom:6px;font-size:15px}p{color:#6b7280;font-size:11px;margin-bottom:12px}
table{width:100%;border-collapse:collapse}
th{background:#f3f4f6;text-align:left;padding:7px 9px;border:1px solid #e5e7eb;font-size:11px;font-weight:600}
td{padding:5px 9px;border:1px solid #e5e7eb;font-size:11px}
tr:nth-child(even){background:#f9fafb}
@media print{body{padding:0}button{display:none}}
</style></head><body>
<h2>${esc(title)}</h2>
<p>Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
<table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${tableRows}</tbody></table>
<br><button onclick="window.print()" style="margin-top:8px;padding:6px 14px;font-size:12px;cursor:pointer">Print / Save PDF</button>
</body></html>`;
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}
