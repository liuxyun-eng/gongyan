// This adapter is server-only. The database RPC rejects every role other than service_role.
export function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid SQL number');
    return String(value);
  }
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('Invalid SQL value');
  // A hex-encoded UTF-8 string keeps both quotes and backslashes out of SQL syntax.
  return `convert_from(decode('${Buffer.from(value).toString('hex')}', 'hex'), 'UTF8')`;
}
export function bindSql(sql, values) {
  let index = 0, quote = false;
  let output = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      output += c;
      if (quote && sql[i + 1] === "'") { output += sql[++i]; continue; }
      quote = !quote;
    } else if (c === '?' && !quote) {
      if (index >= values.length) throw new Error('Missing SQL parameter');
      output += literal(values[index++]);
    } else output += c;
  }
  if (quote || index !== values.length) throw new Error('Invalid SQL parameters');
  if (/^INSERT OR IGNORE /i.test(output)) output = output.replace(/^INSERT OR IGNORE /i, 'INSERT ') + ' ON CONFLICT DO NOTHING';
  return output;
}
export class Database {
  constructor(call) { this.call = call; }
  prepare(sql) {
    const statement = {
      sql, values: [],
      bind(...values) { return Object.assign(Object.create(this), { values }); },
      execute: async function() { return (await this.database.batch([this]))[0]; },
      async first() { return (await this.execute()).results[0] || null; },
      all() { return this.execute(); },
      run() { return this.execute(); },
      database: this,
    };
    return statement;
  }
  batch(statements) {
    return this.call('gongyan_internal_batch', { statements: statements.map(s => bindSql(s.sql, s.values)) });
  }
}
