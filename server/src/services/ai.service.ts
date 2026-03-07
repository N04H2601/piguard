import { getConfig } from '../config.js';
import { getCurrentSnapshot } from './system-monitor.service.js';
import { alertsRepo, healthChecksRepo, nginxStatsRepo } from '../database/repositories.js';
import { collectAllContainerStats } from '../collectors/docker.collector.js';
import { collectSecurityScore } from '../collectors/security.collector.js';
import { detectVhosts } from '../collectors/nginx.collector.js';
import { getAppLanguage } from './setup.service.js';

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function getAiStatus() {
  const config = getConfig();
  return {
    configured: Boolean(config.OPENAI_API_KEY),
    model: config.OPENAI_MODEL,
  };
}

export function getConversationWelcomeMessage() {
  const language = getAppLanguage();
  if (language === 'en') {
    return 'Hello. I answer in a short operational format with three sections: investigation, identified issue, and concrete solution. Pick a guided action or ask your question.';
  }
  return 'Bonjour. Je réponds de façon courte et opérationnelle avec trois sections : investigation, probleme identifie et solution concrete. Choisis une action guidee ou pose ta question.';
}

export async function createDashboardAdvice(messages: AssistantMessage[]) {
  const config = getConfig();
  if (!config.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const context = await buildDashboardContext();
  const input = buildModelInput(messages, context);
  const modelsToTry = [...new Set([config.OPENAI_MODEL, 'gpt-5.4', 'gpt-5'])];

  let lastError = 'OpenAI request failed';
  for (const model of modelsToTry) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        input,
        max_output_tokens: 700,
        store: false,
      }),
    });

    const payload: any = await response.json();
    if (!response.ok) {
      lastError = payload?.error?.message ?? `OpenAI request failed with status ${response.status}`;
      continue;
    }

    const answer = extractTextResponse(payload);
    if (!answer) {
      lastError = 'OpenAI returned an empty response';
      continue;
    }

    return {
      answer,
      context,
      model,
    };
  }

  throw new Error(lastError);
}

async function buildDashboardContext() {
  const [system, containers, security] = await Promise.all([
    getCurrentSnapshot(),
    collectAllContainerStats(),
    collectSecurityScore(),
  ]);

  const checks = healthChecksRepo.getAll() as any[];
  const activeAlerts = alertsRepo.getActive() as any[];
  const recentAlerts = alertsRepo.getHistory(10) as any[];
  const nginxHistory = nginxStatsRepo.query(Date.now() - 3600000, Date.now()) as any[];
  const nginxSummary = summarizeNginxHistory(nginxHistory);

  const runningContainers = containers.filter((container) => container.state === 'running');
  const downChecks = checks.filter((check) => check.enabled && check.last_status === 'down');

  return {
    generatedAt: new Date().toISOString(),
    system: {
      cpuOverall: system.cpu.overall,
      loadAvg: system.cpu.loadAvg,
      coreCount: system.cpu.coreCount,
      memoryUsedPercent: system.memory.usedPercent,
      memoryUsed: system.memory.used,
      memoryTotal: system.memory.total,
      temperature: system.temperature.temp,
      uptimeSeconds: system.uptime.seconds,
      disks: system.disk.map((disk) => ({
        mount: disk.mount,
        usedPercent: disk.usedPercent,
        readIops: disk.readIops,
        writeIops: disk.writeIops,
        readBps: disk.readBps,
        writeBps: disk.writeBps,
      })),
      network: system.network.map((iface) => ({
        name: iface.name,
        rxRate: iface.rxRate,
        txRate: iface.txRate,
      })),
      topProcesses: system.processes.slice(0, 5).map((processEntry) => ({
        pid: processEntry.pid,
        cpu: processEntry.cpu,
        mem: processEntry.mem,
        command: processEntry.command,
      })),
    },
    alerts: {
      activeCount: activeAlerts.length,
      active: activeAlerts.slice(0, 10).map((alert) => ({
        name: alert.rule_name,
        severity: alert.severity,
        message: alert.message,
        firedAt: alert.fired_at,
      })),
      recent: recentAlerts.slice(0, 10).map((alert) => ({
        name: alert.rule_name,
        severity: alert.severity,
        status: alert.status,
        firedAt: alert.fired_at,
      })),
    },
    health: {
      totalChecks: checks.length,
      downCount: downChecks.length,
      downServices: downChecks.map((check) => ({
        name: check.name,
        target: check.target,
        lastError: check.last_error,
        lastLatencyMs: check.last_latency_ms,
      })),
      checks: checks.map((check) => ({
        name: check.name,
        target: check.target,
        enabled: Boolean(check.enabled),
        status: check.last_status ?? 'unknown',
        latencyMs: check.last_latency_ms,
      })),
    },
    docker: {
      totalContainers: containers.length,
      runningCount: runningContainers.length,
      stoppedCount: containers.length - runningContainers.length,
      busiestContainers: runningContainers
        .filter((container) => container.stats)
        .sort((left, right) => (right.stats?.cpuPercent ?? 0) - (left.stats?.cpuPercent ?? 0))
        .slice(0, 6)
        .map((container) => ({
          name: container.name,
          state: container.state,
          cpuPercent: container.stats?.cpuPercent ?? 0,
          memoryPercent: container.stats?.memoryPercent ?? 0,
          memoryUsage: container.stats?.memoryUsage ?? 0,
        })),
    },
    security: {
      score: security.score,
      failedChecks: security.checks.filter((check) => check.status !== 'pass').map((check) => ({
        name: check.name,
        status: check.status,
        details: check.details,
      })),
    },
    nginx: {
      vhosts: detectVhosts(),
      summaryLastHour: nginxSummary,
    },
  };
}

