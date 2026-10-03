import type { KernelMetadata } from './model';

export function normalizeServerUrl(raw: string): string {
  const url = new URL(raw);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Use an HTTP(S) server base URL without credentials, query parameters or fragments.',
    );
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol === 'http:' && !loopback)
    throw new Error('Use HTTPS for remote servers, or an SSH tunnel to localhost.');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url.toString();
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid Jupyter response');
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid Jupyter response field');
  return value;
}

export function parseMetadata(kernels: unknown, sessions: unknown): KernelMetadata[] {
  if (!Array.isArray(kernels) || !Array.isArray(sessions))
    throw new Error('Invalid Jupyter response');
  const paths = new Map<string, Set<string>>();
  for (const value of sessions) {
    const session = object(value);
    if (session.type !== 'notebook') continue;
    const kernel = object(session.kernel);
    const id = string(kernel.id);
    const set = paths.get(id) ?? new Set<string>();
    set.add(string(session.path));
    paths.set(id, set);
  }
  return kernels.map((value) => {
    const kernel = object(value);
    const id = string(kernel.id);
    return {
      id,
      name: string(kernel.name),
      executionState: string(kernel.execution_state),
      notebookPaths: [...(paths.get(id) ?? [])],
    };
  });
}

export class JupyterClient {
  readonly baseUrl: string;
  constructor(
    url: string,
    private readonly token: string,
    private readonly request: typeof fetch = fetch,
  ) {
    this.baseUrl = normalizeServerUrl(url);
  }

  private async send(endpoint: string, signal: AbortSignal, method = 'GET'): Promise<Response> {
    try {
      return await this.request(new URL(endpoint, this.baseUrl), {
        method,
        headers: this.token ? { Authorization: `token ${this.token}` } : {},
        redirect: 'error',
        signal,
      });
    } catch {
      throw new Error(
        method === 'DELETE'
          ? 'Jupyter shutdown failed or timed out. Refresh to check the kernel before trying again.'
          : 'Jupyter request failed or timed out. Check server access and authentication.',
      );
    }
  }

  private async get(endpoint: string, signal: AbortSignal): Promise<unknown> {
    const response = await this.send(endpoint, signal);
    if (!response.ok)
      throw new Error(
        `Jupyter returned HTTP ${response.status}. Check server access and authentication.`,
      );
    // Stream with a cap; do not include response bodies or credentials in errors.
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty Jupyter response');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 4 * 1024 * 1024) throw new Error('Jupyter response is too large');
        chunks.push(part.value);
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        throw new Error('Jupyter returned invalid JSON');
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  async metadata(): Promise<KernelMetadata[]> {
    // Both reads share a deadline, including consumption of response bodies.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const [kernels, sessions] = await Promise.all([
        this.get('api/kernels', controller.signal),
        this.get('api/sessions', controller.signal),
      ]);
      return parseMetadata(kernels, sessions);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  async shutdown(kernelId: string): Promise<void> {
    if (!/^[a-zA-Z0-9_-]+$/.test(kernelId)) throw new Error('Invalid kernel ID');
    const response = await this.send(
      `api/kernels/${encodeURIComponent(kernelId)}`,
      AbortSignal.timeout(30000),
      'DELETE',
    );
    await response.body?.cancel();
    if (response.status !== 204)
      throw new Error(
        `Jupyter shutdown returned HTTP ${response.status}. No process signal was sent.`,
      );
  }
}
