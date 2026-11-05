import { mkdirSync, writeFileSync } from 'node:fs';
import type { Plugin } from 'vite';

// Nur Dev-Server: Benchmark-Seite schickt Messwerte per POST, landen als Beleg in tests/perf/results/.
export function benchSink(): Plugin {
  return {
    name: 'bench-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__bench', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          const result = JSON.parse(body) as { engine: string };
          mkdirSync('tests/perf/results', { recursive: true });
          writeFileSync(`tests/perf/results/${result.engine}-${Date.now()}.json`, JSON.stringify(result, null, 2));
          res.end('ok');
        });
      });
    },
  };
}
