// export-log-client.js
// Drop in repo root. Call logExport() immediately before triggering
// the IIF/CSV file download in your existing Export button handler.
//
// USAGE in index.html:
//
//   import { logExport } from './export-log-client.js';
//   import { getAdminToken } from './admin-login.js';
//
//   // In your existing Export CSV / Export IIF button handler,
//   // add this call right before you trigger the download:
//
//   exportBtn.addEventListener('click', async () => {
//     // ... your existing export logic that builds the file content ...
//
//     // Log the export (non-blocking — won't stop download if it fails)
//     await logExport({
//       dateFrom,           // string 'YYYY-MM-DD' — your existing date range vars
//       dateTo,
//       rows: exportRows,   // the array of rows being exported
//       filename,           // the filename string e.g. 'RR-QBO-2026-07-28.iif'
//       platforms,          // array e.g. ['Square', 'Stripe'] or single string
//     });
//
//     // ... then trigger your existing download ...
//     triggerDownload(content, filename);
//   });

import { getAdminToken } from './admin-login.js';

/**
 * Log an export event to Supabase via the log-export function.
 * Non-blocking — resolves even if the log write fails so the download is never blocked.
 *
 * @param {object} opts
 * @param {string}   opts.dateFrom   - 'YYYY-MM-DD'
 * @param {string}   opts.dateTo     - 'YYYY-MM-DD'
 * @param {Array}    opts.rows       - exported row objects (used to compute totals)
 * @param {string}   opts.filename   - downloaded filename
 * @param {string|string[]} opts.platforms - platform(s) included in export
 */
export async function logExport({ dateFrom, dateTo, rows = [], filename = '', platforms = [] }) {
  try {
    // Compute totals from rows — adjust field names to match your row objects
    const grossTotal = rows.reduce((sum, r) => sum + (parseFloat(r.gross) || parseFloat(r.amount) || 0), 0);
    const netTotal   = rows.reduce((sum, r) => sum + (parseFloat(r.net)   || 0), 0);

    const platformList = Array.isArray(platforms) ? platforms : [platforms];

    await fetch('/.netlify/functions/log-export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': getAdminToken(),
      },
      body: JSON.stringify({
        exportedAt:  new Date().toISOString(),
        dateFrom,
        dateTo,
        rowCount:    rows.length,
        grossTotal:  Math.round(grossTotal * 100) / 100,
        netTotal:    Math.round(netTotal   * 100) / 100,
        platforms:   platformList,
        filename,
      }),
    });
  } catch (err) {
    // Swallow errors — logging should never block an export
    console.warn('Export log failed (non-blocking):', err);
  }
}

/**
 * Load export history from Supabase for display in the Load History UI.
 * Returns array of export records, newest first.
 */
export async function loadExportHistory() {
  try {
    const res = await fetch('/.netlify/functions/get-export-log', {
      headers: { 'x-admin-token': getAdminToken() },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.exports || [];
  } catch {
    return [];
  }
}
