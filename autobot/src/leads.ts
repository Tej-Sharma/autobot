import { redis } from './redis';

const LEADS_PREFIX = 'autobot:lead:';
const LEADS_SET = 'autobot:leads';

export interface Lead {
  email: string;
  jobId: string;
  url: string;
  createdAt: string;
  plan?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

export async function saveLead(lead: Lead): Promise<void> {
  const key = `${LEADS_PREFIX}${lead.email}`;
  const existing = await redis.get(key);
  const prev: Lead | undefined = existing ? JSON.parse(existing) : undefined;
  const merged = { ...prev, ...lead };
  await redis.set(key, JSON.stringify(merged));
  await redis.sadd(LEADS_SET, lead.email);
}

export async function getLead(email: string): Promise<Lead | null> {
  const key = `${LEADS_PREFIX}${email}`;
  const val = await redis.get(key);
  return val ? JSON.parse(val) : null;
}

export async function updateLead(email: string, updates: Partial<Lead>): Promise<void> {
  const existing = await getLead(email);
  const base = existing ?? { email, jobId: '', url: '', createdAt: new Date().toISOString() };
  const merged = { ...base, ...updates };
  await redis.set(`${LEADS_PREFIX}${email}`, JSON.stringify(merged));
  await redis.sadd(LEADS_SET, email);
}

export async function getLeadRunHistory(email: string): Promise<string[]> {
  const key = `autobot:lead-runs:${email}`;
  return redis.lrange(key, 0, 49);
}

export async function addLeadRun(email: string, jobId: string): Promise<void> {
  const key = `autobot:lead-runs:${email}`;
  await redis.lpush(key, jobId);
  await redis.ltrim(key, 0, 49);
}
