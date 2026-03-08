import { getDatabase } from './init.js';

export const metricsRepo = {
  insert(metric: string, value: number, labels: Record<string, string> = {}, nodeId = 'local') {
    const db = getDatabase();
    db.prepare(
      'INSERT INTO metrics (timestamp, metric, value, labels, node_id) VALUES (?, ?, ?, ?, ?)'
    ).run(Date.now(), metric, value, JSON.stringify(labels), nodeId);
  },

  insertBatch(entries: Array<{ metric: string; value: number; labels?: Record<string, string>; nodeId?: string }>) {
    const db = getDatabase();
    const stmt = db.prepare(
      'INSERT INTO metrics (timestamp, metric, value, labels, node_id) VALUES (?, ?, ?, ?, ?)'
    );
    const now = Date.now();
    const tx = db.transaction(() => {
      for (const e of entries) {
        stmt.run(now, e.metric, e.value, JSON.stringify(e.labels ?? {}), e.nodeId ?? 'local');
      }
    });
    tx();
  },

  query(metric: string, from: number, to: number, nodeId = 'local', limit = 1000): any[] {
    const db = getDatabase();
    return db.prepare(
      'SELECT timestamp, value, labels FROM metrics WHERE metric = ? AND timestamp >= ? AND timestamp <= ? AND node_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(metric, from, to, nodeId, limit);
  },

  downsample() {
    const db = getDatabase();
    const now = Date.now();
    db.prepare(`
      INSERT INTO metrics (timestamp, metric, value, labels, node_id)
      SELECT
        bucket_ts,
        metric,
        AVG(value),
        json_insert(COALESCE(labels, '{}'), '$.downsampled', '1', '$.aggregation', 'avg', '$.window', '1h'),
        node_id
      FROM (
        SELECT
          ((timestamp / 3600000) * 3600000) AS bucket_ts,
          metric,
          value,
          labels,
          node_id
        FROM metrics
        WHERE timestamp < ?
          AND json_extract(COALESCE(labels, '{}'), '$.downsampled') IS NULL
      )
      GROUP BY bucket_ts, metric, labels, node_id
    `).run(now - 86400000);

    db.prepare('DELETE FROM metrics WHERE timestamp < ? AND labels NOT LIKE ?')
      .run(now - 86400000, '%"downsampled"%');
  },

  cleanup(maxAgeDays = 90) {
    const db = getDatabase();
    db.prepare('DELETE FROM metrics WHERE timestamp < ?')
      .run(Date.now() - maxAgeDays * 86400000);
  },
};

export const alertsRepo = {
  getRules() {
    return getDatabase().prepare('SELECT * FROM alert_rules WHERE enabled = 1').all();
  },

  getAllRules() {
    return getDatabase().prepare('SELECT * FROM alert_rules ORDER BY id').all();
  },

  createRule(rule: { name: string; metric: string; condition: string; threshold: number; duration_s?: number; cooldown_s?: number; severity?: string; channels?: string[] }) {
    return getDatabase().prepare(
      'INSERT INTO alert_rules (name, metric, condition, threshold, duration_s, cooldown_s, severity, channels) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(rule.name, rule.metric, rule.condition, rule.threshold, rule.duration_s ?? 0, rule.cooldown_s ?? 300, rule.severity ?? 'warning', JSON.stringify(rule.channels ?? []));
  },

  updateRule(id: number, updates: Record<string, any>) {
    const db = getDatabase();
    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates).map(v => Array.isArray(v) ? JSON.stringify(v) : v);
    db.prepare(`UPDATE alert_rules SET ${fields} WHERE id = ?`).run(...values, id);
  },

  deleteRule(id: number) {
    getDatabase().prepare('DELETE FROM alert_rules WHERE id = ?').run(id);
  },

  fireAlert(ruleId: number, value: number, message: string) {
    return getDatabase().prepare(
      'INSERT INTO alert_history (rule_id, status, value, message) VALUES (?, ?, ?, ?)'
    ).run(ruleId, 'fired', value, message);
  },

  resolveAlert(id: number) {
    getDatabase().prepare(
      "UPDATE alert_history SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?"
    ).run(id);
  },

  resolveActiveForRule(ruleId: number) {
    getDatabase().prepare(
      "UPDATE alert_history SET status = 'resolved', resolved_at = datetime('now') WHERE rule_id = ? AND status IN ('fired', 'dismissed')"
    ).run(ruleId);
  },

  acknowledgeAlert(id: number) {
    getDatabase().prepare(
      "UPDATE alert_history SET acknowledged = 1, status = CASE WHEN status = 'fired' THEN 'dismissed' ELSE status END WHERE id = ?"
    ).run(id);
  },

  getHistory(limit = 100) {
    return getDatabase().prepare(
      "SELECT ah.*, ar.name as rule_name, ar.severity FROM alert_history ah JOIN alert_rules ar ON ah.rule_id = ar.id WHERE ah.status IN ('resolved', 'dismissed') ORDER BY ah.fired_at DESC LIMIT ?"
    ).all(limit);
  },

  clearHistory() {
    return getDatabase().prepare(
      "DELETE FROM alert_history WHERE status = 'resolved'"
    ).run();
  },

  getActive() {
    return getDatabase().prepare(
      "SELECT ah.*, ar.name as rule_name, ar.severity FROM alert_history ah JOIN alert_rules ar ON ah.rule_id = ar.id WHERE ah.status = 'fired' AND ah.id IN (SELECT MAX(id) FROM alert_history GROUP BY rule_id) ORDER BY ah.fired_at DESC"
    ).all();
  },

  getActiveForRule(ruleId: number) {
    return getDatabase().prepare(
      "SELECT * FROM alert_history WHERE rule_id = ? AND status IN ('fired', 'dismissed') ORDER BY id DESC LIMIT 1"
    ).get(ruleId);
  },
};

export const healthChecksRepo = {
  getAll() {
    return getDatabase().prepare(`
      SELECT
        hc.*,
        cr.status AS last_status,
        cr.timestamp AS last_checked,
        cr.latency_ms AS last_latency_ms,
        cr.error AS last_error
      FROM health_checks hc
      LEFT JOIN check_results cr
        ON cr.id = (
          SELECT id
          FROM check_results
          WHERE check_id = hc.id
          ORDER BY timestamp DESC
          LIMIT 1
        )
      ORDER BY hc.id
    `).all();
  },

  getEnabled() {
    return getDatabase().prepare(`
      SELECT
        hc.*,
        cr.status AS last_status,
        cr.timestamp AS last_checked,
        cr.latency_ms AS last_latency_ms,
        cr.error AS last_error
      FROM health_checks hc
      LEFT JOIN check_results cr
        ON cr.id = (
          SELECT id
          FROM check_results
          WHERE check_id = hc.id
          ORDER BY timestamp DESC
          LIMIT 1
        )
      WHERE hc.enabled = 1
      ORDER BY hc.id
    `).all();
  },

  create(check: { name: string; type: string; target: string; interval_s?: number; timeout_ms?: number; expected_status?: number }) {
    return getDatabase().prepare(
      'INSERT INTO health_checks (name, type, target, interval_s, timeout_ms, expected_status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(check.name, check.type, check.target, check.interval_s ?? 60, check.timeout_ms ?? 10000, check.expected_status ?? 200);
  },

  update(id: number, updates: Record<string, any>) {
    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    getDatabase().prepare(`UPDATE health_checks SET ${fields} WHERE id = ?`).run(...Object.values(updates), id);
  },

  delete(id: number) {
    getDatabase().prepare('DELETE FROM health_checks WHERE id = ?').run(id);
  },

  replaceAll(checks: Array<{ name: string; type: string; target: string; interval_s?: number; timeout_ms?: number; expected_status?: number; enabled?: number }>) {
    const db = getDatabase();
    const insert = db.prepare(
      'INSERT INTO health_checks (name, type, target, interval_s, timeout_ms, expected_status, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM health_checks').run();
      for (const check of checks) {
        insert.run(
          check.name,
          check.type,
          check.target,
          check.interval_s ?? 60,
          check.timeout_ms ?? 10000,
          check.expected_status ?? 200,
          check.enabled ?? 1
        );
      }
    });
    tx();
  },

  insertResult(checkId: number, status: string, latencyMs: number | null, error: string | null) {
    getDatabase().prepare(
      'INSERT INTO check_results (check_id, timestamp, status, latency_ms, error) VALUES (?, ?, ?, ?, ?)'
    ).run(checkId, Date.now(), status, latencyMs, error);
  },

  getResults(checkId: number, limit = 100) {
    return getDatabase().prepare(
      'SELECT * FROM check_results WHERE check_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(checkId, limit);
  },

  getUptime(checkId: number, periodMs: number) {
    const db = getDatabase();
    const since = Date.now() - periodMs;
    const total = db.prepare('SELECT COUNT(*) as c FROM check_results WHERE check_id = ? AND timestamp >= ?').get(checkId, since) as any;
    const up = db.prepare("SELECT COUNT(*) as c FROM check_results WHERE check_id = ? AND timestamp >= ? AND status = 'up'").get(checkId, since) as any;
    return total.c > 0 ? (up.c / total.c) * 100 : 100;
  },

  cleanupResults(maxAgeDays = 30) {
    getDatabase().prepare(
      'DELETE FROM check_results WHERE timestamp < ?'
    ).run(Date.now() - maxAgeDays * 86400000);
  },
};

export const securityRepo = {
  insertEvent(type: string, sourceIp: string | null, country: string | null, details: Record<string, any> = {}, severity = 'info') {
    getDatabase().prepare(
      'INSERT INTO security_events (timestamp, type, source_ip, country, details, severity) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(Date.now(), type, sourceIp, country, JSON.stringify(details), severity);
  },

  getEvents(limit = 200, type?: string) {
    if (type) {
      return getDatabase().prepare('SELECT * FROM security_events WHERE type = ? ORDER BY timestamp DESC LIMIT ?').all(type, limit);
    }
    return getDatabase().prepare('SELECT * FROM security_events ORDER BY timestamp DESC LIMIT ?').all(limit);
  },

  cleanup(maxAgeDays = 30) {
    getDatabase().prepare(
      'DELETE FROM security_events WHERE timestamp < ?'
    ).run(Date.now() - maxAgeDays * 86400000);
  },
};

export const apiKeysRepo = {
  getAll() {
    return getDatabase().prepare('SELECT id, name, created_at, last_used, enabled FROM api_keys ORDER BY id').all();
  },

  create(name: string, keyHash: string) {
    return getDatabase().prepare('INSERT INTO api_keys (name, key_hash) VALUES (?, ?)').run(name, keyHash);
  },

  findByHash(hash: string) {
    return getDatabase().prepare('SELECT * FROM api_keys WHERE key_hash = ? AND enabled = 1').get(hash);
  },

  updateLastUsed(id: number) {
    getDatabase().prepare("UPDATE api_keys SET last_used = datetime('now') WHERE id = ?").run(id);
  },

  delete(id: number) {
    getDatabase().prepare('DELETE FROM api_keys WHERE id = ?').run(id);
  },
};

export const arpRepo = {
  upsert(mac: string, ip: string, hostname?: string) {
    getDatabase().prepare(`
      INSERT INTO arp_devices (mac, ip, hostname, last_seen) VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(mac) DO UPDATE SET ip = ?, hostname = COALESCE(?, hostname), last_seen = datetime('now')
    `).run(mac, ip, hostname ?? null, ip, hostname ?? null);
  },

  getAll() {
    return getDatabase().prepare('SELECT * FROM arp_devices ORDER BY last_seen DESC').all();
  },

  setKnown(mac: string, known: boolean, alias?: string) {
    getDatabase().prepare('UPDATE arp_devices SET known = ?, alias = COALESCE(?, alias) WHERE mac = ?').run(known ? 1 : 0, alias ?? null, mac);
  },

};

export const loginRepo = {
  record(ip: string, userAgent: string | null, success: boolean, username: string) {
    getDatabase().prepare(
      'INSERT INTO login_attempts (timestamp, ip, user_agent, success, username) VALUES (?, ?, ?, ?, ?)'
    ).run(Date.now(), ip, userAgent, success ? 1 : 0, username);
  },

  getRecent(limit = 50) {
    return getDatabase().prepare('SELECT * FROM login_attempts ORDER BY timestamp DESC LIMIT ?').all(limit);
  },

  cleanup(maxAgeDays = 90) {
    getDatabase().prepare(
      'DELETE FROM login_attempts WHERE timestamp < ?'
    ).run(Date.now() - maxAgeDays * 86400000);
  },

};

export const revokedTokensRepo = {
  revoke(jti: string, expiresAt: number) {
    getDatabase().prepare(
      "INSERT INTO revoked_tokens (jti, expires_at, revoked_at) VALUES (?, ?, datetime('now')) ON CONFLICT(jti) DO UPDATE SET expires_at = excluded.expires_at, revoked_at = datetime('now')"
    ).run(jti, expiresAt);
  },

  isRevoked(jti: string) {
    const row = getDatabase().prepare(
      'SELECT 1 FROM revoked_tokens WHERE jti = ? LIMIT 1'
    ).get(jti);
    return Boolean(row);
  },

  cleanup() {
    getDatabase().prepare(
      'DELETE FROM revoked_tokens WHERE expires_at < ?'
    ).run(Date.now());
  },
};

export const settingsRepo = {
  get(key: string, defaultValue?: string): string | undefined {
    const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
    return row?.value ?? defaultValue;
  },

  set(key: string, value: string) {
    getDatabase().prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
    ).run(key, value, value);
  },

  getAll() {
    return getDatabase().prepare('SELECT * FROM settings ORDER BY key').all();
  },

};

export const nginxStatsRepo = {
  insert(stats: { vhost?: string; requests: number; status_2xx: number; status_3xx: number; status_4xx: number; status_5xx: number; bytes_sent: number }) {
    getDatabase().prepare(
      'INSERT INTO nginx_stats (timestamp, vhost, requests, status_2xx, status_3xx, status_4xx, status_5xx, bytes_sent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(Date.now(), stats.vhost ?? null, stats.requests, stats.status_2xx, stats.status_3xx, stats.status_4xx, stats.status_5xx, stats.bytes_sent);
  },

  query(from: number, to: number, vhost?: string) {
    if (vhost) {
      return getDatabase().prepare('SELECT * FROM nginx_stats WHERE timestamp >= ? AND timestamp <= ? AND vhost = ? ORDER BY timestamp').all(from, to, vhost);
    }
    return getDatabase().prepare('SELECT * FROM nginx_stats WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp').all(from, to);
  },

  cleanup(maxAgeDays = 30) {
    getDatabase().prepare(
      'DELETE FROM nginx_stats WHERE timestamp < ?'
    ).run(Date.now() - maxAgeDays * 86400000);
  },
};

export const aiChatRepo = {
  listConversations(archived = false) {
    return getDatabase().prepare(`
      SELECT
        c.id,
        c.title,
        c.created_at,
        c.updated_at,
        c.archived,
        c.archived_at,
        (
          SELECT content
          FROM ai_messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.id DESC
          LIMIT 1
        ) AS last_message,
        (
          SELECT created_at
          FROM ai_messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.id DESC
          LIMIT 1
        ) AS last_message_at,
        (
          SELECT COUNT(*)
          FROM ai_messages m
          WHERE m.conversation_id = c.id
            AND m.role = 'user'
        ) AS user_message_count
      FROM ai_conversations c
      WHERE c.archived = ?
      ORDER BY c.updated_at DESC, c.id DESC
    `).all(archived ? 1 : 0);
  },

  createConversation(title = 'Nouvelle conversation') {
    const db = getDatabase();
    const result = db.prepare(
      "INSERT INTO ai_conversations (title, created_at, updated_at) VALUES (?, datetime('now'), datetime('now'))"
    ).run(title);
    return db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(result.lastInsertRowid);
  },

  getConversation(id: number) {
    return getDatabase().prepare('SELECT * FROM ai_conversations WHERE id = ?').get(id);
  },

  renameConversation(id: number, title: string) {
    getDatabase().prepare(
      "UPDATE ai_conversations SET title = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(title, id);
  },

  touchConversation(id: number) {
    getDatabase().prepare(
      "UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ?"
    ).run(id);
  },

  setArchived(id: number, archived: boolean) {
    getDatabase().prepare(
      "UPDATE ai_conversations SET archived = ?, archived_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END, updated_at = datetime('now') WHERE id = ?"
    ).run(archived ? 1 : 0, archived ? 1 : 0, id);
  },

  setArchivedAll(archived: boolean) {
    getDatabase().prepare(
      "UPDATE ai_conversations SET archived = ?, archived_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END, updated_at = datetime('now') WHERE archived != ?"
    ).run(archived ? 1 : 0, archived ? 1 : 0, archived ? 1 : 0);
  },

  deleteConversation(id: number) {
    getDatabase().prepare('DELETE FROM ai_conversations WHERE id = ?').run(id);
  },

  deleteArchivedAll() {
    getDatabase().prepare('DELETE FROM ai_conversations WHERE archived = 1').run();
  },

  clearMemory(id: number) {
    const db = getDatabase();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM ai_messages WHERE conversation_id = ?').run(id);
      db.prepare(
        "UPDATE ai_conversations SET title = 'Memoire effacee', updated_at = datetime('now') WHERE id = ?"
      ).run(id);
    });
    tx();
  },

  cleanupArchivedEmpty(maxAgeDays = 30) {
    getDatabase().prepare(`
      DELETE FROM ai_conversations
      WHERE archived = 1
        AND updated_at < datetime('now', ?)
        AND id NOT IN (
          SELECT DISTINCT conversation_id
          FROM ai_messages
        )
    `).run(`-${maxAgeDays} days`);
  },

  listMessages(conversationId: number) {
    return getDatabase().prepare(`
      SELECT id, conversation_id, role, content, created_at
      FROM ai_messages
      WHERE conversation_id = ?
      ORDER BY id ASC
    `).all(conversationId);
  },

  addMessage(conversationId: number, role: 'user' | 'assistant', content: string) {
    const db = getDatabase();
    const result = db.prepare(
      "INSERT INTO ai_messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, datetime('now'))"
    ).run(conversationId, role, content);
    this.touchConversation(conversationId);
    return db.prepare('SELECT * FROM ai_messages WHERE id = ?').get(result.lastInsertRowid);
  },
};
