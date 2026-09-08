/**
 * Tarayıcıda bir CSV dosyası oluşturup indirmeyi tetikler. UTF-8 BOM ekler
 * (Excel'de Türkçe karakterlerin bozulmadan görünmesi için) ve her hücreyi
 * tırnak içine alıp iç tırnakları kaçırır (hücre içeriğinde virgül veya
 * tırnak olsa bile sütunların kaymasını önler).
 */
export function exportCsv(headers: string[], rows: (string | number)[][], filename: string): void {
  // `=`, `+`, `-`, `@` ile BAŞLAYAN bir hücre Excel/Sheets tarafından formül
  // olarak yorumlanır ("CSV formül enjeksiyonu") — bu fonksiyon serbest
  // metin girdisiyle (ör. bir müezzinin mazeret gerekçesi) çağrıldığından,
  // kötü niyetli/kazara bir `=HYPERLINK(...)` gibi değer dışa aktarılan
  // dosyayı açan admin'in cihazında çalışabilirdi (bkz. kod denetimi). Bu
  // dört karakterle başlayan hücrelerin başına bir kesme işareti eklenir —
  // Excel/Sheets bunu düz metin olarak gösterir, formül olarak çalıştırmaz.
  const escapeCell = (val: string | number) => {
    let str = String(val);
    if (/^[=+\-@]/.test(str)) str = `'${str}`;
    return `"${str.replace(/"/g, '""')}"`;
  };

  const csvContent =
    'data:text/csv;charset=utf-8,﻿' + [headers.map(escapeCell).join(','), ...rows.map((row) => row.map(escapeCell).join(','))].join('\n');

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
