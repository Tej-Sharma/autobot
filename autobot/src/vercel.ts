import { CONFIG } from './config';

interface ResolveVercelDeploymentInput {
  branch?: string;
  sha?: string;
}

export async function resolvePreviewUrl({ branch, sha }: ResolveVercelDeploymentInput): Promise<string | null> {
  if (!CONFIG.vercelToken || !CONFIG.vercelProjectId) return null;

  const query = new URLSearchParams({
    projectId: CONFIG.vercelProjectId,
    target: 'preview',
    state: 'READY',
    limit: '20',
    sort: 'createdAt',
    order: 'desc',
  });

  if (branch) {
    query.set('meta-gitBranch', branch);
  }

  const url = `https://api.vercel.com/v6/deployments?${query.toString()}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${CONFIG.vercelToken}`,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Vercel API failed: ${response.status} ${text}`);
    }

    const body = (await response.json()) as {
      deployments?: Array<{ readyState?: string; url?: string; alias?: string[]; meta?: { [key: string]: string } }>;
    };

    const deployments = body?.deployments ?? [];
    if (!deployments.length) return null;

    const exactSha = sha ? deployments.find((d) => d.meta?.['githubCommitRef'] === sha) : undefined;
    const match = exactSha || deployments[0];
    const rawUrl = match?.url || (match?.alias && match.alias[0]);
    if (!rawUrl) return null;
    return `https://${rawUrl}`;
  } catch (error) {
    console.warn('[vercel] failed to resolve preview URL', error);
    return null;
  }
}