function summarizeNginxHistory(entries: any[]) {
  return entries.reduce(
    (summary, entry) => {
      summary.requestCount += entry.requests ?? 0;
      summary.status2xx += entry.status_2xx ?? 0;
      summary.status3xx += entry.status_3xx ?? 0;
      summary.status4xx += entry.status_4xx ?? 0;
      summary.status5xx += entry.status_5xx ?? 0;
      summary.bytesSent += entry.bytes_sent ?? 0;
      return summary;
    },
    { requestCount: 0, status2xx: 0, status3xx: 0, status4xx: 0, status5xx: 0, bytesSent: 0 }
  );
}

function buildModelInput(messages: AssistantMessage[], context: unknown) {
  const language = getAppLanguage();
  const normalizedMessages = messages
    .slice(-24)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 4000),
    }));

  return [
    {
      role: 'system',
      content: language === 'en'
        ? [
            'You are the embedded monitoring assistant for a Raspberry Pi dashboard.',
            'You answer in English by default, unless the user explicitly asks for another language.',
            'You analyze the whole dashboard state: system resources, alerts, health checks, Docker, security, and nginx.',
            'Prioritize incidents, bottlenecks, down services, security anomalies, and concrete short-term actions.',
            'Be precise, operational, and very concise.',
            'Unless the user asks otherwise, answer in markdown with exactly three short sections: "### Investigation", "### Identified issue", "### Concrete solution".',
            'Investigation must fit in 1 or 2 sentences maximum.',
            'Identified issue must fit in 1 or 2 bullet points maximum.',
            'Concrete solution must contain 2 to 4 directly actionable steps maximum.',
            'No preamble, no conclusion, no filler.',
            'Do not invent metrics that are not in the context. If data is missing, say so explicitly.',
          ].join(' ')
        : [
            'Tu es l\'assistant de monitoring embarqué du dashboard Raspberry Pi.',
            'Tu réponds en français par défaut, sauf si l\'utilisateur demande explicitement une autre langue.',
            'Tu analyses l\'ensemble de l\'état du dashboard: ressources système, alertes, checks de santé, Docker, sécurité et nginx.',
            'Priorise les incidents, les goulots d\'étranglement, les services down, les anomalies sécurité et les actions concrètes à court terme.',
            'Sois précis, opérationnel et très concis.',
            'Sauf demande contraire, réponds en markdown avec exactement trois sections courtes: "### Investigation", "### Probleme identifie", "### Solution concrete".',
            'La section Investigation doit tenir en 1 ou 2 phrases maximum.',
            'La section Probleme identifie doit tenir en 1 ou 2 puces maximum.',
            'La section Solution concrete doit contenir 2 a 4 actions maximum, directement executables.',
            'Pas de préambule, pas de conclusion, pas de remplissage.',
            'N\'invente aucune métrique absente du contexte. Si une donnée manque, dis-le explicitement.',
          ].join(' '),
    },
    {
      role: 'system',
      content: `Contexte dashboard:\n${JSON.stringify(context, null, 2)}`,
    },
    ...normalizedMessages,
  ];
}

function extractTextResponse(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const chunks: string[] = [];
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === 'string' && content.text.trim()) {
        chunks.push(content.text.trim());
      }
    }
  }

  return chunks.join('\n\n').trim();
}
