import fs from 'node:fs/promises';
import path from 'node:path';
import { AiTestReport, PhaseRecord, RunReport, RunTotals, StatusRecord } from './types';
import { CONFIG } from './config';

export function capturePathForPhase(jobId: string, routeDir: string, phase: string): string {
  return path.join(routeDir, `${phase}.png`);
}

export function aggregateRunTotals(phases: PhaseRecord[]): RunTotals {
  let scoreSum = 0;
  let scoredCount = 0;
  let blocking = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  let captured = 0;
  let failed = 0;

  for (const phase of phases) {
    if (phase.status === 'captured') captured += 1;
    if (phase.status === 'failed') failed += 1;
    if (!phase.judge) continue;
    if (Number.isFinite(phase.judge.score)) {
      scoreSum += phase.judge.score;
      scoredCount += 1;
    }
    for (const finding of phase.judge.findings) {
      if (finding.severity === 'blocking') blocking += 1;
      else if (finding.severity === 'high') high += 1;
      else if (finding.severity === 'medium') medium += 1;
      else if (finding.severity === 'low') low += 1;
    }
  }

  return {
    score: scoredCount > 0 ? Number((scoreSum / scoredCount).toFixed(2)) : 0,
    blocking,
    high,
    medium,
    low,
    capturedPhases: captured,
    failedPhases: failed,
  };
}

export function evaluateStatusFromTotals(totals: RunTotals): RunReport['status'] {
  if (totals.blocking > 0) return 'failed';
  if (totals.capturedPhases === 0) return 'failed';
  if (totals.high >= CONFIG.failOnHighThreshold) return 'partial';
  return 'succeeded';
}

export async function writeJsonReport(jobId: string, report: RunReport): Promise<string> {
  const filePath = path.join(CONFIG.artifactRoot, jobId, 'qa-report.json');
  await fs.writeFile(filePath, JSON.stringify(report, null, 2), 'utf8');
  return filePath;
}

function issueLine(phase: PhaseRecord): string {
  if (!phase.judge || !phase.judge.findings.length) return '';
  const top = phase.judge.findings.slice(0, 2);
  return top
    .map(
      (finding) =>
        `- [${phase.routeKey}] ${phase.phase}/${phase.viewport}: ${finding.severity.toUpperCase()} - ${finding.message}`,
    )
    .join('\n');
}

export async function writeMarkdownReport(jobId: string, report: RunReport): Promise<string> {
  const { totals } = report;
  const lines: string[] = [];
  lines.push(`# Autobot QA Report\n`);
  lines.push(`- Run ID: ${jobId}`);
  lines.push(`- Status: ${report.status}`);
  lines.push(`- Environment: ${report.environment}`);
  lines.push(`- URL: ${report.baseUrl}`);
  lines.push(`- Mode: ${report.mode}`);
  lines.push(`- Score: ${totals.score}`);
  lines.push(
    `- Phases: ${totals.capturedPhases} captured, ${totals.failedPhases} failed, ${report.phases.length} total\n`,
  );
  lines.push(`- Findings: blocking=${totals.blocking}, high=${totals.high}, medium=${totals.medium}, low=${totals.low}`);

  lines.push('\n## Route & phase breakdown\n');
  for (const phase of report.phases) {
    lines.push(`- ${phase.routeKey} [${phase.viewport}] ${phase.phase} -> ${phase.status}`);
    if (phase.error) lines.push(`  - error: ${phase.error}`);
    if (phase.judge) {
      lines.push(`  - score: ${phase.judge.score}`);
      const line = issueLine(phase);
      if (line) lines.push(line);
      if (phase.judge.notes) lines.push(`  - notes: ${phase.judge.notes}`);
    }
    lines.push('');
  }

  if (totals.blocking > 0 || totals.high > 0) {
    lines.push('## Recommended actions\n');
    lines.push('- Review blocking/high findings and screenshot state in artifacts.');
    lines.push('- Confirm visual and spacing regressions on real target devices.');
    lines.push('- Re-run after design/content fixes.');
  }

  const filePath = path.join(CONFIG.artifactRoot, jobId, 'qa-report.md');
  await fs.writeFile(filePath, lines.join('\n'), 'utf8');
  return filePath;
}

