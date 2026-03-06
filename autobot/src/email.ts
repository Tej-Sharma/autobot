import { Resend } from 'resend';
import { CONFIG } from './config';
import { RunReport } from './types';

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) {
    if (!CONFIG.resendApiKey) throw new Error('RESEND_API_KEY not configured');
    resend = new Resend(CONFIG.resendApiKey);
  }
  return resend;
}

export async function sendReportEmail(
  to: string,
  jobId: string,
  report: RunReport,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = getResend();

    const score = report.totals.score;
    const issueCount = report.totals.blocking + report.totals.high + report.totals.medium + report.totals.low;
    const screenshotCount = report.totals.capturedPhases;

    const severitySummary = [
      report.totals.blocking > 0 ? `${report.totals.blocking} blocking` : '',
      report.totals.high > 0 ? `${report.totals.high} high` : '',
      report.totals.medium > 0 ? `${report.totals.medium} medium` : '',
      report.totals.low > 0 ? `${report.totals.low} low` : '',
    ].filter(Boolean).join(', ') || 'No issues found';

    const resultsUrl = CONFIG.appPublicUrl
      ? `${CONFIG.appPublicUrl}/run/${jobId}`
      : '';

    const findingsHtml = report.phases
      .flatMap(p => p.judge?.findings ?? [])
      .slice(0, 10)
      .map(f => `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;"><span style="background:${
          f.severity === 'blocking' ? '#fee2e2' : f.severity === 'high' ? '#ffedd5' : f.severity === 'medium' ? '#fef9c3' : '#dbeafe'
        };color:${
          f.severity === 'blocking' ? '#dc2626' : f.severity === 'high' ? '#ea580c' : f.severity === 'medium' ? '#ca8a04' : '#2563eb'
        };padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">${f.severity}</span></td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${f.category}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${f.message}</td>
      </tr>`)
      .join('');

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;">
        <h1 style="font-size:24px;font-weight:700;margin-bottom:4px;">QA Report for ${report.baseUrl}</h1>
        <p style="color:#6b7280;font-size:14px;margin-top:0;">Test run completed ${new Date(report.updatedAt).toLocaleDateString()}</p>

        <div style="text-align:center;margin:32px 0;">
          <div style="display:inline-block;width:100px;height:100px;line-height:100px;border-radius:50%;border:4px solid ${
            score > 80 ? '#22c55e' : score > 50 ? '#eab308' : '#ef4444'
          };font-size:36px;font-weight:700;color:${
            score > 80 ? '#22c55e' : score > 50 ? '#eab308' : '#ef4444'
          };">${score}</div>
          <p style="color:#6b7280;font-size:14px;margin-top:8px;">${screenshotCount} screenshots captured &middot; ${severitySummary}</p>
        </div>

        ${findingsHtml ? `
          <h2 style="font-size:16px;font-weight:600;margin-bottom:8px;">Top Findings</h2>
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#f9fafb;">
              <th style="padding:6px 12px;text-align:left;font-size:12px;color:#6b7280;">Severity</th>
              <th style="padding:6px 12px;text-align:left;font-size:12px;color:#6b7280;">Category</th>
              <th style="padding:6px 12px;text-align:left;font-size:12px;color:#6b7280;">Issue</th>
            </tr></thead>
            <tbody>${findingsHtml}</tbody>
          </table>
        ` : '<p style="color:#22c55e;font-weight:600;">No issues found - looking good!</p>'}

        ${resultsUrl ? `
          <div style="text-align:center;margin:32px 0;">
            <a href="${resultsUrl}" style="display:inline-block;background:linear-gradient(135deg,#8b5cf6,#3b82f6);color:white;padding:12px 32px;border-radius:9999px;text-decoration:none;font-weight:600;font-size:14px;">View Full Report &amp; Screenshots</a>
          </div>
        ` : ''}

        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
        <p style="color:#9ca3af;font-size:12px;text-align:center;">
          Sent by AutoBot &middot; AI-powered QA testing
        </p>
      </div>
    `;

    await r.emails.send({
      from: CONFIG.resendFromEmail,
      to,
      subject: `QA Score: ${score}/100 for ${report.baseUrl} — ${issueCount} issue${issueCount !== 1 ? 's' : ''} found`,
      html,
    });

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'email send failed';
    console.error('[email] send failed:', msg);
    return { ok: false, error: msg };
  }
}
