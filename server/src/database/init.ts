import Database from 'better-sqlite3';
import { getConfig } from '../config.js';
import { getLogger } from '../logger.js';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

let db: Database.Database;

export function initDatabase(): Database.Database {
  const config = getConfig();
  const log = getLogger();

  mkdirSync(dirname(config.DB_PATH), { recursive: true });

  db = new Database(config.DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);

  log.info({ path: config.DB_PATH }, 'Database initialized');
  return db;
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function closeDatabase(): void {
  if (db?.open) {
    db.close();
  }
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const migrations: Array<{ name: string; sql: string }> = [
    {
      name: '001_metrics',
      sql: `
        CREATE TABLE IF NOT EXISTS metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          metric TEXT NOT NULL,
          value REAL NOT NULL,
          labels TEXT DEFAULT '{}',
          node_id TEXT DEFAULT 'local'
        );
        CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics(timestamp);
        CREATE INDEX IF NOT EXISTS idx_metrics_metric ON metrics(metric, timestamp);
        CREATE INDEX IF NOT EXISTS idx_metrics_node ON metrics(node_id, metric, timestamp);
      `,
    },
    {
      name: '002_alerts',
      sql: `
        CREATE TABLE IF NOT EXISTS alert_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          metric TEXT NOT NULL,
          condition TEXT NOT NULL,
          threshold REAL NOT NULL,
          duration_s INTEGER DEFAULT 0,
          cooldown_s INTEGER DEFAULT 300,
          severity TEXT DEFAULT 'warning',
          enabled INTEGER DEFAULT 1,
          channels TEXT DEFAULT '[]',
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS alert_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rule_id INTEGER REFERENCES alert_rules(id),
          status TEXT NOT NULL,
          value REAL,
          message TEXT,
          acknowledged INTEGER DEFAULT 0,
          fired_at TEXT DEFAULT (datetime('now')),
          resolved_at TEXT
        );
      `,
    },
    {
      name: '003_health_checks',
      sql: `
        CREATE TABLE IF NOT EXISTS health_checks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          target TEXT NOT NULL,
          interval_s INTEGER DEFAULT 60,
          timeout_ms INTEGER DEFAULT 10000,
          expected_status INTEGER DEFAULT 200,
          enabled INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS check_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          check_id INTEGER REFERENCES health_checks(id) ON DELETE CASCADE,
          timestamp INTEGER NOT NULL,
          status TEXT NOT NULL,
          latency_ms REAL,
          error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_check_results_ts ON check_results(check_id, timestamp);
      `,
    },
    {
      name: '004_security_events',
      sql: `
        CREATE TABLE IF NOT EXISTS security_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          type TEXT NOT NULL,
          source_ip TEXT,
          country TEXT,
          details TEXT DEFAULT '{}',
          severity TEXT DEFAULT 'info'
        );
        CREATE INDEX IF NOT EXISTS idx_security_ts ON security_events(timestamp);
        CREATE INDEX IF NOT EXISTS idx_security_type ON security_events(type, timestamp);
      `,
    },
    {
      name: '005_api_keys',
      sql: `
        CREATE TABLE IF NOT EXISTS api_keys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          key_hash TEXT NOT NULL UNIQUE,
          created_at TEXT DEFAULT (datetime('now')),
          last_used TEXT,
          enabled INTEGER DEFAULT 1
        );
      `,
    },
    {
      name: '006_arp_devices',
      sql: `
        CREATE TABLE IF NOT EXISTS arp_devices (
          mac TEXT PRIMARY KEY,
          ip TEXT,
          hostname TEXT,
          vendor TEXT,
          first_seen TEXT DEFAULT (datetime('now')),
          last_seen TEXT DEFAULT (datetime('now')),
          known INTEGER DEFAULT 0,
          alias TEXT
        );
      `,
    },
    {
      name: '007_nginx_stats',
      sql: `
        CREATE TABLE IF NOT EXISTS nginx_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          vhost TEXT,
          requests INTEGER DEFAULT 0,
          status_2xx INTEGER DEFAULT 0,
          status_3xx INTEGER DEFAULT 0,
          status_4xx INTEGER DEFAULT 0,
          status_5xx INTEGER DEFAULT 0,
          bytes_sent INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_nginx_ts ON nginx_stats(timestamp);
      `,
    },
    {
      name: '008_settings',
      sql: `
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `,
    },
    {
      name: '009_login_attempts',
      sql: `
        CREATE TABLE IF NOT EXISTS login_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          ip TEXT NOT NULL,
          user_agent TEXT,
          success INTEGER NOT NULL,
          username TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_login_ts ON login_attempts(timestamp);
      `,
    },
    {
      name: '010_ai_conversations',
      sql: `
        CREATE TABLE IF NOT EXISTS ai_conversations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL DEFAULT 'Nouvelle conversation',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS ai_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id, id);
        CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated ON ai_conversations(updated_at DESC, id DESC);
      `,
    },
    {
      name: '011_ai_conversation_archive',
      sql: `
        ALTER TABLE ai_conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE ai_conversations ADD COLUMN archived_at TEXT;
        CREATE INDEX IF NOT EXISTS idx_ai_conversations_archived ON ai_conversations(archived, updated_at DESC, id DESC);
      `,
    },
    {
      name: '012_alert_dismiss_status',
      sql: `
        UPDATE alert_history
        SET status = 'dismissed'
        WHERE status = 'fired' AND acknowledged = 1;
      `,
    },
    {
      name: '013_revoked_tokens',
      sql: `
        CREATE TABLE IF NOT EXISTS revoked_tokens (
          jti TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL,
          revoked_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);
      `,
    },
  ];

  const applied = new Set(
    db.prepare('SELECT name FROM migrations').all().map((r: any) => r.name)
  );

  const insert = db.prepare('INSERT INTO migrations (name) VALUES (?)');

  for (const m of migrations) {
    if (!applied.has(m.name)) {
      db.exec(m.sql);
      insert.run(m.name);
    }
  }
}
