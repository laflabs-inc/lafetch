import type { Transport, TransportContext } from "../core/types.js";

export type MockHandler = (request: Request, context: TransportContext) => Response | Promise<Response>;

export interface MockCall {
  readonly request: Request;
  readonly context: TransportContext;
}

export class MockTransport implements Transport {
  readonly name = "mock";
  readonly calls: MockCall[] = [];

  constructor(private readonly handler: MockHandler) {}

  async send(request: Request, context: TransportContext): Promise<Response> {
    this.calls.push({ request, context });
    return await this.handler(request, context);
  }
}

export function mockTransport(handler: MockHandler): MockTransport {
  return new MockTransport(handler);
}