export function buildPrComment(report: RunReport): string {
  const { totals } = report;
  const status = report.status === 'failed' ? '❌ Failed' : report.status === 'partial' ? '⚠️ Partial' : '✅ Passed';
  const fallbackArtifactRoot = path.join(CONFIG.artifactRoot, report.jobId);
  const artifactRoot = typeof report.config.artifactRoot === 'string' ? report.config.artifactRoot : fallbackArtifactRoot;
  const normalizedArtifactRoot = artifactRoot.endsWith(`/${report.jobId}`)
    ? artifactRoot
    : path.join(artifactRoot, report.jobId);
  const lines = [
    `### Autobot QA report`,
    `Run: **${report.jobId}**`,
    `Status: ${status}`,
    `Score: **${totals.score}**`,
    `Environment: **${report.environment}**`,
    `URL: ${report.baseUrl}`,
    `Mode: ${report.mode}`,
    `Routes checked: ${report.routeCount} `,
    `Viewports: ${report.viewportCount}`,
    `Findings: blocking ${totals.blocking}, high ${totals.high}, medium ${totals.medium}, low ${totals.low}`,
    '',
    '### Top issues',
  ];

  const relevant = report.phases
    .filter((phase) => phase.judge && phase.judge.findings.length)
    .slice(0, 10)
    .map((phase) => {
      return `- **${phase.routeKey}** (${phase.viewport}/${phase.phase})`;
    });

  if (!relevant.length) {
    lines.push('- No findings detected by judge.');
  } else {
    lines.push(...relevant);
  }

  lines.push('', `Artifacts: \`${normalizedArtifactRoot}\``);
  lines.push('', 'Report generated by Autobot service.');

  return lines.join('\n');
}

export function makeStatusRecord(jobId: string, status: RunReport['status'], reportPath?: string, error?: string): StatusRecord {
  return {
    id: jobId,
    status,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    reportPath,
    error,
  };
}

export function toStatusMessage(status: RunReport['status']): string {
  if (status === 'succeeded') return 'Run passed';
  if (status === 'partial') return 'Run passed with warnings; review high findings';
  if (status === 'failed') return 'Run failed';
  return 'In progress';
}

export function buildAiTestPrComment(report: RunReport, aiReport: AiTestReport): string {
  // Start with the base screenshot report
  const baseComment = buildPrComment(report);

  const severityIcon: Record<string, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🔵',
  };

  const aiStatus = aiReport.status === 'pass'
    ? '✅ Passed'
    : aiReport.status === 'partial'
      ? '⚠️ Partial'
      : aiReport.status === 'fail'
        ? '❌ Failed'
        : '⚠️ Error';

  const lines = [
    baseComment,
    '',
    '---',
    '',
    `### AI Test Results ${aiStatus}`,
    `Flows: **${aiReport.flowsPassed}/${aiReport.flowsTotal}** passed, ${aiReport.flowsFailed} failed, ${aiReport.flowsSkipped} skipped`,
    `Code faults: ${aiReport.codeFaults}`,
    `Cost: $${aiReport.costUsd.toFixed(4)} | Duration: ${(aiReport.durationMs / 1000).toFixed(1)}s`,
  ];

  // Top findings (max 5)
  const topFindings = aiReport.findings.slice(0, 5);
  if (topFindings.length > 0) {
    lines.push('', '**Key findings:**');
    for (const finding of topFindings) {
      const icon = severityIcon[finding.severity] ?? '⚪';
      lines.push(`- ${icon} **${finding.severity}**: ${finding.message}`);
    }
  }

  // Full report in collapsible details
  if (aiReport.reportMd) {
    lines.push(
      '',
      '<details>',
      '<summary>Full AI Test Report</summary>',
      '',
      aiReport.reportMd,
      '',
      '</details>',
    );
  }

  lines.push('', 'Report generated by Autobot service.');

  return lines.join('\n');
}
