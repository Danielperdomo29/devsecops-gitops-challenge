// Logger estructurado JSON (una línea por evento) listo para Loki/ELK/CloudWatch.
// Sin dependencias: menos superficie de ataque en la cadena de suministro (SCA).

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger({ level = 'info', stream = process.stdout, base = {} } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const write = (lvl, msg, fields = {}) => {
    if (LEVELS[lvl] < threshold) return;
    const entry = { time: new Date().toISOString(), level: lvl, msg, ...base, ...fields };
    stream.write(`${JSON.stringify(entry)}\n`);
  };

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}
