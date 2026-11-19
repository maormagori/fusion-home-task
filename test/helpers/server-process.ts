import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { StatusCodes } from 'http-status-codes';
import { expect } from 'vitest';
import { FEEDBACK_PATH } from '../../src/api/feedback.schemas.js';
import type { Config } from '../../src/config.js';
import { TEST_HOST } from './test-config.js';

export const FETCH_TIMEOUT_MS = 2_000;
const STARTUP_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

export interface ServerProcess {
  baseUrl: string;
  logs: string[];
  ready(): Promise<void>;
  stop(signal?: NodeJS.Signals): Promise<void>;
}

export function startServerProcess(config: Config): ServerProcess {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(config)) env[key] = String(value);
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { env, stdio: 'pipe' });
  const baseUrl = `http://${TEST_HOST}:${config.PORT}`;
  const logs: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  return {
    baseUrl, logs,
    async ready(): Promise<void> {
      await expect.poll(async () => {
        const response = await fetch(`${baseUrl}${FEEDBACK_PATH}`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }).catch(() => null);
        return response?.status;
      }, { timeout: STARTUP_TIMEOUT_MS }).toBe(StatusCodes.OK);
    },
    async stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
      if (!hasExited(child)) child.kill(signal);
      await expect.poll(() => hasExited(child), { timeout: SHUTDOWN_TIMEOUT_MS }).toBe(true);
    },
  };
}

export async function findAvailablePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, TEST_HOST, resolve));
  const address = reservation.address();
  if (address === null || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}
