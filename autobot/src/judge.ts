import fs from 'node:fs/promises';
import OpenAI from 'openai';
import { PhaseRecord, PhaseJudgment, QaFinding } from './types';
import { CONFIG } from './config';
import { sleep } from './utils';

const openai = CONFIG.openAiApiKey ? new OpenAI({ apiKey: CONFIG.openAiApiKey }) : null;

const buildPrompt = (phase: PhaseRecord): string => {
  return `You are a QA UI model reviewing a rendered webpage screenshot.

Context:
- Route key: ${phase.routeKey}
- URL: ${phase.url}
- Viewport: ${phase.viewport}
- Phase: ${phase.phase}

Rate this screenshot for:
1) alignment and spacing consistency
2) typography and hierarchy quality
3) responsive behavior
4) professionalism and visual polish
5) obvious accidental artifacts (overlaps, cutoffs, broken cards, odd blank spaces)

Return ONLY compact JSON with this exact shape:
{
  "score": number,
  "confidence": number,
  "findings": [
    {"severity":"blocking|high|medium|low", "category":"alignment|spacing|copy|contrast|layout|accessibility|interaction|other", "message":"short", "suggestion":"short", "confidence":0.0},
    ...
  ],
  "notes":"short"
}

Score should be 0-100 where 100 is clean.
Use at most 4 findings.
Use blocking only for serious regressions (critical overlap, cut off text, unreadable layout, or obviously broken interaction affordance).
`;
};

type JudgeSeverity = 'blocking' | 'high' | 'medium' | 'low';

const normalizeSeverity = (value: unknown): JudgeSeverity => {
  if (value === 'blocking' || value === 'high' || value === 'medium' || value === 'low') return value;
  return 'low';
};

const normalizeConfidence = (value: unknown): number | undefined => {
  const valueAsNumber = Number(value);
  if (!Number.isFinite(valueAsNumber)) return undefined;
  return Math.min(1, Math.max(0, valueAsNumber));
};

const normalizeFinding = (raw: unknown): QaFinding | null => {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.message !== 'string') return null;
  return {
    severity: normalizeSeverity(candidate.severity),
    category: typeof candidate.category === 'string' ? candidate.category : 'other',
    message: String(candidate.message),
    suggestion: typeof candidate.suggestion === 'string' ? candidate.suggestion : undefined,
    confidence: normalizeConfidence(candidate.confidence),
  };
};

const stripCodeFence = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
};

function coerceJudge(raw: string): PhaseJudgment {
  try {
    const cleaned = stripCodeFence(raw);
    const json = JSON.parse(cleaned) as PhaseJudgment;
    const score = Number(json.score);
    const confidence = Number(json.confidence);
    const findings = Array.isArray(json.findings) ? json.findings : [];

    return {
      score: Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
      findings: findings
        .map(normalizeFinding)
        .filter((finding): finding is QaFinding => !!finding)
        .slice(0, 6),
      notes: typeof json.notes === 'string' ? json.notes : 'No notes',
    };
  } catch {
    return {
      score: 20,
      confidence: 0.2,
      findings: [
        {
          severity: 'low',
          category: 'other',
          message: 'Judge output could not be parsed; manual review required.',
        },
      ],
      notes: 'Parser fallback used. Raw response was not valid JSON.',
    };
  }
}

export async function judgeScreenshots(phases: PhaseRecord[]): Promise<PhaseRecord[]> {
  if (!openai) {
    return phases.map((phase) => ({
      ...phase,
      judge: {
        score: 100,
        confidence: 0,
        findings: [],
        notes: 'OpenAI not configured; skipped AI scoring.',
      },
    }));
  }

  const judgeable = phases.filter((phase) => phase.status === 'captured');

  for (const phase of phases) {
    if (!judgeable.includes(phase)) continue;

    let retries = 0;
    while (retries <= CONFIG.openAiRetries) {
      try {
        const bytes = await fs.readFile(phase.screenshotPath);
        const base64 = bytes.toString('base64');
        const request = openai.chat.completions.create({
          model: CONFIG.openAiModel,
          temperature: 0.2,
          max_tokens: CONFIG.openAiMaxTokens,
          messages: [
            {
              role: 'system',
              content: 'You are a visual regression QA assistant for web screenshots.',
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: buildPrompt(phase),
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/png;base64,${base64}`,
                  },
                },
              ],
            },
          ],
          response_format: {
            type: 'json_object',
          },
        });
        const timeout = new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error(`OpenAI request timed out after ${CONFIG.openAiTimeoutMs}ms`)),
            CONFIG.openAiTimeoutMs,
          );
        });

        const response = await Promise.race([request, timeout]);

        const content = response.choices?.[0]?.message?.content;
        if (!content) throw new Error('No content returned from model');
        phase.judge = coerceJudge(content);
        break;
      } catch (error) {
        retries += 1;
        await sleep(350 * retries);
        if (retries > CONFIG.openAiRetries) {
          phase.judge = {
            score: 30,
            confidence: 0.15,
            findings: [
              {
                severity: 'low',
                category: 'other',
                message: `Judge request failed after ${retries} attempts`,
                suggestion: 'Verify OpenAI credentials/network and retry.',
                confidence: 0.1,
              },
            ],
            notes: `Judge failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          };
        }
      }
    }
  }

  const skipped = phases.filter((phase) => phase.status !== 'captured');
  for (const phase of skipped) {
    if (!phase.judge) {
      phase.judge = {
        score: 0,
        confidence: 0,
        findings: [
          {
            severity: 'medium',
            category: 'other',
            message: 'No screenshot captured for this phase',
            suggestion: 'Verify route reachability and selectors.',
          },
        ],
        notes: 'No screenshot available',
      };
    }
  }

  return phases;
}
