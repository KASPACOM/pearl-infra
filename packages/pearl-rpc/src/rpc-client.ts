import type { PearlRpcConfig } from './network.js';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: unknown[];
}

export interface JsonRpcResponse<T> {
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

export class PearlRpcError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: number,
    message: string,
  ) {
    super(`pearld ${method}: ${message}`);
  }
}

export class PearlRpcClient {
  private nextId = 1;

  constructor(private readonly config: PearlRpcConfig) {}

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method,
      params,
    };

    const headers = new Headers({ 'content-type': 'application/json' });
    if (this.config.user) {
      const credentials = Buffer.from(`${this.config.user}:${this.config.pass ?? ''}`).toString('base64');
      headers.set('authorization', `Basic ${credentials}`);
    }

    const response = await fetch(this.config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`pearld ${method}: HTTP ${response.status}`);
    }

    const body = (await response.json()) as JsonRpcResponse<T>;
    if (body.error) {
      throw new PearlRpcError(method, body.error.code, body.error.message);
    }
    if (!('result' in body)) {
      throw new Error(`pearld ${method}: missing result`);
    }

    return body.result as T;
  }
}
